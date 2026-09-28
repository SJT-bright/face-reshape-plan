/* P1-1/P1-2 计时状态机测试：开始/保存/暂停后保存/继续/离开/跨日期，无双计不丢秒 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');

const TODAY = '2026-09-13';
const NOW = new Date('2026-09-13T01:00:00.000Z'); // 上海 09-13 09:00

function seed() {
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

test('timerShouldRun 决策矩阵：仅今天的进行中且未暂停才走秒', () => {
  const state = seed();
  const today = Core.businessDate(NOW);
  Core.startTraining(state, { date: today }, NOW);
  const day = Core.dayRecord(state, today);
  assert.equal(Core.timerShouldRun(day, today), true);
  Core.pauseTraining(state, { date: today }, NOW);
  assert.equal(Core.timerShouldRun(Core.dayRecord(state, today), today), false);
  Core.resumeTraining(state, { date: today }, NOW);
  assert.equal(Core.timerShouldRun(Core.dayRecord(state, today), today), true);
  Core.finishAndAdvance(state, { date: today }, NOW);
  assert.equal(Core.timerShouldRun(Core.dayRecord(state, today), today), false);
  assert.equal(Core.timerShouldRun(null, today), false);
});

test('advanceDaySeconds：有界、只加一次、拒绝过去日期与已收尾日期', () => {
  const state = seed();
  Core.startTraining(state, { date: TODAY }, NOW);
  assert.equal(Core.advanceDaySeconds(state, TODAY, -5).ok, false);
  assert.equal(Core.advanceDaySeconds(state, TODAY, 90001).ok, false);
  assert.equal(Core.advanceDaySeconds(state, TODAY, NaN).ok, false);
  assert.equal(Core.advanceDaySeconds(state, TODAY, 30).ok, true);
  assert.equal(Core.advanceDaySeconds(state, TODAY, 30).ok, true);
  assert.equal(Core.dayRecord(state, TODAY).totalSeconds, 60); // 每次调用只加一次
  // 补记过去日期：防线在 timerShouldRun（UI 不为过去日期启动秒表），core 不再依赖可伪造的 today 参数
  Core.selectCycleDay(state, { templateId: state.templates[0].id, dayKey: 'push' }, NOW);
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  assert.equal(Core.timerShouldRun(Core.dayRecord(state, '2026-09-12'), TODAY), false);
  // 已收尾日期拒绝追加
  Core.finishAndAdvance(state, { date: TODAY }, NOW);
  assert.equal(Core.advanceDaySeconds(state, TODAY, 30).ok, false);
});

test('核心用户流程模拟：开始→走秒→保存→继续走秒→暂停→继续→离开→总计无双计不丢秒', () => {
  const state = seed();
  const today = Core.businessDate(NOW);
  // UI 开始：startTraining + 秒表从 0 走
  Core.startTraining(state, { date: today }, NOW);
  let timer = { date: today, seconds: 0, running: true };
  const flush = () => {
    if (timer.running && timer.seconds > 0) {
      Core.advanceDaySeconds(state, timer.date, timer.seconds);
    }
    timer = { date: timer.date, seconds: 0, running: false };
  };
  timer.seconds = 30; flush();                       // 每 30 秒周期落盘
  timer.running = true;
  // 保存实际数据（P1-1：保存后应恢复走秒）
  Core.saveTraining(state, { date: today, actions: [{ actionKey: 'act-1-1', setsDone: 4, repsText: '10', weightKg: 40 }] }, NOW);
  assert.equal(Core.timerShouldRun(Core.dayRecord(state, today), today), true);
  timer = { date: today, seconds: 0, running: true }; // 局部变量模拟旧秒表落盘，不调用页面
  timer.seconds = 20; flush();
  timer.running = true;
  // 暂停（先落秒再暂停，不丢秒）
  timer.seconds = 10; flush();
  Core.pauseTraining(state, { date: today }, NOW);
  assert.equal(Core.dayRecord(state, today).totalSeconds, 60);
  // 继续（P1-1：暂停态下的「继续」合法，恢复走秒）
  Core.resumeTraining(state, { date: today }, NOW);
  timer = { date: today, seconds: 0, running: true };
  timer.seconds = 60; flush();                        // 离开页面：落秒停表
  assert.equal(Core.dayRecord(state, today).totalSeconds, 120);
  assert.equal(Core.timerShouldRun(Core.dayRecord(state, today), today), true);
  // 跨日期：先落秒再切日期，各自日期互不污染
  timer = { date: today, seconds: 45, running: true };
  flush();
  assert.equal(Core.dayRecord(state, today).totalSeconds, 165);
  assert.equal(Core.dayRecord(state, '2026-09-12')?.totalSeconds ?? 0, 0);
});

test('补记流程：过去日期开始训练后不启动秒表，时长只来自确认时长', () => {
  const state = seed();
  const today = Core.businessDate(NOW);
  Core.selectCycleDay(state, { templateId: state.templates[0].id, dayKey: 'push' }, NOW);
  Core.startTraining(state, { date: '2026-09-12' }, NOW);
  const day = Core.dayRecord(state, '2026-09-12');
  assert.equal(Core.timerShouldRun(day, today), false); // UI 由此不启动秒表
  const r = Core.saveTraining(state, { date: '2026-09-12', confirmedDurationMinutes: 45, actions: [{ actionKey: 'act-1-1', setsDone: 4, repsText: '10', weightKg: 40 }] }, NOW);
  assert.ok(r.ok, r.error);
  assert.equal(Core.dayRecord(state, '2026-09-12').totalSeconds, 0);
  assert.equal(Core.dayRecord(state, '2026-09-12').confirmedDurationMinutes, 45);
});
