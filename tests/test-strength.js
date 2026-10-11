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

test('业务日期按本地时区归日（与全应用口径一致；UTC+8 下即上海日期）', () => {
  assert.equal(Core.businessDate(new Date(2026, 8, 12, 23, 59)), '2026-09-12');
  assert.equal(Core.businessDate(new Date(2026, 8, 13, 0, 1)), '2026-09-13');
  assert.ok(Core.isBusinessDate('2026-02-29') === false);
  assert.ok(Core.isBusinessDate('2028-02-29') === true);
});

test('normalize 幂等初始化，兼容旧数据', () => {
  const db = {};
  const s = Core.normalize(db);
  assert.deepEqual(Object.keys(s).sort(), ['adjustments', 'baselines', 'cycle', 'days', 'events', 'progress', 'templates']);
  const old = { templates: [{ id: 't1' }], junk: 1 };
  const s2 = Core.normalize({ strength: old });
  assert.equal(s2.templates.length, 1);
  assert.deepEqual(Object.keys(s2).sort(), ['adjustments', 'baselines', 'cycle', 'days', 'events', 'progress', 'templates']);
});

test('normalize 保留 bmiProfile（修复跨页面渲染抹除身体档案），垃圾键仍不收', () => {
  const db = { strength: { templates: [], cycle: {}, days: {}, events: [], progress: [], bmiProfile: { heightCm: 160, weightKg: 50, age: 26, sex: '女' }, junk: 1 } };
  const once = Core.normalize(db);
  assert.deepEqual(once.bmiProfile, { heightCm: 160, weightKg: 50, age: 26, sex: '女' });
  assert.equal(once.junk, undefined);
  const twice = Core.normalize(db); // 幂等：二次归一不得丢失
  assert.deepEqual(twice.bmiProfile, { heightCm: 160, weightKg: 50, age: 26, sex: '女' });
  // 空库仍不引入 bmiProfile 键（既有键集断言保持成立）
  const fresh = Core.normalize({});
  assert.equal('bmiProfile' in fresh, false);
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

test('assign-training-day：预览日换训练日；进行中换模板会改动作并保留计时；已收尾拒绝', () => {
  const state = Core.normalize({});
  const a = pushPlan(state, planInput().days, NOW);
  const b = Core.replaceTemplate(state, {
    name: '练三腹一',
    days: [
      { dayKey: 'chest', name: '第一天 · 胸＋三头', actions: [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '10' }] }
    ]
  }, new Date(NOW.getTime() + 1000)).template;
  /* 预览：今天还没开始，换到练三腹一的胸日 */
  const T2 = new Date(NOW.getTime() + 5000);
  const preview = Core.todayPlan(state, '2026-09-12');
  assert.equal(preview.preview, true);
  const sw = Core.assignTrainingDay(state, { date: '2026-09-12', templateId: b.id, dayKey: 'chest' }, T2);
  assert.ok(sw.ok && sw.preview, sw.error);
  const after = Core.todayPlan(state, '2026-09-12');
  assert.equal(after.day.templateId, b.id);
  assert.equal(after.day.dayKey, 'chest');
  assert.equal(after.templateName, '练三腹一');
  /* 开始后换成另一份模板的拉日：动作变、秒数保留 */
  assert.ok(Core.startTraining(state, { date: '2026-09-12' }, T2).ok);
  state.days['2026-09-12'].totalSeconds = 90;
  state.days['2026-09-12'].actions[0].setsDone = 2;
  const mid = Core.assignTrainingDay(state, { date: '2026-09-12', templateId: a.id, dayKey: 'pull' }, new Date(T2.getTime() + 1000));
  assert.ok(mid.ok, mid.error);
  assert.equal(state.days['2026-09-12'].dayKey, 'pull');
  assert.equal(state.days['2026-09-12'].name, '拉日');
  assert.equal(state.days['2026-09-12'].totalSeconds, 90);
  assert.equal(state.days['2026-09-12'].actions[0].name, '引体向上');
  assert.equal(state.days['2026-09-12'].actions[0].setsDone, null);
  /* 收尾后不能换 */
  assert.ok(Core.finishAndAdvance(state, { date: '2026-09-12' }, NOW).ok);
  const locked = Core.assignTrainingDay(state, { date: '2026-09-12', templateId: b.id, dayKey: 'chest' }, NOW);
  assert.equal(locked.ok, false);
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

test('身体基础指标：BMI/中国分类/健康体重范围/BMR/TDEE', () => {
  assert.equal(Core.bmi(170, 65), 22.5);
  assert.equal(Core.bmi(0, 65), null);
  assert.equal(Core.bmi(300, 65), null);
  assert.equal(Core.bmiCategoryCN(22.5), '正常');
  assert.equal(Core.bmiCategoryCN(17), '偏低');
  assert.equal(Core.bmiCategoryCN(25), '超重');
  assert.equal(Core.bmiCategoryCN(29), '肥胖');
  assert.deepEqual(Core.healthyWeightRange(170), { min: 53, max: 69 });
  /* Mifflin-St Jeor：男 70kg/175cm/30岁 → 10*70+6.25*175-5*30+5 = 1649 */
  assert.equal(Core.bmrMifflin('男', 70, 175, 30), 1649);
  assert.equal(Core.bmrMifflin('女', 60, 160, 28), 1299);
  assert.equal(Core.bmrMifflin('男', 70, 175, 5), null);
  const bmr = Core.bmrMifflin('男', 70, 175, 30);
  assert.equal(Core.tdee(bmr, 'moderate'), Math.round(1649 * 1.55));
  assert.equal(Core.tdee(bmr, 'unknown'), null);
});

test('skip-and-advance：不练原因持久化到收尾决议', () => {
  const state = Core.normalize({});
  pushPlan(state, planInput().days, NOW);
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  const r = Core.skipAndAdvance(state, { date: '2026-09-12', note: '熬夜主动休息' }, NOW);
  assert.ok(r.ok, r.error);
  const day = Core.dayRecord(state, '2026-09-12');
  assert.equal(day.status, 'skipped');
  assert.equal(day.resolution.note, '熬夜主动休息');
});

test('逐组记录兜底：汇总缺失时统计以已完成组为准（观测/容量/趋势/上次/肌群）', () => {
  const state = Core.normalize({});
  const now = new Date('2026-09-12T02:00:00.000Z');
  pushPlan(state, [
    { dayKey: 'd1', name: '推日', actions: [{ name: '卧推', plannedSets: 3, plannedRepsText: '10' }] }
  ], now);
  Core.startTraining(state, { date: '2026-09-10' }, now);
  Core.saveTraining(state, { date: '2026-09-10', actions: [{ actionKey: 'act-1-1', sets: [
    { reps: 10, weightKg: 60, done: true },
    { reps: 10, weightKg: 60, done: true },
    { reps: 8, weightKg: 55, done: true },
    { reps: 8, weightKg: 55, done: false }
  ] }] }, now);
  /* 模拟只有逐组事实、汇总字段缺失的旧数据/导入数据 */
  const act = state.days['2026-09-10'].actions[0];
  act.setsDone = null; act.repsText = ''; act.weightKg = null;

  const obs = Core.collectObservations(state, '2026-09-12');
  assert.equal(obs.length, 1);
  assert.equal(obs[0].sets, 3);

  const vol = Core.volumeOf(state.days['2026-09-10']);
  assert.equal(vol.sets, 3);
  assert.equal(vol.volume, 1640); /* 60×10 + 60×10 + 55×8；未完成组不计 */

  const sum = Core.statsSummary(state, '2026-09-12', 7);
  assert.equal(sum.sets, 3);
  assert.equal(sum.volume, 1640);

  const snap = Core.trendsSnapshot(state, '2026-09-12', 4);
  assert.equal(snap.recentSessions[0].sets, 3);

  const last = Core.lastActual(state, '卧推', '2026-09-12');
  assert.ok(last && last.date === '2026-09-10');

  const muscle = Core.muscleProgress(state, '2026-09-12').find((m) => m.key === 'chest');
  assert.equal(muscle.recentSets, 3);
});

test('导入 round-trip 保留 bmiProfile（导出→粘回恢复不丢身体档案）', () => {
  const state = Core.normalize({});
  state.bmiProfile = { heightCm: 170, weightKg: 65, age: 30, sex: '男' };
  const tpl = Core.replaceTemplate(state, { name: 'T', days: [
    { dayKey: 'd1', name: '日1', actions: [{ name: '深蹲', plannedSets: 3, plannedRepsText: '8' }] }
  ] });
  assert.ok(tpl.ok);
  const exported = JSON.parse(JSON.stringify(state));
  assert.ok(exported.bmiProfile, '导出应含身体档案');
  const fresh = Core.normalize({});
  const r = Core.importFrom(fresh, exported);
  assert.ok(r.ok, r.error || '导入失败');
  assert.deepEqual(fresh.bmiProfile, { heightCm: 170, weightKg: 65, age: 30, sex: '男' });
});

/* ---------- 负重输入解析：数字与「自重」文本进同一套记录机制 ---------- */
test('parseWeightInput：留空=没记(null)，数字原样，自重同义词折算成 0', () => {
  assert.deepEqual(Core.parseWeightInput(''), { ok: true, value: null });
  assert.deepEqual(Core.parseWeightInput('   '), { ok: true, value: null });
  assert.deepEqual(Core.parseWeightInput(null), { ok: true, value: null });
  assert.deepEqual(Core.parseWeightInput('20'), { ok: true, value: 20 });
  assert.deepEqual(Core.parseWeightInput('13.5'), { ok: true, value: 13.5 });
  assert.deepEqual(Core.parseWeightInput('0'), { ok: true, value: 0 });
  assert.deepEqual(Core.parseWeightInput('20kg'), { ok: true, value: 20 });
  assert.deepEqual(Core.parseWeightInput('20 kg'), { ok: true, value: 20 });
  assert.deepEqual(Core.parseWeightInput('7.5公斤'), { ok: true, value: 7.5 });
});

test('parseWeightInput：「自重 / 徒手 / BW」等写法都记为明确自重（0），全角数字也能进', () => {
  for (const text of ['自重', ' 自重 ', '自重训练', '徒手', '裸重', 'bw', 'BW', 'bodyweight', 'body weight', '体重']) {
    assert.deepEqual(Core.parseWeightInput(text), { ok: true, value: 0 }, text);
  }
  assert.deepEqual(Core.parseWeightInput('２０'), { ok: true, value: 20 }); // 全角输入法
  assert.deepEqual(Core.parseWeightInput('１２．５'), { ok: true, value: 12.5 });
});

test('parseWeightInput：无法识别的写法报错并给出填法，不静默当成没记', () => {
  for (const text of ['轻重量', 'abc', '12-15', '-5', '12.5.5']) {
    const r = Core.parseWeightInput(text);
    assert.equal(r.ok, false, text);
    assert.match(r.error, /自重/);
    assert.equal(r.value, undefined);
  }
  assert.equal(Core.parseWeightInput('3000').ok, false); // 超过 2000kg 上限
  for (const text of ['自重20', '自重 20kg', '体重60', '20bw', 'bodyweight12.5']) {
    const mixed = Core.parseWeightInput(text);
    assert.equal(mixed.ok, false, text);
    assert.match(mixed.error, /自重/);
    assert.equal(mixed.value, undefined);
  }
});

test('weightLabelKg：0 显示「自重」，未记录返回空串，数字带 kg', () => {
  assert.equal(Core.weightLabelKg(0), '自重');
  assert.equal(Core.weightLabelKg(null), '');
  assert.equal(Core.weightLabelKg(undefined), '');
  assert.equal(Core.weightLabelKg(12), '12kg');
  assert.equal(Core.weightLabelKg(13.5), '13.5kg');
});

test('自重记 0 后不产生负重容量，与留空一样只计次数', () => {
  const bw = Core.summarizeTrainingSet(4, '15', Core.weightLabelKg(0));
  assert.equal(bw.loadVolumeKg, null);
  assert.equal(bw.averageWeightKg, null);
  assert.equal(bw.totalReps, 60);
  const loaded = Core.summarizeTrainingSet(4, '10', Core.weightLabelKg(20));
  assert.equal(loaded.loadVolumeKg, 800);
});

/* ---------- 留空口径：练了这一行就把留空当自重，整行没动仍算没记 ---------- */
test('resolveWeightInput：有完成组数/次数时留空记 0，整行没动记 null', () => {
  assert.deepEqual(Core.resolveWeightInput('', true), { ok: true, value: 0 });      // 练了没填重量 → 自重
  assert.deepEqual(Core.resolveWeightInput('', false), { ok: true, value: null });  // 没练 → 没记
  assert.deepEqual(Core.resolveWeightInput('  ', true), { ok: true, value: 0 });
  assert.deepEqual(Core.resolveWeightInput('自重', false), { ok: true, value: 0 }); // 明确写了就照写
  assert.deepEqual(Core.resolveWeightInput('20', true), { ok: true, value: 20 });
  assert.deepEqual(Core.resolveWeightInput('20kg', false), { ok: true, value: 20 });
  assert.equal(Core.resolveWeightInput('轻重量', true).ok, false); // 认不出也不猜，报错
});

test('只填负重没填组数次数：不生成观测记录（留空记 0 后重量不再能证明记过）', () => {
  const state = Core.normalize({});
  Core.replaceTemplate(state, { name: 'T', days: [
    { dayKey: 'd', name: '日', actions: [{ name: '俯卧撑', plannedSets: 4, plannedRepsText: '15-20' }] }
  ] }, NOW);
  Core.startTraining(state, { date: '2026-09-10' }, NOW);
  Core.saveTraining(state, { date: '2026-09-10', actions: [{ actionKey: 'act-1-1', setsDone: null, repsText: '', weightKg: 0 }] }, NOW);
  assert.deepEqual(Core.collectObservations(state, '2026-09-12'), []);
  Core.saveTraining(state, { date: '2026-09-10', actions: [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20', weightKg: 0 }] }, NOW);
  const obs = Core.collectObservations(state, '2026-09-12');
  assert.equal(obs.length, 1);
  assert.equal(obs[0].weightText, '自重');
  assert.equal(obs[0].sets, 4);
});

test('未声明汇总替换时，不同的汇总数字不会删掉逐组；声明后才删', () => {
  const state = Core.normalize({});
  pushPlan(state, [{ dayKey: 'd1', name: '推日', actions: [{ name: '卧推', plannedSets: 3, plannedRepsText: '10' }] }], NOW);
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  const sets = [
    { reps: 10, weightKg: 60, done: true },
    { reps: 8, weightKg: 60, done: true }
  ];
  assert.ok(Core.saveTraining(state, { date: '2026-09-12', actions: [{ actionKey: 'act-1-1', sets }] }, NOW).ok);
  const quiet = Core.saveTraining(state, {
    date: '2026-09-12',
    actions: [{ actionKey: 'act-1-1', setsDone: 1, repsText: '5', weightKg: 40 }]
  }, NOW);
  assert.ok(quiet.ok, quiet.error);
  assert.deepEqual(state.days['2026-09-12'].actions[0].sets, sets);
  const edited = Core.saveTraining(state, {
    date: '2026-09-12',
    actions: [{ actionKey: 'act-1-1', setsDone: 2, repsText: '6', weightKg: 50, summaryEdited: true }]
  }, NOW);
  assert.ok(edited.ok, edited.error);
  assert.equal(state.days['2026-09-12'].actions[0].sets, undefined);
  assert.equal(state.days['2026-09-12'].actions[0].setsDone, 2);
});

test('partial 不能改成跳过；再次完成不再次轮转', () => {
  const state = Core.normalize({});
  const tpl = pushPlan(state, planInput().days, NOW);
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  Core.saveTraining(state, { date: '2026-09-12', actions: [{ actionKey: 'act-1-1', setsDone: 1, repsText: '8' }] }, NOW);
  const first = Core.finishAndAdvance(state, { date: '2026-09-12' }, NOW);
  assert.ok(first.ok, first.error);
  assert.equal(first.day.status, 'partial');
  const pointer = state.cycle[tpl.id].currentDayKey;
  const again = Core.finishAndAdvance(state, { date: '2026-09-12' }, NOW);
  assert.ok(again.ok, again.error);
  assert.equal(state.cycle[tpl.id].currentDayKey, pointer);
  const skip = Core.skipAndAdvance(state, { date: '2026-09-12', note: '改主意' }, NOW);
  assert.equal(skip.ok, false);
  assert.equal(Core.dayRecord(state, '2026-09-12').status, 'partial');
  assert.equal(state.cycle[tpl.id].currentDayKey, pointer);
});

test('replaceTemplate：缺少 cycle 时先补指针，不抛错', () => {
  const state = Core.normalize({});
  const tpl = pushPlan(state, planInput().days, NOW);
  delete state.cycle[tpl.id];
  const before = tpl.versions.length;
  const r = Core.replaceTemplate(state, {
    id: tpl.id, name: tpl.name, changeNote: '补指针', days: planInput().days
  }, NOW);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.template.versions.length, before + 1);
  assert.equal(state.cycle[tpl.id].currentDayKey, 'push');
});

test('恢复优先会退回上次重量，不再留下加重后的数字', () => {
  const state = Core.normalize({});
  pushPlan(state, [{ dayKey: 'd1', name: '推日', actions: [{ name: '卧推', plannedSets: 3, plannedRepsText: '8-12', plannedWeightText: '60kg' }] }], NOW);
  Core.startTraining(state, { date: '2026-09-08' }, NOW);
  Core.saveTraining(state, { date: '2026-09-08', actions: [{ actionKey: 'act-1-1', setsDone: 3, repsText: '12+12+12', weightKg: 60 }] }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-08' }, NOW);
  Core.startTraining(state, { date: '2026-09-10' }, NOW);
  Core.saveTraining(state, { date: '2026-09-10', actions: [{ actionKey: 'act-1-1', setsDone: 3, repsText: '12+12+12', weightKg: 60 }] }, NOW);
  const day = { date: '2026-09-12', actions: [{ actionKey: 'act-1-1', name: '卧推', plannedSets: 3, plannedRepsText: '8-12', plannedWeightText: '60kg' }] };
  const base = Core.nextSessionAdvice(state, day);
  const sleepy = Core.nextSessionAdvice(state, day, { recovery: { sleepMinutesLastNight: 300 } });
  assert.equal(base.items[0].mode, 'add-weight');
  assert.notEqual(base.items[0].weightKg, 60);
  assert.equal(sleepy.items[0].mode, 'hold');
  assert.equal(sleepy.items[0].weightKg, 60);
  assert.equal(sleepy.items[0].deltaKg, 0);
  assert.equal(sleepy.items[0].repsText, '8-12');
});
