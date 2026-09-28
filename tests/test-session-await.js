/* 等待播放状态机测试：start(awaitPlay) → 不计时 → beginCounting → 计时；
   等待态停止移除 0 秒条目；计时后停止走完播判定。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* ---------- stub 环境后加载真实 app.js（new Function 提取 Session/App） ---------- */
const util = require('../src/js/util');
const Store = require('../src/js/store');
global.todayKey = () => TODAY;
global.hhmm = () => '12:00';
global.fmtSeconds = util.fmtSeconds;
global.fmtDuration = util.fmtDuration;
global.uid = (p) => (p || 'id') + '_t';
global.followCompletion = util.followCompletion;
global.esc = (s) => String(s == null ? '' : s);
global.toast = () => {};
global.confirmModal = async () => true;
global.document = { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, addEventListener() {} }; } };
global.$ = () => null;
global.$$ = () => [];
global.window = { addEventListener() {}, native: { notify: () => {}, addEventListener() {}, isMac: false } };
global.Views = { syncTimerUI() {}, checkBadgeUnlocks() {} };
const TODAY = '2026-09-16';

function freshStore() {
  const s = Object.create(Store);
  s.db = { videos: [{ id: 'v1', title: 'A', durationSec: 600 }], logs: { training: {}, skincare: {} }, settings: {} };
  s.save = () => {};
  return s;
}
let store = freshStore();
global.Store = store;

const code = fs.readFileSync(path.resolve(__dirname, '../src/js/app.js'), 'utf8');
const factory = new Function('document', 'window', 'Store', 'Views', 'toast', 'hhmm', 'fmtSeconds', 'todayKey', 'uid', 'followCompletion', 'addDays', `${code}\n;return { Session, App };`);
global.addDays = util.addDays;
const { Session, App } = factory(global.document, global.window, store, global.Views, global.toast, global.hhmm, global.fmtSeconds, global.todayKey, global.uid, global.followCompletion, util.addDays);

function fresh() {
  /* 重置同一 Store 实例的 db（app.js 闭包捕获的是首个实例，不可替换） */
  store.db.videos = [{ id: 'v1', title: 'A', durationSec: 600 }];
  store.db.logs = { training: {}, skincare: {} };
  store.db.settings = {};
  Session.active = null;
  Session._saveCounter = 0;
  App.hiddenSince = null;
}

test('等待态：start(awaitPlay) 不计时，beginCounting 后开始', () => {
  fresh();
  Session.start('v1', null, { awaitPlay: true });
  assert.equal(Session.active.awaitingPlay, true);
  assert.equal(Session.active.running, false);
  for (let i = 0; i < 5; i++) Session.tick();
  assert.equal(Session.active.seconds, 0, '等待态不计时');
  assert.equal(Session.beginCounting(), true);
  assert.equal(Session.active.running, true);
  Session.tick();
  assert.equal(Session.active.seconds, 1, 'begin 后恢复计时');
});

test('等待态停止：0 秒占位条目被移除，不污染记录', () => {
  fresh();
  Session.start('v1', null, { awaitPlay: true });
  const sec = Session.stop();
  assert.equal(sec, null);
  assert.equal(store.dayTraining(TODAY).entries.length, 0, '0 秒条目应被移除');
  assert.equal(store.dayTraining(TODAY).seconds, 0);
});

test('计时态停止：条目保留并带完播标记（500s/600s 视频 = 完整）', () => {
  fresh();
  Session.start('v1', null, { awaitPlay: true });
  Session.beginCounting();
  Session.active.seconds = 500;
  const sec = Session.stop();
  assert.equal(sec, 500);
  const en = store.dayTraining(TODAY).entries[0];
  assert.equal(en.completed, true);
  assert.equal(en.seconds, 500);
});

test('逃生门：等待态直接 beginCounting 等价于手动开始', () => {
  fresh();
  Session.start('v1', null, { awaitPlay: true });
  Session.beginCounting();
  Session.togglePause();
  assert.equal(Session.active.running, false, '等待结束后暂停语义正常');
  Session.beginCounting();
  assert.equal(Session.active.awaitingPlay, false, '非等待态 beginCounting 无副作用');
});

test('打断计数：手动暂停计 1 次，后台暂停单独计为技术暂停，恢复不计', () => {
  fresh();
  Session.start('v1', null, { awaitPlay: true });
  Session.beginCounting();
  Session.active.seconds = 60;
  Session.togglePause();              // 手动暂停 → 打断 +1
  assert.equal(Session.active.interruptions, 1);
  assert.equal(Session.active.running, false);
  Session.togglePause();              // 恢复不计数
  assert.equal(Session.active.interruptions, 1);
  assert.equal(Session.active.running, true);
  Session.autoPause('background');    // 切后台单独记为技术暂停
  assert.equal(Session.active.interruptions, 1);
  assert.equal(Session.active.technicalPauses, 1);
  assert.equal(Session.autoResume(), true); // 恢复不计数
  assert.equal(Session.active.interruptions, 1);
  Session._persist();
  const en = store.dayTraining(TODAY).entries[0];
  assert.equal(en.interruptions, 1, '手动打断次数随持久化写入训练条目');
  assert.equal(en.technicalPauses, 1, '技术暂停独立保存，不用于扣分');
});

test('打断计数：等待态未开始计时时手动暂停不计打断', () => {
  fresh();
  Session.start('v1', null, { awaitPlay: true });
  Session.togglePause(); // running=false → 不是打断
  assert.equal(Session.active.interruptions, 0);
});
