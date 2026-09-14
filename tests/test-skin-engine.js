/* 皮肤引擎测试：评分单调性 / 基线 / 睡眠归日 / 预测规则 / 预测对账 / 相关性 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/js/skin-engine');

const NOW = Date.parse('2026-09-14T01:00:00Z'); // 上海 09-14 09:00

test('评分：参数越差分越低，主客观加权正确', () => {
  const good = { acneTotal: 0, acneNew: 0, eyes: 0, pores: 0, spots: 0, redness: 0, oil: 1, dry: 0, barrier: 0, overall: 8 };
  const bad = { acneTotal: 12, acneNew: 3, eyes: 3, pores: 3, spots: 2, redness: 2, oil: 3, dry: 1, barrier: 2, overall: 3 };
  const gs = E.scoreSkin(good).score, bs = E.scoreSkin(bad).score;
  assert.ok(gs > bs, `${gs} 应大于 ${bs}`);
  assert.ok(gs >= 80 && bs <= 45, '极端样本应落在两端');
  /* 只填主观也应有分 */
  assert.equal(E.scoreSkin({ overall: 7 }).score, 70);
  assert.equal(E.scoreSkin({}).score, null);
});

test('基线：取窗口内中位数，不含当日', () => {
  const logs = {
    '2026-09-01': { acneTotal: 4, pores: 1 },
    '2026-09-05': { acneTotal: 2, pores: 1 },
    '2026-09-10': { acneTotal: 6, pores: 2 }
  };
  const b = E.baseline(logs, '2026-09-14', 28);
  assert.equal(b.n, 3);
  assert.equal(b.acneTotal, 4);
  assert.equal(b.params.pores, 1);
  assert.ok(b.score !== null);
});

test('睡眠归日：按醒来日期，排除进行中的睡眠', () => {
  const sleeps = [
    { start: '2026-09-13T23:30:00+08:00', end: '2026-09-14T06:30:00+08:00', startLocal: '2026-09-13T23:30', endLocal: '2026-09-14T06:30', kind: 'main' },
    { start: '2026-09-14T09:00:00+08:00', end: '2026-09-14T10:00:00+08:00', startLocal: '2026-09-14T09:00', endLocal: '2026-09-14T10:00', kind: 'nap' }
  ];
  const s = E.sleepForDate(sleeps, '2026-09-14', NOW);
  assert.equal(s.minutes, 420);
  assert.equal(s.bedtime, '23:30');
  /* 未来某天的睡眠不可见 */
  assert.equal(E.sleepForDate(sleeps, '2026-09-15', NOW), null);
});

function mkInput({ minutes = 480, bedtime = '23:00', prevTrained = false, logs = {}, meals = [] }) {
  const dateKey = '2026-09-14';
  const wake = `2026-09-14T08:00:00+08:00`;
  const start = new Date(Date.parse(wake) - minutes * 60000);
  const sleeps = [{ start: start.toISOString(), end: wake, startLocal: `${bedtime === '23:00' ? '2026-09-13' : '2026-09-14'}T${bedtime}`, endLocal: '2026-09-14T08:00', kind: 'main' }];
  if (bedtime < '08:00') { /* 熬夜场景修正 startLocal 日期 */
    sleeps[0].startLocal = `2026-09-14T${bedtime}`;
    sleeps[0].start = `2026-09-14T${bedtime}:00+08:00`;
  }
  return { dateKey, nowMs: NOW, sleeps, meals, strengthDays: prevTrained ? { '2026-09-13': { status: 'completed', totalSeconds: 3600 } } : {}, logs };
}

test('预测：短睡眠 → 向下预警并引用文献；充足睡眠且屏障好 → 向上', () => {
  const short = E.predictForDate(mkInput({ minutes: 300 }));
  assert.equal(short.overallDir, 'down');
  assert.ok(short.items.some((p) => p.level === 'warn' && p.refs.length));
  const good = E.predictForDate(mkInput({ minutes: 480 }));
  assert.ok(good.items.some((p) => p.dir === 'up'));
});

test('预测：熬夜（时长够）→ 节律提示；昨日训练 → 清洁提醒', () => {
  const late = E.predictForDate(mkInput({ bedtime: '01:30', minutes: 390 }));
  assert.ok(late.items.some((p) => p.title.includes('节律')));
  const tr = E.predictForDate(mkInput({ prevTrained: true }));
  assert.ok(tr.items.some((p) => p.title.includes('清洁')));
});

test('预测：屏障活跃 → 避免刺激；新痘上升 → 炎症期', () => {
  const barrier = E.predictForDate(mkInput({ logs: { '2026-09-13': { barrier: 2, redness: 1, acneTotal: 1, acneNew: 0 } } }));
  assert.ok(barrier.items.some((p) => p.title.includes('刺激')));
  const acne = E.predictForDate(mkInput({ logs: { '2026-09-12': { acneNew: 1 }, '2026-09-13': { acneNew: 3 } } }));
  assert.ok(acne.items.some((p) => p.title.includes('炎症')));
});

test('预测对账：方向命中记 hit，累计命中率更新', () => {
  const state = E.normalize({});
  state.logs['2026-09-13'] = { acneTotal: 2, acneNew: 0, pores: 1, redness: 0, overall: 7 };
  state.predictions['2026-09-14'] = { overallDir: 'down', items: [], madeAt: 'x' };
  state.logs['2026-09-14'] = { acneTotal: 5, acneNew: 2, pores: 2, redness: 1, overall: 5 };
  const r = E.verifyPrediction(state, '2026-09-14', E.scoreSkin(state.logs['2026-09-14']).score);
  assert.equal(r.hit, true);
  assert.ok(r.delta < 0);
  assert.equal(state.stats.seen, 1);
  assert.equal(state.stats.hit, 1);
  /* 重复验证幂等 */
  assert.equal(E.verifyPrediction(state, '2026-09-14', 10), null);
});

test('预测对账：非连续日期（gap≠1）跳过且不污染命中率', () => {
  const state = E.normalize({});
  state.logs['2026-09-08'] = { overall: 8, acneTotal: 1, acneNew: 0 };
  state.predictions['2026-09-14'] = { overallDir: 'down', items: [], madeAt: 'x' };
  state.logs['2026-09-14'] = { overall: 4, acneTotal: 6, acneNew: 2 }; /* 6 天退化，down 必「中」 */
  const r = E.verifyPrediction(state, '2026-09-14', E.scoreSkin(state.logs['2026-09-14']).score);
  assert.ok(r.skipped, 'gap>1 应跳过');
  assert.equal(r.gapDays, 6);
  assert.equal(state.stats.seen, 0, '跳过不计入命中率');
  assert.equal(state.stats.hit, 0);
  assert.equal(state.predictions['2026-09-14'].verified.skipped, true);
});

test('滞后相关：n<14 的滞后不参与选择', () => {
  /* 12 天有效样本：旧门槛(10)会输出，新门槛(14)必须返回 null */
  const entries = Array.from({ length: 12 }, (_, i) => ({
    date: E.addDays('2026-08-20', i),
    score: 80 - i,
    sleepMinutes: 480 - i * 10,
    trained: false
  }));
  assert.equal(E.bestLagCorrelation(entries, 2), null);
  /* 完美相关的既有用例（18 天）不受影响 */
  const strong = Array.from({ length: 18 }, (_, i) => {
    const sleep = 400 + 30 * (i % 4) + 7 * (i % 3);
    return {
      date: E.addDays('2026-08-20', i),
      score: i === 0 ? 50 : 90 - (400 + 30 * ((i - 1) % 4) + 7 * ((i - 1) % 3)) / 10,
      sleepMinutes: sleep,
      trained: false
    };
  });
  const best = E.bestLagCorrelation(strong, 2);
  assert.ok(best && best.lag === 1 && Math.abs(best.r) > 0.99);
});

test('normAiInt：仅整数/纯整数字符串入表，其余拒绝', () => {
  assert.equal(E.normAiInt(2, 0, 3), 2);
  assert.equal(E.normAiInt('2', 0, 3), 2);
  assert.equal(E.normAiInt(' 3 ', 0, 3), 3);
  /* 拒绝：小数、字符串小数、空串、布尔、null、undefined、越界 */
  assert.equal(E.normAiInt(2.5, 0, 3), null);
  assert.equal(E.normAiInt('2.5', 0, 3), null);
  assert.equal(E.normAiInt('', 0, 3), null);
  assert.equal(E.normAiInt(true, 0, 3), null);
  assert.equal(E.normAiInt(false, 0, 3), null);
  assert.equal(E.normAiInt(null, 0, 3), null);
  assert.equal(E.normAiInt(undefined, 0, 3), null);
  assert.equal(E.normAiInt(5, 0, 3), null);
  assert.equal(E.normAiInt('-1', 0, 3), null);
  assert.equal(E.normAiInt('abc', 0, 3), null);
});

test('预测：前一日晚餐过晚 → 浮肿/出油提示', () => {
  const late = E.predictForDate(mkInput({ meals: [{ local: '2026-09-13T12:00' }, { local: '2026-09-13T22:10' }] }));
  assert.ok(late.items.some((p) => p.title.includes('进食')));
  const early = E.predictForDate(mkInput({ meals: [{ local: '2026-09-13T18:30' }] }));
  assert.ok(!early.items.some((p) => p.title.includes('进食')));
});

test('预测：参数连续两天上行 → 趋势预警', () => {
  const rising = E.predictForDate(mkInput({ logs: {
    '2026-09-11': { pores: 0 },
    '2026-09-12': { pores: 1 },
    '2026-09-13': { pores: 2 }
  } }));
  assert.ok(rising.items.some((p) => p.title.includes('连续两天上行')));
  const flat = E.predictForDate(mkInput({ logs: {
    '2026-09-12': { pores: 1 },
    '2026-09-13': { pores: 1 }
  } }));
  assert.ok(!flat.items.some((p) => p.title.includes('连续两天上行')));
});

test('生理期模式：≥2 次标记学出周期与窗口均值', () => {
  const logs = {};
  /* 两次标记 07-26 / 08-21（间隔 26 天）；经期前窗口高痘、平时低痘 */
  logs['2026-07-26'] = { period: true, acneNew: 0 };
  logs['2026-08-21'] = { period: true, acneNew: 0 };
  logs['2026-07-22'] = { acneNew: 3 };
  logs['2026-07-23'] = { acneNew: 4 };
  logs['2026-08-17'] = { acneNew: 4 };
  logs['2026-08-18'] = { acneNew: 3 };
  logs['2026-08-19'] = { acneNew: 5 };
  logs['2026-08-01'] = { acneNew: 1 };
  logs['2026-08-02'] = { acneNew: 0 };
  logs['2026-08-03'] = { acneNew: 1 };
  logs['2026-08-30'] = { acneNew: 1 };
  logs['2026-09-01'] = { acneNew: 0 };
  const pp = E.periodPattern(logs, '2026-09-14');
  assert.ok(pp, '应输出模式');
  assert.equal(pp.cycleLen, 26);
  assert.equal(pp.daysToNext, 2); /* 下一预估起点 09-16 */
  assert.ok(pp.pmsAvg !== null && pp.otherAvg !== null && pp.pmsAvg > pp.otherAvg);
  /* 临近窗口（≤5 天）触发预测规则 */
  const near = E.predictForDate(mkInput({ logs }));
  assert.ok(near.items.some((p) => p.title.includes('生理期窗口')));
});

test('滞后相关：皮肤对 1 天前的睡眠最敏感时自动检出 lag=1', () => {
  /* score[d] = 90 - sleep[d-1]/10；睡眠序列非线性，避免平移共线 */
  const entries = Array.from({ length: 18 }, (_, i) => {
    const sleep = 400 + 30 * (i % 4) + 7 * (i % 3);
    return {
      date: E.addDays('2026-08-20', i),
      score: i === 0 ? 50 : 90 - (400 + 30 * ((i - 1) % 4) + 7 * ((i - 1) % 3)) / 10,
      sleepMinutes: sleep,
      trained: false
    };
  });
  const best = E.bestLagCorrelation(entries, 2);
  assert.ok(best, '应有结果');
  assert.equal(best.lag, 1);
  assert.ok(Math.abs(best.r) > 0.99);
});

test('相关性：n<10 不给 r；完全正相关给 ~1', () => {
  const small = E.correlate(Array.from({ length: 5 }, (_, i) => ({ score: 80 - i, sleepMinutes: 400 - i * 10 })));
  assert.equal(small.sleep.r, null);
  const big = E.correlate(Array.from({ length: 20 }, (_, i) => ({ score: 80 - i, sleepMinutes: 480 - i * 10, trained: i % 2 === 0 })));
  assert.ok(big.sleep.r > 0.95);
  assert.ok(big.sleep.n === 20);
});
