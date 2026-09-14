/* 从高分辨率母版稳定导出 Electron 使用的 512px 与 64px PNG 图标。 */
const fs = require('fs');
const path = require('path');
const electron = require('electron');

if (!electron.app || !electron.nativeImage) {
  process.stderr.write('请使用 Electron 运行：npm run icon\n');
  process.exit(2);
}

const { app, nativeImage } = electron;
const assetsDir = path.join(__dirname, '..', 'assets');
const sourcePath = path.join(assetsDir, 'icon-source-3d.png');

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(sourcePath);
  if (source.isEmpty()) throw new Error(`无法读取图标母版：${sourcePath}`);

  const artifacts = [['icon.png', 512], ['icon@sm.png', 64]].map(([filename, size]) => {
    const data = source.resize({ width: size, height: size, quality: 'best' }).toPNG();
    if (!data.length) throw new Error(`导出 ${filename} 失败`);
    const target = path.join(assetsDir, filename);
    return {
      filename,
      data,
      target,
      hadTarget: fs.existsSync(target),
      temp: `${target}.${process.pid}.tmp`,
      backup: `${target}.${process.pid}.bak`
    };
  });
  const attempted = [];
  try {
    for (const item of artifacts) {
      fs.writeFileSync(item.temp, item.data);
      if (item.hadTarget) fs.copyFileSync(item.target, item.backup);
    }
    for (const item of artifacts) {
      attempted.push(item);
      fs.renameSync(item.temp, item.target);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of attempted.reverse()) {
      try {
        if (item.hadTarget) fs.renameSync(item.backup, item.target);
        else fs.rmSync(item.target, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], '图标导出失败，且回滚不完整');
    throw error;
  } finally {
    for (const item of artifacts) {
      fs.rmSync(item.temp, { force: true });
      fs.rmSync(item.backup, { force: true });
    }
  }

  process.stdout.write(`已从 ${path.basename(sourcePath)} 导出 512px 与 64px 图标\n`);
  app.quit();
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
