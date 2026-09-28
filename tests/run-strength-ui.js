const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'face-strength-acceptance-'));
try {
  execFileSync(require('electron'), [path.join(__dirname, 'test-strength-ui.js'), profile], { stdio: 'inherit', timeout: 60000 });
} finally { fs.rmSync(profile, { recursive: true, force: true }); }
