/* Exercises the production main process, IPC, preload, renderer and JSON file in an isolated profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.argv[2], phase = process.argv[3];
if (!profile || !path.basename(profile).startsWith('face-rhythm-acceptance-')) throw new Error('Isolated test profile required');
app.setPath('userData', profile);
app.commandLine.appendSwitch('disk-cache-dir', path.join(profile, 'cache'));
const file = path.join(profile, 'face-reshape-data.json');
const screenshots = path.join(__dirname, '..', '.impeccable', 'review');
fs.mkdirSync(screenshots, { recursive: true });
if (phase === 'write') fs.writeFileSync(file, JSON.stringify({ version: 1, settings: { keepInTray: false, eveningReviewTime: '', remindersEnabled:false }, sessions: [], videos: [], skincare: { cycles: [] }, logs: { training: { '2020-01-01': { seconds: 42, entries: [] } }, skincare: {} }, sentinel: 'preserve-me' }));
let done = false;
app.on('browser-window-created', (_e, win) => {
  if (done) return; done = true;
  win.webContents.once('did-finish-load', async () => {
    const js = expression => win.webContents.executeJavaScript(expression);
    const wait = async condition => {
      const until = Date.now() + 7000;
      while (!(await js(condition))) { if (Date.now() > until) throw new Error(`Timed out: ${condition}`); await new Promise(r => setTimeout(r, 35)); }
    };
    const record = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    try {
      await wait("typeof Store !== 'undefined' && Store.db && document.querySelector('#today-status-pill').textContent !== '加载中…'");
      await js("window.__errors=[]; window.addEventListener('error', e => __errors.push(e.error?.stack || e.message)); window.addEventListener('unhandledrejection', e => __errors.push(String(e.reason))); document.querySelector('[data-view=nutrition]').click();");
      await wait("document.querySelector('#rh-meal') !== null");
      if (phase === 'write') {
        assert.equal(await js('Store.db.rhythm.meals.length'), 0);
        await new Promise(r => setTimeout(r, 400));
        fs.writeFileSync(path.join(screenshots, 'nutrition-empty-1240.png'), (await win.webContents.capturePage()).toPNG());
        await js("Rhythm.selectedDay = addDays(todayKey(), -1); Rhythm.refresh(); document.querySelector('#rh-meal').click(); document.querySelector('[name=time]').value = todayKey() + 'T00:02'; document.querySelector('#rh-form').requestSubmit();");
        await wait("!Rhythm.busy && Store.db.rhythm.meals.length === 1 && document.querySelector('#modal-mask').classList.contains('hidden')");
        assert.equal(record().rhythm.meals.length, 1);
        assert.ok(fs.existsSync(path.join(profile, 'hub-today.json')), 'hub export must stay inside the isolated profile');
        await js("document.querySelector('[data-meal]').click(); document.querySelector('[name=time]').value = Rhythm.selectedDay + 'T00:01'; document.querySelector('#rh-form').requestSubmit();");
        await wait("!Rhythm.busy && Store.db.rhythm.meals[0].local.endsWith('00:01')");
        assert.equal(await js("!!document.querySelector('#rh-sleep-now, #rh-sleep')"), false);
        // Only total duration and score are editable; timestamps/stages remain historical data.
        assert.equal(await js("document.querySelector('#rh-sleep-form [name=hours]').readOnly"), true);
        assert.equal(await js("document.querySelector('#rh-sleep-form [name=bed]')"), null);
        await js("document.querySelector('#rh-sleep-form [name=hours]').value='8';document.querySelector('#rh-sleep-form [name=minutes]').value='0';document.querySelector('#rh-sleep-form [name=qScore]').value='85';document.querySelector('#rh-sleep-form [name=complete]').checked=true;document.querySelector('#rh-sleep-form').requestSubmit();");
        await wait("!Rhythm.busy && Store.db.rhythm.sleeps.length === 1 && document.querySelector('#modal-mask').classList.contains('hidden')");
        await js("document.querySelector('#rh-complete-meals').click()"); await wait('!Rhythm.busy');
        assert.equal(record().rhythm.sleeps[0].recordedMinutes, 480);
        assert.equal(await js("RhythmEngine.sleepMinutes(Store.db.rhythm.sleeps[0])"), 480); // exact manually confirmed duration
        assert.equal(await js("!!document.querySelector('.rhythm-sleep-advice')"), false); // no invented bedtime from a duration-only record
        assert.equal(record().rhythm.completeDays[record().rhythm.sleeps[0].endLocal.slice(0,10)].sleep, true);
        // Preserve an unfinished v1.2.0 entry; it must not behave like a live timer.
        await js("Rhythm.commit(d => { const p=RhythmEngine.parse('2026-08-01T15:08');d.sleeps.push({id:'legacy',start:p.iso,startLocal:p.local,end:null,kind:'main'}); }, '')");
        await js("document.querySelector('#rh-profile').value='adult';document.querySelector('#rh-profile').dispatchEvent(new Event('change'));"); await wait('!Rhythm.busy');
        assert.equal(record().sentinel, 'preserve-me'); assert.equal(record().logs.training['2020-01-01'].seconds, 42);
        // Simulate real disk failure; production save must report false and renderer roll back.
        const originalWrite = fs.writeFileSync;
        fs.writeFileSync = function (target, ...args) { if (target === file + '.tmp') throw new Error('simulated-full-disk'); return originalWrite.call(this, target, ...args); };
        try { assert.equal(await js("Rhythm.commit(d => d.meals.push({id:'must-not-persist'}), '')"), false); }
        finally { fs.writeFileSync = originalWrite; }
        assert.equal(await js("Store.db.rhythm.meals.some(m => m.id === 'must-not-persist')"), false);
        assert.equal(record().rhythm.meals.length, 1);
        await js("Rhythm.selectedDay = Store.db.rhythm.meals[0].local.slice(0,10);Rhythm.refresh();document.querySelector('#toast-wrap').innerHTML=''");
        assert.equal(await js("document.querySelectorAll('[data-meal]').length"), 1);
        win.show(); win.focus();
        await new Promise(r => setTimeout(r, 350));
        fs.writeFileSync(path.join(screenshots, 'nutrition-recorded-1240.png'), (await win.webContents.capturePage()).toPNG());
        console.log('ok - production UI add/edit meal, add sleep, completeness, profile and atomic save-failure rollback');
      } else {
        assert.equal(await js('Store.db.rhythm.meals.length'), 1);
        assert.equal(await js('Store.db.rhythm.sleeps.length'), 2);
        assert.equal(await js('Store.db.rhythm.sleeps.find(s => s.durationOnly).recordedMinutes'), 480);
        assert.equal(await js("!!document.querySelector('.rhythm-sleep-advice')"), false);
        assert.equal(await js('Store.db.rhythm.profile'), 'adult');
        assert.ok(record().rhythm.meals[0].local.endsWith('00:01'));
        await js("Rhythm.selectedDay = Store.db.rhythm.meals[0].local.slice(0,10);Rhythm.refresh();document.querySelector('[data-meal]').click();document.querySelector('#rh-delete').click();document.querySelector('#rh-delete').click();");
        await wait('!Rhythm.busy && Store.db.rhythm.meals.length === 0');
        assert.equal(record().rhythm.completeDays[Object.keys(record().rhythm.completeDays)[0]].meals, false);
        await js("document.querySelector('#rh-sleep-delete').click();document.querySelector('#rh-sleep-delete').click();");
        await wait('!Rhythm.busy && Store.db.rhythm.sleeps.length === 1');
        assert.equal(record().rhythm.sleeps[0].id, 'legacy');
        await js("document.querySelector('#rh-sleep-form [name=hours]').value='7';document.querySelector('#rh-sleep-form [name=minutes]').value='30';document.querySelector('#rh-sleep-form').requestSubmit();");
        await wait('!Rhythm.busy && Store.db.rhythm.sleeps.some(s => s.durationOnly)');
        const savedSleep = record().rhythm.sleeps.find(s => s.durationOnly);
        assert.equal(savedSleep.startLocal.slice(0,10), savedSleep.endLocal.slice(0,10));
        await js("document.querySelector('#rh-sleep-form [name=minutes]').value='45';document.querySelector('#rh-sleep-form').requestSubmit();");
        await wait("!Rhythm.busy && Store.db.rhythm.sleeps.some(s => s.recordedMinutes===465)");
        assert.equal(record().rhythm.sleeps.filter(s => s.durationOnly).length, 1);
        assert.equal(await js("!!document.querySelector('#rh-sleep-now, #rh-sleep')"), false);
        await js("document.querySelector('#rh-range').value='30';document.querySelector('#rh-range').dispatchEvent(new Event('change'));");
        assert.equal(await js("document.querySelectorAll('.rhythm-history tbody tr').length"), 30);
        await js("document.querySelector('#toast-wrap').innerHTML=''");
        win.setSize(980, 640); win.show(); win.focus();
        await new Promise(r => setTimeout(r, 400));
        const layout = await js(`({overflow: document.querySelector('#view-root').scrollWidth > document.querySelector('#view-root').clientWidth + 1, clock: !!document.querySelector('#live-clock'), direction: getComputedStyle(document.querySelector('#nav')).flexDirection, navVisible: [...document.querySelectorAll('.nav-item')].every(b => { const r=b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })})`);
        assert.deepEqual(layout, { overflow: false, clock: false, direction: 'column', navVisible: true });
        fs.writeFileSync(path.join(screenshots, 'nutrition-980.png'), (await win.webContents.capturePage()).toPNG());
        // Original routes must still open after using the new module.
        for (const route of ['today', 'plan', 'strength', 'skincare', 'achievements', 'nutrition']) {
          await js(`document.querySelector('[data-view=${route}]').click()`);
          assert.equal(await js('App.currentView'), route);
          if (route === 'skincare') {
            assert.equal(await js("!!document.querySelector('#sk-skin-photos') && !!Store.db.skin.predictions[todayKey()]"), true);
          }
        }
        assert.equal(record().sentinel, 'preserve-me'); assert.equal(record().logs.training['2020-01-01'].seconds, 42);
        console.log('ok - real process restart restores records; delete, inline band sleep/update, legacy preservation, 30-day range, 980x640 and all routes');
      }
      assert.deepEqual(await js('__errors'), []);
      console.log(`PASS ${phase}: no renderer errors; user profile untouched`);
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require('../main');
