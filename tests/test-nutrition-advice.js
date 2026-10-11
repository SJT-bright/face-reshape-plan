/* 今日饮食参考引擎测试（RhythmEngine.nutritionAdvice / summarizeMealsToday，纯函数、内存数据）
   口径：Mifflin-St Jeor + 活动系数；蛋白分层（ISSN 1.4–2.0 带内取值，无训练档 1.2 为保守值）；
   脂肪 25% 起步、碳水余量受 50–65%E 约束（越界时带内调脂肪，不可行则披露）；饮水 30–35ml/kg 截 1500–2500 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/js/rhythm-engine');

const PROFILE = { heightCm: 170, weightKg: 65, age: 30, sex: '男', activity: 'moderate' };

test('基础口径：BMR/TDEE 按公式，规律力量训练 → 蛋白 1.6g/kg，碳水在带内时不调整', () => {
  const a = Engine.nutritionAdvice(PROFILE, { weeklySets: 12, mealCount: 3 });
  assert.equal(a.bmr, 1568);          // 10×65 + 6.25×170 − 5×30 + 5 = 1567.5
  assert.equal(a.tdee, 2430);         // 1568 × 1.55
  assert.equal(a.proteinPerKg, 1.6);
  assert.equal(a.proteinG, 104);      // 65 × 1.6
  assert.equal(a.fatG, 68);           // 2430 × 25% ÷ 9 = 67.5
  assert.equal(a.carbsG, 351);        // (2430 − 416 − 612) ÷ 4 = 350.5 → 供能 57.7%，在 50–65% 带内
  assert.equal(a.fatPct, 25);
  assert.equal(a.waterMl, 2100);      // 65 × 32.5ml → 2112.5 → 取整到百位
  assert.equal(a.waterClamped, false);
  assert.equal(a.tier, 'training');
  // F1（02:30 复核）：每餐固定 4 餐主口径，不随当天已记次数变化——消除时间性误导
  assert.equal(a.perMealG, 26);
  assert.equal(a.perMealPerKg, 0.4);
  assert.ok(a.notes.some(n => n.includes('蛋白目标共 104g：按 4 餐分摊约每餐 26g（≈0.4 g/kg')));
  assert.ok(a.notes.some(n => n.includes('0.25–0.4 g/kg')));
  assert.ok(a.notes.some(n => n.includes('今天已记 3 次进食')));
  assert.ok(!a.notes.some(n => n.includes('已高于参考带上端'))); // 误导性折算提示已整体移除
  assert.ok(a.disclaimer.includes('非医疗建议'));
  assert.ok(a.disclaimer.includes('通常高于普通成人 10–15%E')); // F4 披露
});

test('训练量分层：无记录 1.2、周组数 8 → 1.2、>20 → 1.8；1.2 档如实标注 DRIs 锚点', () => {
  assert.equal(Engine.nutritionAdvice(PROFILE, { weeklySets: null }).proteinPerKg, 1.2);
  assert.equal(Engine.nutritionAdvice(PROFILE, { weeklySets: 8 }).proteinPerKg, 1.2);
  assert.equal(Engine.nutritionAdvice(PROFILE, { weeklySets: 25 }).proteinPerKg, 1.8);
  assert.equal(Engine.nutritionAdvice(PROFILE, { weeklySets: 25 }).proteinG, 117);
  const noTrain = Engine.nutritionAdvice(PROFILE, { weeklySets: null, mealCount: 4 });
  assert.ok(noTrain.notes[0].includes('0.98'));
  assert.ok(noTrain.notes[0].includes('1.17'));
  // F2 边界：无训练档按 4 餐主口径 = 1.2/4 = 0.3，在参考带内 → 不得出现「已高于」
  const three = Engine.nutritionAdvice(PROFILE, { weeklySets: null, mealCount: 3 });
  assert.equal(three.perMealPerKg, 0.3);
  assert.ok(!three.notes.some(n => n.includes('已高于参考带上端')));
});

test('F1：每餐口径与当天记录次数解耦（1/2/6 次同一主口径，仅进度句不同）', () => {
  const perMealOf = (count) => Engine.nutritionAdvice(PROFILE, { weeklySets: 12, mealCount: count }).perMealG;
  assert.equal(perMealOf(1), 26);
  assert.equal(perMealOf(2), 26);
  assert.equal(perMealOf(6), 26);
  const one = Engine.nutritionAdvice(PROFILE, { weeklySets: 12, mealCount: 1 });
  assert.ok(one.notes.some(n => n.includes('今天已记 1 次进食') && !n.includes('加餐')));
  const six = Engine.nutritionAdvice(PROFILE, { weeklySets: 12, mealCount: 6 });
  assert.ok(six.notes.some(n => n.includes('今天已记 6 次进食，加餐无需每次都配蛋白')));
  const none = Engine.nutritionAdvice(PROFILE, { weeklySets: 12 });
  assert.ok(!none.notes.some(n => n.includes('今天已记')));
});

test('P2：性别/活动缺省有显式披露（sexAssumed / activityAssumed）', () => {
  const noSex = Engine.nutritionAdvice({ heightCm: 170, weightKg: 65, age: 30, activity: 'moderate' }, { weeklySets: 12 });
  assert.equal(noSex.sexAssumed, true);
  assert.equal(noSex.bmr, 1568); // 与男性同式
  assert.ok(noSex.notes.some(n => n.includes('性别缺省') && n.includes('男性')));
  const female = Engine.nutritionAdvice({ heightCm: 170, weightKg: 65, age: 30, sex: '女', activity: 'moderate' }, { weeklySets: 12 });
  assert.equal(female.sexAssumed, false);
  assert.equal(female.bmr, 1402);
  const weird = Engine.nutritionAdvice({ heightCm: 170, weightKg: 65, age: 30, sex: '男', activity: 'athletic' }, { weeklySets: 12 });
  assert.equal(weird.activityAssumed, true);
  assert.equal(weird.tdee, 2430); // 回退中度活动
  assert.ok(weird.notes.some(n => n.includes('活动水平缺省')));
});

test('F3 碳水带约束：越下限时脂肪在 20–30% 带内让位（边界人群）', () => {
  // 40kg/60 岁女久坐 + 1.8 档：碳水余量 48.8% < 50% → 上调碳水到 50%，脂肪 30→29g（23.9%）
  const a = Engine.nutritionAdvice({ heightCm: 155, weightKg: 40, age: 60, sex: '女', activity: 'sedentary' }, { weeklySets: 25, mealCount: 3 });
  assert.equal(a.carbsG, 136);
  assert.equal(a.fatG, 29);
  assert.equal(a.fatPct, 24);
  assert.ok(a.notes.some(n => n.includes('带内下调')));
  // 42kg/70 岁女久坐：蛋白供能 29.9%，碳水拉到 50% 后脂肪 23g（20.4%），恰在带内
  const b = Engine.nutritionAdvice({ heightCm: 150, weightKg: 42, age: 70, sex: '女', activity: 'sedentary' }, { weeklySets: 25, mealCount: 3 });
  assert.equal(b.carbsG, 127);
  assert.equal(b.fatG, 23);
  assert.equal(b.fatPct, 20);
});

test('F3 不可行披露：大体重久坐高蛋白档，脂肪到 20% 下限仍不足 50% → 如实标注', () => {
  const a = Engine.nutritionAdvice({ heightCm: 150, weightKg: 120, age: 40, sex: '男', activity: 'sedentary' }, { weeklySets: 25, mealCount: 3 });
  assert.equal(a.fatG, 52);
  assert.equal(a.carbsG, 250);
  assert.ok(a.notes.some(n => n.includes('仍低于 50–65% 参考带') && n.includes('20% 下限')));
});

test('X1 活动系数白名单：activity 命中原型键（如 toString）不产生 NaN', () => {
  const a = Engine.nutritionAdvice({ heightCm: 170, weightKg: 65, age: 30, sex: '男', activity: 'toString' }, { weeklySets: 12 });
  assert.equal(a.tdee, 2430); // 回退 moderate
  assert.equal(Number.isFinite(a.carbsG), true);
});

test('X2/X3：年龄缺省标注 + 饮水钳制标注', () => {
  const noAge = Engine.nutritionAdvice({ heightCm: 170, weightKg: 65, sex: '男', activity: 'moderate' }, { weeklySets: 12 });
  assert.equal(noAge.ageAssumed, true);
  assert.ok(noAge.notes.some(n => n.includes('按 30 岁估算')));
  const tiny = Engine.nutritionAdvice({ heightCm: 150, weightKg: 30, age: 30, sex: '女', activity: 'light' }, {});
  assert.equal(tiny.waterMl, 1500);
  assert.equal(tiny.waterClamped, true);
  assert.ok(tiny.notes.some(n => n.includes('1500–2500ml')));
  assert.equal(tiny.carbsG, 204); // 常规场景不受碳水调整影响（TDEE 1275，碳水供能 64% 在带内）
});

test('缺身高/体重 → 不给数字建议（返回 null）', () => {
  assert.equal(Engine.nutritionAdvice({}, {}), null);
  assert.equal(Engine.nutritionAdvice({ heightCm: 170 }, {}), null);
  assert.equal(Engine.nutritionAdvice({ heightCm: 170, weightKg: 0 }, {}), null);
});

test('女性公式：BMR 用 −161 常数（年龄缺省按 30 估算并在 notes 标注）', () => {
  const a = Engine.nutritionAdvice({ heightCm: 170, weightKg: 65, sex: '女', activity: 'moderate' }, { weeklySets: 12 });
  assert.equal(a.bmr, 1402); // 650 + 1062.5 − 150 − 161 = 1401.5
  assert.equal(a.ageAssumed, true);
});

test('轻训练量文案：周组数 8 写 1.2 且不含「蛋白 1.6」；周组数 12 仍写 1.6', () => {
  const light = Engine.nutritionAdvice(PROFILE, { weeklySets: 8 });
  assert.ok(light.notes.some(n => n.includes('1.2')));
  assert.ok(!light.notes.some(n => n.includes('蛋白 1.6')));
  const trained = Engine.nutritionAdvice(PROFILE, { weeklySets: 12 });
  assert.ok(trained.notes.some(n => n.includes('1.6')));
});

test('summarizeMealsToday：只按餐次时间汇总（N 次进食/首次/末次/跨度）', () => {
  const data = Engine.normalize({ meals: [
    { id: 'm1', local: '2026-09-17T08:10', at: '2026-09-17T00:10:00.000Z', kind: 'meal' },
    { id: 'm2', local: '2026-09-17T12:30', at: '2026-09-17T04:30:00.000Z', kind: 'meal' },
    { id: 'm3', local: '2026-09-17T19:05', at: '2026-09-17T11:05:00.000Z', kind: 'snack' },
    { id: 'm4', local: '2026-09-16T19:00', at: '2026-09-16T11:00:00.000Z', kind: 'meal' }
  ] });
  const s = Engine.summarizeMealsToday(data, '2026-09-17');
  assert.equal(s.count, 3);
  assert.equal(s.first, '08:10');
  assert.equal(s.last, '19:05');
  assert.equal(s.spanMinutes, 655); // 08:10 → 19:05
  const empty = Engine.summarizeMealsToday(Engine.normalize({}), '2026-09-17');
  assert.deepEqual(empty, { count: 0, first: null, last: null, spanMinutes: null });
});
