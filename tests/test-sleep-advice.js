/* 今晚入睡建议引擎测试（RhythmEngine.sleepAdvice 纯函数，内存数据，不触真实存储）
   覆盖：目标时长个人化 / 偏短与低质量延长 / 规律性靠拢 / 记录不足降级 / 圆环时刻运算 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/js/rhythm-engine');

const NOW = new Date('2026-09-17T09:00:00'); // 本地（上海）2026-09-17 09:00，早上记录后

/* 造一条主睡眠：bed/wake 为 HH:mm，date 为起床日（跨夜自动往前一天） */
function sleep(date, bed, wake, extra = {}) {
  const cross = bed > wake;
  const startLocal = `${Engine.addDay(date, cross ? -1 : 0)}T${bed}`;
  const endLocal = `${date}T${wake}`;
  const s = Engine.parse(startLocal), e = Engine.parse(endLocal);
  return { id: `s-${date}-${bed}`, kind: 'main', start: s.iso, startLocal: s.local, startOffset: s.offset,
    end: e.iso, endLocal: e.local, endOffset: e.offset, recordedMinutes: null,
    awakeEpisodes: null, morningFeeling: null, qualityScore: null, deepMinutes: null, remMinutes: null, ...extra };
}
function dataWith(sleeps) { return Engine.normalize({ sleeps, meals: [], completeDays: {}, profile: 'adult' }); }

test('圆环时刻运算：跨午夜均值、中点、差值', () => {
  assert.equal(Math.round(Engine.circularMeanMinutes([350, 370])), 360);
  assert.equal(Math.round(Engine.circularMeanMinutes([1430, 10])), 0); // 23:50 与 00:10 的均值是午夜
  assert.equal(Math.round(Engine.circularDiffMinutes(23 * 60, 30)), 90); // 23:00 与 00:30 差 90 分钟
  assert.equal(Math.round(Engine.circularMidpoint(1430, 10)), 0); // 短弧中点在午夜
  assert.equal(Math.round(Engine.circularMidpoint(1365, 1380)), 1373); // 22:45 与 23:00 的中点 ≈ 22:53（四舍五入）
});

test('基础建议：个人均值 8h → 目标 8h，入睡 = 起床 − 目标 − 15 分钟', () => {
  const sleeps = [];
  for (let i = 1; i <= 7; i++) sleeps.push(sleep(`2026-09-${String(10 + i).padStart(2, '0')}`, '23:00', '07:00'));
  const advice = Engine.sleepAdvice(dataWith(sleeps), NOW);
  assert.equal(advice.samples, 7);
  assert.equal(advice.opportunityMinutes, 480);
  assert.equal(advice.bedtime, '22:45'); // 07:00 − 8h − 15min
  assert.equal(advice.wake, '07:00');
  assert.equal(advice.cycles, 5);
  assert.equal(advice.blended, false);
  assert.ok(advice.reasons[0].includes('近 7 次平均'));
  assert.ok(advice.reasons[0].includes('NSF'));
});

test('昨晚偏短 → 多留 30 分钟卧床，入睡时刻提前', () => {
  const sleeps = [];
  for (let i = 1; i <= 6; i++) sleeps.push(sleep(`2026-09-${String(10 + i).padStart(2, '0')}`, '23:00', '07:00'));
  sleeps.push(sleep('2026-09-17', '03:00', '07:00')); // 昨晚仅 4h
  const advice = Engine.sleepAdvice(dataWith(sleeps), NOW);
  assert.equal(advice.opportunityMinutes, 480); // 均值 445.7 → 目标 450，偏短延长 30 → 480
  assert.equal(advice.bedtime, '22:45');
  assert.ok(advice.reasons.some(r => r.includes('偏短')));
});

test('昨晚质量评分低（夜醒多、感受差）→ 多留 30 分钟', () => {
  const sleeps = [];
  for (let i = 1; i <= 6; i++) sleeps.push(sleep(`2026-09-${String(10 + i).padStart(2, '0')}`, '23:00', '07:00'));
  // 时长正常但夜醒 4 次、晨起感受 1 分 → computed 分 ≈ 45+0+0+6 = 51 < 60
  sleeps.push(sleep('2026-09-17', '23:00', '07:00', { awakeEpisodes: 4, morningFeeling: 1 }));
  const advice = Engine.sleepAdvice(dataWith(sleeps), NOW);
  assert.equal(advice.opportunityMinutes, 510); // 480 + 30
  assert.ok(advice.reasons.some(r => r.includes('质量偏低')));
  assert.equal(advice.lastScore < 60, true);
});

test('规律性靠拢：计算的入睡时刻与习惯差 >60 分钟 → 折半靠拢', () => {
  const sleeps = [];
  for (let i = 1; i <= 6; i++) sleeps.push(sleep(`2026-09-${String(10 + i).padStart(2, '0')}`, '23:00', '10:30')); // 长睡 11.5h
  sleeps.push(sleep('2026-09-17', '23:00', '10:30'));
  const advice = Engine.sleepAdvice(dataWith(sleeps), NOW);
  assert.equal(advice.blended, true);
  assert.equal(advice.bedtime, '00:08'); // 未混合为 01:15，习惯 23:00 → 折半到 00:08
  assert.ok(advice.reasons.some(r => r.includes('靠拢')));
});

test('记录不足 3 次 → 通用 7.5 小时目标并在理由中说明', () => {
  const advice = Engine.sleepAdvice(dataWith([sleep('2026-09-17', '23:00', '07:00')]), NOW);
  assert.equal(advice.samples, 1);
  assert.equal(advice.opportunityMinutes, 450); // 通用目标 7.5h（卧床 = 7.5h + 15 分钟潜伏期）
  assert.equal(advice.bedtime, '23:15');
  assert.ok(advice.reasons[0].includes('记录还少'));
});

test('无任何主睡眠记录 → 不给建议（返回 null）', () => {
  assert.equal(Engine.sleepAdvice(dataWith([]), NOW), null);
  assert.equal(Engine.sleepAdvice(dataWith([sleep('2026-09-17', '13:00', '14:00', { kind: 'nap' })]), NOW), null);
});

test('圆环 medoid：抗离群值（6 晚 23:00 + 1 晚 03:00 仍取 23:00）', () => {
  const beds = [1380, 1380, 1380, 1380, 1380, 1380, 180];
  assert.equal(Engine.circularMedoidMinutes(beds), 1380); // 均值会偏到 ~20:22
  assert.equal(Engine.circularMedoidMinutes([420]), 420);
});

test('起床锚点抗离群值：最近三晚一次 11:00 晚起不拉偏锚点', () => {
  const sleeps = [];
  for (let i = 1; i <= 4; i++) sleeps.push(sleep(`2026-09-${String(10 + i).padStart(2, '0')}`, '23:00', '07:00'));
  sleeps.push(sleep('2026-09-15', '23:00', '07:00'));
  sleeps.push(sleep('2026-09-16', '23:00', '07:00'));
  sleeps.push(sleep('2026-09-17', '23:00', '11:00')); // 昨晚晚起（离群值）
  const noon = new Date('2026-09-17T13:00:00'); // 11:00 起床已发生（09:00 时该记录尚未存在，会被正确排除）
  const advice = Engine.sleepAdvice(dataWith(sleeps), noon);
  assert.equal(advice.wake, '07:00'); // medoid → 07:00（circular 均值会偏到 08:00）
  assert.equal(advice.bedtime, '22:15'); // 均值 8.6h → 目标 8.5h；07:00 − 8.5h − 15min
});

test('明早定时起床覆盖：按指定时间重算入睡点', () => {
  const sleeps = [];
  for (let i = 1; i <= 7; i++) sleeps.push(sleep(`2026-09-${String(10 + i).padStart(2, '0')}`, '23:00', '07:00'));
  const data = dataWith(sleeps);
  const advice = Engine.sleepAdvice(data, NOW, { wakeOverrideMinutes: 390 }); // 明早 06:30 要起床
  assert.equal(advice.wakeOverride, true);
  assert.equal(advice.wake, '06:30');
  assert.equal(advice.bedtime, '22:15'); // 06:30 − 8h − 15min
  assert.ok(advice.reasons.some(r => r.includes('指定的明早')));
  // 无覆盖时回到近期锚点
  assert.equal(Engine.sleepAdvice(data, NOW).wake, '07:00');
});

test('建议的免责声明不宣称精确预测', () => {
  const advice = Engine.sleepAdvice(dataWith([sleep('2026-09-17', '23:00', '07:00')]), NOW);
  assert.ok(advice.disclaimer.includes('非医疗建议'));
  assert.ok(advice.disclaimer.includes('无法提前精确预测'));
});

test('倒挂记录（end<start）被排除，不产出负时长荒谬文案', () => {
  const good = sleep('2026-09-16', '23:00', '07:00');
  const bad = { id: 'bad', kind: 'main', start: '2026-09-17T15:00:00.000', startLocal: '2026-09-17T15:00', end: '2026-09-17T06:30:00.000', endLocal: '2026-09-17T06:30', recordedMinutes: null };
  const advice = Engine.sleepAdvice(dataWith([good, bad]), new Date('2026-09-17T20:00:00'));
  assert.equal(advice.lastMinutes >= 0, true);
  assert.ok(!advice.reasons.some(r => r.includes('-')));
  assert.equal(advice.opportunityMinutes >= 420, true);
});
