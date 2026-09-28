/* AI 识图流程测试（全 mock，零真实网络/照片/密钥）：
   stub 浏览器全局后 require 真实 skincare.js，调用真实的 _aiAnalyze / _applyAiResult。
   覆盖：无照片 / 无密钥 / 旧照取消 / 旧照确认成功 / 并发去重 / 压缩失败 / IPC 失败 / finally 恢复 / 填充计数。
   stub 密钥为随机串，仅用于走「已配置」分支，不是任何真实凭据。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const STUB_KEY = process.env.STUB_AI_KEY || `stub-${Math.random().toString(36).slice(2)}`;

/* ---------- 环境全局 stub（只提供浏览器环境，不含任何被测逻辑） ---------- */
const TODAY = '2026-09-14';
const toasts = [];
const registry = new Map(); // 选择器 → stub 元素
const calls = { analyze: 0, read: 0 };

function el(overrides = {}) {
  return Object.assign({
    disabled: false, textContent: '', value: '', dataset: {}, src: '', alt: '', title: '',
    classList: { toggle() {}, add() {}, remove() {} },
    removeAttribute(name) { delete this[name]; },
    querySelector(sel) { return registry.has(sel) ? registry.get(sel) : el(); },
    querySelectorAll() { return []; }
  }, overrides);
}

global.todayKey = () => TODAY;
global.uid = (prefix) => (prefix || 'id') + '_test';
global.toast = (msg) => toasts.push(msg);
let confirmResult = true;
let confirmCalls = [];
global.confirmModal = async (title, body, okText) => { confirmCalls.push({ title, body, okText }); return confirmResult; };
global.openModal = () => el(); // 设置弹窗壳
global.closeModal = () => {};
global.App = { currentView: 'skincare', render() {} };
global.SkinEngine = require('../src/js/skin-engine');
global.$ = (sel, scope) => (scope ? scope.querySelector(sel) : registry.has(sel) ? registry.get(sel) : null);
global.$$ = (sel, scope) => (scope && scope.querySelectorAll ? scope.querySelectorAll(sel) : []);
global.Store = {
  db: {
    skin: { logs: {}, photos: [], predictions: {}, stats: { seen: 0, hit: 0 } },
    rhythm: { sleeps: [], meals: [] },
    settings: { aiApiKey: STUB_KEY, aiModel: 'glm-4v-flash' }
  },
  settings() { return this.db.settings; },
  save() {}
};
let analyzeResult = { ok: true, data: {} };
global.native = {
  analyzeSkinPhoto: async () => { calls.analyze++; return analyzeResult; },
  readSkinPhoto: async () => { calls.read++; return 'c3R1Yg=='; },
  saveSkinPhoto: async () => 'p-mock.jpg'
};
/* 假 canvas（成功压缩路径用）与假 Image：imageMode 控制走 onload 还是 onerror */
let imageMode = 'load';
global.document = {
  createElement() {
    return {
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => 'data:image/jpeg;base64,c3R1Yg=='
    };
  }
};
global.Image = class {
  set src(_) {
    /* microtask 触发：与 await 链同一队列，测试断言时序确定（macrotask 会晚于断言） */
    Promise.resolve().then(() => {
      if (imageMode === 'error') { this.onerror(new Error('decode fail')); return; }
      this.width = 800; this.height = 600;
      this.onload();
    });
  }
};

const Skincare = require('../src/js/skincare');

function reset({ photos = [], withKey = true, confirm = true, result = { ok: true, data: {} }, img = 'load' } = {}) {
  toasts.length = 0;
  confirmCalls.length = 0;
  calls.analyze = 0; calls.read = 0;
  confirmResult = confirm;
  analyzeResult = result;
  imageMode = img;
  Store.db.skin.photos = photos;
  Store.db.settings.aiApiKey = withKey ? STUB_KEY : '';
  registry.clear();
  registry.set('#sk-ai-fill', el());
  registry.set('#view-root', el({
    querySelector(sel) { return registry.has(sel) ? registry.get(sel) : null; },
    querySelectorAll() { return []; }
  }));
  for (const p of ['eyes', 'pores', 'spots', 'redness', 'oil', 'dry', 'barrier', 'overall']) {
    registry.set(`.sk-seg[data-param="${p}"]`, el());
  }
  registry.set('#sk-acne-total', el());
  registry.set('#sk-acne-new', el());
  registry.set('#sk-skin-note', el());
}

const AI_BTN_TEXT_LOADING = '🤖 分析中…';

test('无照片：提示且不发请求，锁释放、按钮未被置为分析中', async () => {
  reset({ photos: [] });
  await Skincare._aiAnalyze();
  assert.equal(calls.analyze, 0);
  assert.ok(toasts.some((m) => m.includes('先拍/传一张照片')));
  const btn = registry.get('#sk-ai-fill');
  assert.equal(Skincare._aiBusy || false, false);
  assert.equal(btn.disabled, false);
  assert.notEqual(btn.textContent, AI_BTN_TEXT_LOADING);
});

test('无密钥：弹设置、不发请求，按钮不显示「分析中」', async () => {
  reset({ photos: [{ id: 'p1', date: TODAY, kind: 'skin', file: 'a.jpg' }], withKey: false });
  await Skincare._aiAnalyze();
  assert.equal(calls.analyze, 0);
  const btn = registry.get('#sk-ai-fill');
  assert.equal(Skincare._aiBusy || false, false);
  assert.notEqual(btn.textContent, AI_BTN_TEXT_LOADING);
});

test('旧照片取消：确认弹窗拒绝 → 0 次请求，锁释放；弹窗显示完整日期（含年份）', async () => {
  reset({ photos: [{ id: 'p1', date: '2026-09-10', kind: 'skin', file: 'old.jpg' }], confirm: false });
  await Skincare._aiAnalyze();
  assert.equal(calls.analyze, 0);
  assert.equal(calls.read, 0);
  assert.ok(toasts.some((m) => m.includes('已取消')));
  /* P-A：确认弹窗正文显示完整 YYYY-MM-DD，避免跨年歧义 */
  assert.equal(confirmCalls.length, 1);
  assert.ok(confirmCalls[0].body.includes('2026-09-10'), `弹窗正文应含完整日期，实际：${confirmCalls[0].body}`);
  assert.ok(!confirmCalls[0].body.includes('最近一张是 09-10'), '不得只显示月日');
  const btn = registry.get('#sk-ai-fill');
  assert.equal(Skincare._aiBusy || false, false);
  assert.equal(btn.disabled, false);
  assert.notEqual(btn.textContent, AI_BTN_TEXT_LOADING);
});

test('并发去重：首次进行中时二次调用直接返回，请求恰好 1 次，完成后锁释放', async () => {
  reset({ photos: [{ id: 'p1', date: TODAY, kind: 'skin', file: 't.jpg' }] });
  let release;
  const gate = new Promise((r) => { release = r; });
  const origNative = global.native.analyzeSkinPhoto;
  global.native.analyzeSkinPhoto = async () => { calls.analyze++; await gate; return { ok: true, data: {} }; };
  const first = Skincare._aiAnalyze();
  const second = Skincare._aiAnalyze(); // in-flight：应立即 return，不计请求
  await second;
  await new Promise((r) => setImmediate(r)); // 跨 macrotask 边界：等 first 推进到 IPC 挂起点
  assert.equal(calls.analyze, 1);
  try {
    release();
    await first;
    assert.equal(calls.analyze, 1);
    assert.equal(Skincare._aiBusy || false, false);
  } finally {
    global.native.analyzeSkinPhoto = origNative; // 用例失败也要恢复 stub，避免污染后续用例
  }
});

test('压缩失败：Image onerror → 明确错误提示，0 次请求，finally 恢复按钮', async () => {
  reset({ photos: [{ id: 'p1', date: TODAY, kind: 'skin', file: 't.jpg' }], img: 'error' });
  await Skincare._aiAnalyze();
  assert.equal(calls.analyze, 0);
  assert.ok(toasts.some((m) => m.includes('AI 识图失败') && m.includes('照片解码失败')));
  const btn = registry.get('#sk-ai-fill');
  assert.equal(Skincare._aiBusy || false, false);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, '🤖 AI 识图');
});

test('IPC 失败：接口返回 ok:false → 错误透传提示，finally 恢复', async () => {
  reset({ photos: [{ id: 'p1', date: TODAY, kind: 'skin', file: 't.jpg' }], result: { ok: false, error: '接口异常（HTTP 429）' } });
  await Skincare._aiAnalyze();
  assert.equal(calls.analyze, 1);
  assert.ok(toasts.some((m) => m.includes('AI 识图失败') && m.includes('HTTP 429')));
  const btn = registry.get('#sk-ai-fill');
  assert.equal(Skincare._aiBusy || false, false);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, '🤖 AI 识图');
});

test('成功路径：请求 1 次、文案时序正确（确认后才进入分析中）、结束后恢复', async () => {
  reset({ photos: [{ id: 'p1', date: TODAY, kind: 'skin', file: 't.jpg' }] });
  let seenLoadingDuringRun = false;
  const origNative = global.native.analyzeSkinPhoto;
  global.native.analyzeSkinPhoto = async () => {
    calls.analyze++;
    seenLoadingDuringRun = registry.get('#sk-ai-fill').textContent === AI_BTN_TEXT_LOADING;
    return { ok: true, data: { advice: '多喝水' } };
  };
  await Skincare._aiAnalyze();
  assert.equal(calls.analyze, 1);
  assert.equal(seenLoadingDuringRun, true, '上传阶段按钮应显示分析中');
  const btn = registry.get('#sk-ai-fill');
  assert.equal(btn.textContent, '🤖 AI 识图');
  assert.equal(btn.disabled, false);
  assert.ok(toasts.some((m) => m.includes('AI 已填入 0/9 项')));
  assert.ok(toasts.some((m) => m.includes('多喝水')));
  global.native.analyzeSkinPhoto = origNative;
});

test('填充计数：整数串入表、小数拒绝、计数准确、摘要写备注', async () => {
  reset({});
  await Skincare._applyAiResult({ pores: '2', oil: 2.5, acneTotal: 3, overall: '8', summary: '测试摘要', advice: '建议X' });
  assert.ok(toasts.some((m) => m.includes('AI 已填入 3/9 项') && m.includes('1 项无效已跳过')));
  assert.equal(registry.get('#sk-acne-total').value, 3);
  assert.ok(registry.get('#sk-skin-note').value.includes('[AI识图] 测试摘要'));
  /* 越界整数同样拒绝 */
  toasts.length = 0;
  await Skincare._applyAiResult({ pores: 9 });
  assert.ok(toasts.some((m) => m.includes('AI 已填入 0/9 项') && m.includes('1 项无效已跳过')));
});

test('面部状态三字段先预填，人工保存前不写正式记录', async () => {
  reset({});
  await Skincare._applyAiResult({ fullness: 2, puffiness: '3', definition: 1, oil: 99, summary: '面' }, '2026-09-10');
  assert.equal(SkinEngine.latestFaceState(Store.db, '2026-09-10',14),null);
  assert.equal(Skincare.pendingAi.data.fullness,2);
  assert.equal(Skincare.pendingAi.photoDate,'2026-09-10');
});

test('同一 img 连续 正常→缺失→正常：src/alt/title/missing 状态完整重置', async () => {
  reset({});
  const img = el(); img.alt = '2026-09-10'; img.dataset = { photoFile: 'a.jpg' };
  const root = registry.get('#view-root');
  root.querySelectorAll = () => [img];
  const origRead = global.native.readSkinPhoto;
  global.native.readSkinPhoto = async () => 'c3R1Yg==';
  await Skincare._loadPhotoImgs(root);
  assert.ok(img.src.includes('c3R1Yg=='));
  assert.equal(img.alt, '2026-09-10');
  assert.ok(!('title' in img));
  /* 切缺失：旧 src 清掉、title 给准确原因、missing 标记 */
  img.dataset.photoFile = 'gone.jpg';
  global.native.readSkinPhoto = async () => null;
  await Skincare._loadPhotoImgs(root);
  assert.ok(!img.src, '切到缺失文件应清掉旧 src，不得旧图冒充');
  assert.equal(img.dataset.missing, '1');
  assert.ok(img.title.includes('照片无法读取'), `title 应含准确文案，实际：${img.title}`);
  /* 再切正常：新图显示、missing/title 清除、alt 不被失败文案污染 */
  img.dataset.photoFile = 'b.jpg';
  global.native.readSkinPhoto = async () => 'ZGF0YUM=';
  await Skincare._loadPhotoImgs(root);
  assert.ok(img.src.includes('ZGF0YUM='), '恢复正常后应显示新图');
  assert.ok(!('missing' in img.dataset), 'data-missing 应被清除');
  assert.ok(!('title' in img), '失败原因 title 应被清除');
  assert.equal(img.alt, '2026-09-10', 'alt 语义应保持日期，不被污染');
  global.native.readSkinPhoto = origRead;
});

test('读取异常（IPC reject）与 null 同样按无法读取处理', async () => {
  reset({});
  const img = el(); img.dataset = { photoFile: 'x.jpg' };
  const root = registry.get('#view-root');
  root.querySelectorAll = () => [img];
  const origRead = global.native.readSkinPhoto;
  global.native.readSkinPhoto = async () => { throw new Error('ipc broken'); };
  const missing = await Skincare._loadPhotoImgs(root);
  assert.equal(missing, 1);
  assert.equal(img.dataset.missing, '1');
  assert.ok(img.title.includes('权限异常'));
  assert.ok(!img.src);
  global.native.readSkinPhoto = origRead;
});

test('逆序响应：慢的旧文件响应不得覆盖新文件', async () => {
  reset({});
  const img = el(); img.alt = '旧'; img.dataset = { photoFile: 'B.jpg' };
  const root = registry.get('#view-root');
  root.querySelectorAll = () => [img];
  const origRead = global.native.readSkinPhoto;
  let releaseB;
  const gate = new Promise((r) => { releaseB = r; });
  global.native.readSkinPhoto = async (file) => {
    if (file === 'B.jpg') { await gate; return 'ZGF0YUI='; } // 慢
    return 'ZGF0YUM='; // 快
  };
  const p1 = Skincare._loadPhotoImgs(root); // 发起读 B（慢）
  img.dataset.photoFile = 'C.jpg';          // 用户切到 C
  const p2 = Skincare._loadPhotoImgs(root); // 发起读 C（快）
  await p2;
  assert.ok(img.src.includes('ZGF0YUM='), '应显示 C');
  releaseB();
  await p1;
  assert.ok(img.src.includes('ZGF0YUM='), '慢的 B 响应不得覆盖 C');
  assert.ok(!('missing' in img.dataset));
  global.native.readSkinPhoto = origRead;
});

test('P6：迟到的睡眠与皮肤资料重新计算，删除来源恢复缺项', async () => {
  reset({}); Store.db.rhythm={sleeps:[],meals:[]};
  Skincare._ensureTodayPrediction(); assert.equal(Store.db.skin.predictions[TODAY].overallDir,null);
  Store.db.rhythm.sleeps=[{start:'2026-09-14T01:30:00+08:00',end:'2026-09-14T06:30:00+08:00',startLocal:'2026-09-14T01:30',endLocal:'2026-09-14T06:30',kind:'main'}];
  Skincare._ensureTodayPrediction();assert.equal(Store.db.skin.predictions[TODAY].status,'partial');
  Store.db.skin.logs['2026-09-13']={redness:0};Skincare._ensureTodayPrediction();assert.equal(Store.db.skin.predictions[TODAY].overallDir,'down');
  Store.db.rhythm.sleeps=[];Skincare._ensureTodayPrediction();assert.equal(Store.db.skin.predictions[TODAY].overallDir,null);
});

test('P9：照片按日期倒序，回填历史日期生效、未来日期拒绝', async () => {
  reset({});
  Store.db.skin.photos = [
    { id: 'p1', date: '2026-09-12', kind: 'skin', file: 'a.jpg', createdAt: '2026-09-12T08:00:00Z' },
    { id: 'p2', date: '2026-09-14', kind: 'skin', file: 'b.jpg', createdAt: '2026-09-14T08:00:00Z' },
    { id: 'p3', date: '2026-09-13', kind: 'skin', file: 'c.jpg', createdAt: '2026-09-13T08:00:00Z' }
  ];
  /* 列表日期倒序（添加顺序无关） */
  assert.deepEqual(Skincare._photoList('skin').map((p) => p.id), ['p2', 'p3', 'p1']);
  /* 回填历史日期：照片记录为所选日期 */
  registry.set('#sk-photo-date', { value: '2026-09-11' });
  registry.set('#sk-photo-weight', { value: '' });
  const fakeFile = { type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  await Skincare._addPhotoFiles([fakeFile]);
  const added = Store.db.skin.photos.find((p) => p.file === 'p-mock.jpg');
  assert.ok(added, '应入库');
  assert.equal(added.date, '2026-09-11');
  /* 未来日期拒绝：回落到今天 */
  registry.get('#sk-photo-date').value = '2026-09-20';
  await Skincare._addPhotoFiles([fakeFile]);
  const addedAll = Store.db.skin.photos.filter((p) => p.file === 'p-mock.jpg');
  assert.equal(addedAll.length, 2);
  assert.equal(addedAll[1].date, TODAY);
  assert.ok(toasts.some((m) => m.includes('拍摄日期无效')));
});

test('UX-18 页面换代后迟到的 AI 结果不进入新表单', async () => {
  reset({ photos: [{id:'stale-photo',date:TODAY,kind:'skin',file:'synthetic.jpg'}] });
  App.currentView='skincare';App._uxRenderEpoch=1;
  let release;const gate=new Promise(resolve=>{release=resolve;});const original=global.native.analyzeSkinPhoto;
  global.native.analyzeSkinPhoto=async()=>{calls.analyze++;await gate;return {ok:true,data:{acneTotal:9,summary:'不应填入的新页面'}};};
  try{const work=Skincare._aiAnalyze();await new Promise(resolve=>setImmediate(resolve));App._uxRenderEpoch=2;release();await work;
    assert.equal(registry.get('#sk-acne-total').value,'');assert.ok(toasts.some(x=>x.includes('旧识图结果未填入')));
  }finally{global.native.analyzeSkinPhoto=original;delete App._uxRenderEpoch;}
});

test('UX-18 自动默认关闭、仅记录页触发、同日去重且未确认不落正式记录', async () => {
  reset({photos:[{id:'auto-photo',date:TODAY,kind:'skin',file:'synthetic.jpg'}]});Store.db.skin.logs={};delete Store.db.skin.aiAutoRun;Skincare.ui.tab='record';Store.db.settings.skinAutoAnalyze=false;
  const original=Skincare._aiAnalyze;let starts=0;Skincare._aiAnalyze=()=>{starts++;};
  try{Skincare._maybeAutoAnalyze();assert.equal(starts,0);Store.db.settings.skinAutoAnalyze=true;Skincare.ui.tab='care';Skincare._maybeAutoAnalyze();assert.equal(starts,0);Skincare.ui.tab='record';Skincare._maybeAutoAnalyze();Skincare._maybeAutoAnalyze();assert.equal(starts,1);assert.equal(Store.db.skin.logs[TODAY],undefined);assert.equal(Store.db.skin.aiAutoRun.file,'synthetic.jpg');
  }finally{Skincare._aiAnalyze=original;Store.db.settings.skinAutoAnalyze=false;delete Store.db.skin.aiAutoRun;}
});
