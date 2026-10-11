const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../src/js/photo-library');
const B = require('../src/js/portable-backup');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'face-photo-'));

test('resolvePhotoDir：隔离资料写 userData/skin-photos，日常写工程子文件夹皮肤照片', () => {
  assert.equal(P.resolvePhotoDir({ isolated: true, dataDir: '/tmp/profile', projectRoot: '/proj/面部重塑计划' }), path.join('/tmp/profile', 'skin-photos'));
  assert.equal(P.resolvePhotoDir({ isolated: false, dataDir: '/tmp/profile', projectRoot: '/proj/面部重塑计划' }), path.join('/proj/面部重塑计划', '皮肤照片'));
});

test('resolveMediaDir：皮肤 / 健身 / 跟练视频三分开', () => {
  const root = '/proj/面部重塑计划';
  assert.equal(P.resolveMediaDir({ isolated: false, dataDir: '/tmp/p', projectRoot: root, kind: 'skin' }), path.join(root, '皮肤照片'));
  assert.equal(P.resolveMediaDir({ isolated: false, dataDir: '/tmp/p', projectRoot: root, kind: 'body' }), path.join(root, '健身照片'));
  assert.equal(P.resolveMediaDir({ isolated: false, dataDir: '/tmp/p', projectRoot: root, kind: 'video' }), path.join(root, '跟练视频'));
  assert.equal(P.resolveMediaDir({ isolated: true, dataDir: '/tmp/p', projectRoot: root, kind: 'body' }), path.join('/tmp/p', 'body-photos'));
  assert.equal(P.resolveMediaDir({ isolated: true, dataDir: '/tmp/p', projectRoot: root, kind: 'video' }), path.join('/tmp/p', 'imported-videos'));
});

test('resolveProjectRoot：源码运行用工程根；打包后优先 Downloads 里的同名工程', () => {
  const downloads = dir();
  const project = path.join(downloads, '面部重塑计划');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'face-reshape-plan', productName: '面部重塑计划' }));
  try {
    assert.equal(P.resolveProjectRoot({ packaged: false, unpackagedRoot: '/src/面部重塑计划', downloadsPath: downloads, homePath: '/nope' }), '/src/面部重塑计划');
    assert.equal(P.resolveProjectRoot({ packaged: true, unpackagedRoot: '/Applications/app.asar', downloadsPath: downloads, homePath: '/nope' }), project);
  } finally { fs.rmSync(downloads, { recursive: true, force: true }); }
});

test('safePhotoName 拦截路径穿越，保留中文日期名', () => {
  assert.equal(P.safePhotoName('../evil.jpg'), 'evil.jpg');
  assert.equal(P.safePhotoName('..'), null);
  assert.equal(P.safePhotoName('.hidden.jpg'), null);
  assert.equal(P.safePhotoName('2026-09-20-皮肤.jpg'), '2026-09-20-皮肤.jpg');
  assert.equal(P.safePhotoName('p-1789900178762-7c9vgy.jpg'), 'p-1789900178762-7c9vgy.jpg');
  assert.equal(P.safePhotoName('note.txt'), null);
  assert.equal(P.safePhotoName('a b.png'), 'a-b.png');
});

test('suggestedName 按日期-类别-角度命名并避开已占用', () => {
  assert.equal(P.suggestedName({ date: '2026-09-20', kind: 'skin', angle: 'front', ext: 'jpg', used: [] }), '2026-09-20-皮肤-正面.jpg');
  assert.equal(P.suggestedName({ date: '2026-09-20', kind: 'body', ext: 'png', used: new Set(['2026-09-20-健身.png']) }), '2026-09-20-健身-2.png');
});

test('newFiles 跳过已登记文件，并从文件名猜日期/类别', () => {
  const d = dir();
  try {
    fs.writeFileSync(path.join(d, '2026-09-18-体型.jpg'), 'a');
    fs.writeFileSync(path.join(d, '2026-09-20-皮肤.jpg'), 'b');
    fs.writeFileSync(path.join(d, 'random.png'), 'c');
    const found = P.newFiles(d, ['2026-09-20-皮肤.jpg'], 'skin', '2026-09-21');
    assert.equal(found.length, 2);
    const body = found.find((x) => x.name === '2026-09-18-体型.jpg');
    const extra = found.find((x) => x.name === 'random.png');
    assert.equal(body.kind, 'body');
    assert.equal(P.guessKind('2026-09-18-健身.jpg'), 'body');
    assert.equal(body.date, '2026-09-18');
    assert.equal(extra.kind, 'skin');
    assert.equal(extra.date, '2026-09-21');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('copyLegacyPhotos 只复制尚未存在的安全图片', () => {
  const oldDir = dir(), neu = dir();
  try {
    fs.writeFileSync(path.join(oldDir, 'p-old.jpg'), 'legacy');
    fs.writeFileSync(path.join(oldDir, 'skip.txt'), 'no');
    fs.writeFileSync(path.join(neu, 'p-old.jpg'), 'keep');
    fs.writeFileSync(path.join(oldDir, 'fresh.png'), 'new');
    const r = P.copyLegacyPhotos(oldDir, neu);
    assert.equal(r.copied, 1);
    assert.equal(fs.readFileSync(path.join(neu, 'p-old.jpg'), 'utf8'), 'keep');
    assert.equal(fs.readFileSync(path.join(neu, 'fresh.png'), 'utf8'), 'new');
  } finally {
    fs.rmSync(oldDir, { recursive: true, force: true });
    fs.rmSync(neu, { recursive: true, force: true });
  }
});

test('备份可从外部照片目录打包，并支持中文文件名', () => {
  const source = dir(), project = dir(), target = dir();
  try {
    const photoDir = path.join(project, '皮肤照片');
    fs.mkdirSync(photoDir);
    fs.writeFileSync(path.join(photoDir, '2026-09-20-皮肤.jpg'), 'face');
    const db = { settings: {}, logs: { training: {} }, videos: [], skin: { photos: [{ id: 'p', file: '2026-09-20-皮肤.jpg', angle: 'front' }] } };
    const bundle = B.createBundle(db, source, false, { photoDir });
    assert.equal(bundle.files[0].path, 'skin-photos/2026-09-20-皮肤.jpg');
    const restored = B.restore(B.decode(B.encode(bundle)), target, { photoDir: path.join(target, '皮肤照片') });
    assert.equal(restored.data.skin.photos[0].file, '2026-09-20-皮肤.jpg');
    assert.equal(fs.readFileSync(path.join(target, '皮肤照片', '2026-09-20-皮肤.jpg'), 'utf8'), 'face');
    assert.equal(fs.existsSync(path.join(target, 'skin-photos')), false);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('本地视频复制进跟练视频文件夹，已在其中则不重复复制', () => {
  const srcDir = dir(), dest = path.join(dir(), '跟练视频');
  try {
    const src = path.join(srcDir, '课.mp4');
    fs.writeFileSync(src, 'video-bytes');
    const first = P.importVideoFile(src, dest);
    assert.equal(first.copied, true);
    assert.equal(fs.readFileSync(first.path, 'utf8'), 'video-bytes');
    assert.equal(path.basename(path.dirname(first.path)), '跟练视频');
    const again = P.importVideoFile(first.path, dest);
    assert.equal(again.copied, false);
    assert.equal(again.path, first.path);
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(dest), { recursive: true, force: true });
  }
});

test('备份把健身照片打进 body-photos，恢复写回健身照片文件夹', () => {
  const source = dir(), project = dir(), target = dir();
  try {
    const bodyDir = path.join(project, '健身照片');
    fs.mkdirSync(bodyDir);
    fs.writeFileSync(path.join(bodyDir, '2026-09-20-健身.jpg'), 'gym');
    const db = { settings: {}, logs: { training: {} }, videos: [], skin: { photos: [{ id: 'p', file: '2026-09-20-健身.jpg', kind: 'body' }] } };
    const bundle = B.createBundle(db, source, false, { bodyDir });
    assert.equal(bundle.files[0].path, 'body-photos/2026-09-20-健身.jpg');
    const restored = B.restore(B.decode(B.encode(bundle)), target, { bodyDir: path.join(target, '健身照片') });
    assert.equal(restored.data.skin.photos[0].kind, 'body');
    assert.equal(fs.readFileSync(path.join(target, '健身照片', '2026-09-20-健身.jpg'), 'utf8'), 'gym');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('外部照片目录恢复中断会滚回原图', () => {
  const source = dir(), target = dir();
  try {
    const photoDest = path.join(target, '皮肤照片');
    fs.mkdirSync(photoDest);
    fs.writeFileSync(path.join(photoDest, 'keep.jpg'), 'original');
    fs.writeFileSync(path.join(target, 'face-reshape-data.json'), 'original-db');
    const bundle = B.createBundle({ settings: {}, logs: { training: {} }, videos: [], skin: { photos: [] } }, source);
    assert.throws(() => B.restore(bundle, target, { photoDir: photoDest, failAfter: 'skin-photos' }), /Injected/);
    assert.equal(fs.readFileSync(path.join(target, 'face-reshape-data.json'), 'utf8'), 'original-db');
    assert.equal(fs.readFileSync(path.join(photoDest, 'keep.jpg'), 'utf8'), 'original');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('listVideoFiles 保留带空格的原名，不把课 1.mp4 改成课-1.mp4', () => {
  const d = dir();
  try {
    fs.writeFileSync(path.join(d, '课 1.mp4'), 'lesson');
    assert.deepEqual(P.listVideoFiles(d), ['课 1.mp4']);
    assert.equal(fs.existsSync(path.join(d, '课 1.mp4')), true);
    assert.equal(fs.existsSync(path.join(d, '课-1.mp4')), false);
    const again = P.importVideoFile(path.join(d, '课 1.mp4'), d);
    assert.equal(again.copied, false);
    assert.equal(again.path, path.resolve(d, '课 1.mp4'));
    assert.equal(fs.existsSync(path.join(d, '课-1.mp4')), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
