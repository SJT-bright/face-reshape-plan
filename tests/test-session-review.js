'use strict';
/* ======================================================================
   跟练计时（Session）测试（node:test 正式固化）
   被测对象 = 真实 src/js/app.js 的 Session（由 /tmp/session-review.js
   已验证可运行的隔离 harness 整理而成）。

   app.js 无 module.exports 且顶层有 document.addEventListener('DOMContentLoaded',…)，
   因此沿用 harness 的加载方式：stub document / window / Store / Views /
   hhmm / fmtSeconds / uid / todayKey / followCompletion 等后，
   用 new Function 求值 app.js 源码并取出真实 Session / App。

   铁律：
   - 只读产品代码，不修改任何产品源码；
   - native.notify 只记录调用，绝不发真实系统通知；
   - Store = 真实 store 逻辑 + 测试内合成 db（save 空操作、不读任何真实用户数据）；
   - 计时通过手动逐次调用 Session.tick() 驱动，不依赖 setInterval / wall-clock。
   ====================================================================== */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

/* ---------------- stub 收集器与环境 ---------------- */
let TODAY = '2026-09-15';          /* 可推进的「今天」（跨天用例用） */
const notifyCalls = [];            /* native.notify 调用记录（只记录，不发通知） */
const toasts = [];                 /* toast 记录 */
const updateCalls = [];            /* Store.updateTrainingEntry 的 dateKey 侦察记录 */

const nativeStub = {
  isMac: true,
  addEventListener() {},
  /* 铁律：通知必须 stub —— 只记录，绝不发真实通知 */
  notify(title, body) { notifyCalls.push({ title, body }); }
};
const documentStub = {
  addEventListener() {},           /* 吞掉 app.js 底部的 DOMContentLoaded */
  querySelector() { return null; },
  getElementById() { return null; }
};
global.native = nativeStub;        /* app.js _warnIfSuspicious 用裸 native */
global.document = documentStub;    /* util.js 的 $ 走全局 document */
global.window = { native: nativeStub, addEventListener() {}, isMac: true };

/* ---------------- 真实 util.js / store.js ---------------- */
const U = require(path.join(ROOT, 'src/js/util.js'));        /* fmtSeconds/uid/followCompletion/$/$$/esc/addDays… */
const RealStore = require(path.join(ROOT, 'src/js/store.js'));

function freshDb() {
  /* 合成 db，绝不触碰真实用户数据 */
  return {
    videos: [{ id: 'v1', title: 'A', durationSec: 600 }],
    sessions: [],
    logs: { training: {}, skincare: {} },
    settings: {}
  };
}

/* Store = 真实 store 逻辑 + 合成 db + save 空操作 + updateTrainingEntry 侦察
   （addTrainingEntry / updateTrainingEntry 的账本逻辑仍是真实实现） */
const Store = Object.create(RealStore);
Store.db = freshDb();
Store.save = () => {};
const realUpdate = RealStore.updateTrainingEntry;
Store.updateTrainingEntry = function (dateKeyStr, entryId, patch) {
  updateCalls.push({ dateKey: dateKeyStr, entryId, patch });
  return realUpdate.call(this, dateKeyStr, entryId, patch);
};

const Views = { syncTimerUI() {}, checkBadgeUnlocks() {} };

/* ---------------- new Function 求值真实 app.js，取出 Session / App ---------------- */
const appSrc = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const factory = new Function(
  'document', 'window', 'native', 'Store', 'Views',
  'Strength', 'Skincare', 'Rhythm', 'Bilibili', 'RhythmEngine',
  'toast', 'uid', 'todayKey', 'hhmm', 'fmtSeconds', 'fmtDuration',
  'esc', 'followCompletion', 'minutesOf', 'addDays',
  '$', '$$', 'openModal', 'closeModal', 'confirmModal',
  '"use strict";\n' + appSrc + '\n;return { Session, App };'
);
const { Session, App } = factory(
  documentStub, global.window, nativeStub, Store, Views,
  { boot() {}, tick() {}, view() {} },           /* Strength（boot 不执行） */
  { view() {} }, { view() {} }, { parse() {} },  /* Skincare / Rhythm / Bilibili */
  { normalize: (d) => d },                       /* RhythmEngine */
  (m) => { toasts.push(m); },                    /* toast stub（记录） */
  U.uid, () => TODAY, () => '12:00',             /* uid / todayKey / hhmm（todayKey 可推进） */
  U.fmtSeconds, U.fmtDuration, U.esc, U.followCompletion, U.minutesOf, U.addDays,
  U.$, U.$$,
  () => null, () => null, async () => true       /* openModal / closeModal / confirmModal stub */
);

function freshSession(videoId) {
  /* 干净起点：结束遗留会话、重置计数器、换新合成 db、清空记录 */
  if (Session.active) Session.stop();
  Session._saveCounter = 0;
  Store.db = freshDb();
  notifyCalls.length = 0;
  updateCalls.length = 0;
  App.hiddenSince = null;
  assert.equal(Session.start(videoId, null), true);
  return Session.active;
}
const todayEntries = () => Store.db.logs.training[TODAY].entries;

/* =====================================================================
   a) 正常计时：start 后手动 tick 5 次 → seconds === 5
   ===================================================================== */
test('a) start 后 tick 5 次 → seconds===5（start 即建 0 秒条目）', () => {
  const a = freshSession('v1');
  assert.equal(a.seconds, 0, 'start 后初始秒数为 0');
  assert.equal(a.dateKey, '2026-09-15', 'start 时 dateKey 固定为当天');
  assert.equal(todayEntries().length, 1, 'start 即写入 0 秒台账条目');
  for (let i = 0; i < 5; i++) Session.tick();
  assert.equal(a.seconds, 5, '5 次 tick → 5 秒');
  assert.equal(a.running, true, '会话处于计时中');
});

/* =====================================================================
   b) 暂停/休眠等价：togglePause 后 tick 不增；
      Date.now() 前跳 1 小时后 tick 仅 +1（计时不基于 wall-clock）
   ===================================================================== */
test('b) togglePause 后 tick 不增；wall-clock 前跳 1 小时不吃差值（休眠等价）', () => {
  const a = freshSession('v1');
  for (let i = 0; i < 5; i++) Session.tick();          /* 5 秒 */
  Session.togglePause();                                /* running=false */
  assert.equal(a.running, false);
  for (let i = 0; i < 3; i++) Session.tick();           /* 暂停中 tick 无效果 */
  assert.equal(a.seconds, 5, '暂停后 3 次 tick 秒数不变');
  Session.togglePause();                                /* 恢复 */
  const realNow = Date.now;
  Date.now = () => realNow() + 3600000;                 /* 模拟休眠/时钟前跳 1 小时 */
  Session.tick();                                       /* 只应 +1，不吃回 wall-clock 差值 */
  Date.now = realNow;
  assert.equal(a.seconds, 6, '前跳 1 小时后 1 次 tick 仅 +1（tick 为 seconds++，不做 Date.now 差值）');
});

/* =====================================================================
   c) 防呆通知A：seconds=1799 → tick → native.notify 记录含「30 分钟」恰一次
   ===================================================================== */
test('c) seconds=1799 → tick → notify 含「30 分钟」恰一次', () => {
  const a = freshSession('v1');
  a.seconds = 1799;
  assert.equal(notifyCalls.length, 0, '触发前无通知');
  Session.tick();                                       /* 1799 → 1800，1800%1800===0 */
  const hits = notifyCalls.filter(c => c.title.includes('跟练计时进行中') && c.body.includes('30 分钟'));
  assert.equal(hits.length, 1, `含「30 分钟」的 notify 应恰 1 次，实际 ${hits.length}`);
  assert.equal(notifyCalls.length, 1, '该 tick 只产生 1 条通知（30 分钟分支 return，不再走失焦提醒）');
  assert.match(hits[0].body, /已计时 30 分钟/, `body 文案正确：${hits[0].body}`);
});

/* =====================================================================
   d) 防呆通知B：hiddenSince 超 2 分钟 + seconds=299 → tick → notify 含「不在前台」；
      无 hiddenSince 时同场景不触发
   ===================================================================== */
test('d) hiddenSince≥2min 且 seconds=299 → notify「不在前台」；无 hiddenSince 不触发', () => {
  const a = freshSession('v1');
  a.seconds = 299;
  App.hiddenSince = Date.now() - 130000;                /* 失焦 130s ≥ 120s */
  Session.tick();                                       /* 299 → 300，300%300===0 */
  assert.equal(notifyCalls.length, 1, '触发 1 条通知');
  assert.ok(notifyCalls[0].title.includes('不在前台'), `title 含「不在前台」：${notifyCalls[0].title}`);

  /* 对照组：同场景（seconds 299→300）但无 hiddenSince → 不触发 */
  const b = freshSession('v1');
  b.seconds = 299;
  App.hiddenSince = null;
  Session.tick();
  assert.equal(notifyCalls.length, 0, '无 hiddenSince 时不发通知');
});

/* =====================================================================
   e) 跨天归账：start 后把「今天」推进，stop() 经 Store stub 写回开始日 dateKey
   ===================================================================== */
test('e) 跨天归账：stop() 传给 updateTrainingEntry 的 dateKey 为开始日', () => {
  const a = freshSession('v1');
  const startDay = TODAY;                               /* '2026-09-15' */
  assert.equal(a.dateKey, startDay);
  for (let i = 0; i < 3; i++) Session.tick();           /* 3 秒 */
  TODAY = '2026-09-16';                                 /* 人为推进「今天」 */
  const ret = Session.stop();
  TODAY = startDay;
  assert.equal(ret, 3, 'stop 返回累计秒数');
  assert.ok(updateCalls.length > 0, 'stop 必然调用 Store.updateTrainingEntry');
  assert.ok(updateCalls.every(c => c.dateKey === startDay),
    `所有 updateTrainingEntry 收到的 dateKey 都应是开始日 ${startDay}，实际 [${[...new Set(updateCalls.map(c => c.dateKey))].join(',')}]`);
  const finalPatch = updateCalls[updateCalls.length - 1].patch;
  assert.equal(finalPatch.seconds, 3, '终值 patch.seconds = 3');
  assert.equal(Store.db.logs.training['2026-09-16'], undefined, '不得在新的一天（2026-09-16）建台账');
});

/* =====================================================================
   f) 完播：durationSec=600 视频，500s stop → completed=true；300s → false
      （真实 util.followCompletion：阈值 max(120, 600*0.8)=480）
   ===================================================================== */
test('f) 完播判定：600s 视频 500s → completed=true；300s → false', () => {
  freshSession('v1');
  Session.active.seconds = 500;                         /* 500 ≥ 480 → 完整 */
  Session.stop();
  assert.equal(todayEntries()[0].completed, true, '500s ≥ 阈值 480 → completed=true');

  freshSession('v1');
  Session.active.seconds = 300;                         /* 300 < 480 → 不完整 */
  Session.stop();
  assert.equal(todayEntries()[0].completed, false, '300s < 阈值 480 → completed=false');
});
