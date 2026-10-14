/* Real Electron renderer, real pointer/keyboard actions; only an isolated test profile. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright-core');
const root = path.resolve(__dirname,'..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'face-sleep-chart-'));
const evidence = path.resolve(process.env.FACE_SLEEP_EVIDENCE || '.impeccable/review/sleep-chart');
const executable = process.env.FACE_SLEEP_APP_BINARY;
const sleeps = [389,412,345,405,308,388,352,470,419,354,377,437,390,330].map((minutes,i) => {
  const date = `2026-10-${String(i+1).padStart(2,'0')}`;
  return { id: 'sample-'+i, kind:'main', durationOnly:true, recordedMinutes:minutes,
    startLocal:date, endLocal:date, qualityScore:95, source:'manual-duration' };
});
const db = {version:1,onboarding:{done:true},freshInstall:false,settings:{keepInTray:false,remindersEnabled:false},
  videos:[],sessions:[],logs:{training:{'2026-10-01':{seconds:42}},skincare:{}},skincare:{cycles:[]},
  rhythm:{sleeps,meals:[],completeDays:{},profile:'adult'},sentinel:'preserve-sleep-source'};
const dataFile=path.join(profile,'face-reshape-data.json');
fs.writeFileSync(dataFile,JSON.stringify(db)); fs.mkdirSync(evidence,{recursive:true});
let app, phase='launch';
const deadline=setTimeout(()=>{console.error('Sleep chart test deadline: '+phase);app?.process().kill('SIGTERM');},60000);
async function main(){
  app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?[]:[path.join(root,'main.js')],
    env:{...process.env,FACE_RESHAPE_PROFILE:profile,FACE_UX20_TEST:'1',FACE_HUB_PORT:'0'},timeout:30000});
  const page=await app.firstWindow();
  await page.waitForFunction(()=>typeof Store!=='undefined' && Store.db);
  await page.evaluate(()=>{window.sleepErrors=[];addEventListener('error',e=>sleepErrors.push(e.error?.stack||e.message));addEventListener('unhandledrejection',e=>sleepErrors.push(String(e.reason)));App.go('nutrition');});
  const card=page.locator('.sleep-quality-card'); await card.waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1240,1000));
  phase='geometry and values';
  assert.equal(await page.locator('[data-sleep-point]').count(),14);
  const geometry=await page.evaluate(()=>{
    const line=h=>+document.querySelector(`[data-hour="${h}"]`).getAttribute('y1');
    const y=i=>+document.querySelector(`[data-sleep-point="${i}"] .sleep-duration-dot`).getAttribute('cy');
    const scoreStyle=getComputedStyle(document.querySelector('.sleep-score-line'));
    return {grid56:line(5)-line(6),grid67:line(6)-line(7),oneHour:y(13)-y(12),
      halfHour:y(13)-(line(5)+line(6))/2,scoreDash:scoreStyle.strokeDasharray,scoreStroke:scoreStyle.stroke,
      scores:Rhythm.mainSleepDetails().map(s=>s.score),avg:Rhythm.sleepQualitySummary().avgScore};
  });
  assert.ok(Math.abs(geometry.grid56-geometry.grid67)<1e-8);
  assert.ok(Math.abs(geometry.oneHour-geometry.grid56)<1e-8);
  assert.ok(Math.abs(geometry.halfHour)<1e-8,'5h30 lies halfway between 5h and 6h');
  assert.notEqual(geometry.scoreDash,'none'); assert.notEqual(geometry.scoreStroke,'none');
  assert.equal(geometry.scores[12],93);assert.equal(geometry.scores[13],79);
  assert.match(await page.locator('[data-sleep-latest]').innerText(),/少 1 小时，评分低 14 分/);
  assert.match(await page.locator('#rh-sleep-reading').innerText(),/5 小时 30 分/);
  assert.equal(await page.evaluate(()=>document.querySelector('.sleep-chart-scroll').scrollWidth>document.querySelector('.sleep-chart-scroll').clientWidth),false,'Desktop shows all dates without clipping');
  await card.screenshot({path:path.join(evidence,'desktop.png')});
  phase='pointer and keyboard';
  await page.locator('[data-sleep-point="12"] .sleep-duration-dot').hover();
  assert.match(await page.locator('#rh-sleep-reading').innerText(),/2026-10-13 · 6 小时 30 分 · 时长评分 93 分/);
  await page.locator('[data-sleep-point="12"]').focus(); await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('#rh-sleep-reading').innerText(),/2026-10-14/);
  await page.keyboard.press('Home');assert.match(await page.locator('#rh-sleep-reading').innerText(),/2026-10-01/);
  await page.keyboard.press('End');assert.match(await page.locator('#rh-sleep-reading').innerText(),/2026-10-14/);
  assert.match(await page.locator('#rh-sleep-reading').innerText(),/原记录自评分 95 分/);
  phase='narrow layout';
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,700));
  await page.waitForTimeout(150);
  const narrow=await page.evaluate(()=>({pageOverflow:document.querySelector('#view-root').scrollWidth>document.querySelector('#view-root').clientWidth+1,
    chartScroll:document.querySelector('.sleep-chart-scroll').scrollWidth>document.querySelector('.sleep-chart-scroll').clientWidth,
    points:[...document.querySelectorAll('.sleep-score-dot')].length}));
  assert.equal(narrow.pageOverflow,false);assert.equal(narrow.chartScroll,true);assert.equal(narrow.points,14);
  await card.screenshot({path:path.join(evidence,'narrow.png')});
  phase='single and empty records';
  await page.evaluate(()=>{Store.db.rhythm.sleeps=Store.db.rhythm.sleeps.slice(-1);App.render();});
  assert.equal(await page.locator('.sleep-score-dot').count(),1);
  assert.equal(await page.locator('.sleep-quality-card .sleep-latest').count(),1);
  await page.evaluate(()=>{Store.db.rhythm.sleeps=[];App.render();});
  assert.equal(await page.locator('.sleep-score-dot').count(),0);
  assert.match(await card.innerText(),/还没有睡眠记录/);
  // Rendering/inspecting a trend never saves or recalculates the original records in storage.
  const saved=JSON.parse(fs.readFileSync(dataFile));
  assert.deepEqual(saved.rhythm.sleeps,sleeps);assert.equal(saved.sentinel,db.sentinel);
  assert.equal(saved.logs.training['2026-10-01'].seconds,42);
  assert.deepEqual(await page.evaluate(()=>sleepErrors),[]);
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:true,installed:false,executable:executable||'source Electron',geometry,narrow,
    checks:['equal 5/6/7 hour grid','real 60-minute delta equals one grid','visible orange dashed line','93→79 score','pointer/keyboard reading','narrow scrolling','single/empty charts','original records preserved']},null,2));
  console.log('PASS sleep chart: true hour geometry, visible duration score, pointer/keyboard, narrow, single/empty, saved data preserved');
}
main().catch(e=>{console.error(phase,e);process.exitCode=1;}).finally(async()=>{clearTimeout(deadline);if(app)await app.close();fs.rmSync(profile,{recursive:true,force:true});});
