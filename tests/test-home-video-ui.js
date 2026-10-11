/* Home video entry: production Electron/IPC, isolated profile, synthetic media. */
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'face-home-video-'));
const evidence = path.resolve('.impeccable/review/home-video');
const clip = path.join(profile, 'fixture.webm');
process.env.FACE_UX20_TEST = '1';
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
fs.mkdirSync(evidence, { recursive: true });
execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x8174bd:s=160x90:r=10', '-t', '20', '-c:v', 'libvpx', '-b:v', '30k', clip]);
app.on('will-quit', () => fs.rmSync(profile, { recursive: true, force: true }));
app.whenReady().then(() => session.defaultSession.protocol.handle('https', request => {
  const url = new URL(request.url);
  if (url.hostname === 'player.bilibili.com') return new Response(`<video controls muted ${url.searchParams.get('autoplay') === '1' ? 'autoplay' : ''} src="https://home-video.test/clip.webm"></video>`, { headers: { 'content-type': 'text/html' } });
  if (url.hostname === 'home-video.test') return new Response(fs.readFileSync(clip), { headers: { 'content-type': 'video/webm' } });
  return new Response('', { status: 404 });
}));

let started = false;
app.on('browser-window-created', (_, win) => {
  if (started) return;
  started = true;
  win.webContents.once('did-finish-load', async () => {
    const js = async code => {
      const expression = code.includes(';') && !code.trim().startsWith('(')
        ? `(async () => { ${code} })()` : `(async () => (${code}))()`;
      try { return await win.webContents.executeJavaScript(expression, true); }
      catch (error) { console.error('Failed expression:', code); throw error; }
    };
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const wait = async code => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(80); }
      throw new Error('Timed out: ' + code);
    };
    const click = async selector => {
      const point = await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    };
    const shot = async name => {
      await pause(650);
      fs.writeFileSync(path.join(evidence, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    try {
      await wait("typeof UX !== 'undefined' && !!document.querySelector('#ux-home-video-play')");
      await js('window.homeVideoErrors=[];window.addEventListener("error",e=>{if(e.message)homeVideoErrors.push(e.message)});window.addEventListener("unhandledrejection",e=>homeVideoErrors.push(String(e.reason)));');
      assert.match(await js("document.querySelector('#ux-home-video-play').textContent"), /导入第一个视频/);
      await click('#ux-home-video-play');
      await wait("!!document.querySelector('#ux-import-text')");
      await js('closeModal(true)');

      const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g"><stop stop-color="#b1a5d8"/><stop offset="1" stop-color="#dfedee"/></linearGradient></defs><path fill="url(#g)" d="M0 0h640v360H0z"/><circle fill="#ffffff55" cx="490" cy="140" r="120"/><text x="36" y="100" fill="#424163" font-family="sans-serif" font-size="29">15 MIN · DAILY PRACTICE</text><text x="36" y="142" fill="#555879" font-family="sans-serif" font-size="18">SYNTHETIC TEST COVER</text></svg>');
      await js(`Store.db.onboarding={done:true};Store.settings().autoPauseOnBlur=false;Store.settings().remindersEnabled=false;
        Store.db.videos=${JSON.stringify([
          { id: 'recent', title: '最近练过的课程', source: 'local', localPath: clip, durationSec: 20, lastUsedAt: '2026-09-19T10:00:00Z' },
          { id: 'planned', title: '今日面部跟练 · 15 分钟', source: 'local', localPath: clip, durationSec: 900, pic: poster },
          { id: 'online', title: 'B 站课程 · 跨域播放测试', source: 'bilibili', bvid: 'BV1xx411c7mD', cid: 1, durationSec: 20 }
        ])};Store.db.sessions=[{id:'today-plan',name:'今日跟练',enabled:true,days:[new Date().getDay()],time:'21:30',videoId:'planned'}];Store.save(true);App.render();`);
      assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'planned');
      await wait("document.querySelector('.ux-home-video-poster').naturalWidth > 0");
      await click('#ux-home-video-trigger');
      await wait("!!document.querySelector('#ux-home-video-menu')");
      const hoverPoint = await js(`(() => { const r=document.querySelector('[data-video-id="planned"]').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...hoverPoint });
      await wait("document.querySelector('.ux-home-video-preview img')?.naturalWidth > 0");
      assert.match(await js("document.querySelector('.ux-home-video-preview strong').textContent"), /今日面部跟练/);
      assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'planned', 'hover does not switch selection');
      await shot('home-video-hover-preview');
      await click('[data-video-id="recent"]');
      await wait("document.querySelector('#ux-home-video-select').value === 'recent'");
      assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'recent');
      await click('#ux-home-video-trigger');
      await wait("!!document.querySelector('#ux-home-video-menu')");
      const noCoverPoint = await js(`(() => { const r=document.querySelector('[data-video-id="recent"]').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...noCoverPoint });
      await wait("document.querySelector('.ux-home-video-preview-empty')?.hidden === false");
      await click('[data-video-id="planned"]');
      await wait("document.querySelector('#ux-home-video-select').value === 'planned'");
      for (const width of [1240, 980]) {
        win.setSize(width, width === 1240 ? 820 : 640);
        await pause(200);
        const bounds = await js(`(() => {
          const left=document.querySelector('.ux-now-main').getBoundingClientRect(),right=document.querySelector('.ux-home-video').getBoundingClientRect(),frame=document.querySelector('#ux-home-video-play').getBoundingClientRect();
          return {rightOfActions:right.left>left.right,visible:frame.top>=0&&frame.bottom<=innerHeight,overflow:document.querySelector('#view-root').scrollWidth>document.querySelector('#view-root').clientWidth+1};
        })()`);
        assert.deepEqual(bounds, { rightOfActions: true, visible: true, overflow: false });
        await shot('home-video-' + width);
      }
      await click('#ux-home-video-trigger');
      await wait("!!document.querySelector('#ux-home-video-menu')");
      const menuBounds = await js(`(() => { const r=document.querySelector('#ux-home-video-menu').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}; })()`);
      assert.ok(menuBounds.left >= 0 && menuBounds.right <= menuBounds.width && menuBounds.top >= 0 && menuBounds.bottom <= menuBounds.height, 'preview remains inside the window');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait("!document.querySelector('#ux-home-video-menu')");
      await js("document.documentElement.classList.add('dark')");
      await shot('home-video-dark-980');
      await js("document.documentElement.classList.remove('dark')");
      await click('#ux-home-video-play');
      await wait("App.currentView==='follow' && Session.active?.running && !document.querySelector('#stage video').paused");
      assert.equal(await js('Session.active.videoId'), 'planned');
      assert.equal(await js('Session.active.sessionId'), 'today-plan');
      assert.equal(await js("document.querySelector('#modal-mask').classList.contains('hidden')"), true, 'direct entry has no intermediate chooser');
      await pause(1100);
      assert.ok(await js('Session.active.seconds >= 1'));
      const entry = await js('Session.active.entryId');
      await js("document.querySelector('#stage video').currentTime=8;App.go('today');");
      assert.match(await js("document.querySelector('#ux-home-video-play').textContent"), /继续跟练/);
      await click('#ux-home-video-play');
      await wait('Session.active?.running');
      assert.equal(await js('Session.active.entryId'), entry, 'continuation retains the entry');

      // Selecting a different video updates the displayed and launched identity together.
      await js("Session.stop();App.go('today');const s=document.querySelector('#ux-home-video-select');s.value='recent';s.dispatchEvent(new Event('change',{bubbles:true}));");
      assert.match(await js("document.querySelector('.ux-home-video-caption strong').textContent"), /最近练过/);
      assert.equal(await js("Drafts.fields(document.querySelector('#view-root')).some(x=>x.id==='ux-home-video-select')"), false);
      win.focus();
      await pause(100);
      await js("document.querySelector('#ux-home-video-play').focus()");
      assert.equal(await js('document.activeElement.id'), 'ux-home-video-play');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
      await wait("Session.active?.videoId==='recent' && Session.active.running");
      await js("Session.stop();App.go('today');const s=document.querySelector('#ux-home-video-select');s.value='online';s.dispatchEvent(new Event('change',{bubbles:true}));");
      await click('#ux-home-video-play');
      await wait("Session.active?.videoId==='online' && Session.active.running");
      assert.match(await js("document.querySelector('#stage iframe').src"), /autoplay=1/);
      assert.match(await js("document.querySelector('#stage iframe').allow"), /autoplay/);

      // Other entry points retain paused-on-open behavior, and broken covers remain usable.
      await js("Session.stop();App.launchFollow('recent')");
      await wait("document.querySelector('#stage video').readyState>=3");
      assert.equal(await js('Session.active.running'), false);
      assert.equal(await js("document.querySelector('#stage video').paused"), true);
      await js("Session.stop();Store.videoById('recent').pic='data:image/png;base64,invalid';UX.homeVideoChoice={date:todayKey(),id:'recent'};App.go('today');");
      await wait("document.querySelector('.ux-home-video-poster').classList.contains('ph')");
      await click('#ux-home-video-play');
      await wait('Session.active?.running');
      await js("Session.stop();Store.settings().enabledModules=['strength','skincare'];App.go('today')");
      assert.equal(await js("!!document.querySelector('#ux-home-video')"), false);
      assert.deepEqual(await js('homeVideoErrors'), []);
      console.log('HOME_VIDEO_UI_PASS: right-side frame, empty import, today-plan selection, local and real cross-origin autoplay on explicit click, actual media timer, active continuation, switch/keyboard, broken cover fallback, two sizes/dark, ordinary entry stays paused, disabled-module handling.');
      app.quit();
    } catch (error) {
      console.error(error);
      await shot('home-video-failure');
      app.exit(1);
    }
  });
});
require('../main');
