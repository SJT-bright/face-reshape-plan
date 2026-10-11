// Windows-only, actual Electron with redirected appData; never touches a real user profile.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
assert.equal(process.platform, 'win32');
if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'life-windows-default-'));
  try { require('node:child_process').execFileSync(require('electron'), [__filename, root], { stdio: 'inherit', timeout: 30000 }); }
  finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); }
} else run();

function run() {
const { app } = require('electron');
const root = process.argv[2];
assert.ok(root && path.basename(root).startsWith('life-windows-default-'));
const profile = path.join(root, '面部重塑计划');
fs.mkdirSync(profile);
app.setPath('appData', root);
app.setPath('userData', profile);
delete process.env.FACE_RESHAPE_PROFILE;
delete process.env.FACE_UX20_TEST;
fs.writeFileSync(path.join(profile, 'face-reshape-data.json'), JSON.stringify({ version: 1, freshInstall: false,
  onboarding: { done: true }, settings: { keepInTray: false, remindersEnabled: false }, videos: [], sessions: [],
  logs: { training: {}, skincare: {} }, skincare: { cycles: [] }, reminderState: {} }));
let done = false;
const timer = setTimeout(() => { console.error('Default Windows storage test timeout'); app.exit(1); }, 20000);
app.on('browser-window-created', (_, win) => {
  if (done) return;
  done = true;
  win.webContents.once('did-finish-load', async () => {
    try {
      const actualProfile = await win.webContents.executeJavaScript('native.userDataPath()');
      assert.equal(path.resolve(actualProfile), profile);
      for (const kind of ['skin', 'body']) {
        const folder = await win.webContents.executeJavaScript(`native.photoFolderInfo('${kind}')`);
        assert.equal(path.resolve(folder.path), path.join(profile, kind + '-photos'));
      }
      await win.webContents.executeJavaScript("native.saveSkinPhoto([1,2,3], 'jpg', {kind:'skin',date:'2026-10-11'})");
      assert.equal(fs.readdirSync(path.join(profile, 'skin-photos')).length, 1);
      assert.equal(fs.existsSync(path.join(root, 'Downloads')), false);
      console.log('WINDOWS_DEFAULT_DATA_PASS: legacy appData profile and writable media directories; no project/install directory writes');
      clearTimeout(timer); app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require('../main');
}
