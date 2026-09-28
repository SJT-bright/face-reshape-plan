/* Isolated Electron UI: nutrition/strength → skincare must not keep the previous page. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.argv[2];
if (!profile || !path.basename(profile).startsWith('face-skincare-nav-')) throw new Error('Isolated test profile required');
app.setPath('userData', profile);
app.commandLine.appendSwitch('disk-cache-dir', path.join(profile, 'cache'));
fs.writeFileSync(path.join(profile, 'face-reshape-data.json'), JSON.stringify({
  version: 1,
  settings: { keepInTray: false, dailyTargetMinutes: 15 },
  sessions: [], videos: [], skincare: { cycles: [] },
  logs: { training: {}, skincare: {} }
}));
let done = false;
app.on('browser-window-created', (_e, win) => {
  if (done) return; done = true;
  win.webContents.once('did-finish-load', async () => {
    const js = (expression) => win.webContents.executeJavaScript(expression);
    const wait = async (condition) => {
      const until = Date.now() + 8000;
      while (!(await js(condition))) {
        if (Date.now() > until) throw new Error(`Timed out: ${condition}`);
        await new Promise((r) => setTimeout(r, 40));
      }
    };
    try {
      await wait("typeof App !== 'undefined' && document.querySelector('#today-status-pill').textContent !== '加载中…'");
      const probe = async (fromView, toView, leftoverNeedle, expectedNeedle) => {
        await js(`document.querySelector('[data-view=${fromView}]').click()`);
        await wait(`App.currentView === '${fromView}' && document.querySelector('#page-title').textContent.length > 0`);
        await js(`document.querySelector('[data-view=${toView}]').click()`);
        await wait(`App.currentView === '${toView}'`);
        const state = await js(`({
          title: document.querySelector('#page-title').textContent,
          active: document.querySelector('.nav-item.active')?.dataset.view,
          html: document.querySelector('#view-root').innerHTML,
          errors: window.__errors || []
        })`);
        assert.equal(state.active, toView, `${fromView}→${toView}: 侧栏应为 ${toView}`);
        assert.equal(state.title.includes('护肤') || toView !== 'skincare', true, `${fromView}→${toView}: 标题应为护肤`);
        assert.ok(!state.html.includes(leftoverNeedle), `${fromView}→${toView}: 不得残留「${leftoverNeedle}」\n` + state.html.slice(0, 400));
        assert.ok(state.html.includes(expectedNeedle), `${fromView}→${toView}: 应出现「${expectedNeedle}」`);
        assert.deepEqual(state.errors, [], `${fromView}→${toView}: 渲染不得抛错 ${state.errors.join(' | ')}`);
      };
      await js("window.__errors=[]; window.addEventListener('error', e => __errors.push(e.error?.stack || e.message)); window.addEventListener('unhandledrejection', e => __errors.push(String(e.reason)));");
      await probe('nutrition', 'skincare', '吃饭与睡觉', '护肤周期');
      await probe('strength', 'skincare', 'st-tabs', '护肤周期');
      console.log('ok - skincare nav does not keep nutrition or strength DOM');
      app.exit(0);
    } catch (err) {
      console.error(err);
      app.exit(1);
    }
  });
});
require('../main.js');
