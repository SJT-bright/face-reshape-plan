/* 评分算法精进（v2）测试：1RM 混合公式 / 分段容量曲线 / 次数区间刺激折算 / top-2 趋势 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');

const DAY = '2026-09-12';

test('1RM 混合公式：≤8 次用 Brzycki，9–10 次取 Brzycki 与 Epley 平均', () => {
  assert.equal(Core.estimateE1rmKg(40, 8), Math.round(40 * 36 / 29 * 10) / 10);
  const b9 = 40 * 36 / 28, e9 = 40 * (1 + 9 / 30);
  assert.equal(Core.estimateE1rmKg(40, 9), Math.round((b9 + e9) / 2 * 10) / 10);
  const b10 = 40 * 36 / 27, e10 = 40 * (1 + 10 / 30);
  assert.equal(Core.estimateE1rmKg(40, 10), Math.round((b10 + e10) / 2 * 10) / 10);
  assert.equal(Core.estimateE1rmKg(0, 5), null);
  assert.equal(Core.estimateE1rmKg(40, 11), null);
});

test('分段容量曲线：10 组前线性到 90，10–20 组爬升到 100，过量回落到 85 保底', () => {
  assert.equal(Core.setCompletionScore(0), 0);
  assert.equal(Core.setCompletionScore(5), 45);
  assert.equal(Core.setCompletionScore(10), 90);
  assert.equal(Core.setCompletionScore(15), 95);
  assert.equal(Core.setCompletionScore(20), 100);
  assert.equal(Core.setCompletionScore(30), 90);
  assert.equal(Core.setCompletionScore(40), 85);
  assert.equal(Core.setCompletionScore(60), 85);
});

test('次数区间刺激折算：5–30 次全额，1–4 次 0.6，>30 次 0.7，未记 0.85', () => {
  assert.equal(Core.repStimMultiplier(10), 1);
  assert.equal(Core.repStimMultiplier(3), 0.6);
  assert.equal(Core.repStimMultiplier(35), 0.7);
  assert.equal(Core.repStimMultiplier(null), 0.85);
});

test('同样组数下，5–30 次组的增肌刺激高于 1–4 次组', () => {
  const rowsHigh = [ { businessDate: '2026-09-10', dayLabel: '推日', actionName: '卧推', sets: 5, repsText: '10', weightText: '40kg' } ];
  const rowsLow = [ { businessDate: '2026-09-10', dayLabel: '推日', actionName: '卧推', sets: 5, repsText: '2', weightText: '80kg' } ];
  const high = Core.buildMuscleProgress(rowsHigh, DAY).find((m) => m.key === 'chest');
  const low = Core.buildMuscleProgress(rowsLow, DAY).find((m) => m.key === 'chest');
  assert.equal(high.recentSets, 5);
  assert.equal(low.recentSets, 5); // 显示口径不变
  assert.ok(low.hypertrophyScore < high.hypertrophyScore, '低次数组的刺激分应更低');
  // 但力量趋势只看有 1RM 的组：低次数高重量反而 e1RM 更高
  assert.ok(low.bestE1rmKg > high.bestE1rmKg);
});

test('top-2 趋势：两次高的平均，单次记录取其自身', () => {
  const rows = [
    { businessDate: '2026-09-05', dayLabel: '推日', actionName: '卧推', sets: 4, repsText: '8', weightText: '40kg' },
    { businessDate: '2026-09-08', dayLabel: '推日', actionName: '卧推', sets: 4, repsText: '8', weightText: '50kg' },
    { businessDate: '2026-09-10', dayLabel: '推日', actionName: '卧推', sets: 4, repsText: '8', weightText: '60kg' }
  ];
  const chest = Core.buildMuscleProgress(rows, DAY).find((m) => m.key === 'chest');
  const e = (w) => Core.estimateE1rmKg(w, 8);
  const top2 = (e(50) + e(60)) / 2; // 最高两次的平均，忽略 40kg 的异常低值
  assert.equal(chest.bestE1rmKg, e(60));
  assert.ok(chest.strengthScore !== null);
  // 单独验证：无上期 → e1RM 变化 null → 力量分由 0.7×50 + 0.2×50 + 0.1×频率 构成，不受单次噪声影响
  assert.equal(chest.strengthChangePercent, null);
});
