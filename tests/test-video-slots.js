/* E：早晚槽位独立 + 数据分账。
   Store 分账（byPeriod 汇总、period 入账、旧数据兼容、损坏记录防御）
   与首页槽位记忆（UX 槽位读写、早晚互不覆盖、按日重置、重启仍在、会话时段归属）。
   使用真实 Store / UX（vm 加载）；全部数据为内存合成记录，不访问正式用户资料。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const util = require('../src/js/util');
const StoreCore = require('../src/js/store');

const TODAY = '2026-10-11';
const YESTERDAY = '2026-10-10';
const clone = value => JSON.parse(JSON.stringify(value));
Object.assign(global, { todayKey: () => TODAY, uid: util.uid, addDays: util.addDays, daysBetween: util.daysBetween, minutesOf: util.minutesOf, hhmm: util.hhmm, esc: util.esc });
global.RhythmEngine = { normalize: value => value || { sleeps: [], meals: [] } };

function baseData() {
  return {
    version: 1,
    videos: [
      { id: 'face-a', title: '早课 A', source: 'bilibili', bvid: 'BV1xx411c7mA', page: 1, durationSec: 600 },
      { id: 'face-b', title: '晚课 B', source: 'bilibili', bvid: 'BV1xx411c7mB', page: 1, durationSec: 600 },
      { id: 'awake-a', title: '唤醒 A', source: 'bilibili', bvid: 'BV1xx411c7mC', page: 1, durationSec: 600, collectionId: 'awakening' }
    ],
    sessions: [],
    settings: { dailyTargetMinutes: 15 },
    logs: { training: {}, skincare: {}, videoWatching: {} },
    skincare: { cycles: [] }
  };
}

async function makeStore(data = baseData()) {
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

/* ---------- Store 分账 ---------- */

test('分账入账：早晚两段各记各的，总数=两段之和，entry 打上 period', async () => {
  const { store } = await makeStore();
  store.addTrainingEntry(TODAY, { id: 'm1', videoId: 'face-a', seconds: 300, period: 'morning', start: '08:00' });
  store.addTrainingEntry(TODAY, { id: 'e1', videoId: 'face-b', seconds: 200, period: 'evening', start: '21:00' });
  const day = store.dayTraining(TODAY);
  assert.equal(day.seconds, 500);
  assert.deepEqual(day.byPeriod, { morning: 300, evening: 200 });
  assert.deepEqual(day.entries.map(e => e.period), ['morning', 'evening']);
  assert.equal(store.dayTrainingPeriod(TODAY, 'morning'), 300);
  assert.equal(store.dayTrainingPeriod(TODAY, 'evening'), 200);
  assert.equal(store.dayTrainingPeriod(TODAY), 500, '缺省时段返回总数');
  assert.equal(store.dayTrainingPeriod(TODAY, 'all'), 500);
});

test('分账改/删：改秒数同步差值，跨时段改写会搬槽位，删除扣回原时段', async () => {
  const { store } = await makeStore();
  store.addTrainingEntry(TODAY, { id: 'm1', videoId: 'face-a', seconds: 300, period: 'morning' });
  store.updateTrainingEntry(TODAY, 'm1', { seconds: 480 });
  assert.deepEqual(store.dayTraining(TODAY).byPeriod, { morning: 480 });
  /* patch 带 period：从早上搬去晚上，总数不变 */
  store.updateTrainingEntry(TODAY, 'm1', { seconds: 480, period: 'evening' });
  assert.equal(store.dayTraining(TODAY).seconds, 480);
  assert.deepEqual(store.dayTraining(TODAY).byPeriod, { evening: 480 });
  store.removeTrainingEntry(TODAY, 'm1');
  assert.equal(store.dayTraining(TODAY).seconds, 0);
  assert.equal(store.dayTraining(TODAY).byPeriod, undefined, '重建式分账：无分账数据时不留空/坏键');
});

test('观看板块同路径分账：add/update/remove 均按时段汇总，face 账本不受影响', async () => {
  const { store } = await makeStore();
  store.addWatchingEntry(TODAY, { id: 'w1', videoId: 'awake-a', seconds: 120, period: 'morning' }, 'awakening');
  store.addWatchingEntry(TODAY, { id: 'w2', videoId: 'awake-a', seconds: 240, period: 'evening' }, 'awakening');
  let day = store.dayWatching(TODAY, 'awakening');
  assert.equal(day.seconds, 360);
  assert.deepEqual(day.byPeriod, { morning: 120, evening: 240 });
  assert.equal(store.dayWatchingPeriod(TODAY, 'morning', 'awakening'), 120);
  assert.equal(store.dayWatchingPeriod(TODAY, 'evening', 'awakening'), 240);
  store.updateWatchingEntry(TODAY, 'w1', { seconds: 300 }, 'awakening');
  assert.deepEqual(store.dayWatching(TODAY, 'awakening').byPeriod, { morning: 300, evening: 240 });
  store.removeWatchingEntry(TODAY, 'w1', 'awakening');
  assert.deepEqual(store.dayWatching(TODAY, 'awakening').byPeriod, { evening: 240 });
  assert.equal(store.dayTraining(TODAY).seconds, 0, '观看不进瘦脸账本');
});

test('无显式 period 时按 entry.start 推断（上午→morning，午后→evening）并回写 entry', async () => {
  const { store } = await makeStore();
  store.addTrainingEntry(TODAY, { id: 'a1', videoId: 'face-a', seconds: 60, start: '09:30' });
  store.addTrainingEntry(TODAY, { id: 'a2', videoId: 'face-a', seconds: 60, start: '13:00' });
  store.addWatchingEntry(TODAY, { id: 'a3', videoId: 'awake-a', seconds: 60, start: '22:15' }, 'awakening');
  const day = store.dayTraining(TODAY);
  assert.deepEqual(day.byPeriod, { morning: 60, evening: 60 });
  assert.deepEqual(day.entries.map(e => e.period), ['morning', 'evening']);
  assert.deepEqual(store.dayWatching(TODAY, 'awakening').byPeriod, { evening: 60 });
  assert.equal(store.dayTrainingPeriod(TODAY, 'morning'), 60);
});

test('旧记录兼容：无 period/byPeriod 的日子总数与达标判定不变，时段读取为 0', async () => {
  const { store } = await makeStore();
  store.db.logs.training[YESTERDAY] = { seconds: 960, targetMinutes: 15, entries: [{ id: 'old', videoId: 'face-a', seconds: 960, completed: true }] };
  store.save(true);
  assert.equal(store.dayTraining(YESTERDAY).seconds, 960);
  assert.equal(store.dayTrainingPeriod(YESTERDAY, 'morning'), 0, '旧记录没有时段标签');
  assert.equal(store.dayTrainingPeriod(YESTERDAY), 960);
  assert.equal(store.dayTargetMet(YESTERDAY), true, '达标判定不受影响');
  assert.equal(store.dayRatio(YESTERDAY), 960 / 900);
  /* 旧条目没有 start：编辑后也不得凭空生成分账 */
  store.updateTrainingEntry(YESTERDAY, 'old', { seconds: 480 });
  assert.equal(store.dayTraining(YESTERDAY).seconds, 480);
  assert.equal(store.db.logs.training[YESTERDAY].byPeriod, undefined);
});

test('记录损坏不崩溃：byPeriod/entries 类型异常时读取端兜底，总数照常', async () => {
  const { store } = await makeStore();
  store.db.logs.training[TODAY] = { seconds: 300, entries: 'broken', byPeriod: 'broken' };
  assert.equal(store.dayTrainingPeriod(TODAY, 'morning'), 0);
  assert.equal(store.dayTrainingPeriod(TODAY, 'evening'), 0);
  assert.equal(store.dayTrainingPeriod(TODAY), 300);
  /* byPeriod 丢失但 entry 带 period：按标签兜底汇总 */
  store.db.logs.training[TODAY] = { seconds: 400, entries: [{ id: 'x', seconds: 150, period: 'morning' }, { id: 'y', seconds: 250, period: 'evening' }] };
  assert.equal(store.dayTrainingPeriod(TODAY, 'morning'), 150);
  assert.equal(store.dayTrainingPeriod(TODAY, 'evening'), 250);
  /* 完全坏掉的日记录 */
  store.db.logs.training[TODAY] = null;
  assert.equal(store.dayTrainingPeriod(TODAY, 'morning'), 0);
  /* byPeriod 类型坏掉时再入账：在坏字段上重建 */
  store.db.logs.training[TODAY] = { seconds: 0, entries: [], byPeriod: [] };
  store.addTrainingEntry(TODAY, { id: 'z', videoId: 'face-a', seconds: 90, period: 'morning' });
  assert.deepEqual(store.dayTraining(TODAY).byPeriod, { morning: 90 });
});

test('分账与总数随 save/init 持久化（重启后当日分账仍在）', async () => {
  const { store, state } = await makeStore();
  store.addTrainingEntry(TODAY, { id: 'm1', videoId: 'face-a', seconds: 300, period: 'morning' });
  store.addWatchingEntry(TODAY, { id: 'w1', videoId: 'awake-a', seconds: 120, period: 'evening' }, 'awakening');
  await store.init();
  assert.equal(store.dayTraining(TODAY).seconds, 300);
  assert.deepEqual(store.dayTraining(TODAY).byPeriod, { morning: 300 });
  assert.deepEqual(store.dayWatching(TODAY, 'awakening').byPeriod, { evening: 120 });
  assert.equal(state.persisted.logs.training[TODAY].entries[0].period, 'morning');
});

/* ---------- UX 槽位记忆（vm 加载 ux.js，真实 Store） ---------- */

function loadUX(store, extra = {}) {
  const sandbox = {
    ...util, Store: store, window: global.window, console,
    document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    App: { render() {}, go() {}, boot() {} },
    Strength: { _templateView() {}, _saveTemplate() {} },
    Views: {},
    Session: { active: null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ...extra
  };
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', 'src', 'js', 'ux.js');
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\n;this.__UX = UX;', sandbox, { filename: file });
  return sandbox.__UX;
}

test('槽位互不覆盖：早上/晚上各自读写，可相同可不同，「全部」不碰早晚槽位', async () => {
  const { store } = await makeStore();
  const UX = loadUX(store);
  UX.rememberHomeVideo('face', 'morning', 'face-a');
  UX.rememberHomeVideo('face', 'evening', 'face-b');
  assert.equal(UX.slotChoice('face', 'morning').id, 'face-a');
  assert.equal(UX.slotChoice('face', 'evening').id, 'face-b');
  /* 晚上改选不影响早上 */
  UX.rememberHomeVideo('face', 'evening', 'face-a');
  assert.equal(UX.slotChoice('face', 'morning').id, 'face-a');
  assert.equal(UX.slotChoice('face', 'evening').id, 'face-a', '同一视频可同时是两个槽位');
  UX.rememberHomeVideo('face', 'evening', 'face-b');
  assert.equal(UX.slotChoice('face', 'evening').id, 'face-b');
  /* 板块之间也不串 */
  UX.rememberHomeVideo('awakening', 'morning', 'awake-a');
  assert.equal(UX.slotChoice('awakening', 'morning').id, 'awake-a');
  assert.equal(UX.slotChoice('face', 'morning').id, 'face-a');
  /* 「全部」沿用内存记忆，不写持久槽位 */
  UX.rememberHomeVideo('face', null, 'face-b');
  assert.equal(UX.homeVideoChoices.face.id, 'face-b');
  assert.equal(UX.slotChoice('face', null), null, '「全部」不读早晚槽位');
  assert.equal(store.db.settings.videoSlots?.face, undefined, '「全部」不写持久槽位');
});

test('槽位按日重置与持久化：昨天的记忆失效，今天的记忆重启后仍在', async () => {
  const { store, state } = await makeStore();
  const UX = loadUX(store);
  UX.rememberHomeVideo('face', 'morning', 'face-a');
  UX.rememberHomeVideo('face', 'evening', 'face-b');
  assert.equal(state.persisted.settings.videoSlots['face:morning'].date, TODAY);
  /* 模拟跨天：date 变成昨天 → 无记忆；槽位本身还在 */
  store.db.settings.videoSlots['face:morning'].date = YESTERDAY;
  assert.equal(UX.slotChoice('face', 'morning'), null, '昨天的槽位记忆不显示');
  assert.equal(UX.videoSlot('face', 'morning').id, 'face-a');
  /* 视频不属于当前板块或已删除：同样视为无记忆 */
  store.db.settings.videoSlots['face:evening'] = { date: TODAY, id: 'awake-a' };
  assert.equal(UX.slotChoice('face', 'evening'), null);
  store.db.settings.videoSlots['face:evening'] = { date: TODAY, id: 'missing-video' };
  assert.equal(UX.slotChoice('face', 'evening'), null);
  /* 重启（同 profile 再 init）：今天的槽位记忆仍在 */
  UX.rememberHomeVideo('face', 'morning', 'face-a');
  UX.rememberHomeVideo('face', 'evening', 'face-b');
  await store.init();
  const UX2 = loadUX(store);
  assert.equal(UX2.slotChoice('face', 'morning').id, 'face-a');
  assert.equal(UX2.slotChoice('face', 'evening').id, 'face-b');
});

test('会话入账按视图槽位打 period：早上槽位开始的会话记早上，晚上记晚上', async () => {
  const { store } = await makeStore();
  const UX = loadUX(store);
  UX.facePeriod = 'morning';
  store.addWatchingEntry(TODAY, { id: 's1', videoId: 'face-a', seconds: 0, start: '21:00' }, 'face');
  assert.equal(store.dayTraining(TODAY).entries[0].period, 'morning', '早上槽位开始的会话按早上入账（优先于钟点推断）');
  UX.facePeriod = 'evening';
  store.addWatchingEntry(TODAY, { id: 's2', videoId: 'face-a', seconds: 0, start: '08:00' }, 'face');
  assert.equal(store.dayTraining(TODAY).entries[1].period, 'evening', '晚上槽位开始的会话按晚上入账');
  UX.facePeriod = 'all';
  store.addWatchingEntry(TODAY, { id: 's3', videoId: 'face-a', seconds: 0, start: '10:00' }, 'face');
  assert.equal(store.dayTraining(TODAY).entries[2].period, 'morning', '「全部」不标记，由 Store 按 entry.start 推断');
  /* 已带合法 period 的入口不被覆盖（同视频早晚双槽互不混） */
  UX.facePeriod = 'morning';
  store.addWatchingEntry(TODAY, { id: 's4', videoId: 'face-a', seconds: 0, period: 'evening' }, 'face');
  assert.equal(store.dayTraining(TODAY).entries[3].period, 'evening');
  /* 占位 0 秒不产生分账金额，总数不受影响 */
  assert.equal(store.dayTraining(TODAY).seconds, 0);
  assert.equal(store.dayTraining(TODAY).byPeriod, undefined);
});

test('自动流程时段优先于视图时段（Routine.active.period）', async () => {
  const { store } = await makeStore();
  const routine = { active: null };
  const UX = loadUX(store, { Routine: routine });
  UX.facePeriod = 'morning';
  routine.active = { period: 'evening' };
  store.addWatchingEntry(TODAY, { id: 'r1', videoId: 'face-a', seconds: 0, start: '08:00' }, 'face');
  assert.equal(store.dayTraining(TODAY).entries[0].period, 'evening', '自动流程到点的会话按流程时段入账');
  routine.active = null;
  store.addWatchingEntry(TODAY, { id: 'r2', videoId: 'face-a', seconds: 0, start: '08:00' }, 'face');
  assert.equal(store.dayTraining(TODAY).entries[1].period, 'morning', '流程结束后回到视图槽位时段');
});

test('G-2 回归：单时段键损坏后写入按 entry 重建该槽位，不再把坏值当 0 从头算', async () => {
  const { store } = await makeStore();
  store.addTrainingEntry(TODAY, { id: 'm1', videoId: 'face-a', seconds: 120, period: 'morning', start: '08:00' });
  store.addTrainingEntry(TODAY, { id: 'm2', videoId: 'face-a', seconds: 4, period: 'morning', start: '08:30' });
  const day = store.dayTraining(TODAY);
  day.byPeriod.morning = 'oops'; /* 模拟单槽位损坏 */
  store.addTrainingEntry(TODAY, { id: 'm3', videoId: 'face-a', seconds: 6, period: 'morning', start: '09:00' });
  const rebuilt = store.dayTraining(TODAY);
  assert.equal(rebuilt.seconds, 130, '总数不受损坏影响');
  assert.equal(rebuilt.byPeriod.morning, 130, '损坏槽位按 entry 重建（120+4+6），而不是 6');
  assert.equal(store.dayTrainingPeriod(TODAY, 'morning'), 130);
});

test('D4 回归：读取端钳制——byPeriod 异常大数不超过当日总数，负数不小于 0', async () => {
  const { store } = await makeStore();
  store.addTrainingEntry(TODAY, { id: 'm1', videoId: 'face-a', seconds: 100, period: 'morning', start: '08:00' });
  const day = store.dayTraining(TODAY);
  day.byPeriod = { morning: 1e12, evening: -50 };
  assert.equal(store.dayTrainingPeriod(TODAY, 'morning'), 100, '异常大数钳到当日总数');
  assert.equal(store.dayTrainingPeriod(TODAY, 'evening'), 0, '负数钳到 0');
  day.byPeriod = { morning: 'x' };
  assert.equal(store.dayTrainingPeriod(TODAY, 'morning'), 100, '坏类型回退 entry 汇总，同样受总数钳制');
});
