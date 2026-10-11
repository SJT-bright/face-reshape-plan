/* FACE-UX-20260929-B regression: achievement-calendar state colors vs the "today" marker.
   One real-app session on an isolated mkdtemp profile drives TODAY through all three
   states via the real UI (unrecorded → backfilled to target → entry edited down to a
   partial 5 minutes), asserting in light and dark mode that the state gradient survives
   while the today marker (purple border + inset ring + 今天 badge) is kept. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const pad2 = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const shiftKey = delta => { const d = new Date(); d.setDate(d.getDate() + delta); return keyOf(d); };
const today = shiftKey(0), yesterday = shiftKey(-1), dayBefore = shiftKey(-2);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'face-today-acceptance-'));
if (!path.basename(profile).startsWith('face-today-acceptance-')) throw new Error('Isolated test profile required');
app.setPath('userData', profile);
app.commandLine.appendSwitch('disk-cache-dir', path.join(profile, 'cache'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const dataFile = path.join(profile, 'face-reshape-data.json');
const evidence = path.join(__dirname, '..', 'docs', 'zcode-face-ux-20260929-B-evidence');
fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(dataFile, JSON.stringify({
  settings: { dailyTargetMinutes: 15, keepInTray: false, eveningReviewTime: '00:00', darkMode: false },
  logs: { training: {
    [yesterday]: { seconds: 300, entries: [{ id: 'y', manual: true, seconds: 300, note: '昨日部分', start: '08:00' }] },
    [dayBefore]: { seconds: 900, entries: [{ id: 'p', manual: true, seconds: 900, note: '前日达标', start: '08:00' }] }
  }, skincare: {} },
  sentinel: 'b-today-acceptance'
}));

const PROPS = ['backgroundImage', 'backgroundColor', 'borderColor', 'boxShadow', 'color'];
const grabSource = `(map, props) => { const out = {}; for (const [name, selector] of Object.entries(map)) { const el = document.querySelector(selector); if (!el) { out[name] = null; continue; } const cs = getComputedStyle(el); const row = { className: el.className }; for (const p of props) row[p] = cs[p]; out[name] = row; } return out; }`;
const grab = async (win, map) => win.webContents.executeJavaScript(`(${grabSource})(${JSON.stringify(map)}, ${JSON.stringify(PROPS)})`);
const cellMap = {
  today: `[data-date="${today}"]`,
  yesterday: `[data-date="${yesterday}"]`,
  dayBefore: `[data-date="${dayBefore}"]`,
  legendUnrecorded: '.ac-legend i.unrecorded',
  legendPartial: '.ac-legend i.partial',
  legendMet: '.ac-legend i.met'
};
const textMap = {
  todayNumber: `[data-date="${today}"] .ac-day-top b`,
  todayValue: `[data-date="${today}"] .ac-day-value`,
  todayBadge: `[data-date="${today}"] .ac-day-top small`
};

/* Fixed expectations: state gradients must survive the today marker (light) and
   dark.css's html.dark .ac-day flattening (dark). The today marker is carried by
   border rgb(143,130,207) + inset ring rgba(143,130,207,.35) + the 今天 badge. */
const GREEN = ['214, 240, 228', '196, 233, 217'];
const PURPLE_TODAY = ['243, 240, 255', '233, 229, 252'];
const PARTIAL = ['236, 231, 252', '226, 219, 250'];
const DARK_MET = ['45, 94, 74', '35, 78, 61'];
const DARK_PARTIAL = ['76, 66, 124', '60, 52, 100'];
const has = (value, mark) => typeof value === 'string' && value.includes(mark);
const hasAny = (value, marks) => marks.some(m => has(value, m));
const assertGradient = (bg, marks, label) => assert.ok(hasAny(bg, marks), `${label}: background ${bg} misses gradient marks ${marks}`);
const markerKept = cell => has(cell.borderColor, '143, 130, 207') && has(cell.boxShadow, 'rgba(143, 130, 207, 0.35)');

const results = {
  testId: 'FACE-UX-20260929-B', script: 'tests/test-calendar-today-ui.js',
  runAt: new Date().toISOString(), todayKey: today, yesterdayKey: yesterday, dayBeforeKey: dayBefore,
  profile: path.basename(profile), states: {}, assertions: {}, persistence: null, passed: false
};
const writeResults = () => { try { fs.writeFileSync(path.join(evidence, 'today-state-results.post.json'), JSON.stringify(results, null, 2)); } catch {} };

let started = false;
app.on('browser-window-created', (_event, win) => {
  if (started) return; started = true;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    const js = expression => win.webContents.executeJavaScript(expression);
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const wait = async (condition, label) => {
      const until = Date.now() + 12000;
      while (!(await js(condition))) { if (Date.now() > until) throw new Error(`Timed out: ${label || condition}`); await pause(35); }
    };
    const capture = async name => {
      win.show(); win.focus(); app.focus({ steal: true });
      await pause(750);
      await js("document.querySelector('#achievement-calendar').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      win.webContents.invalidate();
      await pause(300);
      fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG());
    };
    const deselectToday = async label => {
      await js(`document.querySelector('[data-date="${yesterday}"]').click(); true`);
      await wait(`!document.querySelector('[data-date="${today}"]').classList.contains('is-selected')`, `today deselected (${label})`);
    };
    const setDark = async on => {
      await js(`Store.db.settings.darkMode = ${!!on}; document.documentElement.classList.toggle('dark', !!Store.db.settings.darkMode); App.render(); true`);
      await wait(`document.documentElement.classList.contains('dark') === ${!!on}`, 'dark toggle');
      await pause(250);
    };
    try {
      /* --- boot & error listeners --- */
      await wait("typeof Store !== 'undefined' && Store.db && document.querySelector('#today-status-pill').textContent !== '加载中…'", 'app ready (#today-status-pill)');
      assert.equal(await js('todayKey()'), today, `runtime todayKey() must equal ${today}`);
      await js("window.__errors=[];window.addEventListener('error',e=>__errors.push(e.message));window.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));true");
      await js("App.go('achievements'); true");
      await wait("document.querySelector('.ac-grid') && document.querySelector('.ac-grid').children.length > 0", '.ac-grid render');

      /* --- state 0: light, today unrecorded+is-today+is-selected — the one case where
             the today purple gradient legitimately carries the whole cell --- */
      const state0 = await grab(win, cellMap);
      results.states.state0_light_today_unrecorded = state0;
      assert.match(state0.today.className, /\bunrecorded\b/, 'initial today is unrecorded');
      assert.match(state0.today.className, /\bis-today\b/, 'initial today carries is-today');
      assertGradient(state0.today.backgroundImage, PURPLE_TODAY, 'state0 unrecorded today keeps today gradient');
      assert.ok(markerKept(state0.today), 'state0 today marker (border+ring) kept');
      assert.match(state0.yesterday.className, /\bpartial\b/, 'preset yesterday is partial (control)');
      assert.match(state0.dayBefore.className, /\bmet\b/, 'preset day-before is met (control)');

      /* --- fill today to target via the real manual-log UI (15 min = dailyTargetMinutes) --- */
      await js(`document.querySelector('[data-date="${today}"]').click(); true`);
      await js("document.querySelector('#ac-manual').click(); true");
      await wait("document.querySelector('#ml-ok')", 'manual log modal');
      await js("document.querySelector('#ml-min').value='15';document.querySelector('#ml-note').value='B验收-今日达标';document.querySelector('#ml-ok').click(); true");
      await wait(`document.querySelector('[data-date="${today}"]').classList.contains('met')`, 'today cell becomes met');

      /* --- state A: light, today met + selected --- */
      const stateA = await grab(win, cellMap);
      const textA = await grab(win, textMap);
      results.states.stateA_light_selected = stateA; results.states.stateA_text = textA;
      for (const cls of ['met', 'is-today', 'is-selected']) assert.match(stateA.today.className, new RegExp(`\\b${cls}\\b`), `state A today class contains ${cls}`);
      assertGradient(stateA.today.backgroundImage, GREEN, 'stateA met today green gradient');
      assert.ok(!hasAny(stateA.today.backgroundImage, PURPLE_TODAY), 'stateA met today has no today-purple background');
      assert.ok(markerKept(stateA.today), 'stateA today marker kept while selected');
      assert.ok(has(stateA.today.boxShadow, 'rgba(115, 102, 165, 0.22)'), 'stateA selected outer shadow kept');
      assert.equal(textA.todayNumber.color, 'rgb(31, 94, 70)', 'stateA date number green');
      assert.equal(await js(`document.querySelector('[data-date="${today}"] .ac-day-top small')?.textContent`), '今天', 'stateA today badge present');
      await capture('b-fixed-A-light-selected.png');

      /* --- state B: light, today met + NOT selected (core regression) --- */
      await deselectToday('state B');
      const stateB = await grab(win, cellMap);
      const textB = await grab(win, textMap);
      results.states.stateB_light_unselected = stateB; results.states.stateB_text = textB;
      assert.match(stateB.today.className, /\bmet\b/, 'state B today still met');
      assert.match(stateB.today.className, /\bis-today\b/, 'state B today still is-today');
      assert.doesNotMatch(stateB.today.className, /\bis-selected\b/, 'state B today not selected');
      assertGradient(stateB.today.backgroundImage, GREEN, 'stateB met today green gradient');
      assert.ok(!hasAny(stateB.today.backgroundImage, PURPLE_TODAY), 'stateB met today not overridden by today purple');
      assert.ok(markerKept(stateB.today), 'stateB today marker (border+ring) kept');
      assert.equal(textB.todayNumber.color, 'rgb(31, 94, 70)', 'stateB date number green');
      assert.equal(textB.todayValue.color, 'rgb(47, 112, 87)', 'stateB minutes value green');
      assertGradient(stateB.dayBefore.backgroundImage, GREEN, 'stateB control day-before met green');
      assertGradient(stateB.yesterday.backgroundImage, PARTIAL, 'stateB control yesterday partial');
      await capture('b-fixed-B-light-unselected.png');
      results.assertions.stateB_coreRegression = { greenGradient: true, purpleGone: !hasAny(stateB.today.backgroundImage, PURPLE_TODAY), markerKept: markerKept(stateB.today) };

      /* --- legend (light) unchanged: three swatches, light values --- */
      assert.equal(await js("document.querySelectorAll('.ac-legend i').length"), 3, 'legend has exactly three swatches');
      assert.equal(stateB.legendMet.backgroundColor, 'rgb(155, 206, 181)', 'light legend met swatch unchanged');
      assert.equal(stateB.legendPartial.backgroundColor, 'rgb(214, 206, 239)', 'light legend partial swatch unchanged');
      assert.equal(stateB.legendUnrecorded.backgroundColor, 'rgb(233, 239, 245)', 'light legend unrecorded swatch unchanged');

      /* --- state C: dark, today met + NOT selected --- */
      await setDark(true);
      const stateC = await grab(win, cellMap);
      const textC = await grab(win, textMap);
      results.states.stateC_dark_unselected = stateC; results.states.stateC_text = textC;
      assertGradient(stateC.today.backgroundImage, DARK_MET, 'stateC dark met today dark-green gradient');
      assert.ok(!has(stateC.today.backgroundColor, '26, 35, 50'), 'stateC dark met today not flattened to #1a2332');
      assert.equal(textC.todayNumber.color, 'rgb(158, 217, 190)', 'stateC dark date number light green');
      assert.equal(textC.todayValue.color, 'rgb(143, 208, 177)', 'stateC dark minutes value light green');
      assertGradient(stateC.dayBefore.backgroundImage, DARK_MET, 'stateC dark met (non-today) dark-green gradient');
      assertGradient(stateC.yesterday.backgroundImage, DARK_PARTIAL, 'stateC dark partial dark-purple gradient');
      assert.equal(stateC.legendMet.backgroundColor, 'rgb(63, 122, 97)', 'dark legend met swatch matches dark cells');
      assert.equal(stateC.legendPartial.backgroundColor, 'rgb(76, 66, 121)', 'dark legend partial swatch matches dark cells');
      assert.equal(stateC.legendUnrecorded.backgroundColor, 'rgba(255, 255, 255, 0.08)', 'dark legend unrecorded swatch matches dark cells');
      await capture('b-fixed-C-dark.png');

      /* --- state C2: dark + today selected --- */
      await js(`document.querySelector('[data-date="${today}"]').click(); true`);
      await wait(`document.querySelector('[data-date="${today}"]').classList.contains('is-selected')`, 'today selected (dark)');
      const stateC2 = await grab(win, cellMap);
      results.states.stateC2_dark_selected = stateC2;
      assertGradient(stateC2.today.backgroundImage, DARK_MET, 'stateC2 dark selected met today keeps dark green');
      assert.ok(!has(stateC2.today.backgroundColor, '200, 233, 218'), 'stateC2 no bright light-green card in dark');
      assert.ok(markerKept(stateC2.today) && has(stateC2.today.boxShadow, 'rgba(115, 102, 165, 0.22)'), 'stateC2 merged selected shadow + today ring');
      await capture('b-fixed-C2-dark-selected.png');

      /* --- edit today's entry down to 5 minutes via the real edit modal → partial --- */
      await wait("document.querySelector('.ac-entry-edit')", 'today entry edit button');
      await js("document.querySelector('.ac-entry-edit').click(); true");
      await wait("document.querySelector('#te-save')", 'entry edit modal');
      await js("document.querySelector('#te-min').value='5';document.querySelector('#te-save').click(); true");
      await wait(`document.querySelector('[data-date="${today}"]').classList.contains('partial')`, 'today cell becomes partial');

      /* --- state D: dark, today partial + is-today, NOT selected --- */
      await deselectToday('state D');
      const stateD = await grab(win, cellMap);
      const textD = await grab(win, textMap);
      results.states.stateD_dark_partial_unselected = stateD; results.states.stateD_text = textD;
      assertGradient(stateD.today.backgroundImage, DARK_PARTIAL, 'stateD dark partial today dark-purple gradient');
      assert.ok(!has(stateD.today.backgroundColor, '26, 35, 50'), 'stateD dark partial today not flattened');
      assert.equal(textD.todayNumber.color, 'rgb(195, 186, 239)', 'stateD dark partial date number readable');
      assert.equal(stateD.legendPartial.backgroundColor, 'rgb(76, 66, 121)', 'dark legend partial matches cells');
      assertGradient(stateD.dayBefore.backgroundImage, DARK_MET, 'stateD dark day-before met gradient kept');
      assert.equal(await js(`getComputedStyle(document.querySelector('.ac-day.unrecorded:not(.is-today)')).backgroundColor`), 'rgba(255, 255, 255, 0.03)', 'dark unrecorded control keeps subtle cell');
      await capture('b-fixed-D-partial-today-dark.png');

      /* --- state E: back to light, today partial + is-today, NOT selected --- */
      await setDark(false);
      const stateE = await grab(win, cellMap);
      const textE = await grab(win, textMap);
      results.states.stateE_light_partial_unselected = stateE; results.states.stateE_text = textE;
      assert.match(stateE.today.className, /\bpartial\b.*\bis-today\b/, 'stateE today partial+is-today');
      assertGradient(stateE.today.backgroundImage, PARTIAL, 'stateE partial today keeps partial gradient');
      assert.ok(!hasAny(stateE.today.backgroundImage, PURPLE_TODAY), 'stateE partial today not replaced by today purple');
      assert.ok(markerKept(stateE.today), 'stateE today marker kept');
      assert.equal(textE.todayNumber.color, 'rgb(74, 63, 143)', 'stateE partial today keeps the today-purple date number');
      await capture('b-fixed-E-partial-today-light.png');

      /* --- persistence & hygiene --- */
      await js('Store.flushSync(); true');
      await pause(200);
      const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      results.persistence = {
        sentinel: saved.sentinel,
        todaySeconds: saved.logs.training[today]?.seconds,
        todayEntries: saved.logs.training[today]?.entries?.length,
        todayEntrySeconds: saved.logs.training[today]?.entries?.[0]?.seconds,
        yesterdaySeconds: saved.logs.training[yesterday]?.seconds,
        dayBeforeSeconds: saved.logs.training[dayBefore]?.seconds
      };
      assert.equal(saved.sentinel, 'b-today-acceptance', 'sentinel preserved');
      assert.equal(saved.logs.training[today].seconds, 300, 'today persisted 300s after the edit');
      assert.equal(saved.logs.training[today].entries.length, 1, 'today still has exactly one entry');
      assert.equal(saved.logs.training[today].entries[0].seconds, 300, 'today entry edited to 300s');
      assert.equal(saved.logs.training[yesterday].seconds, 300, 'yesterday untouched (300s)');
      assert.equal(saved.logs.training[dayBefore].seconds, 900, 'day-before untouched (900s)');
      results.assertions.jsErrors = await js('__errors');
      assert.deepEqual(results.assertions.jsErrors, [], 'no window error / unhandledrejection');

      results.passed = true;
      writeResults();
      console.log(`PASS FACE-UX-20260929-B: today walked unrecorded→met→partial via real UI; state gradients survive the today marker in light+dark; today border/ring/badge kept; persistence & no JS errors`);
    } catch (error) {
      results.error = String(error && error.stack || error);
      writeResults();
      console.error(error);
      app.exit(1);
      return;
    }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    app.exit(0);
  });
});
require('../main');
