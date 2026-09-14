/* Export the original imagegen PNGs at practical UI sizes; preserve their alpha. */
const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage } = require('electron');
const root = path.join(__dirname, '..');
const assets = path.join(root, 'src', 'assets', '3d');
app.whenReady().then(() => {
  const originals = path.join(assets, 'originals');
  const files = fs.readdirSync(originals).filter(name => name.endsWith('.png'));
  for (const name of files) {
    const source = nativeImage.createFromPath(path.join(originals, name));
    if (source.isEmpty()) throw new Error(`Cannot decode ${name}`);
    const width = name.startsWith('button-') ? 1024 : 256;
    const output = source.resize({ width, quality: 'best' }).toPNG();
    fs.writeFileSync(path.join(assets, name), output);
  }
  fs.copyFileSync(path.join(originals, 'brand.png'), path.join(root, 'assets', 'icon-source-3d.png'));
  const brand = nativeImage.createFromPath(path.join(originals, 'brand.png'));
  for (const [name, size] of [['icon.png', 512], ['icon@sm.png', 64]]) {
    fs.writeFileSync(path.join(root, 'assets', name), brand.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  console.log(`Exported ${files.length} generated assets and the macOS app icons.`);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
