/* 未打包的媒体目录在恢复时必须留在原地。包里真有的目录仍要替换。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const B = require('../src/js/portable-backup');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'restore-videos-')); }
function db() {
  return {
    settings: { dailyTargetMinutes: 15 },
    logs: { training: {}, skincare: {} },
    videos: [],
    sessions: [],
    skincare: { cycles: [] }
  };
}

test('不打包视频时，恢复不会挪走已有的跟练视频目录', () => {
  const source = tmp();
  const target = tmp();
  try {
    const data = db();
    const video = path.join(source, 'demo.mp4');
    fs.writeFileSync(video, 'leave-me');
    data.videos = [{ id: 'v1', source: 'local', title: '课 1', localPath: video }];
    const keepDir = path.join(target, 'imported-videos');
    fs.mkdirSync(keepDir);
    fs.writeFileSync(path.join(keepDir, 'keep.mp4'), 'still-here');
    fs.writeFileSync(path.join(target, 'face-reshape-data.json'), 'old-db');
    const bundle = B.createBundle(data, source, false);
    assert.equal(bundle.files.some((f) => String(f.path).startsWith('imported-videos/')), false);
    const restored = B.restore(bundle, target);
    assert.equal(fs.readFileSync(path.join(keepDir, 'keep.mp4'), 'utf8'), 'still-here');
    assert.equal(fs.existsSync(path.join(target, 'imported-videos', 'keep.mp4')), true);
    assert.ok(restored.data);
    assert.equal(fs.existsSync(path.join(target, 'face-reshape-data.json')), true);
    assert.notEqual(fs.readFileSync(path.join(target, 'face-reshape-data.json'), 'utf8'), 'old-db');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('包里带了视频时，恢复会用包内文件替换视频目录', () => {
  const source = tmp();
  const target = tmp();
  try {
    const data = db();
    const video = path.join(source, 'demo.mp4');
    fs.writeFileSync(video, 'from-bundle');
    data.videos = [{ id: 'v1', source: 'local', title: '课 1', localPath: video }];
    const keepDir = path.join(target, 'imported-videos');
    fs.mkdirSync(keepDir);
    fs.writeFileSync(path.join(keepDir, 'keep.mp4'), 'old-file');
    const bundle = B.decode(B.encode(B.createBundle(data, source, true)));
    assert.equal(bundle.files.some((f) => String(f.path).startsWith('imported-videos/')), true);
    const restored = B.restore(bundle, target);
    assert.equal(fs.existsSync(path.join(keepDir, 'keep.mp4')), false);
    assert.equal(fs.readFileSync(restored.data.videos[0].localPath, 'utf8'), 'from-bundle');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
