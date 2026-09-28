#!/usr/bin/env node
/* 把工作区代码部署进已安装的 /Applications/面部重塑计划.app：
   1) 备份当前 app.asar 到 backups/
   2) 从工作区全新组装 asar 内容（与 package.json 的 electron-builder files 配置一致，
      排除 src/assets/3d/originals；不从旧 asar 解包，避免带入历史残留）
   3) 打包 + ad-hoc 重签
   用法：node scripts/deploy-app-asar.js [--app /path/to/面部重塑计划.app] */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const argApp = process.argv.indexOf('--app');
const APP = path.resolve(argApp > -1 ? process.argv[argApp + 1] : `/Applications/面部重塑计划.app`);

/* codesign 的目标路径参数不做选项注入校验，这里自行收紧：
   必须是绝对路径、真实存在的 .app 目录，且各段不以 '-' 开头（防止被当选项解析） */
function assertSafeAppPath(p) {
  if (!path.isAbsolute(p) || !p.endsWith('.app')) throw new Error(`非法应用路径：${p}`);
  for (const seg of p.split(path.sep)) {
    if (seg.startsWith('-')) throw new Error(`路径段以 '-' 开头，可能被解释为命令选项：${p}`);
  }
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error(`应用不存在：${p}`);
}

const EXCLUDE = [/^src\/assets\/3d\/originals\//];
const SYNC = ['main.js', 'preload.js', 'package.json', 'src', 'assets'];
function copy(src, dest, rel) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(dest, name), `${rel}${name}/`);
    return;
  }
  if (EXCLUDE.some((re) => re.test(rel))) return;
  fs.copyFileSync(src, dest);
}

async function main() {
  assertSafeAppPath(APP);
  const RES = path.join(APP, 'Contents', 'Resources');
  const ASAR = path.join(RES, 'app.asar');
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  if (!fs.existsSync(ASAR)) { console.error(`找不到 ${ASAR}`); process.exit(1); }

  const bak = path.join(ROOT, 'backups', `app.asar.bak-${stamp}`);
  fs.copyFileSync(ASAR, bak);
  console.log('已备份 →', path.relative(ROOT, bak));

  const work = fs.mkdtempSync('/tmp/face-reshape-deploy-');
  const staged = path.join(ROOT, 'backups', `app.asar.next-${stamp}`);
  try {
    for (const name of SYNC) copy(path.join(ROOT, name), path.join(work, name), `${name}/`);
    /* 先打到工作区再替换：createPackage 直接写正在运行的 asar 会失败或留下半包 */
    await asar.createPackage(work, staged);
    console.log('已打包 →', path.relative(ROOT, staged));
    fs.copyFileSync(staged, ASAR);
    console.log('已替换 →', ASAR);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--', APP], { stdio: 'inherit' });
  console.log('已 ad-hoc 重签');
}

main().catch((e) => {
  console.error(e);
  if (e && e.code === 'EPERM') {
    console.error('macOS 拒绝写入该 .app（常见于未授予「App 管理」权限，或应用仍在运行）。请先完全退出应用，在本机「终端」再跑一次本脚本。');
  }
  process.exit(1);
});
