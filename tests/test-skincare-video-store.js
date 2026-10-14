'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/js/skincare-video-store');

const STARTED = new Date('2026-10-12T16:20:03+08:00');
const BASE = '护肤-20261012-162003.webm';

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skincare-video-'));
}

function readAt(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

test('文件名用上海时区的开始时刻，不用调用方字符串', () => {
  assert.equal(STARTED.toISOString(), '2026-10-12T08:20:03.000Z');
  assert.equal(store.videoFileName(STARTED), BASE);
  assert.equal(store.videoFileName(STARTED.getTime()), BASE);
  assert.equal(store.videoFileName('2026-10-12T16:20:03+08:00'), BASE);
  const fallback = store.videoFileName('护肤-19990101-000000.webm');
  assert.match(fallback, /^护肤-\d{8}-\d{6}\.webm$/);
  assert.notEqual(fallback, '护肤-19990101-000000.webm');
});

test('撞名从 -2 递增，最多到 -99', () => {
  assert.equal(store.videoFileName(STARTED, [BASE]), '护肤-20261012-162003-2.webm');
  assert.equal(
    store.videoFileName(STARTED, new Set([BASE, '护肤-20261012-162003-2.webm'])),
    '护肤-20261012-162003-3.webm'
  );
  const used = [BASE];
  for (let suffix = 2; suffix <= 99; suffix += 1) used.push(`护肤-20261012-162003-${suffix}.webm`);
  assert.equal(store.videoFileName(STARTED, used.slice(0, -1)), '护肤-20261012-162003-99.webm');
  assert.equal(store.videoFileName(STARTED, used), null);

  const root = makeDir();
  try {
    const dir = path.join(root, 'clips');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, BASE), 'keep', { mode: 0o644 });
    const created = store.createFile(dir, STARTED);
    assert.deepEqual(created, { file: '护肤-20261012-162003-2.webm' });
    assert.equal(fs.readFileSync(path.join(dir, BASE), 'utf8'), 'keep');
    assert.equal(path.basename(created.file), created.file);
    const blocker = path.join(root, 'not-dir');
    fs.writeFileSync(blocker, 'x');
    assert.equal(store.createFile(blocker, STARTED), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('create、两段 append、finish 后字节一致且 mode 为 0600', () => {
  const root = makeDir();
  try {
    const dir = path.join(root, 'a', 'b');
    const created = store.createFile(dir, STARTED);
    assert.deepEqual(created, { file: BASE });
    const full = path.join(dir, created.file);
    if (process.platform !== 'win32') assert.equal(fs.statSync(full).mode & 0o777, 0o600);
    assert.equal(store.appendChunk(dir, created.file, 'nope'), null);
    assert.equal(fs.statSync(full).size, 0);

    const first = Buffer.from('AB');
    const second = Uint8Array.from([1, 2, 3, 4]).subarray(1, 3);
    assert.deepEqual(store.appendChunk(dir, created.file, first), { file: BASE, bytes: 2 });
    assert.deepEqual(store.appendChunk(dir, created.file, new Uint8Array()), { file: BASE, bytes: 2 });
    if (process.platform !== 'win32') fs.chmodSync(full, 0o644);
    assert.deepEqual(store.appendChunk(dir, created.file, second), { file: BASE, bytes: 4 });
    if (process.platform !== 'win32') assert.equal(fs.statSync(full).mode & 0o777, 0o600);

    if (process.platform !== 'win32') fs.chmodSync(full, 0o644);
    const finished = store.finishFile(dir, created.file);
    assert.deepEqual(finished, { file: BASE, bytes: 4 });
    assert.deepEqual(fs.readFileSync(full), Buffer.concat([first, Buffer.from(second)]));
    if (process.platform !== 'win32') assert.equal(fs.statSync(full).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('../、绝对路径、错误后缀和符号链接被拒绝，且不写出目录外', () => {
  const parent = makeDir();
  try {
    const dir = path.join(parent, 'clips');
    fs.mkdirSync(dir);
    const created = store.createFile(dir, STARTED);
    assert.equal(created.file, BASE);
    const payload = Buffer.from('leak');
    const outsideName = '护肤-20261012-162099.webm';
    const attacks = [
      `../${outsideName}`,
      `..\\${outsideName}`,
      path.join('..', outsideName),
      path.join(parent, outsideName),
      path.resolve(parent, outsideName),
      '护肤.txt',
      '护肤-20261012-162003.webm.txt',
      '护肤-20261012-162003.WEBM',
      '',
      null,
      `护肤-20261012-162003.webm/../../${outsideName}`,
    ];
    for (const name of attacks) {
      assert.equal(store.appendChunk(dir, name, payload), null, `append ${name}`);
      assert.equal(store.finishFile(dir, name), null, `finish ${name}`);
    }
    assert.equal(store.appendChunk(dir, '护肤-20261012-162004.webm', payload), null);
    assert.equal(store.finishFile(dir, '护肤-20261012-162004.webm'), null);
    assert.equal(fs.existsSync(path.join(dir, '护肤-20261012-162004.webm')), false);
    assert.equal(fs.existsSync(path.join(parent, outsideName)), false);
    assert.equal(fs.existsSync(path.join(dir, '护肤.txt')), false);
    assert.deepEqual(fs.readdirSync(parent).sort(), ['clips']);
    assert.deepEqual(fs.readdirSync(dir), [BASE]);

    const secret = path.join(parent, 'secret.webm');
    fs.writeFileSync(secret, 'SECRET', { mode: 0o644 });
    const linkName = '护肤-20200101-000000.webm';
    fs.symlinkSync(secret, path.join(dir, linkName));
    assert.equal(store.appendChunk(dir, linkName, payload), null);
    assert.equal(store.finishFile(dir, linkName), null);
    assert.equal(fs.readFileSync(secret, 'utf8'), 'SECRET');
    if (process.platform !== 'win32') assert.equal(fs.statSync(secret).mode & 0o777, 0o644);
    assert.equal(fs.lstatSync(path.join(dir, linkName)).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(parent, outsideName)), false);
    assert.deepEqual(fs.readdirSync(parent).sort(), ['clips', 'secret.webm']);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('目录不存在或为空时 listFiles 为 []', () => {
  const dir = makeDir();
  try {
    assert.deepEqual(store.listFiles(dir), []);
    assert.deepEqual(store.listFiles(path.join(dir, 'missing')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listFiles 只列出普通录像，mtime 新的在前', () => {
  const dir = makeDir();
  try {
    const older = store.createFile(dir, STARTED);
    const newer = store.createFile(dir, new Date('2026-10-12T17:00:00+08:00'));
    fs.utimesSync(path.join(dir, older.file), new Date(1_000_000), new Date(1_000_000));
    fs.utimesSync(path.join(dir, newer.file), new Date(2_000_000), new Date(2_000_000));
    fs.writeFileSync(path.join(dir, 'ignore.txt'), 'x');
    fs.mkdirSync(path.join(dir, '护肤-20200202-000000.webm'));
    fs.symlinkSync(path.join(dir, older.file), path.join(dir, '护肤-20200101-000000.webm'));
    const listed = store.listFiles(dir);
    assert.deepEqual(listed.map((item) => item.file), [newer.file, older.file]);
    assert.deepEqual(Object.keys(listed[0]).sort(), ['bytes', 'file', 'mtimeMs']);
    assert.equal(listed[0].bytes, 0);
    assert.equal(listed[0].mtimeMs, 2_000_000);
    assert.equal(listed[1].mtimeMs, 1_000_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('追加后超过 2GB 的块被拒绝，恰好到达上限可以写入', () => {
  assert.equal(store.MAX_BYTES, 2 * 1024 * 1024 * 1024);
  const dir = makeDir();
  try {
    const created = store.createFile(dir, STARTED);
    const full = path.join(dir, created.file);
    assert.deepEqual(store.appendChunk(dir, created.file, Buffer.from('hi')), { file: BASE, bytes: 2 });
    fs.truncateSync(full, store.MAX_BYTES - 1);
    assert.deepEqual(store.appendChunk(dir, created.file, Buffer.alloc(0)), { file: BASE, bytes: store.MAX_BYTES - 1 });
    assert.equal(store.appendChunk(dir, created.file, Buffer.from('YZ')), null);
    assert.equal(fs.statSync(full).size, store.MAX_BYTES - 1);
    assert.equal(readAt(full, 0, 2).toString(), 'hi');
    assert.deepEqual(store.appendChunk(dir, created.file, Buffer.from('Z')), { file: BASE, bytes: store.MAX_BYTES });
    assert.equal(store.appendChunk(dir, created.file, Buffer.from('Y')), null);
    assert.equal(fs.statSync(full).size, store.MAX_BYTES);
    assert.equal(readAt(full, 0, 2).toString(), 'hi');
    if (process.platform !== 'win32') assert.equal(fs.statSync(full).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
