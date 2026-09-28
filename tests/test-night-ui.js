/* Real Electron, empty isolated data. Never read the personal profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'face-night-ui-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('will-quit', () => fs.rmSync(profile, { recursive: true, force: true }));
const out = path.join(__dirname, '../.impeccable/review');
fs.mkdirSync(out, { recursive: true });
let started = false;
app.on('browser-window-created', (_, win) => {
  if (started) return; started = true;
  win.setSize(1240, 860);
  win.webContents.once('did-finish-load', async () => {
    const js = x => win.webContents.executeJavaScript(x);
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const capture = async name => {
      win.show(); await pause(900);
      fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    try {
      for(let i=0; i<60; i++) {
        if(await js("typeof Store !== 'undefined' && !!Store.db && !!document.querySelector('.today-title')")) break;
        await pause(100);
      }
      await js("window.__nightErrors=[];addEventListener('error',e=>__nightErrors.push(e.message));App.go('plan');document.querySelector('#pl-dark').click()");
      assert.equal(await js("Store.db.settings.darkMode"), true);
      assert.match(await js("getComputedStyle(document.body,'::before').backgroundImage"), /optical-sculpture-night/);
      for(const route of ['today','plan','skincare','nutrition','achievements','strength']) {
        await js(`App.go('${route}')`);
        assert.equal(await js("document.querySelector('#view-root').textContent.includes('这一页没能打开')"), false, route);
        if(route==='today' || route==='plan') await capture('night-'+route);
      }
      await js("App.go('follow')");
      assert.equal(await js("document.querySelectorAll('night-sky i').length"),54);
      assert.equal(await js("getComputedStyle(document.querySelector('night-sky')).pointerEvents"),'none');
      assert.notEqual(await js("getComputedStyle(document.querySelector('night-sky i')).animationName"),'none');
      await capture('night-follow');
      await win.webContents.executeJavaScript("document.querySelector('#stage-wrap').requestFullscreen()", true);
      await pause(500);
      assert.equal(await js("document.fullscreenElement?.id"), 'stage-wrap');
      assert.equal(await js("document.querySelector('#stage-wrap').scrollHeight > innerHeight + 1"), false);
      await capture('night-fullscreen');
      await js("document.exitFullscreen()"); await pause(500);
      // A video remains the hit target; decorative stars cannot block its controls.
      assert.equal(await js(`(() => {
        const stage=document.querySelector('#stage'); stage.innerHTML='<video controls aria-label="Test video"></video>';
        const r=stage.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).tagName;
      })()`),'VIDEO');
      await js("window.__oldSky=document.querySelector('night-sky');App.go('plan')");
      assert.equal(await js("__oldSky.isConnected"), false);
      await js("document.querySelector('#pl-dark').click();App.go('follow')");
      assert.equal(await js("getComputedStyle(document.querySelector('night-sky')).display"),'none');
      assert.equal(await js("getComputedStyle(document.querySelector('night-sky i')).animationName"),'none');
      assert.match(await js("getComputedStyle(document.body,'::before').backgroundImage"), /optical-sculpture-bg/);
      await js("document.documentElement.classList.add('dark')");
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      assert.equal(await js("getComputedStyle(document.querySelector('night-sky i')).animationName"),'none');
      win.webContents.debugger.detach();
      win.setSize(980,740); await pause(300);
      assert.equal(await js("document.querySelector('#view-root').scrollWidth>document.querySelector('#view-root').clientWidth+1"),false);
      await capture('night-follow-compact');
      assert.deepEqual(await js('__nightErrors'), []);
      console.log('NIGHT_UI_PASS: 6 routes, generated background, video hit target, day/night toggle, route cleanup, reduced motion, compact layout');
      app.quit();
    }catch(e){console.error(e);app.exit(1);}
  });
});
require('../main.js');
