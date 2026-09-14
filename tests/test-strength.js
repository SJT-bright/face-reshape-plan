/* 力量训练领域核心测试 —— 用例对应「个人积累库」健身板块的领域测试（service.test.ts 等） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');

const NOW = new Date('2026-09-12T02:00:00.000Z'); // 上海 2026-09-12 10:00

function pushPlan(state, days, now) {
  const r = Core.replaceTemplate(state, {
    name: '三分化力量', days
  }, now);
  assert.ok(r.ok, r.error || '建模板失败');
  return r.template;
}
function planInput(overrides) {
  return Object.assign({
    days: [
      { dayKey: 'push', name: '推日', actions: [
        { name: '俯卧撑', plannedSets: 4, plannedRepsText: '12-15' },
        { name: '哑铃推举', plannedSets: 4, plannedRepsText: '10', plannedWeightText: '10kg' }
      ] },
      { dayKey: 'pull', name: '拉日', actions: [
        { name: '引体向上', plannedSets: 5, plannedRepsText: '6-8' }
      ] },
      { dayKey: 'legs', name: '腿日', actions: [
        { name: '深蹲', plannedSets: 5, plannedRepsText: '8', plannedWeightText: '40kg' }
      ] }
    ]
  }, overrides);
}

test('业务日期按 Asia/Shanghai 归日', () => {
  assert.equal(Core.businessDate(new Date('2026-09-12T15:59:00Z')), '2026-09-12'); // 23:59 上海
  assert.equal(Core.businessDate(new Date('2026-09-12T16:01:00Z')), '2026-09-13'); // 次日 00:01 上海
  assert.ok(Core.isBusinessDate('2026-02-29') === false);
  assert.ok(Core.isBusinessDate('2028-02-29') === true);
});

test('normalize 幂等初始化，兼容旧数据', () => {
  const db = {};
  const s = Core.normalize(db);
  assert.deepEqual(Object.keys(s).sort(), ['cycle', 'days', 'events', 'progress', 'templates']);
  const old = { templates: [{ id: 't1' }], junk: 1 };
  const s2 = Core.normalize({ strength: old });
  assert.equal(s2.templates.length, 1);
  assert.deepEqual(Object.keys(s2).sort(), ['cycle', 'days', 'events', 'progress', 'templates']);
});

test('replaceTemplate：新建是第 1 版，再次替换产生第 2 版且旧版本保留', () => {
  const state = Core.normalize({});
  const tpl = pushPlan(state, planInput().days, NOW);
  assert.equal(tpl.currentRevision, 1);
  const r2 = Core.replaceTemplate(state, { id: tpl.id, name: '三分化力量 v2', changeNote: '加量', days: planInput({ days: [
    { dayKey: 'push', name: '推日·加强', actions: [{ name: '俯卧撑', plannedSets: 5, plannedRepsText: '15-20' }] },
    { dayKey: 'pull', name: '拉日', actions: [{ name: '引体向上', plannedSets: 5, plannedRepsText: '6-8' }] },
    { dayKey: 'legs', name: '腿日', actions: [{ name: '深蹲', plannedSets: 5, plannedRepsText: '8' }] }
  ] }).days }, NOW);
  assert.ok(r2.ok, r2.error);
  assert.equal(r2.template.currentRevision, 2);
  assert.equal(r2.template.versions.length, 2);
  assert.equal(Core.versionOf(r2.template, 1).days[0].name, '推日');       // 旧版本原样保留
  assert.equal(Core.currentVersion(r2.template).days[0].name, '推日·加强');
});

test('模板改版后，已开始的训练日快照不变（历史不可变）', () => {
  const state = Core.normalize({});
  const tpl = pushPlan(state, planInput().days, NOW);
  const start = Core.startTraining(state, { date: '2026-09-12' }, NOW);
  assert.ok(start.ok, start.error);
  const replaced = Core.replaceTemplate(state, { id: tpl.id, name: '三分化力量', days: planInput({ days: [
    { dayKey: 'push', name: '推日·新计划', actions: [{ name: '俯卧撑', plannedSets: 9, plannedRepsText: '30' }] },
    { dayKey: 'pull', name: '拉日', actions: [{ name: '引体向上', plannedSets: 5, plannedRepsText: '6-8' }] },
    { dayKey: 'legs', name: '腿日', actions: [{ name: '深蹲', plannedSets: 5, plannedRepsText: '8' }] }
  ] }).days }, NOW);
  assert.ok(replaced.ok, replaced.error);
  const day = Core.dayRecord(state, '2026-09-12');
  assert.equal(day.name, '推日');                       // 快照仍是开始时的计划
  assert.equal(day.actions[0].plannedSets, 4);
  assert.equal(day.templateRevision, 1);
});

test('start → save → finish-and-advance：状态机、训练量与轮转', () => {
  const state = Core.normalize({});
  pushPlan(state, planInput().days, NOW);
  const start = Core.startTraining(state, { date: '2026-09-12' }, NOW);
  assert.equal(start.day.status, 'in-progress');

  const saved = Core.saveTraining(state, { date: '2026-09-12', totalSeconds: 1500, actions: [
    { actionKey: 'act-1-1', setsDone: 4, repsText: '15', weightKg: null },
    { actionKey: 'act-1-2', setsDone: 4, repsText: '10', weightKg: 10 }
  ] }, NOW);
  assert.ok(saved.ok, saved.error);
  assert.equal(saved.day.status, 'in-progress'); // 填数据不降级状态，收尾时定档
  const vol = Core.volumeOf(saved.day);
  assert.equal(vol.sets, 8);
  assert.equal(vol.volume, (4 * 13.5 * 0) + (4 * 10 * 10)); // 自重计 0，负重 400

  const paused = Core.pauseTraining(state, { date: '2026-09-12' }, NOW);
  assert.equal(paused.day.pausedAt, NOW.toISOString());
  const resumed = Core.resumeTraining(state, { date: '2026-09-12' }, NOW);
  assert.equal(resumed.day.pausedAt, null);

  const finished = Core.finishAndAdvance(state, { date: '2026-09-12', note: '状态不错' }, NOW);
  assert.ok(finished.ok, finished.error);
  assert.equal(finished.day.status, 'completed');
  assert.equal(finished.day.resolution.note, '状态不错');
  assert.equal(state.cycle[finished.day.templateId].currentDayKey, 'pull'); // 轮转到下一训练日

  const types = state.events.map((e) => e.type);
  assert.deepEqual(types, ['started', 'started', 'advanced', 'completed']);
});

test('skip-and-advance 跳过并轮转；连续轮转回到起点', () => {
  const state = Core.normalize({});
  const tpl = pushPlan(state, planInput().days, NOW);
  const start = Core.startTraining(state, { date: '2026-09-12' }, NOW);
  const skip = Core.skipAndAdvance(state, { date: '2026-09-12', note: '没时间' }, NOW);
  assert.ok(skip.ok, skip.error);
  assert.equal(skip.day.status, 'skipped');
  assert.equal(state.cycle[tpl.id].currentDayKey, 'pull');
  // 连续完成 pull、legs 后回到 push
  assert.ok(Core.startTraining(state, { date: '2026-09-13' }, NOW).ok);
  assert.ok(Core.finishAndAdvance(state, { date: '2026-09-13' }, NOW).ok);
  assert.equal(state.cycle[tpl.id].currentDayKey, 'legs');
  assert.ok(Core.startTraining(state, { date: '2026-09-14' }, NOW).ok);
  assert.ok(Core.finishAndAdvance(state, { date: '2026-09-14' }, NOW).ok);
  assert.equal(state.cycle[tpl.id].currentDayKey, 'push');
});

test('收尾后修改被拒绝，reopen 后可继续', () => {
  const state = Core.normalize({});
  pushPlan(state, planInput().days, NOW);
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-12' }, NOW);
  const again = Core.saveTraining(state, { date: '2026-09-12', actions: [{ actionKey: 'act-1-1', setsDone: 1 }] }, NOW);
  assert.equal(again.ok, false);
  const finishAgain = Core.finishAndAdvance(state, { date: '2026-09-12' }, NOW);
  assert.equal(finishAgain.ok, false);
  const reopen = Core.reopenDay(state, { date: '2026-09-12' }, NOW);
  assert.ok(reopen.ok, reopen.error);
  assert.equal(reopen.day.status, 'in-progress');
  assert.equal(reopen.day.resolution, null);
  const saved = Core.saveTraining(state, { date: '2026-09-12', actions: [{ actionKey: 'act-1-1', setsDone: 4, repsText: '15' }] }, NOW);
  assert.ok(saved.ok, saved.error);
  const events = state.events.filter((e) => e.type === 'reset');
  assert.equal(events.length, 1);
});

test('reopen 校验：not-started 不能重开；未收尾不能重复完成', () => {
  const state = Core.normalize({});
  pushPlan(state, planInput().days, NOW);
  assert.equal(Core.reopenDay(state, { date: '2026-09-12' }, NOW).ok, false);
  assert.equal(Core.finishAndAdvance(state, { date: '2026-09-12' }, NOW).ok, false);
});

test('select-cycle-day 手动指定轮转指针', () => {
  const state = Core.normalize({});
  const tpl = pushPlan(state, planInput().days, NOW);
  const r = Core.selectCycleDay(state, { templateId: tpl.id, dayKey: 'legs' }, NOW);
  assert.ok(r.ok, r.error);
  assert.equal(state.cycle[tpl.id].currentDayKey, 'legs');
  const bad = Core.selectCycleDay(state, { templateId: tpl.id, dayKey: 'nope' }, NOW);
  assert.equal(bad.ok, false);
});

test('进步对比：与上一次实际数据的差值', () => {
  const state = Core.normalize({});
  pushPlan(state, planInput().days, NOW);
  // 第 1 轮：push 记录俯卧撑，pull 空过，legs 记录深蹲 40kg
  Core.startTraining(state, { date: '2026-09-01' }, NOW);
  Core.saveTraining(state, { date: '2026-09-01', actions: [{ actionKey: 'act-1-1', setsDone: 4, repsText: '15', weightKg: 5 }] }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-01' }, NOW); // → pull
  Core.startTraining(state, { date: '2026-09-02' }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-02' }, NOW); // → legs
  Core.startTraining(state, { date: '2026-09-03' }, NOW);
  Core.saveTraining(state, { date: '2026-09-03', actions: [{ actionKey: 'act-3-1', setsDone: 5, repsText: '8', weightKg: 40 }] }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-03' }, NOW); // → push
  // 第 2 轮推进到 legs
  Core.startTraining(state, { date: '2026-09-04' }, NOW); Core.finishAndAdvance(state, { date: '2026-09-04' }, NOW);
  Core.startTraining(state, { date: '2026-09-05' }, NOW); Core.finishAndAdvance(state, { date: '2026-09-05' }, NOW);
  const info = Core.todayPlan(state, '2026-09-06');
  assert.equal(info.day.dayKey, 'legs');
  assert.ok(Core.startTraining(state, { date: '2026-09-06' }, NOW).ok);
  const delta = Core.progressDelta(state, state.templates[0].id, 'act-3-1', '2026-09-06', { setsDone: 5, repsText: '8', weightKg: 42.5 });
  assert.ok(delta, '应找到上次记录');
  assert.equal(delta.lastDate, '2026-09-03');
  assert.equal(delta.delta.weightKg, 2.5);
  assert.equal(delta.last.weightKg, 40);
  // 收尾时全部达标定档 completed
  const finished = Core.finishAndAdvance(state, { date: '2026-09-06', note: '深蹲完成' }, NOW);
  assert.equal(finished.day.status, 'completed');
});

test('statsSummary 汇总近 N 天', () => {
  const state = Core.normalize({});
  pushPlan(state, planInput().days, NOW);
  Core.startTraining(state, { date: '2026-09-10' }, NOW);
  Core.saveTraining(state, { date: '2026-09-10', totalSeconds: 1200, actions: [
    { actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 5 },
    { actionKey: 'act-1-2', setsDone: 4, repsText: '10', weightKg: 10 }
  ] }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-10' }, NOW);
  Core.startTraining(state, { date: '2026-09-11' }, NOW);
  Core.skipAndAdvance(state, { date: '2026-09-11' }, NOW);
  const sum = Core.statsSummary(state, '2026-09-12', 30);
  assert.equal(sum.completed, 1);
  assert.equal(sum.skipped, 1);
  assert.equal(sum.seconds, 1200);
  assert.ok(sum.volume > 0);
});

test('校验与边界：坏模板、坏动作、超界数据被拒绝', () => {
  const state = Core.normalize({});
  assert.equal(Core.replaceTemplate(state, { name: '', days: planInput().days }, NOW).ok, false);
  assert.equal(Core.replaceTemplate(state, { name: '空模板', days: [] }, NOW).ok, false);
  assert.equal(Core.replaceTemplate(state, { name: '坏动作', days: [{ name: '日', actions: [{ name: '', plannedSets: 3 }] }] }, NOW).ok, false);
  assert.equal(Core.replaceTemplate(state, { name: '坏组数', days: [{ name: '日', actions: [{ name: '深蹲', plannedSets: -1 }] }] }, NOW).ok, false);
  const badSave = Core.saveTraining(state, { date: '2026-09-12', actions: [{ actionKey: 'ghost', setsDone: 1 }] }, NOW);
  assert.equal(badSave.ok, false);
  const badWeight = Core.saveTraining(state, { date: '2026-09-12', actions: [{ actionKey: 'x', weightKg: -5 }] }, NOW);
  assert.equal(badWeight.ok, false);
  const emptyDecision = Core.recordProgressDecision(state, { note: '  ' }, NOW);
  assert.equal(emptyDecision.ok, false);
});

test('todayPlan 预览不落库，开始后才生成记录', () => {
  const state = Core.normalize({});
  pushPlan(state, planInput().days, NOW);
  const info = Core.todayPlan(state, '2026-09-12');
  assert.equal(info.preview, true);
  assert.equal(info.day.dayKey, 'push');
  assert.equal(Object.keys(state.days).length, 0);
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  assert.equal(Object.keys(state.days).length, 1);
  assert.equal(Core.todayPlan(state, '2026-09-12').preview, false);
});
