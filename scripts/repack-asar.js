#!/usr/bin/env node
/**
 * repack-asar.js —— 把源码改动快速打进 dist/mac-arm64/面部重塑计划.app
 * 用法：node scripts/repack-asar.js
 * 内容清单与 electron-builder 产物一致：main.js / preload.js / package.json / assets / src
 * 说明：该 app 为 linker-signed（无资源封签），替换 asar 后无需重签、直接可启动。
 *       新增 npm 依赖或改 electron-builder 配置时，仍请用 npm run dist:mac -- --dir。
 */
const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'dist', 'mac-arm64', '面部重塑计划.app');
const asarPath = path.join(appDir, 'Contents', 'Resources', 'app.asar');
const stage = path.join(root, '.repack-stage');
const ENTRIES = ['main.js', 'preload.js', 'package.json', 'assets', 'src'];
// 与 electron-builder files 配置保持一致：排除 3D 原始素材
const EXCLUDES = [path.join('src', 'assets', '3d', 'originals')];

async function main() {
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
  } catch (e) {
    console.error('打包失败，暂存目录保留在', stage);
    throw e;
  }
  fs.rmSync(stage, { recursive: true, force: true });
  console.log('完成 ✓  重启应用即可加载新代码');
}

main().catch(e => { console.error(e); process.exit(1); });
