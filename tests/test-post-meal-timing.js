/* 餐后锻炼时机推荐测试（StrengthCore.postMealTimingAdvice 纯函数，内存数据，不触真实存储）
   规则阈值取自 rhythm-evidence.rules（postMealWorkout / eveningWorkout / performanceWindow）：
   低强度餐后 10 分钟 · 中高强度距正餐 ≥2h / 距加餐 ≥30–60min · 剧烈运动就寝前 ≥2h 结束、
   中等强度 ≥1h · 默认就寝锚点 23:00 · 高表现窗 14:00–19:00。
   依据与出处见 docs/meal-timing-workout-design.md */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');

const DAY = '2026-09-26';
const meal = (time, kind = 'meal', mealType = null) => {
  const m = { id: `m-${time}-${kind}`, at: new Date(`${DAY}T${time}:00`).toISOString(), local: `${DAY}T${time}`, offset: -480, kind };
  if (mealType) m.mealType = mealType;
  return m;
};
const nowAt = (time) => new Date(`${DAY}T${time}:00`);

test('正餐后：低强度 10 分钟、中高强度 2 小时；默认就寝 23:00 → 截止 21:00 / 22:00', () => {
  const a = Core.postMealTimingAdvice([meal('12:00')], nowAt('12:40'), { date: DAY });
  assert.equal(a.hasMeal, true);
  assert.equal(a.lastMeal.typeLabel, '午餐');
  assert.equal(a.bedtime, '23:00');
  assert.equal(a.walk.atText, '12:10');
  assert.equal(a.walk.ready, true);
  assert.equal(a.moderate.atText, '14:00');
  assert.equal(a.moderate.ready, false);
  assert.equal(a.vigorous.atText, '14:00');
  assert.equal(a.cutoffs.vigorousEnd, '21:00');
  assert.equal(a.cutoffs.moderateEnd, '22:00');
  assert.equal(a.vigorous.feasible, true);
  assert.equal(a.performanceWindow.start, '14:00');
  assert.equal(a.performanceWindow.end, '19:00');
  assert.ok(a.items.some((i) => i.key === 'large-meal')); // 正餐附大餐提示
});

test('就寝锚点按入睡建议提前 → 截止时间随动；训练窗不足 30 分钟判为改期', () => {
  // 18:32 晚餐 + 锚点 22:45：剧烈最早 20:32、截止 20:45 → 窗口 13 分钟 < 30 → 不可行
  const a = Core.postMealTimingAdvice([meal('18:32')], nowAt('19:00'), { date: DAY, bedMinutes: 22 * 60 + 45 });
  assert.equal(a.cutoffs.vigorousEnd, '20:45');
  assert.equal(a.cutoffs.moderateEnd, '21:45');
  assert.equal(a.vigorous.feasible, false);
  assert.equal(a.moderate.feasible, true);
  assert.equal(a.items.find((i) => i.key === 'vigorous').level, 'off');
});

test('吃得太晚（夜宵 22:30）→ 今晚不再推荐中高强度，文案指向明天高表现窗', () => {
  const a = Core.postMealTimingAdvice([meal('22:30')], nowAt('22:40'), { date: DAY });
  assert.equal(a.lastMeal.typeLabel, '夜宵');
  assert.equal(a.vigorous.feasible, false);
  assert.equal(a.moderate.feasible, false);
  const vig = a.items.find((i) => i.key === 'vigorous');
  assert.ok(vig.text.includes('明天'));
  assert.ok(vig.text.includes('14:00–19:00'));
});

test('加餐：等待时间缩短为 30 / 60 分钟', () => {
  const a = Core.postMealTimingAdvice([meal('16:00', 'snack')], nowAt('16:10'), { date: DAY });
  assert.equal(a.moderate.atText, '16:30');
  assert.equal(a.vigorous.atText, '17:00');
  assert.ok(!a.items.some((i) => i.key === 'large-meal')); // 加餐不附大餐提示
});

test('到点后可以开始；未到点给出最早钟点，不写倒计时', () => {
  const a = Core.postMealTimingAdvice([meal('12:00')], nowAt('14:30'), { date: DAY });
  assert.equal(a.vigorous.ready, true);
  assert.equal(a.moderate.ready, true);
  const b = Core.postMealTimingAdvice([meal('12:00')], nowAt('13:10'), { date: DAY });
  assert.equal(b.vigorous.ready, false);
  assert.equal(b.vigorous.atText, '14:00');
  assert.equal(b.vigorous.waitMinutes, 50);
  assert.equal(b.items.find((i) => i.key === 'vigorous').title.includes('分钟'), false);
});

test('今天还没吃：用上一次进食，间隔已过就可以练', () => {
  const prev = { id: 'y', at: new Date('2026-09-25T19:00:00').toISOString(), local: '2026-09-25T19:00', offset: -480, kind: 'meal', mealType: 'dinner' };
  const a = Core.postMealTimingAdvice([prev], nowAt('10:00'), { date: DAY });
  assert.equal(a.hasMeal, true);
  assert.equal(a.lastMeal.priorDay, true);
  assert.equal(a.lastMeal.typeLabel, '晚餐');
  assert.equal(a.vigorous.ready, true);
});

test('晚上加餐：力量训练等 1 小时', () => {
  const a = Core.postMealTimingAdvice([meal('15:10', 'snack', 'afternoon-snack')], nowAt('15:20'), { date: DAY });
  assert.equal(a.lastMeal.typeLabel, '下午加餐');
  assert.equal(a.lastMeal.isSnack, true);
  assert.equal(a.vigorous.atText, '16:10');
  assert.equal(a.vigorous.ready, false);
});

test('无进餐记录 → 通用引导；历史日期不出现「现在」状态', () => {
  const empty = Core.postMealTimingAdvice([], nowAt('10:00'), { date: DAY });
  assert.equal(empty.hasMeal, false);
  assert.equal(empty.items.length, 1);
  assert.ok(empty.items[0].text.includes('记下吃完的时间'));
  const pastDay = '2026-09-25';
  const pastMeal = { id: 'm-past', at: new Date(`${pastDay}T12:00:00`).toISOString(), local: `${pastDay}T12:00`, offset: -480, kind: 'meal' };
  const past = Core.postMealTimingAdvice([pastMeal], nowAt('14:30'), { date: pastDay });
  assert.equal(past.isToday, false);
  assert.equal(past.lastMeal.minutesAgo, null);
  assert.equal(past.vigorous.ready, false);
  assert.equal(past.vigorous.feasible, true); // 当天窗口本身成立，只是不谈「现在」
});

test('非法日期返回 null；用户手选餐别优先展示', () => {
  assert.equal(Core.postMealTimingAdvice([meal('12:00')], nowAt('12:30'), { date: '2026-9-26' }), null);
  assert.equal(Core.postMealTimingAdvice([meal('12:00')], nowAt('12:30'), {}), null);
  const a = Core.postMealTimingAdvice([meal('09:30', 'meal', 'lunch')], nowAt('09:40'), { date: DAY });
  assert.equal(a.lastMeal.typeLabel, '午餐'); // 手动改过的餐别优先展示（推荐编排仍按时刻计算）
});

test('无效时刻的脏记录被忽略，不阻塞有效记录', () => {
  const dirty = { id: 'bad', local: 'not-a-time', kind: 'meal' };
  const a = Core.postMealTimingAdvice([dirty, meal('12:00')], nowAt('12:40'), { date: DAY });
  assert.equal(a.hasMeal, true);
  assert.equal(a.lastMeal.local, `${DAY}T12:00`);
});
