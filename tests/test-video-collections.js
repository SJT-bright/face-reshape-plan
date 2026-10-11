/* 视频板块契约：旧库无损迁移、分类隔离、DIY 时段、独立观看日志与保存失败回退。
   使用真实 Store 和 Session；全部数据为内存合成记录，不访问正式用户资料。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const util = require('../src/js/util');
const StoreCore = require('../src/js/store');

const TODAY = '2026-10-03';
const HISTORY = '2026-10-02';
const clone = value => JSON.parse(JSON.stringify(value));
Object.assign(global, { todayKey: () => TODAY, uid: util.uid, addDays: util.addDays, daysBetween: util.daysBetween });
global.RhythmEngine = { normalize: value => value || { sleeps: [], meals: [] } };

function legacyData() {
  return {
    version: 1,
    videos: Array.from({ length: 5 }, (_, i) => ({
      id: 'face-' + i, title: '旧瘦脸课程 ' + (i + 1), source: 'bilibili',
      bvid: 'BV1xx411c7m' + 'ABCDE'[i], page: 1, durationSec: 600,
      favorite: i === 1, lastUsedAt: '2026-09-30T09:00:00Z', customNote: '保留视频原字段'
    })),
    sessions: [{ id: 'old-plan', name: '旧晚间安排', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], videoId: 'face-0', enabled: true }],
    settings: { dailyTargetMinutes: 15, keepInTray: false, theme: 'night' },
    logs: {
      training: { [HISTORY]: { seconds: 120, targetMinutes: 15, entries: [{ id: 'old-entry', videoId: 'face-0', seconds: 120, completed: false, note: '旧训练记录' }] } },
      skincare: { [HISTORY]: { morning: ['clean'], day: [], evening: ['hydrate'] } }
    },
    skincare: { cycles: [{ id: 'old-cycle', startDate: '2026-09-01', steps: { morning: [{ id: 'clean' }], evening: [{ id: 'hydrate' }] } }] },
    rhythm: { sleeps: [{ id: 'old-sleep', recordedMinutes: 450 }], meals: [{ id: 'old-meal', note: '原饮食记录' }] },
    strength: { days: { [HISTORY]: { status: 'completed', actions: [{ name: '原力量记录', setsDone: 3 }] } } },
    skin: { logs: { [HISTORY]: { note: '原皮肤记录', overall: 7 } } },
    achievementsSeen: { follow_lv1: true },
    reminderState: { lastReviewDate: HISTORY }
  };
}

async function makeStore(data = legacyData()) {
  const state = { persisted: clone(data), failNext: false, writes: 0 };
  global.window = { native: {
    loadData: async () => clone(state.persisted),
    saveDataSync: next => {
      if (state.failNext) { state.failNext = false; return false; }
      state.persisted = clone(next); state.writes++; return true;
    }
  } };
  const store = Object.create(StoreCore);
  await store.init();
  return { store, state };
}

function addVideo(store, id, mode, bvid = 'BV1xx411c7mD') {
  return store.addVideo({ id, title: id, source: 'bilibili', bvid, page: 1, durationSec: 600 }, mode);
}

function originalRecords(db) {
  return clone({
    videos: db.videos.filter(v => StoreCore.videoMode(v) === 'face'),
    sessions: db.sessions, training: db.logs.training, skincareLog: db.logs.skincare,
    skincare: db.skincare, rhythm: db.rhythm, strength: db.strength, skin: db.skin,
    achievementsSeen: db.achievementsSeen, reminderState: db.reminderState
  });
}

test('旧库迁移添加瘦脸护理/认知唤醒；旧视频与全部原记录逐字段不变', async () => {
  const legacy = legacyData();
  const before = originalRecords(legacy);
  const { store } = await makeStore(legacy);
  assert.deepEqual(store.collections(), [
    { id: 'face', name: '瘦脸护理', periods: [] },
    { id: 'awakening', name: '认知唤醒', periods: ['morning', 'evening'] }
  ]);
  assert.deepEqual(originalRecords(store.db), before);
  assert.equal(store.currentMode(), 'face');
  assert.equal(store.currentCollection().name, '瘦脸护理');
  assert.equal(store.videosForMode().length, 5);
  assert.equal(store.videosForMode('awakening').length, 0);
  assert.ok(store.db.videos.every(v => !Object.hasOwn(v, 'collectionId')), '不改写旧视频原字段');
});

test('迁移后保存再加载幂等，不复制旧视频、分类或训练记录', async () => {
  const { store, state } = await makeStore();
  store.save(true);
  const committed = clone(state.persisted);
  await store.init();
  assert.deepEqual(store.db, committed);
  assert.equal(store.collections().length, 2);
  assert.equal(store.videosForMode('face').length, 5);
  assert.equal(store.dayTraining(HISTORY).entries.length, 1);
});

test('两边各 5 条视频独立；同 BV 可跨库导入，默认新增跟随当前板块', async () => {
  const { store } = await makeStore();
  const faceIds = store.videosForMode('face').map(v => v.id);
  for (let i = 0; i < 5; i++) addVideo(store, 'awakening-' + i, 'awakening', store.videosForMode('face')[i].bvid);
  store.setMode('awakening');
  assert.equal(store.db.videos.length, 10);
  assert.equal(store.videosForMode().length, 5);
  assert.deepEqual(store.videosForMode('face').map(v => v.id), faceIds);
  assert.ok(store.videosForMode().every(v => v.collectionId === 'awakening'));
  assert.equal(store.videosForMode('face')[0].bvid, store.videosForMode('awakening')[0].bvid);
  assert.notEqual(store.videosForMode('face')[0].id, store.videosForMode('awakening')[0].id);
  addVideo(store, 'current-library-extra');
  assert.equal(store.videosForMode().length, 6);
  assert.equal(store.videoMode(store.videoById('current-library-extra')), 'awakening');
  store.setMode('face');
  assert.equal(store.videosForMode().length, 5);
});

test('DIY 名称/早晚时段/当前板块保存重载；改名保留 id、视频与日志关联', async () => {
  const { store } = await makeStore();
  const collection = store.createCollection('  睡前复盘  ', ['evening']);
  assert.equal(collection.name, '睡前复盘');
  addVideo(store, 'review-video', collection.id);
  store.addWatchingEntry(TODAY, { id: 'review-entry', videoId: 'review-video', seconds: 180 }, collection.id);
  store.setMode(collection.id);
  store.updateCollection(collection.id, { name: '思考练习', periods: ['morning', 'evening'] });
  await store.init();
  assert.equal(store.currentMode(), collection.id);
  assert.deepEqual(store.currentCollection(), { id: collection.id, name: '思考练习', periods: ['morning', 'evening'] });
  assert.equal(store.videosForMode()[0].id, 'review-video');
  assert.equal(store.dayWatching(TODAY).seconds, 180);
  assert.equal(store.dayWatching(TODAY).entries[0].collectionId, collection.id);
  store.updateCollection(collection.id, { periods: ['morning'] });
  await store.init();
  assert.deepEqual(store.currentCollection().periods, ['morning']);
});

test('非法名称、同名、空时段和不存在板块不会部分写入', async () => {
  const { store, state } = await makeStore();
  store.save(true);
  const before = clone(store.db);
  const writes = state.writes;
  for (const action of [
    () => store.createCollection(' ', ['morning']),
    () => store.createCollection('认知唤醒', ['evening']),
    () => store.createCollection('A'.repeat(41), ['morning']),
    () => store.createCollection('无时段', []),
    () => store.updateCollection('awakening', { name: '瘦脸护理' }),
    () => store.updateCollection('awakening', { periods: [] }),
    () => store.setMode('missing'),
    () => addVideo(store, 'missing-video', 'missing')
  ]) {
    assert.throws(action);
    assert.deepEqual(store.db, before);
    assert.equal(state.writes, writes);
  }
});

test('多个板块的观看日志增改删分别累计，face 路径仍写原训练账本', async () => {
  const { store } = await makeStore();
  const custom = store.createCollection('晚上学习', ['evening']);
  store.addWatchingEntry(TODAY, { id: 'face-entry', videoId: 'face-0', seconds: 60 }, 'face');
  store.addWatchingEntry(TODAY, { id: 'awakening-entry', videoId: 'awake', seconds: 240 }, 'awakening');
  store.addWatchingEntry(TODAY, { id: 'custom-entry', videoId: 'custom', seconds: 180 }, custom.id);
  assert.equal(store.dayWatching(TODAY, 'face'), store.dayTraining(TODAY));
  assert.equal(store.dayTraining(TODAY).seconds, 60);
  store.updateWatchingEntry(TODAY, 'awakening-entry', { seconds: 300, completed: true }, 'awakening');
  assert.equal(store.dayWatching(TODAY, 'awakening').seconds, 300);
  assert.equal(store.dayWatching(TODAY, custom.id).seconds, 180);
  store.removeWatchingEntry(TODAY, 'awakening-entry', 'awakening');
  store.removeWatchingEntry(TODAY, 'missing-entry', custom.id);
  assert.deepEqual(store.dayWatching(TODAY, 'awakening'), { seconds: 0, entries: [], targetMinutes: 15 });
  assert.equal(store.dayWatching(TODAY, custom.id).seconds, 180);
  store.updateWatchingEntry(TODAY, 'face-entry', { seconds: 90 }, 'face');
  assert.equal(store.dayTraining(TODAY).seconds, 90);
  store.removeWatchingEntry(TODAY, 'face-entry', 'face');
  assert.equal(store.dayTraining(TODAY).seconds, 0);
});

test('观看 30 分钟不增加瘦脸目标、跟练次数或成就统计', async () => {
  const { store } = await makeStore();
  addVideo(store, 'awake', 'awakening');
  const beforeStats = clone(store.stats());
  const beforeTotals = clone(store.followTotals());
  store.setMode('awakening');
  store.addWatchingEntry(TODAY, { id: 'watch-only', videoId: 'awake', seconds: 1800, completed: true });
  assert.equal(store.dayWatching(TODAY).seconds, 1800);
  assert.equal(store.dayTraining(TODAY).seconds, 0);
  assert.equal(store.dayTargetMet(TODAY), false);
  assert.equal(store.dayRatio(TODAY), 0);
  assert.deepEqual(store.stats(), beforeStats);
  assert.deepEqual(store.followTotals(), beforeTotals);
});

test('videoStats 按视频所属板块选账本，切换 UI 模式不改变统计结果', async () => {
  const { store } = await makeStore();
  addVideo(store, 'awake', 'awakening');
  store.addWatchingEntry(TODAY, { id: 'watch-one', videoId: 'awake', seconds: 300, completed: true }, 'awakening');
  store.addWatchingEntry(HISTORY, { id: 'watch-two', videoId: 'awake', seconds: 120, completed: false }, 'awakening');
  // 故意放入错误账本的同 videoId；所属板块才是统计依据。
  store.db.logs.training[TODAY] = { seconds: 999, entries: [{ id: 'wrong-ledger', videoId: 'awake', seconds: 999, completed: true }] };
  store.db.logs.videoWatching.awakening[TODAY].entries.push({ id: 'wrong-face-ledger', videoId: 'face-0', seconds: 999 });
  assert.deepEqual(store.videoStats('awake'), { total: 2, completed: 1, seconds: 420, days: 2 });
  assert.deepEqual(store.videoStats('face-0'), { total: 1, completed: 0, seconds: 120, days: 1 });
  store.setMode('awakening');
  assert.deepEqual(store.videoStats('awake'), { total: 2, completed: 1, seconds: 420, days: 2 });
  assert.deepEqual(store.videoStats('face-0'), { total: 1, completed: 0, seconds: 120, days: 1 });
});

test('删除一个自建板块仅移除自己的视频/观看日志，原瘦脸与其他板块完整保留', async () => {
  const { store } = await makeStore();
  const original = originalRecords(store.db);
  const deleted = store.createCollection('早晨斗志', ['morning']);
  const retained = store.createCollection('晚间静心', ['evening']);
  addVideo(store, 'remove-video', deleted.id);
  addVideo(store, 'retain-video', retained.id);
  addVideo(store, 'awake', 'awakening');
  store.addWatchingEntry(TODAY, { id: 'remove-entry', videoId: 'remove-video', seconds: 100 }, deleted.id);
  store.addWatchingEntry(TODAY, { id: 'retain-entry', videoId: 'retain-video', seconds: 200 }, retained.id);
  store.addWatchingEntry(TODAY, { id: 'awake-entry', videoId: 'awake', seconds: 300 }, 'awakening');
  const other = clone(store.db.logs.videoWatching[retained.id]);
  const awakening = clone(store.db.logs.videoWatching.awakening);
  store.setMode(deleted.id);
  store.db.activeFollow = { videoId: 'remove-video', mode: deleted.id, seconds: 10, running: false };
  store.save(true);
  assert.equal(store.deleteCollection(deleted.id), true);
  assert.equal(store.collectionById(deleted.id), null);
  assert.equal(store.videoById('remove-video'), null);
  assert.equal(store.db.logs.videoWatching[deleted.id], undefined);
  assert.equal(store.db.activeFollow, null);
  assert.equal(store.currentMode(), 'face');
  assert.deepEqual(originalRecords(store.db), original);
  assert.deepEqual(store.db.logs.videoWatching[retained.id], other);
  assert.deepEqual(store.db.logs.videoWatching.awakening, awakening);
  assert.equal(store.videosForMode(retained.id).length, 1);
  assert.equal(store.videosForMode('awakening').length, 1);
  const after = clone(store.db);
  assert.throws(() => store.deleteCollection('face'), /保留/);
  assert.deepEqual(store.db, after);
  assert.equal(store.deleteCollection(deleted.id), false);
});

test('收藏夹创建/改名/删除/切换保存失败均回退到最后成功状态', async () => {
  const { store, state } = await makeStore();
  const custom = store.createCollection('稳定收藏夹', ['evening']);
  addVideo(store, 'stable-video', custom.id);
  store.addWatchingEntry(TODAY, { id: 'stable-entry', videoId: 'stable-video', seconds: 120 }, custom.id);
  const before = clone(store.db);
  const writes = state.writes;
  for (const action of [
    () => store.createCollection('失败创建', ['morning']),
    () => store.updateCollection(custom.id, { name: '失败改名', periods: ['morning'] }),
    () => store.deleteCollection(custom.id),
    () => store.setMode(custom.id)
  ]) {
    state.failNext = true;
    assert.throws(action, /写入失败/);
    assert.deepEqual(store.db, before);
    assert.deepEqual(state.persisted, before);
    assert.equal(state.writes, writes);
    assert.ok(store._failed, '失败输入保留，供界面重试');
    assert.equal(store.flushSync(), false, '退出不静默重写失败输入');
  }
});

test('视频批量提交和观看记录保存失败不会污染原库，也不会留下假观看时长', async () => {
  const { store, state } = await makeStore();
  store.save(true);
  const before = clone(store.db);
  addVideo(store, 'failed-import', 'awakening');
  state.failNext = true;
  assert.throws(() => store.save(true), /写入失败/);
  assert.deepEqual(store.db, before);
  assert.deepEqual(state.persisted, before);
  state.failNext = true;
  assert.throws(() => store.addWatchingEntry(TODAY, { id: 'failed-watch', videoId: 'face-0', seconds: 900 }, 'awakening'), /写入失败/);
  assert.deepEqual(store.db, before);
  assert.deepEqual(state.persisted, before);
});

test('自定义本地视频删除板块后路径排除表仍持久保存，防止文件夹自动扫描串入瘦脸库', async () => {
  const { store } = await makeStore();
  const custom = store.createCollection('本地认知', ['morning']);
  const original = originalRecords(store.db);
  const video = store.addVideo({ id: 'local-cognitive', source: 'local', localPath: '/synthetic/imported-videos/cognitive.webm', title: '本地认知视频' }, custom.id);
  const firstPath = video.localPath;
  video.localPath = '/synthetic/imported-videos/cognitive-relocated.webm';
  store.rememberVideoPath(video);
  store.rememberVideoPath(video);
  store.save(true);
  assert.deepEqual(store.db.videoFolderExclusions, [firstPath, video.localPath], '重新定位后旧/新路径均记一次');
  store.deleteCollection(custom.id);
  await store.init();
  assert.deepEqual(store.db.videoFolderExclusions, [firstPath, video.localPath]);
  assert.equal(store.videosForMode('face').length, 5);
  assert.equal(store.videoById('local-cognitive'), null);
  assert.deepEqual(originalRecords(store.db), original);
});

test('瘦脸计划快捷导入限定原库，不能复用认知库同 BV 的视频 id', async () => {
  const { store } = await makeStore();
  const bvid = 'BV1xx411c7mZ';
  addVideo(store, 'cognitive-same-bv', 'awakening', bvid);
  store.setMode('awakening');
  let fetched = 0;
  global.window.native.fetchBilibiliInfo = async id => { fetched++; return { ok: true, title: id, cid: 99 }; };
  const sandbox = { ...util, Store: store, window: global.window, console };
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', 'src', 'js', 'templates.js');
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\n;this.__importer = PlanImporter;', sandbox, { filename: file });
  const importer = sandbox.__importer;
  const result = await importer.importLines('瘦脸护理 21:30 每天 ' + bvid);
  assert.equal(result.videos, 1);
  assert.equal(result.sessions, 1);
  assert.equal(store.videosForMode('face').length, 6);
  assert.equal(store.videosForMode('awakening').length, 1);
  const session = store.db.sessions.find(entry => entry.name === '瘦脸护理');
  assert.notEqual(session.videoId, 'cognitive-same-bv');
  assert.equal(store.videoMode(store.videoById(session.videoId)), 'face');
  assert.equal(store.currentMode(), 'awakening', '快捷导入不改变当前收藏夹');
  const again = await importer.importLines('瘦脸护理 21:30 每天 ' + bvid);
  assert.equal(again.videos, 0);
  assert.equal(fetched, 1);
});

function loadSession(store) {
  const sandbox = {
    ...util, Store: store, todayKey: () => TODAY, hhmm: () => '08:00', toast() {},
    native: {}, window: global.window,
    document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    Views: { syncTimerUI() {}, checkBadgeUnlocks() {} },
    $() { return null; }, $$() { return []; }, console
  };
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', 'src', 'js', 'app.js');
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\n;this.__session = Session;', sandbox, { filename: file });
  return sandbox.__session;
}

test('真实 Session 从视频归属确定日志；切换当前板块后继续仍写原观看账本', async () => {
  const { store } = await makeStore();
  addVideo(store, 'awake', 'awakening');
  const before = clone(store.db.logs.training);
  const session = loadSession(store);
  session.start('awake', 'old-plan', { awaitPlay: true });
  assert.equal(session.active.mode, 'awakening');
  assert.equal(session.active.sessionId, null, '认知视频不借用瘦脸计划关联');
  session.beginCounting();
  session.active.seconds = 500;
  store.setMode('face');
  session._persist();
  assert.equal(session.stop(), 500);
  assert.equal(store.dayWatching(TODAY, 'awakening').seconds, 500);
  assert.equal(store.dayWatching(TODAY, 'awakening').entries[0].completed, true);
  assert.deepEqual(store.db.logs.training, before);
  assert.deepEqual(store.videoStats('awake'), { total: 1, completed: 1, seconds: 500, days: 1 });
});

test('认知观看等待态停止不留空记录；随后原瘦脸 Session 正常累计到旧账本', async () => {
  const { store } = await makeStore();
  addVideo(store, 'awake', 'awakening');
  const session = loadSession(store);
  session.start('awake', null, { awaitPlay: true });
  assert.equal(session.stop(), null);
  assert.equal(store.dayWatching(TODAY, 'awakening').entries.length, 0);
  assert.equal(store.dayTraining(TODAY).seconds, 0);
  session.start('face-0', 'old-plan', { awaitPlay: true });
  assert.equal(session.active.mode, 'face');
  assert.equal(session.active.sessionId, 'old-plan');
  session.beginCounting();
  session.active.seconds = 120;
  session.stop();
  assert.equal(store.dayTraining(TODAY).seconds, 120);
  assert.equal(store.dayWatching(TODAY, 'awakening').seconds, 0);
});

test('瘦脸库本地视频 excludeLocalVideo 写入排除表，face 模式不跳过且不重复', async () => {
  const { store } = await makeStore();
  const localPath = '/synthetic/跟练视频/课 1.mp4';
  const video = store.addVideo({ id: 'face-local-delete', source: 'local', localPath, title: '课 1' }, 'face');
  assert.equal(store.videoMode(video), 'face');
  assert.ok(!store.db.videoFolderExclusions.includes(localPath), '加入瘦脸库本身不排除，扫描仍能看到');
  store.excludeLocalVideo(localPath);
  store.excludeLocalVideo(localPath);
  store.excludeLocalVideo('');
  store.excludeLocalVideo(null);
  assert.deepEqual(store.db.videoFolderExclusions, [localPath]);
});
