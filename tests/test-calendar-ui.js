/* Real app + isolated JSON profile: weekday layout, day selection, backfill and restart. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.argv[2], phase = process.argv[3];
if (!profile || !path.basename(profile).startsWith('face-calendar-acceptance-')) throw new Error('Isolated test profile required');
app.setPath('userData', profile);
app.commandLine.appendSwitch('disk-cache-dir', path.join(profile, 'cache'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const file = path.join(profile, 'face-reshape-data.json');
const screenshots = path.join(__dirname, '..', '.impeccable', 'review');
fs.mkdirSync(screenshots, { recursive: true });
if (phase === 'write') fs.writeFileSync(file, JSON.stringify({
  settings: { dailyTargetMinutes: 15, keepInTray: false, eveningReviewTime: '00:00' },
  logs: { training: {
    '2024-02-27': { seconds: 300, entries: [{ id: 'old', manual: true, seconds: 300, note: '原有训练', start: '08:00' }] },
    '2024-02-29': { seconds: 900, entries: [{ id: 'leap', manual: true, seconds: 900, note: '闰日训练', start: '08:00' }] }
  }, skincare: {} }, sentinel: 'preserve-original-records'
}));
let started = false;
app.on('browser-window-created', (_event, win) => {
  if (started) return; started = true;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    const js = expression => win.webContents.executeJavaScript(expression);
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const wait = async condition => {
      const until = Date.now() + 6000;
      while (!(await js(condition))) { if (Date.now() > until) throw new Error(`Timed out: ${condition}`); await pause(35); }
    };
    const record = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    const capture = async name => {
      win.show(); win.focus(); app.focus({ steal: true });
      await pause(750);
      await js("document.querySelector('#achievement-calendar').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      win.webContents.invalidate();
      await pause(300);
      fs.writeFileSync(path.join(screenshots, name), (await win.webContents.capturePage()).toPNG());
    };
    try {
      await wait("typeof Store !== 'undefined' && Store.db && document.querySelector('#today-status-pill').textContent !== '加载中…'");
      await js("window.__errors=[];window.addEventListener('error',e=>__errors.push(e.message));window.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));App.go('achievements');AchievementCalendar.select('2024-02-27');App.render();");
      await pause(80); // Include the production icon MutationObserver.
      if (phase === 'write') {
        assert.deepEqual(await js(`({days:document.querySelectorAll('.ac-day').length, first:[...document.querySelector('.ac-grid').children].findIndex(c=>c.dataset.date==='2024-02-01'), last:document.querySelector('.ac-day:last-child')?.dataset.date || AchievementCalendar.monthCells('2024-02').filter(Boolean).at(-1)})`), {days:29,first:3,last:'2024-02-29'});
        assert.equal(await js("AchievementCalendar.monthCells('2026-03').indexOf('2026-03-01')"), 6);
        assert.equal(await js("AchievementCalendar.monthCells('2025-02').filter(Boolean).length"), 28);
        assert.equal(await js("AchievementCalendar.shiftMonth('2025-12',1)"), '2026-01');
        assert.equal(await js("document.querySelectorAll('.ac-day.unrecorded .icon3d, .ac-day.partial .icon3d').length"), 0);
        assert.equal(await js("document.querySelectorAll('.ac-day.met .icon3d-check').length"), 1);
        assert.match(await js("document.querySelector('.ac-detail').textContent"), /原有训练/);
        // Clicking a specific date must drive the visible details and the backfill form.
        await js("document.querySelector('[data-date=\"2024-02-29\"]').click();document.querySelector('#ac-manual').click()");
        assert.equal(await js("document.querySelector('#ml-date').value"), '2024-02-29');
        await js("document.querySelector('#ml-cancel').click();document.querySelector('[data-date=\"2024-02-27\"]').click();document.querySelector('#ac-manual').click();document.querySelector('#ml-min').value='0';document.querySelector('#ml-ok').click()");
        assert.equal(await js("Store.dayTraining('2024-02-27').seconds"), 300);
        await js("document.querySelector('#ml-min').value='10';document.querySelector('#ml-note').value='日历补记验收';document.querySelector('#ml-ok').click()");
        await wait("document.querySelector('[data-date=\"2024-02-27\"]').classList.contains('met')");
        await pause(500);
        assert.equal(record().logs.training['2024-02-27'].seconds, 900);
        assert.equal(record().logs.training['2024-02-27'].entries.length, 2);
        assert.equal(record().logs.training['2024-02-29'].seconds, 900);
        assert.match(await js("document.querySelector('.ac-detail').textContent"), /本月达标\s*2\s*天/);
        // Keyboard navigation crosses a real leap-day boundary and retains focus.
        await js("document.querySelector('[data-date=\"2024-02-29\"]').click();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
        assert.equal(await js('document.activeElement.dataset.date'), '2024-03-01');
        await js("document.querySelector('#ac-prev').click()");
        assert.equal(await js('AchievementCalendar.month'), '2024-02');
        await js("document.querySelector('#ac-month').value='2025-12';document.querySelector('#ac-month').dispatchEvent(new Event('change'));document.querySelector('#ac-next').click()");
        assert.equal(await js('AchievementCalendar.month'), '2026-01');
        await js("document.querySelector('#ac-today').click()");
        assert.equal(await js("AchievementCalendar.selected === todayKey() && document.querySelector('#ac-next').disabled && [...document.querySelectorAll('.ac-day')].filter(b=>b.dataset.date>todayKey()).every(b=>b.disabled)"), true);
        await js("AchievementCalendar.select('2024-02-27');App.render();document.querySelector('#toast-wrap').innerHTML='';document.querySelector('#achievement-calendar').scrollIntoView({block:'start'})");
        await capture('calendar-1240.png');
        console.log('PASS calendar: leap/non-leap weekday layout, three states, selected-date backfill, validation, persistence, month/year and keyboard navigation');
      } else {
        assert.equal(await js("Store.dayTraining('2024-02-27').seconds"), 900);
        assert.equal(await js("document.querySelector('[data-date=\"2024-02-27\"]').classList.contains('met')"), true);
        assert.match(await js("document.querySelector('.ac-entries').textContent"), /日历补记验收/);
        win.setSize(980,640); win.show(); win.focus(); await pause(350);
        await js("document.querySelector('#achievement-calendar').scrollIntoView({block:'start'})");
        const layout = await js(`({overflow:document.querySelector('#view-root').scrollWidth>document.querySelector('#view-root').clientWidth+1, weekdayAligned:[...document.querySelectorAll('.ac-weekdays span')].every((w,i)=>Math.abs(w.getBoundingClientRect().x-document.querySelector('.ac-grid').children[i].getBoundingClientRect().x)<1), selectedVisible:document.querySelector('.ac-day.is-selected').getBoundingClientRect().width>45})`);
        assert.deepEqual(layout, {overflow:false, weekdayAligned:true, selectedVisible:true});
        assert.equal(await js("[...document.querySelectorAll('.ac-legend i')].every(i=>i.getBoundingClientRect().height<12)"), true);
        await capture('calendar-980.png');
        console.log('PASS calendar restart: saved entries restored, 980px no horizontal overflow and weekday columns aligned');
      }
      assert.equal(record().sentinel, 'preserve-original-records');
      assert.deepEqual(await js('__errors'), []);
      app.exit(0);
    } catch(error) { console.error(error); app.exit(1); }
  });
});
require('../main');
