/* 肌群进步评分测试 —— 用例对应「个人积累库」training-metrics.test.ts 的关键行为 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');

const DAY = '2026-09-12';

function obs(date, name, sets, reps, weight, dayLabel = '推日') {
  return { businessDate: date, dayLabel, actionName: name, sets, repsText: reps, weightText: weight };
}

test('Brzycki 估算 1RM：只接受 1–10 次、正重量', () => {
  assert.equal(Core.estimateE1rmKg(40, 8), Math.round(40 * 36 / 29 * 10) / 10);
  assert.equal(Core.estimateE1rmKg(40, 0), null);
  assert.equal(Core.estimateE1rmKg(40, 11), null);
  assert.equal(Core.estimateE1rmKg(0, 5), null);
  assert.equal(Core.estimateE1rmKg(100, 1), 100); // 1 次 = 重量本身
});

test('组数据汇总：单值 reps 复制到每组、磅转 kg、负重容量', () => {
  const s1 = Core.summarizeTrainingSet(4, '10', '40kg');
  assert.equal(s1.totalReps, 40);
  assert.equal(s1.loadVolumeKg, 1600);
  assert.equal(s1.maxWeightKg, 40);
  const s2 = Core.summarizeTrainingSet(2, '8', '50 lbs');
  assert.equal(s2.maxWeightKg, 22.7); // 50 lb ≈ 22.68 kg，round 1 位
  const s3 = Core.summarizeTrainingSet(3, '10-12', ''); // 自重：无容量无 1RM
  assert.equal(s3.loadVolumeKg, null);
  assert.equal(s3.bestE1rmKg, null);
  assert.equal(s3.totalReps, 34); // 10-12 摊到 3 组 = 10+12+12（末值补齐）
});

test('动作→肌群权重：主肌群 1、辅助 0.5，匹配不到用训练日名推断', () => {
  assert.deepEqual(Core.inferMuscleWeights('卧推', ''), { chest: 1, triceps: 0.5, shoulders: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('神秘动作', '腿日'), { quadriceps: 1, hamstrings: 0.5, glutes: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('深蹲', ''), { quadriceps: 1, glutes: 0.5, hamstrings: 0.5 });
});

test('28 天窗口统计：主辅肌群分开累计组数与容量', () => {
  const rows = [
    obs('2026-09-10', '卧推', 4, '10', '40kg'),      // chest 4 组, tri/shoulder 2 组
    obs('2026-09-05', '哑铃飞鸟', 3, '12', '10kg'),  // chest 3 组
    obs('2026-08-01', '卧推', 5, '10', '35kg')       // previous 窗口
  ];
  const result = Core.buildMuscleProgress(rows, DAY);
  const chest = result.find((m) => m.key === 'chest');
  assert.equal(chest.recentSets, 7);
  assert.equal(chest.recentSessions, 2);
  assert.equal(chest.recentLoadVolumeKg, 1600 + 360);
  const triceps = result.find((m) => m.key === 'triceps');
  assert.equal(triceps.recentSets, 3.5); // 卧推 4×0.5 + 飞鸟 3×0.5（飞鸟同属推类规则）
});

test('有效组按肌群权重折算，且自重动作只贡献组数不贡献容量', () => {
  const rows = [obs('2026-09-10', '俯卧撑', 4, '15', ''), obs('2026-09-11', '弹力带划船', 4, '12', '20kg')];
  const result = Core.buildMuscleProgress(rows, DAY);
  const chest = result.find((m) => m.key === 'chest');
  assert.equal(chest.recentSets, 4);
  assert.equal(chest.recentLoadVolumeKg, null); // 自重无负重容量
  const back = result.find((m) => m.key === 'back');
  assert.equal(back.recentSets, 4);
  assert.ok(back.recentLoadVolumeKg > 0);
});

test('每周 10 组目标封顶：组数完成度最高 100', () => {
  const rows = [];
  for (let week = 0; week < 4; week++) {
    rows.push(obs(`2026-09-${String(2 + week * 2).padStart(2, '0')}`, '卧推', 10, '10', '40kg'));
  }
  const result = Core.buildMuscleProgress(rows, DAY);
  const chest = result.find((m) => m.key === 'chest');
  assert.ok(chest.hypertrophyScore <= 100);
  assert.ok(chest.recentSets >= 40);
});

test('纯自重高次：strengthScore 为 null，综合走仅耐力分支 0.5×增肌 + 0.3×耐力 + 0.2×频率', () => {
  /* 预期行为变更（docs/muscle-endurance-design.md §4）：自重高次有次数容量 → enduranceScore 非 null，
     综合分从旧 0.85/0.15 分支迁到 0.5/0.3/0.2 仅耐力分支（首窗耐力趋势为 50 基线，分数回落属预期） */
  const rows = [obs(DAY, '俯卧撑', 4, '15', '')];
  const result = Core.buildMuscleProgress(rows, DAY);
  const chest = result.find((m) => m.key === 'chest');
  assert.equal(chest.strengthScore, null);
  assert.ok(chest.enduranceScore !== null); // 15 次×4 组计入次数容量，耐力分可算
  /* 最小修正（docs/muscle-endurance-design.md §11.2）：关系式本身不变；v2 绝对耐力分恰使综合分
     落在四舍五入边界——引擎内部用未取整频率（1/8×100=12.5）参与合成，输出字段 frequencyScore 为
     取整后的 13，故按 ±1 舍入容差断言 0.5/0.3/0.2 分支权重 */
  const expected = 0.5 * chest.hypertrophyScore + 0.3 * chest.enduranceScore + 0.2 * chest.frequencyScore;
  assert.ok(Math.abs(chest.overallScore - expected) <= 1);
  assert.equal(chest.confidence, 'limited'); // 只有 1 天、无上期
});

test('近窗未记次数：enduranceScore 为 null，综合维持旧 0.85/0.15 分支不变', () => {
  const rows = [obs(DAY, '卧推', 4, '', '40kg')];
  const result = Core.buildMuscleProgress(rows, DAY);
  const chest = result.find((m) => m.key === 'chest');
  assert.equal(chest.enduranceScore, null); // 近窗 repVolume = 0（无任何已知次数）
  assert.equal(chest.strengthScore, null); // 无 ≤10 次负重组 → 无 e1RM 锚点
  assert.equal(chest.overallScore, Math.round(0.85 * chest.hypertrophyScore + 0.15 * chest.frequencyScore));
});

test('有上期对比时力量趋势参与综合评分，置信度可到 good', () => {
  const rows = [
    obs('2026-08-05', '卧推', 4, '8', '40kg'),
    obs('2026-08-08', '卧推', 4, '8', '40kg'),
    obs('2026-09-05', '卧推', 4, '8', '45kg'),
    obs('2026-09-08', '卧推', 4, '8', '45kg'),
    obs('2026-09-10', '卧推', 4, '8', '45kg'),
    obs('2026-09-11', '卧推', 4, '8', '45kg')
  ];
  const result = Core.buildMuscleProgress(rows, DAY);
  const chest = result.find((m) => m.key === 'chest');
  assert.ok(chest.strengthScore !== null);
  assert.ok(chest.strengthChangePercent > 0, '重量上调后 1RM 应上升');
  assert.equal(chest.confidence, 'good');
  assert.ok(chest.overallScore >= 50);
});

test('从训练日快照收集观测：跳过日排除、日期过滤正确', () => {
  const state = Core.normalize({});
  const now = new Date('2026-09-12T02:00:00.000Z');
  const tpl = Core.replaceTemplate(state, {
    name: '三分化', days: [
      { dayKey: 'push', name: '推日', actions: [{ name: '卧推', plannedSets: 4, plannedRepsText: '10' }] },
      { dayKey: 'pull', name: '拉日', actions: [{ name: '划船', plannedSets: 4, plannedRepsText: '10' }] }
    ]
  }, now);
  assert.ok(tpl.ok, tpl.error);
  Core.startTraining(state, { date: '2026-09-10' }, now);
  Core.saveTraining(state, { date: '2026-09-10', actions: [{ actionKey: 'act-1-1', setsDone: 4, repsText: '10', weightKg: 40 }] }, now);
  Core.startTraining(state, { date: '2026-09-11' }, now);
  Core.skipAndAdvance(state, { date: '2026-09-11' }, now);
  const observations = Core.collectObservations(state, '2026-09-12');
  assert.equal(observations.length, 1); // 跳过日被排除
  assert.equal(observations[0].actionName, '卧推');
  assert.equal(observations[0].weightText, '40kg');
  const chest = Core.muscleProgress(state, '2026-09-12').find((m) => m.key === 'chest');
  assert.equal(chest.recentSets, 4);
  assert.equal(chest.lastTrainedAt, '2026-09-10');
});

test('动作名→肌群规则审计：细分族优先于宽泛族（后束/面拉、举腿、反屈伸、转腕、直臂上拉、挺身、农夫）', () => {
  assert.deepEqual(Core.inferMuscleWeights('俯身哑铃飞鸟', ''), { shoulders: 1, back: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('反向飞鸟', ''), { shoulders: 1, back: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('面拉', ''), { shoulders: 1, back: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('悬挂举腿', ''), { core: 1 });
  assert.deepEqual(Core.inferMuscleWeights('仰卧举腿', ''), { core: 1 });
  assert.deepEqual(Core.inferMuscleWeights('凳上反屈伸', ''), { triceps: 1, chest: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('双杠臂屈伸', ''), { triceps: 1, chest: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('哑铃水平转腕', ''), { forearms: 1 });
  assert.deepEqual(Core.inferMuscleWeights('腕弯举', ''), { forearms: 1 });
  assert.deepEqual(Core.inferMuscleWeights('直臂下压', ''), { back: 1, chest: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('山羊挺身', ''), { hamstrings: 1, glutes: 0.5, back: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('农夫行走', ''), { forearms: 1, core: 0.5 });
  /* 宽泛族不回归 */
  assert.deepEqual(Core.inferMuscleWeights('哑铃飞鸟', ''), { chest: 1, triceps: 0.5, shoulders: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('哑铃弯举', ''), { biceps: 1, forearms: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('高位下拉', ''), { back: 1, biceps: 0.5, forearms: 0.5 });
  assert.deepEqual(Core.inferMuscleWeights('卧推', ''), { chest: 1, triceps: 0.5, shoulders: 0.5 });
});
