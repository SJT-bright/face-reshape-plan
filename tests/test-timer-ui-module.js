/* 真实模块计时测试：require 真实 strength.js，调用真实的
   Strength._ensureTimerFor / _flushTimer / tick / _saveActual（含 openModal 弹窗处理器），
   只 stub 环境全局（Store/App/$/…）与可控时钟 Core.businessDate。
   不把任何被测实现复制进测试。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');
const Strength = require('../src/js/strength');

const TODAY = '2026-09-13';
const TOMORROW = '2026-09-14';
const NOW = new Date('2026-09-13T01:00:00.000Z');

/* ---------- 环境全局 stub（只提供浏览器环境，不含任何被测逻辑） ---------- */
let toastMessages = [];
global.toast = (msg) => { toastMessages.push(msg); };
global.esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
global.fmtSeconds = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
global.confirmModal = async () => true;
let lastModal = null;
const modalCard = {
  _handlers: {},
  querySelector(sel) {
    if (!this._handlers[sel]) {
      this._handlers[sel] = { onclick: null, value: sel === '#st-fin-text' ? ' 今天的收获 ' : '' };
    }
    return this._handlers[sel];
  }
};
global.openModal = (html) => { lastModal = html; modalCard._handlers = {}; return modalCard; };
global.closeModal = () => { lastModal = null; };
global.$ = (sel, root) => {
  if (root && typeof root.querySelector === 'function') {
    const found = root.querySelector(sel);
    if (found) return found;
  }
  if (lastModal) return modalCard.querySelector(sel);
  return { onclick: null, value: '' };
};
global.$$ = (sel) => (typeof sel === 'string' && sel.includes('.st-tr') ? global.__rows || [] : []);

/* 可控时钟：只替换 Core.businessDate，测毕还原 */
let clockDate = TODAY;
const origBusinessDate = Core.businessDate;
Core.businessDate = () => clockDate;
test.afterEach?.(() => {});
process.on('exit', () => { Core.businessDate = origBusinessDate; });

function freshState() {
  const state = Core.normalize({});
  const r = Core.replaceTemplate(state, {
    name: '三分化', days: [
      { dayKey: 'push', name: '推日', actions: [{ name: '卧推', plannedSets: 4, plannedRepsText: '10' }] },
      { dayKey: 'pull', name: '拉日', actions: [{ name: '划船', plannedSets: 4, plannedRepsText: '10' }] }
    ]
  }, NOW);
  assert.ok(r.ok, r.error);
  return state;
}

/* 真实 Strength 所依赖的 Store/App stub：db 指向隔离 state */
let state;
global.Store = { db: null, save() {} };
global.App = { currentView: 'strength', render() {} };
function bootWith(s) { state = s; global.Store.db = { strength: s }; }

/* 构造 _saveActual 可读的动作行（1 个动作：4 组 × 10 次 × 40kg） */
function saveRoot() {
  const fields = { setsDone: { value: '4' }, repsText: { value: '10' }, weightKg: { value: '40' } };
  const tr = {
    querySelector(sel) {
      if (sel === '.st-num') return {};
      if (sel === '[data-idx]') return { dataset: { idx: '0' } };
      const m = sel && sel.match(/data-key="(\w+)"/);
      return m ? (fields[m[1]] ?? null) : null;
    }
  };
  global.__rows = [tr];
  return { querySelector: () => null, querySelectorAll: () => [tr] };
}

function seedToday() {
  bootWith(freshState());
  const r = Core.startTraining(state, { date: TODAY }, NOW);
  assert.ok(r.ok, r.error);
  Strength.ui = { tab: 'today', muscle: null, date: null, historyPage: 1, tplDraft: null };
  Strength.timer = null;
  Strength._ensureTimerFor(Core.dayRecord(state, TODAY), TODAY);
  return Core.dayRecord(state, TODAY);
}

test('真实 tick：每秒累计，30 秒周期经真实 _flushTimer 落盘', () => {
  const day = seedToday();
  for (let i = 0; i < 35; i++) Strength.tick();
  assert.equal(day.totalSeconds, 30, '30 秒周期真实落盘一次');
  assert.equal(Strength.timer.seconds, 5, '落盘后从 0 续计');
  assert.equal(Strength.timer.running, true);
});

test('P1-1 真实 _saveActual：保存后秒表继续走，无双计不丢秒', async () => {
  const day = seedToday();
  for (let i = 0; i < 30; i++) Strength.tick();      // 周期落盘 30s
  for (let i = 0; i < 5; i++) Strength.tick();       // 未落盘 5s
  await Strength._saveActual(saveRoot(), day, false); // 真实保存（内部先 flush 再 ensure）
  assert.equal(day.totalSeconds, 35, '保存前未落盘的 5 秒一并落盘');
  assert.equal(Strength.timer.running, true, '保存后秒表继续走');
  assert.equal(Strength.timer.seconds, 0, '从 0 续计，不双计');
  for (let i = 0; i < 10; i++) Strength.tick();
  // 界面显示总量 = 已落盘 + 当前秒表（10 秒还在秒表里，未到 30 秒周期）
  assert.equal(day.totalSeconds + Strength.timer.seconds, 45, '保存后再走 10 秒正确累计');
  assert.equal(day.totalSeconds, 35, '落盘值不被重复累计');
});

test('P1-1 暂停后保存：保持暂停，秒表不恢复不累计', async () => {
  const day = seedToday();
  for (let i = 0; i < 10; i++) Strength.tick();
  // 真实暂停按钮处理器的完整接线：先落秒 → pauseTraining → ensure
  Strength._flushTimer();
  Core.pauseTraining(state, { date: TODAY }, NOW);
  Strength._ensureTimerFor(Core.dayRecord(state, TODAY), TODAY);
  assert.equal(Strength.timer.running, false, '暂停即停表');
  await Strength._saveActual(saveRoot(), day, false);
  assert.equal(Strength.timer.running, false, '暂停态保存后不恢复走秒');
  const before = day.totalSeconds;
  Strength.tick();
  Strength.tick();
  assert.equal(day.totalSeconds, before, '暂停期间 tick 不累计');
});

test('P1-1 取消收尾弹窗：训练仍在进行，秒表恢复', async () => {
  const day = seedToday();
  for (let i = 0; i < 12; i++) Strength.tick();
  await Strength._saveActual(saveRoot(), day, true); // withFinish → 弹窗
  assert.ok(lastModal, '应弹出收尾弹窗');
  modalCard.querySelector('#st-fin-cancel').onclick(); // 真实取消处理器
  assert.equal(Strength.timer.running, true, '取消收尾后秒表恢复');
  assert.equal(Core.dayRecord(state, TODAY).status, 'in-progress');
});

test('P1-1 完成收尾：秒表清空并轮转', async () => {
  const day = seedToday();
  for (let i = 0; i < 5; i++) Strength.tick();
  await Strength._saveActual(saveRoot(), day, true);
  modalCard.querySelector('#st-fin-ok').onclick();
  assert.equal(Strength.timer, null);
  assert.equal(Core.dayRecord(state, TODAY).status, 'completed');
});

test('切日期边界：真实 _flushTimer 把秒数落回拥有日期，另一日期不受污染', () => {
  const day = seedToday();
  for (let i = 0; i < 25; i++) Strength.tick();
  Strength._flushTimer(); // _bindDateNav.set 切日期前的真实调用
  assert.equal(day.totalSeconds, 25);
  Strength.timer = null;
  assert.equal(Object.keys(state.days).length, 1, '不产生其他日期的记录');
});

test('午夜边界（可控时钟）：零点前未落盘秒数保留在原日期，零点后不写回', () => {
  const day = seedToday();
  clockDate = TODAY;
  for (let i = 0; i < 20; i++) Strength.tick(); // 零点前累计 20 秒，未到 30 秒周期，未落盘
  assert.equal(day.totalSeconds, 0);
  clockDate = TOMORROW;                          // 跨零点
  Strength.tick();                               // 跨零点后第一 tick
  assert.equal(day.totalSeconds, 20, '零点前累计的 20 秒保留在原日期');
  assert.equal(Strength.timer.running, false, '跨零点后停表');
  assert.equal(state.days[TOMORROW], undefined, '零点后时间不写进新日期');
  Strength.tick();
  Strength.tick();
  assert.equal(day.totalSeconds, 20, '停表后不再累计');
  clockDate = TODAY;
});

test('补记防线：过去日期没有 timer（真实 ensure 不启动秒表）', () => {
  bootWith(freshState());
  Strength.timer = null;
  Core.selectCycleDay(state, { templateId: state.templates[0].id, dayKey: 'push' }, NOW);
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  Strength._ensureTimerFor(Core.dayRecord(state, '2026-09-12'), TODAY);
  assert.equal(Strength.timer, null);
  assert.equal(state.days['2026-09-12'].totalSeconds, 0);
});
