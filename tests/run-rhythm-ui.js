const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'face-rhythm-acceptance-'));
try {
  for (const phase of ['write', 'restart']) {
    execFileSync(require('electron'), [path.join(__dirname, 'test-rhythm-ui.js'), profile, phase], { stdio: 'inherit', timeout: 90000 });
  }
} finally { fs.rmSync(profile, { recursive: true, force: true }); }
