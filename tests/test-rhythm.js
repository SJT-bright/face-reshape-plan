const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const R = require('../src/js/rhythm-engine');
const E = require('../src/js/rhythm-evidence');
const now = new Date('2026-09-12T16:00');
function meal(local, id = local) { const p = R.parse(local); return { id, local, at: p.iso, offset: p.offset, kind: 'meal' }; }
function sleep(startLocal, endLocal, kind = 'main') { const a = R.parse(startLocal), b = R.parse(endLocal); return { id: startLocal, startLocal, endLocal, start: a.iso, end: b.iso, startOffset: a.offset, endOffset: b.offset, kind }; }
function week() {
  const d = R.normalize({ profile: 'adult' });
  for (let i = 4; i <= 11; i++) {
    const day = `2026-09-${String(i).padStart(2, '0')}`;
    d.completeDays[day] = { meals: true, sleep: true };
    ['08:00', '13:00', '19:00'].forEach(time => d.meals.push(meal(`${day}T${time}`)));
    d.sleeps.push(sleep(`${R.addDay(day, -1)}T23:00`, `${day}T07:00`));
  }
  return d;
}
test('empty and migrated journals do not imply fasting, zero sleep or healthy status', () => {
  const old = { custom: 42 }; const d = R.normalize(old);
  assert.equal(d.custom, 42); assert.equal(old.meals, undefined);
  const a = R.analyze(d, { now });
  assert.equal(a.metrics.sleep, null); assert.equal(a.metrics.mealGap, null);
  assert.equal(a.state, 'descriptive'); assert.equal(a.alerts.length, 0);
});
test('complete ordinary week produces correct midnight durations and meal/wake pairs', () => {
  const a = R.analyze(week(), { now });
  assert.equal(a.metrics.sleep, 480); assert.equal(a.metrics.beforeBed, 240);
  assert.equal(a.metrics.afterWake, 60); assert.equal(a.metrics.mealGap, 330); assert.equal(a.metrics.gapVariation, 30);
  assert.equal(a.counts.beforeBed, 7); assert.equal(a.state, 'no-flags');
});
test('missing meal confirmations never become long fasting estimates', () => {
  const d = week(); Object.values(d.completeDays).forEach(c => { c.meals = false; });
  const a = R.analyze(d, { now });
  assert.equal(a.metrics.beforeBed, null); assert.equal(a.metrics.afterWake, null);
  assert.equal(a.metrics.mealGap, null); assert.equal(a.metrics.firstVariation, null);
});
test('today is excluded even if marked complete, and yesterday is included', () => {
  const d = week(); d.meals.push(meal('2026-09-12T15:00')); d.completeDays['2026-09-12'] = { meals: true };
  const a = R.analyze(d, { now });
  assert.equal(a.endDay, '2026-09-11'); assert.equal(a.counts.mealDays, 7);
});
test('sleep duration adds naps and never treats an unrecorded day as zero', () => {
  const d = week(); d.sleeps.push(sleep('2026-09-11T14:00', '2026-09-11T15:00', 'nap'));
  d.completeDays['2026-09-10'].sleep = false;
  const a = R.analyze(d, { now });
  assert.equal(a.counts.sleepDays, 6); assert.equal(a.metrics.sleep, 490);
});
test('a single short night is not promoted to repeated risk; repeated short nights flag', () => {
  const d = week(); d.sleeps = d.sleeps.map(s => sleep(s.startLocal, s.endLocal.replace('07:00', '05:00')));
  let a = R.analyze(d, { now }); assert.ok(a.alerts.some(x => x.id === 'short-sleep'));
  Object.values(d.completeDays).forEach(c => { c.sleep = false; }); d.completeDays['2026-09-11'].sleep = true;
  a = R.analyze(d, { now }); assert.equal(a.alerts.length, 0);
});
test('sleep/wake crossing midnight pairs the real last meal, not a future meal', () => {
  const d = R.normalize({ profile: 'adult' });
  d.meals = [meal('2026-09-10T23:30'), meal('2026-09-11T09:00')];
  d.sleeps = [sleep('2026-09-11T00:30', '2026-09-11T08:00')];
  d.completeDays = { '2026-09-10': { meals: true }, '2026-09-11': { meals: true, sleep: true } };
  const a = R.analyze(d, { now }); assert.equal(a.metrics.beforeBed, 60); assert.equal(a.metrics.afterWake, 60);
  delete d.completeDays['2026-09-10']; assert.equal(R.analyze(d, { now }).metrics.beforeBed, null);
});
test('circular timing respects 23:50 and 00:10 as close, not twelve hours apart', () => {
  assert.ok(R.circularSD([1430, 10]) < 11); assert.equal(R.circularSD([10, 10, 10]), 0);
  assert.equal(R.circularSD([0]), null); assert.equal(R.circularSD([0, 720]), 720);
});
test('meal inside a sleep period suppresses ambiguous sleep and pair calculations', () => {
  const d = week(); d.meals.push(meal('2026-09-11T02:00'));
  const a = R.analyze(d, { now }); assert.equal(a.counts.conflicts, 1); assert.equal(a.counts.sleepDays, 6);
  assert.equal(a.beforeBed.some(p => p.date === '2026-09-11'), false);
});
test('near-bed reminders require repeats and contain no predicted fat or disease score', () => {
  const d = week(); d.meals = d.meals.map(m => m.local.endsWith('19:00') ? meal(m.local.replace('19:00', '22:00')) : m);
  const a = R.analyze(d, { now }); assert.ok(a.alerts.some(x => x.id === 'near-bed'));
  assert.equal(a.riskScore, undefined); assert.equal(a.fatPrediction, undefined);
  d.profile = 'other'; assert.equal(R.analyze(d, { now }).alerts.length, 0);
});
test('invalid dates, duplicates, future entries, reversed and overlapping sleeps are rejected', () => {
  const d = week();
  assert.equal(R.parse('2026-02-30T10:00'), null); assert.equal(R.parse('2026-09-11T25:00'), null);
  assert.ok(R.validateMeal({ local: '2026-09-13T10:00' }, d, +now));
  assert.ok(R.validateMeal({ local: '2026-09-11T08:00' }, d, +now));
  assert.equal(R.validateMeal({ ...d.meals[0] }, d, +now), null);
  assert.ok(R.validateSleep({ startLocal: '2026-09-11T08:00', endLocal: '2026-09-11T07:00' }, d, +now));
  assert.ok(R.validateSleep({ startLocal: '2026-09-10T23:30', endLocal: '2026-09-11T06:00' }, d, +now));
  assert.ok(R.validateSleep({ startLocal: '2026-09-01T23:00', endLocal: '2026-09-03T07:00' }, d, +now));
});
test('legacy unfinished sleep stays excluded without blocking later complete days', () => {
  const d = week(); const p = R.parse('2026-09-11T23:00');
  d.sleeps.push({ id: 'pending', startLocal: p.local, start: p.iso, end: null });
  assert.equal(R.analyze(d, { now }).counts.sleepDays, 7);
  assert.ok(R.validateSleep({ startLocal: '2026-09-12T15:00' }, d, +now));
});
test('timezone changes suppress meal/sleep pairing rather than manufacturing a shift', () => {
  const d = week(); d.meals.forEach(m => { m.offset += 60; });
  const a = R.analyze(d, { now }); assert.equal(a.metrics.beforeBed, null); assert.equal(a.metrics.afterWake, null);
});
test('DST durations use elapsed time and impossible spring-forward times are rejected', () => {
  const result = execFileSync(process.execPath, ['-e', `const R=require(${JSON.stringify(require.resolve('../src/js/rhythm-engine'))});console.log(JSON.stringify([R.parse('2026-03-08T02:30'),(Date.parse(R.parse('2026-03-08T07:00').iso)-Date.parse(R.parse('2026-03-07T23:00').iso))/60000]));`], { env: { ...process.env, TZ: 'America/New_York' } });
  assert.deepEqual(JSON.parse(result), [null, 420]);
});
test('30-day window and evidence references remain traceable with explicit non-clinical thresholds', () => {
  const a = R.analyze(week(), { now, days: 30 }); assert.equal(a.rows.length, 30); assert.equal(a.startDay, '2026-08-13');
  Object.values(E.rules).forEach(r => { assert.ok(r.threshold); r.sources.forEach(id => assert.ok(E.sources[id].url.startsWith('https://'))); });
});

test('morning form automatically infers midnight dates and rejects identical times', () => {
  assert.equal(R.sleepInput('2026-09-12', '23:50', '07:00').startLocal, '2026-09-11T23:50');
  assert.equal(R.sleepInput('2026-09-12', '00:30', '07:00').startLocal, '2026-09-12T00:30');
  assert.equal(R.sleepInput('2026-09-12', '13:00', '14:00').startLocal, '2026-09-12T13:00');
  assert.equal(R.sleepInput('2026-09-12', '07:00', '07:00'), null);
});
test('band duration is preferred, bounded by the interval, and optional for old data', () => {
  const d = week(); d.sleeps.forEach(s => { s.recordedMinutes = 405; });
  assert.equal(R.analyze(d, { now }).metrics.sleep, 405);
  assert.ok(R.analyze(d, { now }).alerts.some(a => a.id === 'short-sleep'));
  assert.equal(R.sleepMinutes(sleep('2026-09-11T23:00', '2026-09-12T07:00')), 480);
  assert.ok(R.validateSleep(R.sleepInput('2026-09-12','23:00','07:00',481), R.normalize(), +now));
  assert.ok(R.validateSleep(R.sleepInput('2026-09-12','23:00','07:00',0), R.normalize(), +now));
  assert.equal(R.validateSleep(R.sleepInput('2026-09-12','23:00','07:00',405), R.normalize(), +now), null);
});
test('awake minutes are subtracted from the interval and take precedence over recorded minutes', () => {
  const base = sleep('2026-09-11T23:00', '2026-09-12T07:00'); // 跨度 480
  assert.equal(R.sleepMinutes({ ...base, awakeMinutes: 30 }), 450);
  assert.equal(R.sleepMinutes({ ...base, awakeMinutes: 0 }), 480);
  // 清醒时间优先于旧手环时长：两者同时存在时不双重扣减
  assert.equal(R.sleepMinutes({ ...base, awakeMinutes: 30, recordedMinutes: 405 }), 450);
  // 未填清醒时间时旧口径不变
  assert.equal(R.sleepMinutes({ ...base, recordedMinutes: 405 }), 405);
  // 校验：负数 / 非整数 / 不小于跨度 → 拒绝；合法值通过
  const data = R.normalize();
  assert.ok(R.validateSleep(R.sleepInput('2026-09-12','23:00','07:00',null,null,-5), data, +now));
  assert.ok(R.validateSleep(R.sleepInput('2026-09-12','23:00','07:00',null,null,480), data, +now));
  assert.ok(R.validateSleep(R.sleepInput('2026-09-12','23:00','07:00',null,null,30.5), data, +now));
  assert.equal(R.validateSleep(R.sleepInput('2026-09-12','23:00','07:00',null,null,30), data, +now), null);
});

test('sleepAdvice：昨日训练容量高 → 今晚多留 15 分钟恢复窗口（2026-09-22 N2）', () => {
  const now = new Date('2026-09-22T09:00:00+08:00');
  const mkData = () => {
    const sleeps = [];
    for (let i = 0; i < 7; i++) {
      const day = String(15 + i).padStart(2, '0');
      const next = String(16 + i).padStart(2, '0');
      const startLocal = '2026-09-' + day + 'T23:00';
      const endLocal = '2026-09-' + next + 'T07:00';
      sleeps.push({ kind: 'main', startLocal, endLocal, start: startLocal + ':00', end: endLocal + ':00' });
    }
    return { sleeps, meals: [] };
  };
  const base = R.sleepAdvice(mkData(), now, {});
  const boosted = R.sleepAdvice(mkData(), now, { trainingSetsYesterday: 18 });
  assert.equal(boosted.opportunityMinutes, base.opportunityMinutes + 15);
  assert.ok(boosted.reasons.some((r) => r.includes('恢复窗口')), 'reasons 应说明恢复窗口');
  /* 容量不足 15 组 → 不加 */
  const light = R.sleepAdvice(mkData(), now, { trainingSetsYesterday: 10 });
  assert.equal(light.opportunityMinutes, base.opportunityMinutes);
  /* options=null → 不炸（向后兼容加固） */
  assert.equal(R.sleepAdvice(mkData(), now, null).opportunityMinutes, base.opportunityMinutes);
});

test('glycemicScore：tomorrowActions 只对今天记录到的具体习惯给行动（2026-09-22 N4）', () => {
  const mk = (tier, firstAt, lastAt) => ({ sugarLog: { '2026-09-22': tier }, meals: [
    { local: '2026-09-22T' + firstAt }, { local: '2026-09-22T' + lastAt }
  ] });
  const bad = R.glycemicScore(mk(2, '08:00', '23:30'), '2026-09-22');
  assert.ok(bad.tomorrowActions.length >= 1, '甜食档偏多+跨度超12h+末餐晚 → 至少一条行动');
  assert.ok(bad.tomorrowActions.some((a) => a.includes('甜食')));
  const good = R.glycemicScore(mk(0, '09:00', '19:00'), '2026-09-22');
  assert.equal(good.tomorrowActions.length, 0, '全部达标 → 无行动项');
  /* 分数本身不受影响（tomorrowActions 是附加字段） */
  assert.equal(bad.score, R.glycemicScore(mk(2, '08:00', '23:30'), '2026-09-22').score);
});
