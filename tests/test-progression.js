/* 下次进步建议：同负重比较、缺记录不加重、两次达标才加重、步长过大先加次数、自重加组看周刺激 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');

const NOW = new Date('2026-09-12T02:00:00.000Z'); // 上海 2026-09-12 10:00

function seedState() {
  const state = Core.normalize({});
  const r = Core.replaceTemplate(state, {
    name: '三分化力量', days: [
      { dayKey: 'push', name: '推日', actions: [
        { name: '哑铃推举', plannedSets: 4, plannedRepsText: '10', plannedWeightText: '10kg' },
        { name: '俯卧撑', plannedSets: 4, plannedRepsText: '15-20' }
      ] },
      { dayKey: 'pull', name: '拉日', actions: [
        { name: '引体向上', plannedSets: 5, plannedRepsText: '6-8' }
      ] }
    ]
  }, NOW);
  assert.ok(r.ok, r.error || '建模板失败');
  return state;
}

/* 走完一天推日：记录推举/俯卧撑实际数据并收尾轮转 */
function runPushDay(state, date, press, pushup) {
  const s = Core.startTraining(state, { date }, NOW);
  assert.ok(s.ok, s.error || '开始训练失败');
  const patches = [];
  if (press) patches.push({ actionKey: 'act-1-1', ...press });
  if (pushup) patches.push({ actionKey: 'act-1-2', ...pushup });
  if (patches.length) {
    const sv = Core.saveTraining(state, { date, actions: patches }, NOW);
    assert.ok(sv.ok, sv.error || '保存失败');
  }
  const f = Core.finishAndAdvance(state, { date }, NOW);
  assert.ok(f.ok, f.error || '收尾失败');
  return f.day;
}

test('parseRepRange：区间、单一目标(+2 缓冲)、逐组列表与不可解析', () => {
  assert.deepEqual(Core.parseRepRange('12-15'), { lo: 12, hi: 15 });
  assert.deepEqual(Core.parseRepRange('15-20'), { lo: 15, hi: 20 });
  assert.deepEqual(Core.parseRepRange('8～12'), { lo: 8, hi: 12 });
  assert.deepEqual(Core.parseRepRange('10'), { lo: 10, hi: 12 }); // 2-for-2：单一目标留 +2 缓冲
  assert.deepEqual(Core.parseRepRange('12＋10'), { lo: 10, hi: 12 });
  assert.equal(Core.parseRepRange('力竭'), null);
  assert.equal(Core.parseRepRange(''), null);
});

test('loadProgressRule / nextLoadKg：按动作类别取 2.5–10%，0.5kg 取整、单次封顶 5kg', () => {
  assert.equal(Core.loadProgressRule('杠铃深蹲').pct, 0.1);
  assert.equal(Core.loadProgressRule('哑铃卧推').pct, 0.05);
  assert.equal(Core.loadProgressRule('哑铃弯举').pct, 0.025);
  assert.equal(Core.loadProgressRule('面拉').pct, 0.025);
  assert.equal(Core.loadProgressRule('神秘动作').pct, 0.05); // 缺省按上肢复合

  assert.deepEqual(Core.nextLoadKg('哑铃弯举', 9), { pct: 0.025, label: '孤立', delta: 0.5, next: 9.5 });
  assert.deepEqual(Core.nextLoadKg('哑铃推举', 10), { pct: 0.05, label: '上肢复合', delta: 0.5, next: 10.5 });
  assert.deepEqual(Core.nextLoadKg('哑铃卧推', 20), { pct: 0.05, label: '上肢复合', delta: 1, next: 21 });
  assert.deepEqual(Core.nextLoadKg('杠铃深蹲', 40), { pct: 0.1, label: '下肢复合', delta: 4, next: 44 });
  assert.equal(Core.nextLoadKg('杠铃深蹲', 100).delta, 5); // 封顶 5kg
});

test('双递进：区间内先加次数，重量不变', () => {
  const state = seedState();
  const day = runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '10', weightKg: 10 }, null);
  const advice = Core.nextSessionAdvice(state, day);
  assert.ok(advice && advice.hasAnyData);
  const press = advice.items.find((i) => i.name === '哑铃推举');
  assert.equal(press.mode, 'add-reps');
  assert.equal(press.weightKg, 10);
  assert.equal(press.repsText, '11-12');
  assert.equal(press.sets, 4);
  assert.ok(press.reason.includes('双递进'));
});

test('首次动作给 start 建议，不影响 hasAnyData', () => {
  const state = seedState();
  const day = runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '10', weightKg: 10 }, null);
  const advice = Core.nextSessionAdvice(state, day);
  assert.ok(advice.hasAnyData); // 推举有数据
  const pushup = advice.items.find((i) => i.name === '俯卧撑');
  assert.equal(pushup.mode, 'start');
  assert.ok(pushup.reason.includes('首次记录'));
});

/* 走完一天拉日（空记录收尾，仅用于轮转指针推进） */
function runPullDay(state, date) {
  const s = Core.startTraining(state, { date }, NOW);
  assert.ok(s.ok, s.error || '开始训练失败');
  const f = Core.finishAndAdvance(state, { date }, NOW);
  assert.ok(f.ok, f.error || '收尾失败');
  return f.day;
}

test('只到一次区间上限 → 先巩固，不因单次表现加重', () => {
  const state = seedState();
  runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '10', weightKg: 10 }, null);
  runPullDay(state, '2026-09-02');
  const day = runPushDay(state, '2026-09-03', { setsDone: 4, repsText: '12', weightKg: 10 }, null);
  const press = Core.nextSessionAdvice(state, day).items.find((i) => i.name === '哑铃推举');
  assert.equal(press.mode, 'hold');
  assert.equal(press.weightKg, 10);
  assert.equal(press.deltaKg, null);
  assert.match(press.reason, /再完成一次/);
  assert.equal(press.reason.includes('低于推荐带'), false);
  assert.equal(press.reason.includes('2-for-2'), false);
});

test('连续两次同重量到达上限，且实际增幅未超过 2009 年历史 10% → 加重', () => {
  const state = seedState();
  runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '12', weightKg: 10 }, null);
  runPullDay(state, '2026-09-02');
  const day = runPushDay(state, '2026-09-03', { setsDone: 4, repsText: '12', weightKg: 10 }, null);
  const press = Core.nextSessionAdvice(state, day).items.find((i) => i.name === '哑铃推举');
  assert.equal(press.mode, 'add-weight');
  assert.equal(press.weightKg, 10.5);
  assert.equal(press.deltaKg, 0.5);
  assert.equal(press.deltaPct, 5);
  assert.equal(press.repsText, '10-12');
  assert.match(press.reason, /2026/);
  assert.match(press.reason, /2009/);
  assert.equal(press.reason.includes('低于推荐带'), false);
});

test('自重动作只到一次上限 → 不加组', () => {
  const state = seedState();
  const day = runPushDay(state, '2026-09-01',
    { setsDone: 4, repsText: '10', weightKg: 10 }, { setsDone: 4, repsText: '20', weightKg: 0 });
  const pushup = Core.nextSessionAdvice(state, day).items.find((i) => i.name === '俯卧撑');
  assert.equal(pushup.mode, 'hold');
  assert.equal(pushup.sets, 4);
  assert.equal(pushup.weightKg, null);
  assert.match(pushup.reason, /不加组/);
});

test('组数没做满 → 巩固（一次只推进一个变量）', () => {
  const state = seedState();
  const day = runPushDay(state, '2026-09-01', { setsDone: 3, repsText: '10', weightKg: 10 }, null);
  const advice = Core.nextSessionAdvice(state, day);
  const press = advice.items.find((i) => i.name === '哑铃推举');
  assert.equal(press.mode, 'hold');
  assert.equal(press.weightKg, 10);
  assert.ok(press.reason.includes('3/4'));
});

test('轮转回来：新一天的建议基于上次完成数据（而非计划快照）', () => {
  const state = seedState();
  runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '10', weightKg: 10 }, null);
  // 轮转：拉日(09-02) → 推日(09-03 预览快照)
  const pull = runPushDay(state, '2026-09-02', null, null); // 空收尾占位（引体无数据）
  void pull;
  const s = Core.startTraining(state, { date: '2026-09-03' }, NOW);
  assert.ok(s.ok, s.error);
  const advice = Core.nextSessionAdvice(state, s.day);
  const press = advice.items.find((i) => i.name === '哑铃推举');
  assert.equal(press.mode, 'add-reps');
  assert.equal(press.lastDate, '2026-09-01');
  assert.equal(press.ref, '上次');
});

test('连续两次下滑 → 减载（重量 -10%）', () => {
  const state = seedState();
  runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '12', weightKg: 10 }, null);
  runPullDay(state, '2026-09-02');
  runPushDay(state, '2026-09-03', { setsDone: 4, repsText: '11', weightKg: 10 }, null);
  runPullDay(state, '2026-09-04');
  const day = runPushDay(state, '2026-09-05', { setsDone: 4, repsText: '10', weightKg: 10 }, null);
  const advice = Core.nextSessionAdvice(state, day);
  const press = advice.items.find((i) => i.name === '哑铃推举');
  assert.equal(press.mode, 'deload');
  assert.equal(press.weightKg, 9); // 10 × 0.9
  assert.equal(press.deltaKg, -1);
  assert.ok(press.reason.includes('连续两次下滑'));
});

test('明显低于区间下限只有一次 → 先重做，不减载', () => {
  const state = seedState();
  state.templates[0].versions[0].days[0].actions[0].plannedRepsText = '8-12';
  const day = runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '6', weightKg: 20 }, null);
  const press = Core.nextSessionAdvice(state, day).items.find((i) => i.name === '哑铃推举');
  assert.equal(press.mode, 'hold');
  assert.equal(press.weightKg, 20);
  assert.match(press.reason, /不直接减重/);
});

test('收尾当日的建议引用本次数据（ref=本次），预览日引用上次', () => {
  const state = seedState();
  const day = runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '10', weightKg: 10 }, null);
  const advice = Core.nextSessionAdvice(state, day);
  assert.equal(advice.items.find((i) => i.name === '哑铃推举').ref, '本次');
});

test('muscleProgress 输出 weeklyStimSets（周容量带依据）', () => {
  const state = seedState();
  runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '10', weightKg: 10 }, { setsDone: 4, repsText: '20' });
  const muscles = Core.muscleProgress(state, '2026-09-12');
  assert.ok(muscles.length > 0);
  for (const m of muscles) assert.equal(typeof m.weeklyStimSets, 'number');
  const shoulders = muscles.find((m) => m.key === 'shoulders');
  assert.ok(shoulders.weeklyStimSets > 0);
});

test('P1-1 步长超出 2009 年历史上限时先加次数；大负重封顶仍按实算加重', () => {
  const state = Core.normalize({});
  Core.replaceTemplate(state, { name: 'T', days: [{ dayKey: 'mix', name: '混合日', actions: [
    { name: '哑铃弯举', plannedSets: 3, plannedRepsText: '10-12' },
    { name: '杠铃深蹲', plannedSets: 5, plannedRepsText: '8' }
  ] }] }, NOW);
  function log(date) {
    Core.startTraining(state, { date }, NOW);
    Core.saveTraining(state, { date, actions: [
      { actionKey: 'act-1-1', setsDone: 3, repsText: '12', weightKg: 1 },
      { actionKey: 'act-1-2', setsDone: 5, repsText: '10', weightKg: 100 }
    ] }, NOW);
    return Core.finishAndAdvance(state, { date }, NOW).day;
  }
  log('2026-09-01');
  const advice = Core.nextSessionAdvice(state, log('2026-09-03'));
  const curl = advice.items.find((i) => i.name === '哑铃弯举');
  assert.equal(curl.mode, 'add-reps');
  assert.equal(curl.weightKg, 1);
  assert.equal(curl.deltaKg, null);
  assert.match(curl.reason, /最小步长/);
  assert.match(curl.reason, /50/);
  assert.match(curl.reason, /2009/);
  const squat = advice.items.find((i) => i.name === '杠铃深蹲');
  assert.equal(squat.mode, 'add-weight');
  assert.equal(squat.weightKg, 105);
  assert.equal(squat.deltaKg, 5);
  assert.equal(squat.deltaPct, 5);
  assert.match(squat.reason, /封顶/);
  assert.match(squat.reason, /2026/);
});

test('P1-2 零负重视为自重：记 0kg 的自重动作走次数→组数，不编造加重', () => {
  const state = Core.normalize({});
  Core.replaceTemplate(state, { name: 'T', days: [{ dayKey: 'push', name: '推日', actions: [
    { name: '俯卧撑', plannedSets: 4, plannedRepsText: '15-20' }] }] }, NOW);
  Core.startTraining(state, { date: '2026-09-01' }, NOW);
  Core.saveTraining(state, { date: '2026-09-01', actions: [
    { actionKey: 'act-1-1', setsDone: 4, repsText: '20', weightKg: 0 }] }, NOW);
  const day = Core.finishAndAdvance(state, { date: '2026-09-01' }, NOW).day;
  const item = Core.nextSessionAdvice(state, day).items[0];
  assert.equal(item.mode, 'hold');
  assert.equal(item.sets, 4);
  assert.equal(item.weightKg, null);
  assert.equal(item.reason.includes('0.5'), false);
});

test('P2-2 组×次数写法：3x8 取次数 8，不把组数误读成次数下限', () => {
  assert.deepEqual(Core.parseRepRange('3x8'), { lo: 8, hi: 10 });
  assert.deepEqual(Core.parseRepRange('3×8-12'), { lo: 8, hi: 12 });
  assert.deepEqual(Core.parseRepRange('4*10'), { lo: 10, hi: 12 });
  assert.deepEqual(Core.parseRepRange('12-15'), { lo: 12, hi: 15 });
  assert.deepEqual(Core.parseRepRange('10'), { lo: 10, hi: 12 });
});

test('P1-3 文案不宣称 2-for-2：单次超出区间上限只做事实描述', () => {
  const state = Core.normalize({});
  Core.replaceTemplate(state, { name: 'T', days: [{ dayKey: 'push', name: '推日', actions: [
    { name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }] }] }, NOW);
  Core.startTraining(state, { date: '2026-09-01' }, NOW);
  Core.saveTraining(state, { date: '2026-09-01', actions: [
    { actionKey: 'act-1-1', setsDone: 4, repsText: '15', weightKg: 20 }] }, NOW);
  const day = Core.finishAndAdvance(state, { date: '2026-09-01' }, NOW).day;
  const item = Core.nextSessionAdvice(state, day).items[0];
  assert.equal(item.mode, 'hold');
  assert.equal(item.weightKg, 20);
  assert.ok(!item.reason.includes('2-for-2'));
  assert.ok(item.reason.includes('超出区间上限'));
  assert.match(item.reason, /再完成一次/);
});

test('实际数据「3x8」按组×次数解析：均次 8 而非 5.5，评分链路同步修复', () => {
  const s = Core.summarizeTrainingSet(3, '3x8', '');
  assert.equal(s.totalReps, 24);
  assert.equal(s.averageReps, 8); // 修复前 [3,8] 混算 → 均次 6.3
  // 端到端：计划 8-10、实际记成 3x8 → 均次 8 在区间内 → 加次数（修复前均次 5.5 会误判「低于下限」）
  const state = Core.normalize({});
  Core.replaceTemplate(state, { name: 'T', days: [{ dayKey: 'push', name: '推日', actions: [
    { name: '哑铃卧推', plannedSets: 3, plannedRepsText: '8-10' }] }] }, NOW);
  Core.startTraining(state, { date: '2026-09-01' }, NOW);
  Core.saveTraining(state, { date: '2026-09-01', actions: [
    { actionKey: 'act-1-1', setsDone: 3, repsText: '3x8', weightKg: 20 }] }, NOW);
  const day = Core.finishAndAdvance(state, { date: '2026-09-01' }, NOW).day;
  const item = Core.nextSessionAdvice(state, day).items[0];
  assert.equal(item.mode, 'add-reps');
  assert.ok(!item.reason.includes('低于'));
});

test('杠铃按 2.5kg 真实片取档：增量落在器械可实现的档位上', () => {
  assert.equal(Core.equipmentStepKg('杠铃卧推'), 2.5);
  assert.equal(Core.equipmentStepKg('哑铃卧推'), 0.5);
  // 杠铃卧推 20kg：理想 1kg → 向上取档 2.5kg（12.5%，器械限制如实标注）
  const state = Core.normalize({});
  Core.replaceTemplate(state, { name: 'T', days: [{ dayKey: 'push', name: '推日', actions: [
    { name: '杠铃卧推', plannedSets: 4, plannedRepsText: '8-12' },
    { name: '杠铃深蹲', plannedSets: 5, plannedRepsText: '8-12' }] }] }, NOW);
  function log(date) {
    Core.startTraining(state, { date }, NOW);
    Core.saveTraining(state, { date, actions: [
      { actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 20 },
      { actionKey: 'act-1-2', setsDone: 5, repsText: '12', weightKg: 40 }
    ] }, NOW);
    return Core.finishAndAdvance(state, { date }, NOW).day;
  }
  log('2026-09-01');
  const advice = Core.nextSessionAdvice(state, log('2026-09-03'));
  const bench = advice.items.find((i) => i.name === '杠铃卧推');
  assert.equal(bench.mode, 'add-reps');
  assert.equal(bench.weightKg, 20);
  assert.equal(bench.deltaKg, null);
  assert.match(bench.reason, /2\.5kg/);
  assert.match(bench.reason, /2009/);
  const squat = advice.items.find((i) => i.name === '杠铃深蹲');
  assert.equal(squat.mode, 'add-weight');
  assert.equal(squat.deltaKg, 2.5);
  assert.equal(squat.weightKg, 42.5);
  assert.equal(squat.deltaPct, 6);
});

test('计划写负重但上次未记录：给出补记提示', () => {
  const state = Core.normalize({});
  Core.replaceTemplate(state, { name: 'T', days: [{ dayKey: 'push', name: '推日', actions: [
    { name: '哑铃推举', plannedSets: 4, plannedRepsText: '10', plannedWeightText: '10kg' }] }] }, NOW);
  Core.startTraining(state, { date: '2026-09-01' }, NOW);
  Core.saveTraining(state, { date: '2026-09-01', actions: [
    { actionKey: 'act-1-1', setsDone: 4, repsText: '10' }] }, NOW); // 没填负重
  const day = Core.finishAndAdvance(state, { date: '2026-09-01' }, NOW).day;
  const item = Core.nextSessionAdvice(state, day).items[0];
  assert.equal(item.mode, 'hold');
  assert.equal(item.weightKg, 10);
  assert.equal(item.deltaKg, null);
  assert.ok(item.reason.includes('填 0'));
  assert.match(item.reason, /不会按计划重量去加重/);
});

test('计划和实际都没填重量：不猜自重，也不凭次数到顶加组', () => {
  const built = logLone(
    [{ name: '俯卧撑', plannedSets: 4, plannedRepsText: '15-20' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20' }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20' }]
    ]
  );
  assert.equal(built.item.mode, 'hold');
  assert.equal(built.item.weightUnknown, true);
  assert.match(built.item.reason, /负重没记/);
});

test('nextSessionAdvice：空日子/无动作返回 null，全部无数据时 hasAnyData=false', () => {
  const state = seedState();
  assert.equal(Core.nextSessionAdvice(state, null), null);
  const fresh = Core.normalize({});
  Core.replaceTemplate(fresh, { name: '空白', days: [{ dayKey: 'd1', name: '日1', actions: [{ name: '深蹲', plannedSets: 5, plannedRepsText: '8', plannedWeightText: '40kg' }] }] }, NOW);
  const s = Core.startTraining(fresh, { date: '2026-09-01' }, NOW);
  assert.ok(s.ok, s.error);
  const advice = Core.nextSessionAdvice(fresh, s.day);
  assert.equal(advice.hasAnyData, false);
  assert.equal(advice.items[0].mode, 'start');
});

test('跨模板重量互通：同名动作的「上次」与递进建议全库统一', () => {
  const state = seedState();
  /* 在三分化模板里练一次哑铃推举 */
  runPushDay(state, '2026-09-01', { setsDone: 4, repsText: '10', weightKg: 10 }, null);
  /* 新建另一份模板（全身），同名动作「哑铃推举」 */
  Core.replaceTemplate(state, { name: '全身模板', days: [{ dayKey: 'full', name: '全身日', actions: [
    { name: '哑铃推举', plannedSets: 4, plannedRepsText: '10', plannedWeightText: '' }
  ] }] }, new Date(NOW.getTime() + 2000));
  const last = Core.lastActual(state, '哑铃推举', '2026-09-05');
  assert.ok(last, '跨模板应能找到上次记录');
  assert.equal(last.date, '2026-09-01');
  assert.equal(last.action.weightKg, 10);
  /* 新模板下开始训练：递进建议沿用另一份模板里留下的重量基线 */
  const s = Core.startTraining(state, { date: '2026-09-05' }, NOW);
  assert.ok(s.ok, s.error);
  const advice = Core.nextSessionAdvice(state, s.day);
  const press = advice.items.find((i) => i.name === '哑铃推举');
  assert.equal(press.hasLast, true);
  assert.equal(press.weightKg, 10);
  assert.equal(press.mode, 'add-reps'); // 均次 10 在区间 10-12 内 → 加次数
  /* 大小写/空格差异也视为同一动作 */
  const last2 = Core.lastActual(state, '  哑铃推举 ', '2026-09-05');
  assert.ok(last2 && last2.date === '2026-09-01');
});

test('恢复优先降级：昨晚睡眠不足时进取建议降为 hold（2026-09-22 N1）', () => {
  const state = Core.normalize({});
  const now = new Date('2026-09-12T02:00:00.000Z');
  const tpl = Core.replaceTemplate(state, {
    name: '降级测试', days: [
      { dayKey: 'd1', name: '推日', actions: [{ name: '卧推', plannedSets: 3, plannedRepsText: '8-12', plannedWeightText: '60kg' }] }
    ]
  }, now);
  assert.ok(tpl.ok, tpl.error);
  Core.startTraining(state, { date: '2026-09-08' }, now);
  Core.saveTraining(state, { date: '2026-09-08', actions: [{ actionKey: 'act-1-1', setsDone: 3, repsText: '12+12+12', weightKg: 60, durationMinutes: 20 }] }, now);
  Core.finishAndAdvance(state, { date: '2026-09-08' }, now);
  Core.startTraining(state, { date: '2026-09-10' }, now);
  Core.saveTraining(state, { date: '2026-09-10', actions: [{ actionKey: 'act-1-1', setsDone: 3, repsText: '12+12+12', weightKg: 60, durationMinutes: 95 }] }, now);
  const day = { date: '2026-09-12', actions: [{ actionKey: 'act-1-1', name: '卧推', plannedSets: 3, plannedRepsText: '8-12', plannedWeightText: '60kg', setsDone: null, repsText: '', weightKg: null }] };

  /* 基线：无恢复上下文 → 加重量 */
  const base = Core.nextSessionAdvice(state, day);
  assert.equal(base.items[0].mode, 'add-weight');
  assert.equal(base.recovery, null);

  /* 昨晚 5h → 恢复优先，保留原建议痕迹 */
  const degraded = Core.nextSessionAdvice(state, day, { recovery: { sleepMinutesLastNight: 300 } });
  assert.equal(degraded.items[0].mode, 'hold');
  assert.equal(degraded.items[0].prevMode, 'add-weight');
  assert.equal(degraded.recovery.active, true);
  assert.match(degraded.items[0].reason, /恢复优先/);
  assert.match(degraded.items[0].reason, /Fullagar/);

  /* 连续两晚不足 6.5h → 同样降级 */
  const two = Core.nextSessionAdvice(state, day, { recovery: { sleepMinutesLastNight: 420, consecutiveShortNights: 2 } });
  assert.equal(two.items[0].mode, 'hold');

  /* 睡够了 → 不降级 */
  const okSleep = Core.nextSessionAdvice(state, day, { recovery: { sleepMinutesLastNight: 480, consecutiveShortNights: 0 } });
  assert.equal(okSleep.items[0].mode, 'add-weight');
  assert.equal(okSleep.recovery, null);

  /* 未传 options → 完全向后兼容 */
  assert.equal(Core.nextSessionAdvice(state, day, null).items[0].mode, 'add-weight');
  assert.equal(/分钟|时长/.test(base.items[0].reason), false);
});

function logLone(actions, sessions) {
  const state = Core.normalize({});
  Core.replaceTemplate(state, { name: 'T', days: [{ dayKey: 'd', name: '日', actions }] }, NOW);
  let day = null;
  sessions.forEach((patches, index) => {
    const date = `2026-09-${String(index + 1).padStart(2, '0')}`;
    const started = Core.startTraining(state, { date }, NOW);
    assert.ok(started.ok, started.error || '开始失败');
    const saved = Core.saveTraining(state, { date, actions: patches }, NOW);
    assert.ok(saved.ok, saved.error || '保存失败');
    const finished = Core.finishAndAdvance(state, { date }, NOW);
    assert.ok(finished.ok, finished.error || '收尾失败');
    day = finished.day;
  });
  return { state, day, item: Core.nextSessionAdvice(state, day).items[0] };
}

test('不同负重的次数下降不算连续下滑', () => {
  const { item } = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 30 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '11', weightKg: 20 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '10', weightKg: 10 }]
    ]
  );
  assert.equal(item.mode, 'add-reps');
  assert.equal(item.weightKg, 10);
  assert.equal(item.mode === 'deload', false);
});

test('换重量之后只有一次同重量下降，不减载', () => {
  const { item } = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '8', weightKg: 40 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '11', weightKg: 20 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '9', weightKg: 20 }]
    ]
  );
  assert.equal(item.mode, 'add-reps');
  assert.equal(item.weightKg, 20);
});

test('10kg 与 10.5kg 不算同一负重，次数下降不连成减载', () => {
  const { item } = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 10 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '11', weightKg: 10.5 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '10', weightKg: 10 }]
    ]
  );
  assert.notEqual(item.mode, 'deload');
  assert.equal(item.weightKg, 10);
});

test('计划有重量但两次都没记下，即使次数到顶也不加重', () => {
  const { item } = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12', plannedWeightText: '20kg' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12' }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12' }]
    ]
  );
  assert.equal(item.mode, 'hold');
  assert.equal(item.weightKg, 20);
  assert.equal(item.deltaKg, null);
  assert.match(item.reason, /填 0/);
});

test('次数个数对不齐组数时不加重', () => {
  const { item } = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [[{ actionKey: 'act-1-1', setsDone: 4, repsText: '12+12', weightKg: 20 }]]
  );
  assert.equal(item.mode, 'hold');
  assert.equal(item.weightKg, 20);
  assert.match(item.reason, /不加重/);
});

test('组数没做满即使次数到顶也不加重', () => {
  const { item } = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [[{ actionKey: 'act-1-1', setsDone: 2, repsText: '12', weightKg: 20 }]]
  );
  assert.equal(item.mode, 'hold');
  assert.equal(item.weightKg, 20);
  assert.match(item.reason, /2\/4/);
});

test('同一重量连续两次明显低于下限 → 约一成减载，并标明是启发式', () => {
  const { item } = logLone(
    [{ name: '哑铃推举', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '6', weightKg: 20 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '6', weightKg: 20 }]
    ]
  );
  assert.equal(item.mode, 'deload');
  assert.equal(item.weightKg, 18);
  assert.match(item.reason, /启发式/);
  assert.match(item.reason, /2026/);
});

test('同一重量连续两次下滑的减载文案不把一成说成定律，睡眠不足也不改写减载', () => {
  const { state, day, item } = logLone(
    [{ name: '哑铃推举', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 10 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '11', weightKg: 10 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '10', weightKg: 10 }]
    ]
  );
  assert.equal(item.mode, 'deload');
  assert.equal(item.weightKg, 9);
  assert.match(item.reason, /同一负重/);
  assert.match(item.reason, /启发式/);
  const sleepy = Core.nextSessionAdvice(state, day, { recovery: { sleepMinutesLastNight: 300 } });
  assert.equal(sleepy.items[0].mode, 'deload');
  assert.equal(sleepy.items[0].prevMode, undefined);
});

test('自重连续两次到顶：周刺激估算低于 10 才加组，到 10 就不自动加', () => {
  const built = logLone(
    [{ name: '俯卧撑', plannedSets: 4, plannedRepsText: '15-20' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20', weightKg: 0, durationMinutes: 15 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20', weightKg: 0, durationMinutes: 80 }]
    ]
  );
  assert.equal(built.item.mode, 'add-sets');
  assert.equal(built.item.sets, 5);
  assert.equal(/分钟|时长/.test(built.item.reason), false);
  const day = built.state.days['2026-09-02'];
  const action = day.actions[0];
  const atTen = Core.progAdviceForAction(built.state, day, action, new Map([['chest', { label: '胸', weeklyStimSets: 10 }]]));
  assert.equal(atTen.mode, 'hold');
  assert.match(atTen.reason, /不自动加组/);
  assert.match(atTen.reason, /不是个人定额/);
  const under = Core.progAdviceForAction(built.state, day, action, new Map([['chest', { label: '胸', weeklyStimSets: 9.9 }]]));
  assert.equal(under.mode, 'add-sets');
  assert.equal(under.sets, 5);
  const unknown = Core.progAdviceForAction(built.state, day, action, new Map());
  assert.equal(unknown.mode, 'hold');
  assert.match(unknown.reason, /看不清/);
});

test('计划写了重量但实际填 0：按自重处理，不编造加重', () => {
  const { item } = logLone(
    [{ name: '俯卧撑', plannedSets: 4, plannedRepsText: '15-20', plannedWeightText: '10kg' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20', weightKg: 0 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20', weightKg: 0 }]
    ]
  );
  assert.equal(item.mode, 'add-sets');
  assert.equal(item.weightKg, null);
  assert.equal(item.deltaKg, null);
});

test('逐组负重不一致时不加重；逐组同一重量连续两次到顶才加重', () => {
  const mixed = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [[{ actionKey: 'act-1-1', sets: [
      { done: true, reps: 12, weightKg: 20 },
      { done: true, reps: 12, weightKg: 20 },
      { done: true, reps: 12, weightKg: 25 },
      { done: true, reps: 12, weightKg: 20 }
    ], setsDone: 4 }]]
  );
  assert.equal(mixed.item.mode, 'hold');
  assert.match(mixed.item.reason, /不加重/);
  const even = [20, 20, 20, 20].map((weightKg) => ({ done: true, reps: 12, weightKg }));
  const steady = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', sets: even, setsDone: 4 }],
      [{ actionKey: 'act-1-1', sets: even, setsDone: 4 }]
    ]
  );
  assert.equal(steady.item.mode, 'add-weight');
  assert.equal(steady.item.weightKg, 21);
  assert.equal(steady.item.deltaKg, 1);
});

test('实际增幅刚好等于 2009 年历史 10% 时可以加重', () => {
  const { item } = logLone(
    [{ name: '哑铃深蹲', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 50 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 50 }]
    ]
  );
  assert.equal(item.mode, 'add-weight');
  assert.equal(item.weightKg, 55);
  assert.equal(item.deltaKg, 5);
  assert.equal(item.deltaPct, 10);
});

test('2.5kg/24kg 的实际增幅是 10.4%，不能因四舍五入成 10% 而加重', () => {
  const { item } = logLone(
    [{ name: '杠铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 24 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 24 }]
    ]
  );
  assert.equal(item.mode, 'add-reps');
  assert.equal(item.weightKg, 24);
  assert.equal(item.deltaKg, null);
  assert.match(item.reason, /10\.4/);
  assert.match(item.reason, /不跳重量/);
});

test('计划从 2 组改成 4 组后，上一课只做满 2 组不能确认这次加重', () => {
  const state = Core.normalize({});
  const created = Core.replaceTemplate(state, { name: 'T', days: [{ dayKey: 'd', name: '日', actions: [
    { name: '哑铃卧推', plannedSets: 2, plannedRepsText: '8-12' }
  ] }] }, NOW);
  assert.ok(created.ok, created.error);
  Core.startTraining(state, { date: '2026-09-01' }, NOW);
  Core.saveTraining(state, { date: '2026-09-01', actions: [
    { actionKey: 'act-1-1', setsDone: 2, repsText: '12', weightKg: 20 }
  ] }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-01' }, NOW);
  const updated = Core.replaceTemplate(state, {
    id: state.templates[0].id, name: 'T', changeNote: '组数改为 4',
    days: [{ dayKey: 'd', name: '日', actions: [
      { name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }
    ] }]
  }, new Date(NOW.getTime() + 1000));
  assert.ok(updated.ok, updated.error);
  Core.startTraining(state, { date: '2026-09-03' }, NOW);
  Core.saveTraining(state, { date: '2026-09-03', actions: [
    { actionKey: 'act-1-1', setsDone: 4, repsText: '12', weightKg: 20 }
  ] }, NOW);
  const day = Core.finishAndAdvance(state, { date: '2026-09-03' }, NOW).day;
  assert.equal(day.actions[0].plannedSets, 4);
  const item = Core.nextSessionAdvice(state, day).items[0];
  assert.equal(item.mode, 'hold');
  assert.equal(item.weightKg, 20);
  assert.equal(item.deltaKg, null);
});

test('16+16+8+8 平均 12 但不能掩盖后两组没到上限', () => {
  const listed = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '16+16+8+8', weightKg: 20 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '16+16+8+8', weightKg: 20 }]
    ]
  );
  assert.equal(listed.item.mode, 'hold');
  assert.equal(listed.item.weightKg, 20);
  assert.match(listed.item.reason, /不加重/);
  assert.match(listed.item.reason, /2 组没到 12/);
  const each = [16, 16, 8, 8].map((reps) => ({ done: true, reps, weightKg: 20 }));
  const perSet = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, sets: each }],
      [{ actionKey: 'act-1-1', setsDone: 4, sets: each }]
    ]
  );
  assert.equal(perSet.item.mode, 'hold');
  assert.equal(perSet.item.weightKg, 20);
  const clean = logLone(
    [{ name: '哑铃卧推', plannedSets: 4, plannedRepsText: '8-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12+12+12+12', weightKg: 20 }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '12+12+12+12', weightKg: 20 }]
    ]
  );
  assert.equal(clean.item.mode, 'add-weight');
  assert.equal(clean.item.weightKg, 21);
});

test('次数已经很高且最小步长仍然过大 → 巩固，不再把次数往上堆', () => {
  const { item } = logLone(
    [{ name: '哑铃弯举', plannedSets: 3, plannedRepsText: '10-12' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 3, repsText: '30', weightKg: 1 }],
      [{ actionKey: 'act-1-1', setsDone: 3, repsText: '30', weightKg: 1 }]
    ]
  );
  assert.equal(item.mode, 'hold');
  assert.equal(item.weightKg, 1);
  assert.match(item.reason, /先巩固/);
});

/* ---------- 「自重」写法接进递进建议与模板写回（输入层折算成 0 之后） ---------- */
test('自重记 0：建议标为自重（bodyweight），不提示补记负重', () => {
  const state = seedState();
  const day = runPushDay(state, '2026-09-01', null, { setsDone: 4, repsText: '20', weightKg: 0 });
  const pushup = Core.nextSessionAdvice(state, day).items.find((i) => i.name === '俯卧撑');
  assert.equal(pushup.weightUnknown, false);
  assert.equal(pushup.bodyweight, true);
  assert.equal(pushup.weightKg, null);
  assert.match(pushup.reason, /自重/);
  /* 同一动作留空（没记重量）仍是 unknown，两种写法不混为一谈 */
  const blank = Core.normalize({});
  const r = Core.replaceTemplate(blank, { name: 'T', days: [
    { dayKey: 'd1', name: '日1', actions: [{ name: '俯卧撑', plannedSets: 4, plannedRepsText: '15-20' }] }
  ] }, NOW);
  assert.ok(r.ok);
  Core.startTraining(blank, { date: '2026-09-02' }, NOW);
  Core.saveTraining(blank, { date: '2026-09-02', actions: [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20' }] }, NOW);
  const f = Core.finishAndAdvance(blank, { date: '2026-09-02' }, NOW);
  const item = Core.nextSessionAdvice(blank, f.day).items[0];
  assert.equal(item.bodyweight, false);
  assert.equal(item.weightUnknown, true);
});

test('自重记 0 连续两次到顶 → 加组数，建议负重仍按自重', () => {
  const parsed = Core.parseWeightInput('自重');
  assert.deepEqual(parsed, { ok: true, value: 0 });
  const { item } = logLone(
    [{ name: '俯卧撑', plannedSets: 4, plannedRepsText: '15-20' }],
    [
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20', weightKg: parsed.value }],
      [{ actionKey: 'act-1-1', setsDone: 4, repsText: '20', weightKg: parsed.value }]
    ]
  );
  assert.equal(item.mode, 'add-sets');
  assert.equal(item.sets, 5);
  assert.equal(item.weightKg, null);
  assert.equal(item.bodyweight, true);
  assert.equal(item.weightUnknown, false);
  assert.match(item.reason, /自重/);
});
