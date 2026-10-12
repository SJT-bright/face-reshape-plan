/* 认知唤醒第一页：已下载到本地的视频，卡片和视频库都显示该文件的首帧。 */
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'face-poster-ui-'));
const real = path.join(__dirname, '..', '跟练视频', '抖音-清醒雄竞的爽感-7620084017840344329.mp4');
if (!fs.existsSync(real)) throw new Error('缺少本地抖音视频，无法核对第一页首帧');
app.setPath('userData', profile);
app.commandLine.appendSwitch('disk-cache-dir', path.join(profile, 'cache'));
fs.writeFileSync(path.join(profile, 'face-reshape-data.json'), JSON.stringify({
  version: 1,
  settings: { keepInTray: false, dailyTargetMinutes: 15, videoMode: 'awakening', remindersEnabled: false, autoPauseOnBlur: false, onboarding: { done: true } },
  videoCollections: [
    { id: 'face', name: '瘦脸护理', periods: [] },
    { id: 'awakening', name: '认知唤醒', periods: ['morning', 'evening'] }
  ],
  videos: [{
    id: 'vid_douyin_frame', source: 'local', collectionId: 'awakening', pic: '',
    douyinId: '7620084017840344329', localPath: real,
    title: '清醒雄竞的爽感>迷茫中娱乐 雄竞男必经四阶段 # 男性成长 # 男性力量',
    addedAt: '2026-10-04T07:34:22.867Z'
  }],
  sessions: [], skincare: { cycles: [] }, logs: { training: {}, skincare: {}, videoWatching: {} }
}));

let started = false;
app.on('browser-window-created', (_e, win) => {
  if (started) return;
  started = true;
  win.webContents.once('did-finish-load', async () => {
    const js = code => win.webContents.executeJavaScript(code, true);
    const wait = async (code, ms = 20000) => {
      const until = Date.now() + ms;
      while (!(await js(code))) {
        if (Date.now() > until) throw new Error('Timed out: ' + code);
        await new Promise(r => setTimeout(r, 80));
      }
    };
    try {
      await wait("typeof UX !== 'undefined' && App.currentView === 'awakening'");
      await wait("document.querySelector('.ux-home-video-poster')?.naturalWidth > 0 && !document.querySelector('.ux-home-video-poster').classList.contains('ph')");
      await wait("document.querySelector('.vid-card[data-video=\"vid_douyin_frame\"] img.vid-cover')?.naturalWidth > 0");
      const state = await js(`({
        src: document.querySelector('.ux-home-video-poster').src,
        title: document.querySelector('.ux-home-video-caption strong').textContent,
        saved: Store.videoById('vid_douyin_frame').posterFromFrame === true && Store.videoById('vid_douyin_frame').pic.startsWith('file:')
      })`);
      assert.match(state.src, /^file:/);
      assert.match(state.title, /清醒雄竞/);
      assert.equal(state.saved, true);
      win.setSize(1240, 900);
      await new Promise(r => setTimeout(r, 400));
      fs.writeFileSync('/tmp/awakening-poster.png', (await win.webContents.capturePage()).toPNG());
      console.log('LOCAL_POSTER_UI_PASS');
      app.exit(0);
    } catch (error) {
      console.error(error);
      try { fs.writeFileSync('/tmp/awakening-poster-fail.png', (await win.webContents.capturePage()).toPNG()); } catch {}
      app.exit(1);
    }
  });
});
require('../main');
