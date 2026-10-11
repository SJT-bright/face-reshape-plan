#!/usr/bin/env node
/**
 * repack-asar.js —— 把源码改动快速打进 dist/mac-arm64/人生重塑计划.app（兼容旧名称）
 * 用法：node scripts/repack-asar.js [--app /path/to/人生重塑计划.app]
 * 内容清单与 electron-builder 产物一致：main.js / preload.js / package.json / assets / src
 * 说明：重打 asar 后必须同步 Info.plist 的头部哈希并重签。
 *       新增 npm 依赖或改 electron-builder 配置时，仍请用 npm run dist:mac -- --dir。
 */
const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');
const { execFileSync } = require('node:child_process');
const { syncMacAsarIntegrity } = require('./sync-asar-integrity');
const { resolveAppPath, syncDisplayName } = require('./deploy-app-asar');

const root = path.resolve(__dirname, '..');
const argApp = process.argv.indexOf('--app');
const appDir = resolveAppPath(path.join(root, 'dist', 'mac-arm64'), argApp > -1 ? process.argv[argApp + 1] : null);
const asarPath = path.join(appDir, 'Contents', 'Resources', 'app.asar');
const stage = path.join(root, '.repack-stage');
const ENTRIES = ['main.js', 'preload.js', 'package.json', 'assets', 'src'];
// 与 electron-builder files 配置保持一致：排除 3D 原始素材
const EXCLUDES = [path.join('src', 'assets', '3d', 'originals')];

async function main() {
  if (argApp > -1 && !process.argv[argApp + 1]) throw new Error('--app 后需要指定 .app 路径');
  if (!fs.existsSync(asarPath)) throw new Error(`找不到 ${asarPath}；请先运行 npm run dist:mac -- --dir`);
  // 从项目源码直接构建 asar（内容清单与 electron-builder 产物一致）
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const rel of ENTRIES) {
    fs.cpSync(path.join(root, rel), path.join(stage, rel), { recursive: true });
    console.log('已收集', rel);
  }
  for (const rel of EXCLUDES) {
    fs.rmSync(path.join(stage, rel), { recursive: true, force: true });
  }

  // 2) 重打 asar（失败时保留暂存目录便于排查）
  try {
    await asar.createPackageWithOptions(stage, asarPath, {});
    console.log('已重写 app.asar');
    syncDisplayName(appDir);
    const hash = syncMacAsarIntegrity(appDir);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--', appDir], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--', appDir], { stdio: 'inherit' });
    console.log('已同步完整性记录并重签，asar 头部 SHA256=' + hash);
  } catch (e) {
    console.error('打包失败，暂存目录保留在', stage);
    throw e;
  }
  fs.rmSync(stage, { recursive: true, force: true });
  console.log('完成 ✓  重启应用即可加载新代码');
}

main().catch(e => { console.error(e); process.exit(1); });
