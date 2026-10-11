/* 渐进超负荷 UI 行为测试（全 stub，不触真实数据/不弹真窗）：
   覆盖 P2-1——「把建议填入表格」在表格里有与建议不同的未保存输入时必须先确认，
   取消则不覆盖；无冲突时直接填充。加载方式与 tests/test-views-render.js 同风格。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Strength = require('../src/js/strength.js');
globalThis.esc = (text) => String(text);

test('缺重量时建议卡显示待补，不误写成自重', () => {
  const line = Strength._adviceTarget({ modeLabel: '巩固', weightKg: null, weightUnknown: true, repsText: '12', sets: 4 });
  assert.match(line, /负重待补/);
  assert.doesNotMatch(line, /自重/);
});

const confirmCalls = [];
const toastCalls = [];
let confirmAnswer = true;
let stubRows = [];
globalThis.toast = (msg) => toastCalls.push(msg);
globalThis.confirmModal = async (title, body, okLabel) => {
  confirmCalls.push({ title, body, okLabel });
  return confirmAnswer;
};
globalThis.$$ = () => stubRows;

function makeRow(idx, vals) {
  const els = {
    setsDone: { value: String(vals.setsDone ?? ''), dataset: { orig: String(vals.setsDone ?? '') } },
    repsText: { value: String(vals.repsText ?? ''), dataset: { orig: String(vals.repsText ?? '') } },
    weightKg: { value: String(vals.weightKg ?? ''), dataset: { orig: String(vals.weightKg ?? '') } }
  };
  return {
    els,
    querySelector(sel) {
      if (sel === '.st-num') return {};
      if (sel === '[data-idx]') return { dataset: { idx: String(idx) } };
      const m = sel.match(/\[data-key="(.+)"\]/);
      return m ? els[m[1]] : null;
    }
  };
}

const advice = {
  items: [
    { actionKey: 'a1', mode: 'hold', sets: 4, repsText: '10', weightKg: 10 },
    { actionKey: 'a2', mode: 'add-reps', sets: 4, repsText: '11-12', weightKg: 10 }
  ]
};
const ctx = { ui: { advice } };

function freshRows() {
  return [
    makeRow(0, { setsDone: '4', repsText: '10', weightKg: '10' }), // 与建议一致 → 非冲突
    makeRow(1, { setsDone: '', repsText: '', weightKg: '' })       // 空 → 非冲突
  ];
}

test('无冲突（空表 / 与建议一致）直接填充，不弹确认', async () => {
  toastCalls.length = 0; confirmCalls.length = 0;
  const rows = freshRows();
  stubRows = rows;
  await Strength._fillFromAdvice.call(ctx, null);
  assert.equal(confirmCalls.length, 0);
  // 真实 DOM 对 el.value 赋数字会强转为字符串；stub 保持原值，这里按字符串比较
  assert.equal(String(rows[1].els.setsDone.value), '4');
  assert.equal(String(rows[1].els.repsText.value), '11-12');
  assert.equal(String(rows[1].els.weightKg.value), '10');
  assert.equal(toastCalls.length, 1);
});

test('有与建议不同的未保存输入 → 先确认；取消则不覆盖、不提示', async () => {
  toastCalls.length = 0; confirmCalls.length = 0; confirmAnswer = false;
  const rows = freshRows();
  rows[1].els.repsText.value = '我手输的次数';
  stubRows = rows;
  await Strength._fillFromAdvice.call(ctx, null);
  assert.equal(confirmCalls.length, 1);
  assert.equal(confirmCalls[0].title, '覆盖已填写的数据？');
  assert.equal(confirmCalls[0].okLabel, '覆盖并填充');
  assert.equal(rows[1].els.repsText.value, '我手输的次数'); // 未被覆盖
  assert.equal(toastCalls.length, 0);
});

test('有差异但用户确认 → 覆盖并提示', async () => {
  toastCalls.length = 0; confirmCalls.length = 0; confirmAnswer = true;
  const rows = freshRows();
  rows[1].els.repsText.value = '我手输的次数';
  stubRows = rows;
  await Strength._fillFromAdvice.call(ctx, null);
  assert.equal(confirmCalls.length, 1);
  assert.equal(rows[1].els.repsText.value, '11-12');
  assert.equal(toastCalls.length, 1);
});

test('start 模式的动作不填充（留空按计划）', async () => {
  toastCalls.length = 0; confirmCalls.length = 0;
  const rows = [makeRow(0, {})]; // 空行，确认填充没有发生
  stubRows = rows;
  const startAdvice = { items: [{ actionKey: 'a1', mode: 'start', sets: 4, repsText: '8-12', weightKg: null }] };
  await Strength._fillFromAdvice.call({ ui: { advice: startAdvice } }, null);
  assert.equal(confirmCalls.length, 0);
  assert.equal(rows[0].els.setsDone.value, '');
  assert.equal(rows[0].els.repsText.value, '');
  assert.equal(toastCalls.length, 1);
});

/* ---------- 动作名历史选择器 + 建议写进模板（真 Core 状态，Store/App 为 stub） ---------- */
const Core = require('../src/js/strength-core');
const NOW = new Date('2026-09-12T02:00:00.000Z');

function seedStrengthState() {
  const state = Core.normalize({});
  Core.replaceTemplate(state, { name: '三分化', days: [
    { dayKey: 'push', name: '推日', actions: [
      { name: '哑铃推举', plannedSets: 4, plannedRepsText: '10', plannedWeightText: '10kg' }] },
    { dayKey: 'pull', name: '拉日', actions: [
      { name: '引体向上', plannedSets: 5, plannedRepsText: '6-8' }] }
  ] }, NOW);
  return state;
}

test('_actionNameOptions：跨模板跨版本去重 + 排序', () => {
  const state = seedStrengthState();
  Core.replaceTemplate(state, { id: state.templates[0].id, name: '三分化 v2', changeNote: '改名', days: [
    { dayKey: 'push', name: '推日', actions: [{ name: ' 哑铃推举 ', plannedSets: 4, plannedRepsText: '10' }] },
    { dayKey: 'pull', name: '拉日', actions: [{ name: '引体向上', plannedSets: 5, plannedRepsText: '6-8' }, { name: '面拉', plannedSets: 3, plannedRepsText: '15' }] }
  ] }, NOW);
  const names = Strength._actionNameOptions(state);
  assert.deepEqual(names, ['哑铃推举', '引体向上', '面拉'].sort((a, b) => a.localeCompare(b, 'zh-CN')));
  assert.equal(new Set(names).size, names.length);
});

test('按建议更新模板：确认后生成新版本，只改有建议值的动作', async () => {
  toastCalls.length = 0; confirmCalls.length = 0; confirmAnswer = true;
  const state = seedStrengthState();
  Core.startTraining(state, { date: '2026-09-15' }, NOW);
  Core.saveTraining(state, { date: '2026-09-15', actions: [
    { actionKey: 'act-1-1', setsDone: 4, repsText: '10', weightKg: 10 }] }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-15' }, NOW);
  const day = state.days['2026-09-15'];
  const advice = Core.nextSessionAdvice(state, day);
  assert.equal(advice.items[0].mode, 'add-reps'); // 10 在 10–12 带内 → 加次数
  let rendered = 0;
  globalThis.Store = { db: { strength: state }, save: () => {} };
  globalThis.App = { render: () => { rendered++; } };
  Strength.ui = { advice };
  await Strength._applyAdviceToTemplate();
  assert.equal(confirmCalls.length, 1);
  const tpl = state.templates[0];
  assert.equal(tpl.currentRevision, 2);
  const act = tpl.versions[1].days[0].actions[0];
  assert.equal(act.plannedRepsText, '11-12'); // 次数推进写入计划
  assert.equal(act.plannedWeightText, '10kg'); // 加次数不改重量
  assert.equal(act.plannedSets, 4);
  assert.equal(rendered, 1);
  assert.ok(toastCalls.some(m => m.includes('第 2 版')));
});

test('按建议更新模板：用户取消则不生成新版本', async () => {
  toastCalls.length = 0; confirmCalls.length = 0; confirmAnswer = false;
  const state = seedStrengthState();
  Core.startTraining(state, { date: '2026-09-15' }, NOW);
  Core.saveTraining(state, { date: '2026-09-15', actions: [
    { actionKey: 'act-1-1', setsDone: 4, repsText: '10', weightKg: 10 }] }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-15' }, NOW);
  const advice = Core.nextSessionAdvice(state, state.days['2026-09-15']);
  Strength.ui = { advice };
  await Strength._applyAdviceToTemplate();
  assert.equal(confirmCalls.length, 1);
  assert.equal(state.templates[0].currentRevision, 1);
  assert.equal(toastCalls.some(m => m.includes('第 2 版')), false);
});

test('按建议更新模板：无建议时提示且不动模板', async () => {
  toastCalls.length = 0; confirmCalls.length = 0;
  const state = seedStrengthState();
  globalThis.Store = { db: { strength: state }, save: () => {} };
  globalThis.App = { render: () => {} };
  Strength.ui = { advice: null };
  await Strength._applyAdviceToTemplate();
  assert.equal(confirmCalls.length, 0);
  assert.ok(toastCalls.some(m => m.includes('还没有可应用的递进建议')));
  assert.equal(state.templates[0].currentRevision, 1);
});

/* ---------- 「自重」文本与记录机制（输入层折算成 0 后，建议/填充/模板写回同一口径） ---------- */
test('按建议填充：自重动作在负重框里填「自重」文本', async () => {
  toastCalls.length = 0; confirmCalls.length = 0;
  const rows = [makeRow(0, { setsDone: '', repsText: '', weightKg: '' })];
  stubRows = rows;
  const advice = { items: [{ actionKey: 'a1', mode: 'hold', sets: 4, repsText: '10', weightKg: null, bodyweight: true }] };
  await Strength._fillFromAdvice.call({ ui: { advice } }, null);
  assert.equal(rows[0].els.weightKg.value, '自重');
  assert.equal(confirmCalls.length, 0);
});

test('按建议更新模板：自重记录把计划负重改写成「自重」，不残留器械重量', async () => {
  toastCalls.length = 0; confirmCalls.length = 0; confirmAnswer = true;
  const state = seedStrengthState();
  Core.startTraining(state, { date: '2026-09-15' }, NOW);
  const bw = Core.parseWeightInput('自重');
  assert.deepEqual(bw, { ok: true, value: 0 });
  Core.saveTraining(state, { date: '2026-09-15', actions: [
    { actionKey: 'act-1-1', setsDone: 4, repsText: '20', weightKg: bw.value }] }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-15' }, NOW);
  const advice = Core.nextSessionAdvice(state, state.days['2026-09-15']);
  assert.equal(advice.items[0].bodyweight, true);
  assert.equal(advice.items[0].weightUnknown, false);
  globalThis.Store = { db: { strength: state }, save: () => {} };
  globalThis.App = { render: () => {} };
  Strength.ui = { advice };
  await Strength._applyAdviceToTemplate();
  const act = state.templates[0].versions[1].days[0].actions[0];
  assert.equal(act.plannedWeightText, '自重'); // 计划原写 10kg，实际记自重 → 写回自重
  assert.equal(state.templates[0].currentRevision, 2);
});
