/* 成长曲线 / 历史分页 / 补剂扩展测试 —— 对应 trends-query.ts 与工作区行为 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');

const NOW = new Date('2026-09-12T02:00:00.000Z'); // 上海 09-12 10:00（周六）

test('parseRepsText：逐组相加 / 单值乘组数 / 无法解析为 0', () => {
  assert.equal(Core.parseRepsText('12, 10, 8', 3), 30);
  assert.equal(Core.parseRepsText('10', 3), 30);
  assert.equal(Core.parseRepsText('10', 1), 10);
  assert.equal(Core.parseRepsText('12-15', 2), 27);
  assert.equal(Core.parseRepsText('', 3), 0);
});

test('computeVolume：组数×5 + 次数×0.5，一位小数', () => {
  assert.equal(Core.computeVolume(10, 0), 50);
  assert.equal(Core.computeVolume(10, 30), 65);
  assert.equal(Core.computeVolume(0, 10), 5);
});

test('mondayOf / normalizeBodyPart', () => {
  assert.equal(Core.mondayOf('2026-09-12'), '2026-09-07'); // 周六 → 周一
  assert.equal(Core.mondayOf('2026-09-07'), '2026-09-07');
  assert.equal(Core.normalizeBodyPart('推胸日', ''), '胸');
  assert.equal(Core.normalizeBodyPart('', '肩+三头'), '肩');
  assert.equal(Core.normalizeBodyPart('', '背+二头+小臂'), '背');
  assert.equal(Core.normalizeBodyPart('手臂日', ''), '手臂');
  assert.equal(Core.normalizeBodyPart('', ''), '未分类');
});

function seed() {
  const state = Core.normalize({});
  const r = Core.replaceTemplate(state, {
    name: '练三腹一', days: [
      { dayKey: 'push', name: '第一天·胸+三头', bodyPart: '胸', actions: [{ name: '卧推', plannedSets: 5, plannedRepsText: '10' }] },
      { dayKey: 'pull', name: '第二天·背+二头+小臂', bodyPart: '背', actions: [{ name: '划船', plannedSets: 7, plannedRepsText: '10' }] }
    ]
  }, NOW);
  assert.ok(r.ok, r.error);
  return state;
}

test('补剂打卡 / 确认时长 / 完成感言随 save-training 落库', () => {
  const state = seed();
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  const r = Core.saveTraining(state, {
    date: '2026-09-12',
    actions: [{ actionKey: 'act-1-1', setsDone: 5, repsText: '10', weightKg: 40 }],
    totalSeconds: 1800,
    confirmedDurationMinutes: 30,
    supplements: { creatineTaken: true, proteinPowderTaken: false, note: '训练后喝' },
    completionText: '状态好'
  }, NOW);
  assert.ok(r.ok, r.error);
  const day = Core.dayRecord(state, '2026-09-12');
  assert.deepEqual(day.supplements, { creatineTaken: true, proteinPowderTaken: false, note: '训练后喝' });
  assert.equal(day.confirmedDurationMinutes, 30);
  assert.equal(day.completionText, '状态好');
  const bad = Core.saveTraining(state, { date: '2026-09-12', supplements: { creatineTaken: 'yes' } }, NOW);
  assert.equal(bad.ok, false);
});

test('finish-and-advance 记录决议，历史分页按日期倒序', () => {
  const state = seed();
  for (const date of ['2026-09-01', '2026-09-03', '2026-09-05']) {
    Core.startTraining(state, { date }, NOW);
    Core.saveTraining(state, { date, actions: [{ actionKey: 'act-1-1', setsDone: 4, repsText: '10', weightKg: 40 }] }, NOW);
    Core.finishAndAdvance(state, { date, note: `完成 ${date}` }, NOW);
  }
  const page1 = Core.historyEntries(state, 1, 2);
  assert.equal(page1.total, 3);
  assert.deepEqual(page1.entries.map((e) => e.date), ['2026-09-05', '2026-09-03']);
  const page2 = Core.historyEntries(state, 2, 2);
  assert.equal(page2.entries.length, 1);
  assert.equal(page2.entries[0].date, '2026-09-01');
  assert.equal(page2.entries[0].resolution.note, '完成 2026-09-01');
  assert.equal(page2.entries[0].resolution.cycleAdvanced, true);
});

test('周日历与生效版本查询', () => {
  const state = seed();
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  const week = Core.calendarRecords(state, '2026-09-10');
  assert.equal(week.length, 7);
  assert.equal(week[0], null); // 周一 09-07 无记录
  assert.ok(week.some((r) => r && r.date === '2026-09-12'));
  const eff = Core.effectiveTemplate(state, '2026-09-12');
  assert.equal(eff.v.revision, 1);
  const history = Core.templateHistory(state);
  assert.equal(history.length, 1);
  assert.equal(history[0].revision, 1);
});

test('成长曲线：周聚合、容量分、连续训练周数、最近训练', () => {
  const state = seed();
  // 第 1 周（08-31~09-06）练两次
  for (const date of ['2026-09-01', '2026-09-03']) {
    Core.startTraining(state, { date }, NOW);
    Core.saveTraining(state, { date, actions: [{ actionKey: 'act-1-1', setsDone: 5, repsText: '10', weightKg: 40 }] }, NOW);
    Core.finishAndAdvance(state, { date }, NOW);
    // 轮转后是 pull 日，手动指回 push 再练
    Core.selectCycleDay(state, { templateId: state.templates[0].id, dayKey: 'push' }, NOW);
  }
  // 第 2 周（09-07~09-13）练一次
  Core.startTraining(state, { date: '2026-09-08' }, NOW);
  Core.saveTraining(state, { date: '2026-09-08', actions: [{ actionKey: 'act-1-1', setsDone: 6, repsText: '10', weightKg: 42.5 }] }, NOW);
  Core.finishAndAdvance(state, { date: '2026-09-08' }, NOW);

  const snap = Core.trendsSnapshot(state, '2026-09-12', 4);
  assert.equal(snap.weeks.length, 4);
  assert.equal(snap.weeks.at(-1), '2026-09-07');
  const chest = snap.series.find((s) => s.bodyPart === '胸');
  assert.ok(chest, '应有胸系列');
  assert.equal(chest.totalSets, 16);
  assert.equal(chest.totalSessions, 3);
  assert.equal(chest.points.at(-1).sets, 6);
  assert.equal(chest.points.at(-1).volume, Core.computeVolume(6, 60));
  assert.equal(snap.currentStreakWeeks, 2);
  assert.equal(snap.recentSessions.length >= 1, true);
  assert.equal(snap.recentSessions[0].businessDate, '2026-09-08');
  assert.ok(snap.recentSessions[0].bestE1rmKg > 0);
  // 本周概览：6 组低于推荐下限 10
  assert.equal(Core.RECOMMENDED_WEEKLY_SETS.min, 10);
});
