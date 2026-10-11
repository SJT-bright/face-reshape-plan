/* 力量训练记录页已去掉秒表。这里确认页面不再暴露 tick / _flushTimer / _ensureTimerFor，
   保存与收尾仍只写组数、次数、负重；旧的 totalSeconds / confirmedDurationMinutes 不被这次保存改写。
   只 stub 环境全局（Store/App/$/…）。不把被测实现复制进测试。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');
const Strength = require('../src/js/strength');

const TODAY = '2026-09-13';
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
global.Store = { db: null, save() { return true; } };
global.App = { currentView: 'strength', render() {} };
function bootWith(s) { state = s; global.Store.db = { strength: s }; }

/* 构造 _saveActual 可读的动作行（1 个动作：4 组 × 10 次 × 40kg） */
function saveRoot() {
  const fields = { setsDone: { value: '4', dataset: { dirty: '1' } }, repsText: { value: '10', dataset: { dirty: '1' } }, weightKg: { value: '40', dataset: { dirty: '1' } } };
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
  return Core.dayRecord(state, TODAY);
}

test('力量训练页不再暴露秒表方法', () => {
  assert.equal(typeof Strength.tick, 'undefined');
  assert.equal(typeof Strength._flushTimer, 'undefined');
  assert.equal(typeof Strength._ensureTimerFor, 'undefined');
  assert.equal(Object.hasOwn(Strength, 'timer'), false);
});

test('保存实际数据只写组数、次数、负重，不改旧时长字段', async () => {
  const day = seedToday();
  day.totalSeconds = 90;
  day.confirmedDurationMinutes = 45;
  await Strength._saveActual(saveRoot(), day, false);
  const saved = Core.dayRecord(state, TODAY);
  assert.equal(saved.actions[0].setsDone, 4);
  assert.equal(saved.actions[0].repsText, '10');
  assert.equal(saved.actions[0].weightKg, 40);
  assert.equal(saved.totalSeconds, 90);
  assert.equal(saved.confirmedDurationMinutes, 45);
});

test('取消收尾弹窗：训练仍在进行', async () => {
  seedToday();
  await Strength._saveActual(saveRoot(), Core.dayRecord(state, TODAY), true);
  assert.ok(lastModal, '应弹出收尾弹窗');
  modalCard.querySelector('#st-fin-cancel').onclick();
  assert.equal(Core.dayRecord(state, TODAY).status, 'in-progress');
  assert.equal(Core.dayRecord(state, TODAY).totalSeconds, 0);
});

test('完成收尾并轮转，不依赖秒表', async () => {
  seedToday();
  await Strength._saveActual(saveRoot(), Core.dayRecord(state, TODAY), true);
  modalCard.querySelector('#st-fin-ok').onclick();
  assert.equal(Core.dayRecord(state, TODAY).status, 'completed');
  assert.equal(Core.dayRecord(state, TODAY).totalSeconds, 0);
});
