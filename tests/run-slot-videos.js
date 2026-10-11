/* E：早晚槽位独立 UI 测试入口。生成合成视频到隔离 profile，先 write 再 restart 两次真实启动。
   子进程命令全部为字面量（ffmpeg 固定路径、electron 走 node_modules/.bin），参数数组、shell 关闭。 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const profile = '/tmp/fr-dev-20261011-e';
/* 相对命令按调用方 cwd 解析，先固定到项目根，任何目录下调用都一致 */
process.chdir(path.resolve(__dirname, '..'));
/* 每次从干净 profile 开始（write 阶段断言依赖首日零数据），结束同样清理 */
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
try {
  spawnSync('/opt/homebrew/bin/ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x5b8def:s=160x90:r=10', '-t', '30', '-c:v', 'libvpx', '-b:v', '30k', path.join(profile, 'slot-fixture.webm')],
    { stdio: 'inherit', shell: false });
  for (const mode of ['write', 'restart']) {
    const r = spawnSync('./node_modules/.bin/electron', [path.join(__dirname, 'test-slot-videos-ui.js'), mode], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, FACE_RESHAPE_PROFILE: profile, FACE_HUB_PORT: '18481' }
    });
    if (r.error || r.status !== 0) throw r.error || new Error(`electron ${mode} exited ${r.status}`);
  }
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
