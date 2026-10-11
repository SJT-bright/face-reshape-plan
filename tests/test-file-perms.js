/* file-perms 测试：数据文件权限收紧到 0600（P8 隔离测试） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensurePrivatePerms } = require('../src/js/file-perms');

test('ensurePrivatePerms：把宽权限文件收紧到 0600 并以实际 mode 验证', { skip: process.platform === 'win32' && 'Windows 使用用户目录 ACL，不支持 POSIX 0600' }, () => {
  const p = path.join(os.tmpdir(), `face-reshape-perms-test-${process.pid}.json`);
  fs.writeFileSync(p, '{}', { mode: 0o644 });
  try {
    assert.equal(fs.statSync(p).mode & 0o777, 0o644, '前置：初始为 0644');
    assert.equal(ensurePrivatePerms(p), true);
    assert.equal(fs.statSync(p).mode & 0o777, 0o600, '收紧后应为 0600');
    /* 幂等：已 0600 再执行仍成功 */
    assert.equal(ensurePrivatePerms(p), true);
  } finally {
    fs.rmSync(p, { force: true });
  }
});

test('ensurePrivatePerms：文件不存在返回 false 且不抛异常', () => {
  assert.equal(ensurePrivatePerms(path.join(os.tmpdir(), `face-reshape-not-exist-${process.pid}`)), false);
});
