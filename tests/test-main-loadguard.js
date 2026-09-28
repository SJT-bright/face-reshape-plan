/* 主进程 loadData 守卫测试：畸形数据文件（数组/字符串/截断 JSON）必须走损坏隔离而不是带病运行。
   真实 main.js 依赖 electron 运行时——这里用 source 提取 + 注入桩的方式验证同一份代码。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

function extractLoadData() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
  const start = src.indexOf('function loadData()');
  const end = src.indexOf('\nfunction rendererData', start);
  assert.ok(start > 0 && end > start, 'main.js 里应能定位 loadData');
  return src.slice(start, end);
}

function runLoadData(profile, fileBody) {
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'face-reshape-data.json'), fileBody);
  const sandbox = {
    require: (name) => {
      if (name === 'node:fs') return fs;
      if (name === 'node:path') return path;
      /* PortableBackup.recover：测试里不需要真恢复，空实现 */
      return { recover: () => {} };
    },
    fs, path, /* main.js 模块作用域里的 fs/path 闭包变量 */
    PortableBackup: { recover: () => {} }, /* loadData 引用的模块级常量 */
    db: null,
    dataDir: () => profile,
    dataFile: () => path.join(profile, 'face-reshape-data.json'),
    defaultData: () => ({ version: 1, settings: { dailyTargetMinutes: 15 }, logs: { training: {}, skincare: {} }, videos: [], sessions: [], skincare: { cycles: [] }, reminderState: {} }),
    saveData: () => true,
    keys: () => ({ migrate: () => false }),
    isBackupFileName: () => false,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractLoadData() + '\nthis.__db = loadData();', sandbox);
  return sandbox.__db;
}

test('畸形数据文件（数组）走损坏隔离并重建默认库', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'p11-array-'));
  try {
    const db = runLoadData(profile, '[1,2,3]');
    assert.ok(db && typeof db === 'object' && !Array.isArray(db), '重建后应为 plain object');
    assert.ok(db.settings && db.logs, '重建后应有默认结构');
    /* 原文件应被隔离改名，而不是被覆盖 */
    const kept = fs.readdirSync(profile).filter((n) => n.startsWith('face-reshape-data.json.corrupt-'));
    assert.equal(kept.length, 1, '损坏文件应保留 .corrupt- 副本供抢救');
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('字符串内容同样隔离；正常对象不受影响', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'p11-str-'));
  try {
    const db = runLoadData(profile, '"just a string"');
    assert.ok(db.settings, '字符串文件也应重建默认库');
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
  const profile2 = fs.mkdtempSync(path.join(os.tmpdir(), 'p11-ok-'));
  try {
    const db = runLoadData(profile2, JSON.stringify({ version: 1, settings: { dailyTargetMinutes: 20 }, logs: { training: { '2026-09-21': { seconds: 900, entries: [] } } }, videos: [], sessions: [] }));
    assert.equal(db.settings.dailyTargetMinutes, 20, '正常文件原样加载');
    assert.equal(db.logs.training['2026-09-21'].seconds, 900);
    assert.equal(fs.readdirSync(profile2).filter((n) => n.includes('.corrupt-')).length, 0, '正常文件不应被隔离');
  } finally { fs.rmSync(profile2, { recursive: true, force: true }); }
});
