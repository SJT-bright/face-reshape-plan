/* Actual Electron renderer, synthetic video and fake camera, isolated data only. */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'face-follow-mirror-'));
const evidence = path.resolve(process.env.FACE_MIRROR_EVIDENCE || '.impeccable/review/follow-mirror');
const executable = process.env.FACE_MIRROR_APP_BINARY;
const original = { training: { '2026-10-01': { seconds: 75, targetMinutes: 15, entries: [{ id: 'old-record', seconds: 75 }] } }, skincare: {} };
const dataFile = path.join(profile, 'face-reshape-data.json');
fs.mkdirSync(evidence, { recursive: true });
const clip = path.join(profile, 'synthetic.webm');
fs.copyFileSync(path.join(root, 'tests/fixtures/synthetic.webm'), clip);
fs.writeFileSync(dataFile, JSON.stringify({ version: 1, onboarding: { done: true }, freshInstall: false,
  settings: { keepInTray: false, remindersEnabled: false, autoPauseOnBlur: false },
  videos: [{ id: 'test-video', source: 'local', title: '动作对照测试视频', localPath: clip, durationSec: 600 }],
  sessions: [], logs: original, skincare: { cycles: [] } }));
let app, phase = 'launch';
const deadline = setTimeout(() => { console.error('Mirror test deadline: ' + phase); process.exitCode = 1; app?.process().kill('SIGTERM'); }, 60000);
async function main() {
  app = await electron.launch({ ...(executable ? { executablePath: executable } : {}),
    args: [...(executable ? [] : [path.join(root, 'main.js')]), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, FACE_RESHAPE_PROFILE: profile, FACE_UX20_TEST: '1', FACE_HUB_PORT: '0' }, timeout: 30000 });
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('camera:permission'); ipcMain.handle('camera:permission', () => ({ granted: true, status: 'synthetic-device' }));
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.db);
  await page.evaluate(() => {
    window.mirrorCalls = { gum: [], record: 0, writes: 0 };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = opts => { mirrorCalls.gum.push(opts); return gum(opts); };
    window.MediaRecorder = class { constructor() { mirrorCalls.record++; throw Error('Mirror must never record'); } };
    App.launchFollow('test-video');
  });
  const wait = fn => page.waitForFunction(fn, {}, { timeout: 15000 });
  const status = () => JSON.parse(fs.readFileSync(dataFile));
  const size = (width, height) => app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setSize(width, height), { width, height });
  await size(1240, 900);
  phase = 'preview and drag';
  await page.locator('#follow-mirror-toggle').click();
  await wait(() => FollowMirror.stream && document.querySelector('#follow-mirror-preview').videoWidth > 0);
  assert.equal(await page.evaluate(() => document.querySelector('#follow-mirror-preview').paused), false);
  assert.equal(await page.evaluate(() => Session.active.seconds), 0, 'Camera does not start training timer');
  assert.deepEqual(status().logs.training['2026-10-01'], original.training['2026-10-01']);
  assert.equal(await page.evaluate(() => mirrorCalls.gum.length), 1);
  assert.equal(await page.evaluate(() => mirrorCalls.gum[0].audio), false);
  assert.equal(await page.locator('#follow-mirror').locator('canvas, [id*=capture], [id*=record]').count(), 0);
  assert.equal(await page.evaluate(() => mirrorCalls.record), 0);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(evidence, 'desktop.png') });
  const before = await page.locator('#follow-mirror').boundingBox();
  const handle = await page.locator('#follow-mirror-handle').boundingBox();
  await page.mouse.move(handle.x + 20, handle.y + 12); await page.mouse.down();
  await page.mouse.move(handle.x - 240, handle.y + 155, { steps: 12 }); await page.mouse.up();
  const moved = await page.locator('#follow-mirror').boundingBox();
  assert.ok(moved.x < before.x - 100 && moved.y > before.y + 50, 'Real pointer drag moves the window across the player');
  await page.evaluate(() => App.render());
  assert.equal(await page.evaluate(() => mirrorCalls.gum.length), 1, 'Rerender preserves one stream');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.__mirrorFullscreenSettled = win.isFullScreen();
    win.once('enter-full-screen', () => { win.__mirrorFullscreenSettled = true; });
  });
  await page.locator('#t-imm').click();
  phase = 'fullscreen';
  await wait(() => document.fullscreenElement?.id === 'stage-wrap');
  for (let i = 0; i < 50; i++) {
    if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].__mirrorFullscreenSettled)) break;
    await page.waitForTimeout(100);
  }
  assert.equal(await page.evaluate(() => document.fullscreenElement.contains(document.querySelector('#follow-mirror'))), true);
  await page.locator('#follow-mirror-handle').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => FollowMirror.stream.getVideoTracks()[0].readyState), 'live');
  await page.screenshot({ path: path.join(evidence, 'fullscreen.png') });
  await page.evaluate(() => { void document.exitFullscreen(); });
  await wait(() => document.fullscreenElement === null);
  await size(980, 640); await page.waitForTimeout(200);
  phase = 'playback and close';
  const narrow = await page.locator('#follow-mirror').boundingBox();
  assert.ok(narrow.x >= 8 && narrow.y >= 8 && narrow.x + narrow.width <= await page.evaluate(() => innerWidth) - 7);
  await page.screenshot({ path: path.join(evidence, 'narrow.png') });
  assert.equal(await page.evaluate(() => Session.active.seconds), 0, 'Live mirror remains excluded from timer throughout dragging and fullscreen');
  await page.evaluate(() => { const video = document.querySelector('#stage video'); video.loop = true; video.play(); });
  await wait(() => Session.active?.running && Session.active.seconds > 0);
  await page.evaluate(() => Bilibili.MediaSync.pauseAll());
  await wait(() => !Session.active.running);
  assert.equal(await page.evaluate(() => document.querySelector('#follow-mirror-preview').paused), false, 'Player pause leaves mirror live');
  await page.evaluate(() => { window.closedMirrorStream = FollowMirror.stream; });
  await page.locator('#follow-mirror-close').click();
  assert.equal(await page.evaluate(() => FollowMirror.stream), null);
  assert.equal(await page.evaluate(() => closedMirrorStream.getTracks().every(t => t.readyState === 'ended')), true);
  assert.equal(await page.locator('#follow-mirror').count(), 0);
  // A late camera result is released after closing the window, even if opened again.
  phase = 'late camera request';
  await page.evaluate(() => {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.resumeMirror = null;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      window.resumeMirror = async () => { window.lateMirrorStream = await gum({ video: true, audio: false }); resolve(lateMirrorStream); };
    });
    FollowMirror.start();
  });
  await wait(() => typeof resumeMirror === 'function');
  await page.locator('#follow-mirror-close').click();
  await page.bringToFront();
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows()[0].show(); BrowserWindow.getAllWindows()[0].focus(); app.focus({ steal: true }); });
  await page.evaluate(() => { void resumeMirror(); });
  await wait(() => window.lateMirrorStream?.getTracks().every(t => t.readyState === 'ended'));
  assert.equal(await page.locator('#follow-mirror').count(), 0);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('camera:permission'); ipcMain.handle('camera:permission', () => ({ granted: false, status: 'denied' }));
  });
  phase = 'permission denied';
  await page.locator('#follow-mirror-toggle').click();
  await wait(() => document.querySelector('#follow-mirror-retry')?.textContent.includes('权限'));
  assert.equal(await page.evaluate(() => FollowMirror.stream), null);
  await page.evaluate(() => App.go('today'));
  assert.equal(await page.locator('#follow-mirror').count(), 0);
  assert.equal(await page.evaluate(() => mirrorCalls.record), 0);
  const photos = path.join(profile, 'skin-photos');
  assert.equal(fs.existsSync(photos) ? fs.readdirSync(photos).length : 0, 0, 'No photo files created');
  assert.deepEqual(status().logs.training['2026-10-01'], original.training['2026-10-01']);
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ passed: true, scope: executable ? 'actual packaged executable, synthetic camera' : 'source Electron, synthetic camera', checks: ['live preview and no microphone/recording', 'drag and keyboard movement', 'HTML fullscreen and narrow window', 'one stream across rerenders', 'timer unchanged by camera', 'close and navigation release camera', 'late request released', 'permission denied fallback', 'no photos and old logs unchanged'] }, null, 2));
  console.log('FOLLOW_MIRROR_UI_PASS: ' + (executable || 'source') + '; synthetic camera only');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(deadline);
  if (app) await app.close().catch(() => {}); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});
