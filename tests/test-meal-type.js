/* 餐别分类标准测试（RhythmEngine.classifyMealType / mealTypeLabel / validateMeal）
   分类带：早餐 05:00–09:30 · 上午加餐 09:30–11:00 · 午餐 11:00–14:00 ·
   下午加餐 14:00–17:00 · 晚餐 17:00–20:00 · 晚上加餐 20:00–22:30 · 夜宵 22:30–次日 05:00。
   左闭右开。数值同步登记在 rhythm-evidence.rules.mealType。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/js/rhythm-engine');

const at = (t) => `2026-09-26T${t}`;

test('分类边界：左闭右开，夜宵跨午夜', () => {
  assert.equal(Engine.classifyMealType(at('04:59')), 'supper');
  assert.equal(Engine.classifyMealType(at('05:00')), 'breakfast');
  assert.equal(Engine.classifyMealType(at('09:29')), 'breakfast');
  assert.equal(Engine.classifyMealType(at('09:30')), 'morning-snack');
  assert.equal(Engine.classifyMealType(at('10:59')), 'morning-snack');
  assert.equal(Engine.classifyMealType(at('11:00')), 'lunch');
  assert.equal(Engine.classifyMealType(at('13:59')), 'lunch');
  assert.equal(Engine.classifyMealType(at('14:00')), 'afternoon-snack');
  assert.equal(Engine.classifyMealType(at('16:59')), 'afternoon-snack');
  assert.equal(Engine.classifyMealType(at('17:00')), 'dinner');
  assert.equal(Engine.classifyMealType(at('19:59')), 'dinner');
  assert.equal(Engine.classifyMealType(at('20:00')), 'evening-snack');
  assert.equal(Engine.classifyMealType(at('22:29')), 'evening-snack');
  assert.equal(Engine.classifyMealType(at('22:30')), 'supper');
  assert.equal(Engine.classifyMealType(at('23:59')), 'supper');
  assert.equal(Engine.classifyMealType(at('00:00')), 'supper');
  assert.equal(Engine.classifyMealType(at('04:30')), 'supper');
});

test('无效输入返回 null；七个餐别标签齐全', () => {
  assert.equal(Engine.classifyMealType(''), null);
  assert.equal(Engine.classifyMealType('2026-09-26 12:00'), null);
  assert.equal(Engine.classifyMealType('2026-09-26T25:00'), null);
  assert.equal(Engine.classifyMealType(null), null);
  assert.equal(Engine.mealTypeLabel('breakfast'), '早餐');
  assert.equal(Engine.mealTypeLabel('morning-snack'), '上午加餐');
  assert.equal(Engine.mealTypeLabel('lunch'), '午餐');
  assert.equal(Engine.mealTypeLabel('afternoon-snack'), '下午加餐');
  assert.equal(Engine.mealTypeLabel('dinner'), '晚餐');
  assert.equal(Engine.mealTypeLabel('evening-snack'), '晚上加餐');
  assert.equal(Engine.mealTypeLabel('supper'), '夜宵');
  assert.equal(Engine.mealTypeKind('dinner'), 'meal');
  assert.equal(Engine.mealTypeKind('evening-snack'), 'snack');
  assert.equal(Engine.mealTypeLabel('brunch'), null);
  assert.equal(Engine.MEAL_TYPE_WINDOWS.length, 7);
});

test('编辑旧记录：正餐加餐标记改落到对应加餐', () => {
  assert.equal(Engine.resolveMealSelection(null, at('12:10')), 'lunch');
  assert.equal(Engine.resolveMealSelection({ mealType: 'dinner', kind: 'meal', local: at('18:00') }, at('18:00')), 'dinner');
  assert.equal(Engine.resolveMealSelection({ mealType: 'dinner', kind: 'snack', local: at('20:40') }, at('20:40')), 'evening-snack');
  assert.equal(Engine.resolveMealSelection({ mealType: 'dinner', kind: 'snack', local: at('18:00') }, at('18:00')), 'evening-snack');
  assert.equal(Engine.resolveMealSelection({ kind: 'snack', local: at('15:10') }, at('15:10')), 'afternoon-snack');
});

test('validateMeal：餐别白名单校验，旧记录无餐别字段仍通过', () => {
  const data = Engine.normalize({ meals: [], sleeps: [], completeDays: {}, profile: 'adult' });
  const now = +new Date('2026-09-26T21:00');
  assert.equal(Engine.validateMeal({ local: at('19:00'), mealType: 'dinner' }, data, now), null);
  assert.ok(Engine.validateMeal({ local: at('19:00'), mealType: 'brunch' }, data, now));
  assert.ok(Engine.validateMeal({ local: at('19:00'), mealType: '' }, data, now));
  assert.equal(Engine.validateMeal({ local: at('19:00') }, data, now), null);
});
