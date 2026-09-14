/* 力量训练 · 文本计划导入解析测试（strength.js _parsePlanText → 模板结构） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Strength = require('../src/js/strength.js');
const Core = require('../src/js/strength-core');

const PLAN = `第一天（胸＋三头）
哑铃卧推 （4组/10/9kg）2min
上斜卧推＋并拢上斜卧推 起始 （4组/10/9kg＋8/9kg）2min
凳上反屈伸 起始 （2组/力竭/20）1min
单臂颈后臂屈伸 起始 （2组/12）2min

第二天（背＋二头＋小臂）
引体向上 起始 （6组/8）2min
哑铃水平转腕（2组/20）1min

练腹日 跟keep
休息`;

test('解析：列约定 左组数 · 中次数 · 右重量；起始与行尾时长进目标列', () => {
  const r = Strength._parsePlanText(PLAN);
  assert.ok(r.ok, r.error);
  const [d1] = r.days;
  assert.equal(d1.bodyPart, '胸');
  const bench = d1.actions[0];
  assert.equal(bench.name, '哑铃卧推');
  assert.equal(bench.plannedSets, 4);
  assert.equal(bench.plannedRepsText, '10');
  assert.equal(bench.plannedWeightText, '9kg');
  assert.equal(bench.targetText, '组间休息2分钟');
  /* 混写 9kg＋8/9kg → 次数 10＋8、重量去重 9kg */
  const incline = d1.actions[1];
  assert.equal(incline.plannedRepsText, '10＋8');
  assert.equal(incline.plannedWeightText, '9kg');
  assert.ok(incline.targetText.includes('起始动作'));
  /* 无单位右列纯数字按重量（右列约定） */
  const dips = d1.actions[2];
  assert.equal(dips.plannedRepsText, '力竭');
  assert.equal(dips.plannedWeightText, '20');
  /* 单 token 只有次数 */
  assert.equal(d1.actions[3].plannedWeightText, '');
  assert.equal(d1.actions[3].plannedRepsText, '12');
});

test('解析：部位识别、休息日、空日占位动作', () => {
  const r = Strength._parsePlanText(PLAN);
  assert.ok(r.ok);
  const back = r.days[1];
  assert.equal(back.bodyPart, '背');
  assert.equal(back.actions[0].plannedWeightText, ''); // 引体向上自重
  const abs = r.days[2];
  assert.equal(abs.name, '练腹日');
  assert.equal(abs.bodyPart, '腹');
  assert.ok(abs.actions.length >= 1); // 空日补占位，满足领域校验
  const rest = r.days[3];
  assert.ok(rest.isRest);
  assert.ok(rest.actions.length >= 1);
});

test('解析结果可直接通过领域校验并走真实导入', () => {
  const r = Strength._parsePlanText(PLAN);
  assert.ok(r.ok);
  const days = r.days.map((d, i) => ({
    dayKey: `d${i + 1}`, name: d.name, bodyPart: d.bodyPart, isRest: d.isRest, note: '', ordinal: i,
    actions: d.actions.map((a, j) => ({
      actionKey: `d${i + 1}a${j + 1}`, name: a.name, plannedSets: a.plannedSets,
      plannedRepsText: a.plannedRepsText, plannedWeightText: a.plannedWeightText,
      targetText: a.targetText, note: '', ordinal: j
    }))
  }));
  assert.equal(Core.validateTemplateInput({ name: 'x', days }), null);
  const state = Core.normalize({});
  const now = new Date().toISOString();
  const rr = Core.importFrom(state, {
    templates: [{ id: 'tpl_parse_test', name: '文本导入', currentRevision: 1, createdAt: now, updatedAt: now,
      versions: [{ revision: 1, effectiveFrom: '2026-09-13', changeNote: 't', createdAt: now, days }] }],
    cycle: { tpl_parse_test: { currentDayKey: 'd1', revision: 1, updatedAt: now } }
  });
  assert.ok(rr.ok, rr.error);
  assert.equal(Core.todayPlan(state).day.name, '第一天（胸＋三头）');
});

test('解析失败场景给出可行动的错误信息', () => {
  assert.equal(Strength._parsePlanText('').ok, false);
  const noHeading = Strength._parsePlanText('哑铃卧推 （4组/10/9kg）2min');
  assert.equal(noHeading.ok, false);
  assert.ok(noHeading.error.includes('训练日标题'));
  const noAction = Strength._parsePlanText('第一天（胸）\n第二天（背）');
  assert.ok(noAction.ok); // 全空日自动补占位动作，导入后可在编辑器里改
  assert.equal(noAction.days[0].actions[0].plannedSets, 0);
});
