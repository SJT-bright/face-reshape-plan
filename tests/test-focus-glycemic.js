/* 专注参考分（util.focusScore）与血糖友好习惯参考（RhythmEngine.glycemicScore）测试
   纯函数、内存数据。溯源与诚实性口径见 docs/scoring-parameters.md §7/§8 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const util = require('../src/js/util');
const Engine = require('../src/js/rhythm-engine');

const focusScore = util.focusScore;

test('focusScore：密度线性扣分（每 10 分钟 1 次扣 20），下限 0', () => {
  assert.equal(focusScore(0, 30), 100);
  assert.equal(focusScore(3, 30), 80);  // 每 10 分钟 1 次
  assert.equal(focusScore(1, 5), 60);   // 1 次/5 分钟 = 2 次/10 分钟
  assert.equal(focusScore(2, 5), 20);
  assert.equal(focusScore(3, 5), 0);    // 下限 0
  assert.equal(focusScore(1, 25), 92);  // 0.4 次/10 分钟 → 扣 8
});

test('focusScore：<5 分钟不评估，非法输入返回 null', () => {
  assert.equal(focusScore(0, 4), null);
  assert.equal(focusScore(0, 0), null);
  assert.equal(focusScore('1', 10), null);
  assert.equal(focusScore(1.5, 10), null);
  assert.equal(focusScore(-1, 10), null);
});

function mealsOf(pairs) {
  return pairs.map(([time], i) => ({ id: `m${i}`, local: `2026-09-18T${time}`, at: `2026-09-18T${time}:00.000Z`, kind: 'meal' }));
}

test('glycemicScore：三因子齐全（甜食适量 + 跨度 12h + 20:00 末餐）→ 82', () => {
  const raw = Engine.normalize({ meals: mealsOf([['08:00'], ['20:00']]) });
  Engine.setSugarTier(raw, '2026-09-18', 2);
  const g = Engine.glycemicScore(raw, '2026-09-18');
  assert.equal(g.score, 82); // 60×0.45 + 100×0.30 + 100×0.25
  assert.equal(g.factors.length, 3);
  assert.ok(g.factors[0].note.includes('最好 <25g'));
  assert.ok(g.disclaimer.includes('不是血糖测量'));
  assert.ok(g.disclaimer.includes('不预测任何认知表现'));
});

test('glycemicScore：缺甜食档 → 剩余权重归一，不虚构分数', () => {
  const raw = Engine.normalize({ meals: mealsOf([['08:00'], ['22:00']]) }); // 跨度 14h→70，末餐 22:00→50
  const g = Engine.glycemicScore(raw, '2026-09-18');
  assert.equal(g.factors.length, 2);
  assert.equal(g.score, 61); // (70×0.30 + 50×0.25) / 0.55
});

test('glycemicScore：单因子（仅一次进食）→ 该因子即满分制', () => {
  const raw = Engine.normalize({ meals: mealsOf([['21:45']]) });
  const g = Engine.glycemicScore(raw, '2026-09-18');
  assert.equal(g.score, 50); // 21:30 后末餐 → 50
  assert.equal(g.factors[0].key, 'late');
});

test('glycemicScore：全无数据 → null（不虚构）', () => {
  assert.equal(Engine.glycemicScore(Engine.normalize({}), '2026-09-18'), null);
});

test('setSugarTier：0–3 整数合法，其余拒绝', () => {
  const raw = Engine.normalize({});
  assert.equal(Engine.setSugarTier(raw, '2026-09-18', 3), 3);
  assert.equal(Engine.setSugarTier(raw, '2026-09-18', 4), null);
  assert.equal(Engine.setSugarTier(raw, '2026-09-18', 1.5), null);
  assert.equal(Engine.setSugarTier(raw, 'bad-date', 1), null);
  assert.equal(raw.sugarLog['2026-09-18'], 3);
});

test('glycemicScore：sugarLog 越界脏数据按缺档处理，不再 TypeError', () => {
  const raw = Engine.normalize({ sugarLog: { '2026-09-18': 4 } });
  const g = Engine.glycemicScore(raw, '2026-09-18');
  assert.equal(g, null); // 无 meals、无有效档位 → null（修复前：undefined.label 崩溃）
  const raw2 = Engine.normalize({ sugarLog: { '2026-09-18': 100 }, meals: [
    { id: 'm1', local: '2026-09-18T08:00', at: '2026-09-18T00:00:00.000Z', kind: 'meal' },
    { id: 'm2', local: '2026-09-18T19:00', at: '2026-09-18T11:00:00.000Z', kind: 'meal' }
  ] });
  const g2 = Engine.glycemicScore(raw2, '2026-09-18');
  assert.equal(g2.factors.some(f => f.key === 'sugar'), false); // 越界档不参与计分
  assert.equal(g2.factors.length, 2); // 跨度 + 晚间两因子照常
});

test('glycemicScore：当天最后一条是 01:00 时按夜宵计，late 因子不是 100，并提示末餐偏晚', () => {
  const at = (time) => Engine.glycemicScore(Engine.normalize({ meals: mealsOf([[time]]) }), '2026-09-18');
  const late = at('01:00');
  const factor = late.factors.find((f) => f.key === 'late');
  assert.notEqual(factor.factor, 100);
  assert.equal(factor.factor, 50);
  assert.ok(late.tomorrowActions.some((a) => a.includes('末餐偏晚')));
  assert.equal(at('07:00').factors.find((f) => f.key === 'late').factor, 100);
  assert.equal(at('19:00').factors.find((f) => f.key === 'late').factor, 100);
  assert.equal(at('21:45').factors.find((f) => f.key === 'late').factor, 50);
  assert.equal(at('23:30').factors.find((f) => f.key === 'late').factor, 50);
});
