/* 应用改名回归：运行真实 main.js 启动配置与资料加载，使用内存 Electron/文件系统替身。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const { resolveAppPath } = require('../scripts/deploy-app-asar');

function boot({ initialName = '人生重塑计划', userData, env = {} } = {}) {
  const appData = path.join(os.tmpdir(), 'life-identity-memory', 'Application Support');
  const paths = { appData, userData: userData || path.join(appData, initialName) };
  const made = [];
  const browserUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0';
  let userAgentOverride;
  const sandbox = {
    path,
    process: { env },
    fs: { mkdirSync: value => made.push(value) },
    app: {
      getName: () => initialName,
      setName: value => { initialName = value; },
      get userAgentFallback() { return userAgentOverride || `${browserUserAgent} ${initialName}/1.6.0 Safari/537.36`; },
      set userAgentFallback(value) { userAgentOverride = value; },
      getPath: key => paths[key],
      setPath: (key, value) => { paths[key] = value; }
    },
    dataDir: () => paths.userData
  };
  vm.createContext(sandbox);
  const start = source.indexOf('const APP_NAME =');
  const end = source.indexOf('\nconst isMac', start);
  assert.ok(start > 0 && end > start, '应能定位主进程启动配置');
  vm.runInContext(source.slice(start, end), sandbox);
  const isolatedStart = source.indexOf('function isolatedProfile()');
  const isolatedEnd = source.indexOf('\nfunction projectRoot()', isolatedStart);
  vm.runInContext(source.slice(isolatedStart, isolatedEnd), sandbox);
  return { sandbox, appData, paths, made, browserUserAgent };
}

test('新旧应用名称均读取同一旧资料目录，Chromium 草稿目录同样固定', () => {
  for (const initialName of ['面部重塑计划', '人生重塑计划']) {
    const { sandbox, appData, paths } = boot({ initialName });
    const legacy = path.join(appData, '面部重塑计划');
    assert.equal(sandbox.app.getName(), '人生重塑计划');
    assert.equal(paths.userData, legacy);
    assert.equal(paths.sessionData, legacy);
    assert.equal(sandbox.isolatedProfile(), false, '正式资料仍使用原工程媒体位置');
  }
});

test('FACE_RESHAPE_PROFILE 优先，并保留既有测试工具的 app.setPath 隔离路径', () => {
  const explicit = path.join(os.tmpdir(), 'life-test-explicit-profile');
  const overridden = boot({ userData: explicit });
  assert.equal(overridden.paths.userData, explicit);
  assert.equal(overridden.paths.sessionData, explicit);
  assert.equal(overridden.sandbox.isolatedProfile(), true);
  const environment = path.join(os.tmpdir(), 'life-test-env-profile');
  const selected = boot({ userData: explicit, env: { FACE_RESHAPE_PROFILE: environment } });
  assert.equal(selected.paths.userData, environment);
  assert.equal(selected.paths.sessionData, environment);
  assert.equal(selected.paths.cache, path.join(environment, 'cache'));
  assert.equal(selected.sandbox.isolatedProfile(), true);
  assert.equal(boot({ env: { FACE_UX20_TEST: '1' } }).sandbox.isolatedProfile(), true);
});

test('中文显示名保持不变，HTTP User-Agent 应用产品名使用 ASCII 且保留平台与 Chromium 字段', () => {
  const { sandbox, browserUserAgent } = boot();
  const userAgent = sandbox.app.userAgentFallback;
  assert.equal(sandbox.app.getName(), '人生重塑计划');
  assert.equal(userAgent, `${browserUserAgent} LifeReshapePlan/1.6.0 Safari/537.36`);
  assert.match(userAgent, /^[\x20-\x7e]+$/);
  assert.doesNotThrow(() => new Request('https://fixture.test/', { headers: { 'User-Agent': userAgent } }));
});

test('改名后继续加载旧 JSON，原视频、护理和未结束训练均保留', () => {
  const { sandbox, paths } = boot();
  const legacy = {
    version: 1,
    settings: { dailyTargetMinutes: 20 },
    videos: [{ id: 'existing', title: '原有视频', path: '/fixture/跟练视频/original.mp4' }],
    sessions: [{ id: 'existing-plan', videoId: 'existing' }],
    logs: { training: { '2026-10-02': { seconds: 600, entries: [] } }, skincare: { '2026-10-02': ['洗脸'] } },
    activeFollow: { videoId: 'existing', seconds: 719, running: false },
    videoCollections: [{ id: 'custom', name: '个人收藏', periods: ['evening'] }]
  };
  let writes = 0;
  sandbox.fs.readFileSync = file => {
    assert.equal(file, path.join(paths.userData, 'face-reshape-data.json'));
    return JSON.stringify(legacy);
  };
  sandbox.PortableBackup = { recover: dir => assert.equal(dir, paths.userData) };
  sandbox.db = null;
  sandbox.saveData = () => { writes++; return true; };
  sandbox.keys = () => ({ migrate: () => false });
  const start = source.indexOf('function dataFile()');
  const end = source.indexOf('\nfunction rendererData()', start);
  vm.runInContext(source.slice(start, end) + '\nloadData();', sandbox);
  const loaded = JSON.parse(JSON.stringify(sandbox.db));
  assert.deepEqual(loaded.videos, legacy.videos);
  assert.deepEqual(loaded.sessions, legacy.sessions);
  assert.deepEqual(loaded.logs.training, legacy.logs.training);
  assert.deepEqual(loaded.logs.skincare, legacy.logs.skincare);
  assert.deepEqual(loaded.activeFollow, legacy.activeFollow);
  assert.deepEqual(loaded.videoCollections, legacy.videoCollections);
  assert.deepEqual(loaded.logs.videoWatching, {});
  assert.equal(loaded.settings.dailyTargetMinutes, 20);
  assert.equal(loaded.settings.videoMode, 'face');
  assert.equal(writes, 0, '正常读取不重写旧库');
});

test('部署与重打包选择新名称，并兼容旧应用及显式路径', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'life-app-identity-'));
  try {
    const current = path.join(base, '人生重塑计划.app');
    const legacy = path.join(base, '面部重塑计划.app');
    assert.equal(resolveAppPath(base), current);
    fs.mkdirSync(legacy);
    assert.equal(resolveAppPath(base), legacy);
    fs.mkdirSync(current);
    assert.equal(resolveAppPath(base), current);
    assert.equal(resolveAppPath(base, legacy), legacy);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('打包显示名统一更新，稳定应用标识与旧可执行文件保持兼容', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.productName, '人生重塑计划');
  assert.equal(pkg.build.productName, '人生重塑计划');
  assert.equal(pkg.build.appId, 'com.faceshape.plan');
  const calls = [];
  const module = { exports: {} };
  const sandbox = {
    __dirname: path.join(__dirname, '..', 'scripts'),
    process: { argv: [] },
    module,
    require: name => {
      if (name === 'node:child_process') return { execFileSync: (...args) => calls.push(args) };
      if (name === 'node:fs') return fs;
      if (name === 'node:path') return path;
      if (name === '../package.json') return pkg;
      return {};
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-app-asar.js'), 'utf8'), sandbox);
  module.exports.syncDisplayName('/fixture/面部重塑计划.app');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(args => String(args[1][1])), [
    'Set :CFBundleName 人生重塑计划',
    'Set :CFBundleDisplayName 人生重塑计划'
  ]);
  assert.ok(calls.every(args => !String(args).includes('CFBundleExecutable')));
});
