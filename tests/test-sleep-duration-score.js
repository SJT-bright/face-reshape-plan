const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Engine = require('../src/js/rhythm-engine');
function rhythm(sleeps) {
  const context = { RhythmEngine: Engine, Store: { db: { rhythm: { sleeps } } },
    todayKey: () => '2026-10-14', addDays: Engine.addDay,
    esc: s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/rhythm.js'), 'utf8') + '\nglobalThis.rhythm = Rhythm;', context);
  return context.rhythm;
}
const sleep = (date, minutes, qualityScore = 99) => ({ id: date, kind: 'main', durationOnly: true,
  recordedMinutes: minutes, startLocal: date, endLocal: date, qualityScore });

test('7 小时时长达标度：5h、6h、7h及逐分钟输入，达到目标后封顶', () => {
  assert.equal(Engine.SLEEP_TARGET_MINUTES, 420);
  for (const [minutes, score] of [[0,0],[300,71],[330,79],[360,86],[390,93],[420,100],[480,100],[1440,100]])
    assert.equal(Engine.sleepDurationScore(minutes), score);
  for (let m = 1; m <= 420; m++) assert.equal(Engine.sleepDurationScore(m), Math.round(m / 420 * 100));
  for (const missing of [null,undefined,NaN,Infinity,-1,'360']) assert.equal(Engine.sleepDurationScore(missing), null);
});
test('6h30 → 5h30 降 14 分；相同自评分不掩盖时长变化，原记录不回写', () => {
  const records = [sleep('2026-10-13',390,95),sleep('2026-10-14',330,95)];
  const before = JSON.stringify(records), r = rhythm(records), s = r.sleepQualitySummary();
  assert.equal(s.last.score,79); assert.equal(s.avgScore,86); assert.equal(s.avgMinutes,360);
  assert.equal(s.details[0].score-s.details[1].score,14);
  assert.match(r.sleepChartReading(s.details,1), /少 1 小时，评分低 14 分/);
  assert.match(r.sleepChartReading(s.details,1), /原记录自评分 95 分/);
  assert.equal(JSON.stringify(records), before);
});
test('时长评分不受自评/分期/夜醒影响；午睡和未完成记录不进入主要睡眠图', () => {
  const records = [sleep('2026-10-12',360,0),sleep('2026-10-13',360,100),
    {...sleep('2026-10-14',45),kind:'nap'}, {id:'incomplete',startLocal:'2026-10-14T23:00',end:null}];
  const r=rhythm(records), s=r.sleepQualitySummary();
  assert.equal(s.details.length,2); assert.equal(s.avgScore,86);
  assert.equal(rhythm([]).sleepQualitySummary(),null);
  assert.match(r.sleepChartSVG([]), /还没有可绘制/);
});
test('图表按同一真实小时比例生成，评分虚线与蓝线分别绘制，单点也可见', () => {
  const r=rhythm([sleep('2026-10-13',390),sleep('2026-10-14',330)]);
  const html=r.sleepChartSVG(r.mainSleepDetails());
  const lines=[...html.matchAll(/data-hour="(\d+)"[^>]*y1="([\d.]+)"/g)].map(m=>[+m[1],+m[2]]);
  const y=h=>lines.find(l=>l[0]===h)[1];
  assert.equal(y(5)-y(6),y(6)-y(7));
  assert.match(html,/class="sleep-score-line" points="[^\"]+ [^\"]+"/);
  assert.match(html,/6h30/); assert.match(html,/5h30/); assert.match(html,/93 分/); assert.match(html,/79 分/);
  assert.match(r.sleepChartSVG(r.mainSleepDetails().slice(-1)),/class="sleep-score-dot"/);
  assert.equal(r.sleepDurationText(367),'6 小时 7 分');
  assert.match(r.sleepChartSVG([{date:'2026-10-14',minutes:419.8}]),/7h00/);
  assert.doesNotMatch(r.sleepChartSVG([{date:'2026-10-14',minutes:null}]),/<svg/);
});
