const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage } = require('electron');

const assetsDir = path.join(__dirname, '..', 'assets');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const assetSpecs = [
  { filename: 'icon-source-3d.png', width: 1254, height: 1254, minBytes: 500_000 },
  { filename: 'icon.png', width: 512, height: 512, minBytes: 100_000 },
  { filename: 'icon@sm.png', width: 64, height: 64, minBytes: 5_000 }
];

const cases = [];
const test = (name, run) => cases.push({ name, run });

function loadAsset(spec) {
  const filePath = path.join(assetsDir, spec.filename);
  fs.accessSync(filePath, fs.constants.R_OK);
  const fileBuffer = fs.readFileSync(filePath);
  const image = nativeImage.createFromBuffer(fileBuffer);
  return { filePath, fileBuffer, image };
}

function alphaAt(bitmap, width, x, y) {
  return bitmap[((y * width) + x) * 4 + 3];
}

test('all required icon PNG files exist and are readable', () => {
  for (const spec of assetSpecs) {
    const { fileBuffer } = loadAsset(spec);
    assert.ok(fileBuffer.length > 0, `${spec.filename} must not be empty`);
    assert.deepEqual(
      fileBuffer.subarray(0, pngSignature.length),
      pngSignature,
      `${spec.filename} must have a PNG signature`
    );
  }
});

test('source and exported icons have the required dimensions', () => {
  for (const spec of assetSpecs) {
    const { image } = loadAsset(spec);
    assert.equal(image.isEmpty(), false, `${spec.filename} must decode as an image`);
    assert.deepEqual(
      image.getSize(),
      { width: spec.width, height: spec.height },
      `${spec.filename} dimensions changed unexpectedly`
    );
  }
});

test('decoded images produce non-empty PNG buffers', () => {
  for (const spec of assetSpecs) {
    const { image } = loadAsset(spec);
    const encoded = image.toPNG();
    assert.ok(Buffer.isBuffer(encoded), `${spec.filename} must encode to a Buffer`);
    assert.ok(encoded.length > 0, `${spec.filename} must encode to a non-empty PNG`);
    assert.deepEqual(encoded.subarray(0, pngSignature.length), pngSignature);
  }
});

test('all four image corners are fully transparent', () => {
  for (const spec of assetSpecs) {
    const { image } = loadAsset(spec);
    const bitmap = image.toBitmap();
    assert.equal(bitmap.length, spec.width * spec.height * 4);
    const corners = [
      [0, 0],
      [spec.width - 1, 0],
      [0, spec.height - 1],
      [spec.width - 1, spec.height - 1]
    ];
    for (const [x, y] of corners) {
      assert.equal(
        alphaAt(bitmap, spec.width, x, y),
        0,
        `${spec.filename} corner (${x}, ${y}) must be transparent`
      );
    }
  }
});

test('the central subject has enough non-transparent pixels', () => {
  for (const spec of assetSpecs) {
    const { image } = loadAsset(spec);
    const bitmap = image.toBitmap();
    const left = Math.floor(spec.width * 0.1);
    const right = Math.ceil(spec.width * 0.9);
    const top = Math.floor(spec.height * 0.1);
    const bottom = Math.ceil(spec.height * 0.9);
    let visiblePixels = 0;
    let regionPixels = 0;

    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        regionPixels += 1;
        if (alphaAt(bitmap, spec.width, x, y) > 0) visiblePixels += 1;
      }
    }

    const coverage = visiblePixels / regionPixels;
    assert.ok(
      coverage >= 0.2,
      `${spec.filename} central visible coverage ${coverage.toFixed(3)} is below 0.2`
    );
  }
});

test('new icon assets stay above their regression size thresholds', () => {
  for (const spec of assetSpecs) {
    const { fileBuffer } = loadAsset(spec);
    assert.ok(
      fileBuffer.length >= spec.minBytes,
      `${spec.filename} is ${fileBuffer.length} bytes; expected at least ${spec.minBytes}`
    );
  }
});

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(() => {
  let failures = 0;
  for (const { name, run } of cases) {
    try {
      run();
      process.stdout.write(`ok - ${name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
    }
  }
  process.stdout.write(`\n${cases.length - failures} passed, ${failures} failed\n`);
  app.exit(failures ? 1 : 0);
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
