const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const makeStore = require('../src/js/secure-key');

test('启动与设置只读取密钥配置状态，不访问可能阻塞主进程的系统钥匙串', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-key-test-'));
  try {
    const store = makeStore(dir, { isEncryptionAvailable() { throw Error('Unexpected Keychain access'); } });
    assert.deepEqual(store.status(), { available: null, configured: false });
    assert.equal(store.read(), '');
    store.save('');
    fs.writeFileSync(path.join(dir, 'ai-key.enc'), 'encrypted-fixture');
    assert.deepEqual(store.status(), { available: null, configured: true });
    assert.throws(() => store.read(), /Unexpected Keychain/);
    store.save('');
    assert.equal(store.status().configured, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('实际保存仍要求系统加密可用，不把密钥降级成明文或破坏已有加密文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-key-test-'));
  try {
    const file = path.join(dir, 'ai-key.enc'); fs.writeFileSync(file, 'prior-ciphertext');
    const store = makeStore(dir, { isEncryptionAvailable: () => false });
    assert.throws(() => store.save('test-value'), /系统安全存储不可用/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'prior-ciphertext');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
