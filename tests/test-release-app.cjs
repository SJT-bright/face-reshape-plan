// Run the actual packaged executable twice with a disposable profile. All media is synthetic.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const binary = path.resolve(process.argv[2] || 'dist/win-unpacked/人生重塑计划.exe');
const evidence = path.resolve(process.env.FACE_RELEASE_EVIDENCE || 'release-evidence');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'life-release-'));
const archive = process.platform === 'darwin'
  ? path.resolve(path.dirname(binary), '../Resources/app.asar')
  : path.join(path.dirname(binary), 'resources', 'app.asar');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, browser, output = '';
const report = { platform: process.platform, version: require('../package.json').version, checks: [] };
async function start() {
  fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });
  child = spawn(binary, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-backgrounding-occluded-windows'], {
    cwd: profile, env: { ...process.env, FACE_RESHAPE_PROFILE: profile, FACE_UX20_TEST: '1', FACE_HUB_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.once('error', error => { output += error.stack; });
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw Error('Packaged app exited: ' + output);
    if (fs.existsSync(portFile)) break;
    await delay(100);
  }
  assert.ok(fs.existsSync(portFile), 'packaged app started from a different working directory');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const context = browser.contexts()[0];
  let page;
  for (let i = 0; i < 150; i++) {
    page = context.pages().find(p => p.url().endsWith('/src/index.html'));
    if (page) break;
    await delay(100);
  }
  assert.ok(page, 'packaged renderer loaded');
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.db && typeof UX !== 'undefined', {}, { timeout: 20000 });
  return page;
}
async function stop() {
  if (browser) { await browser.close(); browser = null; }
  if (!child || child.exitCode !== null) return;
  const active = child;
  await new Promise(resolve => { active.once('exit', resolve); active.kill(); });
  child = null;
}
async function main() {
  fs.mkdirSync(evidence, { recursive: true });
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(pkg.version, report.version);
  const files = ['main.js', 'preload.js', ...fs.readdirSync(path.join(root, 'src/js')).filter(n => n.endsWith('.js')).map(n => 'src/js/' + n), 'src/index.html', 'src/ux.css'];
  for (const name of files) assert.equal(hash(asar.extractFile(archive, path.normalize(name))), hash(fs.readFileSync(path.join(root, name))), name + ' matches source');
  const packaged = asar.listPackage(archive).map(name => name.replace(/\\/g, '/'));
  assert.equal(packaged.some(n => /(?:face-reshape-data\.json|ai-key\.enc|hub-meal-token|\.sqlite|\.frbackup|\/\.zcode\/)/.test(n)), false);
  report.checks.push('package version, ' + files.length + ' source hashes, no private records');
  const clip = path.join(profile, '测试 视频 #1.webm');
  fs.copyFileSync(path.join(root, 'tests/fixtures/synthetic.webm'), clip);
  const dbFile = path.join(profile, 'face-reshape-data.json');
  fs.writeFileSync(dbFile, JSON.stringify({ version: 1, freshInstall: false, onboarding: { done: true },
    settings: { keepInTray: false, dailyTargetMinutes: 15, remindersEnabled: false, autoPauseOnBlur: false },
    videos: [{ id: 'release-clip', title: '合成测试视频', source: 'local', localPath: clip, mode: 'face', durationSec: 6 }],
    sessions: [], logs: { training: {}, skincare: {} }, skincare: { cycles: [] }, reminderState: {} }));
  let page = await start();
  assert.equal(await page.evaluate(() => native.platform), process.platform);
  const folder = await page.evaluate(() => native.photoFolderInfo('skin'));
  assert.equal(path.resolve(folder.path), path.join(profile, 'skin-photos'));
  for (const view of ['today', 'plan', 'strength', 'skincare', 'nutrition', 'achievements', 'settings']) {
    await page.evaluate(view => App.go(view), view);
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => App.currentView), view);
    assert.ok(await page.locator('main').innerText(), view + ' rendered content');
  }
  await page.locator('#ux-tab-preferences').click();
  const input = page.locator('#ux-settings-form [name=target]');
  await input.fill('21');
  await page.locator('.ux-settings-save').click();
  await page.waitForFunction(() => Store.db.settings.dailyTargetMinutes === 21);
  assert.equal(JSON.parse(fs.readFileSync(dbFile)).settings.dailyTargetMinutes, 21);
  report.checks.push('seven routes, settings form and native IPC persistence');
  await page.evaluate(() => { App.followVideoId = 'release-clip'; App.go('follow'); });
  await page.waitForFunction(() => document.querySelector('#stage video')?.readyState >= 2, {}, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#stage video').play());
  await page.waitForFunction(() => document.querySelector('#stage video').currentTime > 0.3);
  assert.equal(await page.evaluate(() => document.querySelector('#stage video').error), null);
  await page.evaluate(() => document.querySelector('#stage video').pause());
  report.checks.push('local video decodes and plays from a path containing Chinese, space and #');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yV8AAAAASUVORK5CYII=', 'base64');
  const saved = await page.evaluate(async bytes => native.saveSkinPhoto(bytes, 'png', { date: todayKey(), kind: 'skin' }), [...png]);
  assert.ok(saved); assert.deepEqual(fs.readFileSync(path.join(profile, 'skin-photos', saved)), png);
  await page.evaluate(() => { Session.stop(); App.go('today'); });
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.screenshot({ path: path.join(evidence, process.platform + '-home.png'), fullPage: true });
  await stop(); page = await start();
  assert.equal(await page.evaluate(() => Store.db.settings.dailyTargetMinutes), 21);
  assert.equal(await page.evaluate(() => Store.db.videos[0].id), 'release-clip');
  assert.deepEqual(fs.readFileSync(path.join(profile, 'skin-photos', saved)), png);
  report.checks.push('photo bytes saved, process restart restores records and media');
  report.archiveSha256 = hash(fs.readFileSync(archive));
  fs.writeFileSync(path.join(evidence, process.platform + '-launch.json'), JSON.stringify(report, null, 2));
  console.log('PACKAGED_RELEASE_PASS ' + JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await stop(); fs.rmSync(profile, { recursive: true, force: true });
});
