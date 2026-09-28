'use strict';
/* ======================================================================
   护肤界面渲染测试（node:test 正式固化）
   被测对象 = 真实 src/js/skincare.js + 真实 src/js/skin-engine.js
   （由 /tmp/skin-ui-review.js 已验证可运行的隔离 harness 整理而成）

   铁律：
   - 只读产品代码，不修改任何产品源码；
   - native（readSkinPhoto / saveSkinPhoto / analyzeSkinPhoto）与 Notification 全部 stub，
     无真实系统通知 / 无真实 IPC / 无真实文件读取；
   - 数据全部为测试内合成的假数据，不读取任何真实用户数据。

   顶部 stub 全局：todayKey 固定 '2026-09-15'、uid（真实 util 纯函数）、
   toast 收集数组、confirmModal、openModal（捕获 html 并返回假 card）、closeModal、
   App、$ / $$（作用于假元素注册表）、Store = 合成 db。
   每个用例前重建合成 db，避免用例间串扰。
   ====================================================================== */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const TODAY = '2026-09-15'; /* stub todayKey 固定值 */

/* ---------------- 假元素构造（querySelector / querySelectorAll 注册表） ---------------- */
function makeEl(overrides = {}) {
  const base = {
    disabled: false, textContent: '', value: '', dataset: {}, src: '', alt: '', title: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    removeAttribute(name) { delete this[name]; },
    addEventListener() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return this._q || []; }
  };
  return Object.assign(base, overrides);
}

/* ---------------- stub 收集器 ---------------- */
const toasts = [];          /* global.toast 收集数组 */
const openModalCalls = [];  /* openModal 捕获的 { html, card } */

/* ---------------- 全局 stub（先载真实 util 纯函数，再覆盖需 stub 的入口） ---------------- */
const U = require(path.join(SRC, 'js/util.js'));
Object.assign(global, U);            /* esc / addDays / pad2 / uid / fmtSeconds … 真实纯函数 */
global.todayKey = () => TODAY;       /* 固定「今天」，与测试数据对齐 */

global.toast = (msg, type) => toasts.push({ msg: String(msg), type: type || '' });
global.confirmModal = async () => true;
global.openModal = (html) => { const card = makeEl(); openModalCalls.push({ html, card }); return card; };
global.closeModal = () => {};
global.App = { currentView: 'skincare', render() {} };
global.$ = (sel, scope) => (scope && scope.querySelector) ? scope.querySelector(sel) : null;
global.$$ = (sel, scope) => (scope && scope.querySelectorAll) ? scope.querySelectorAll(sel) : [];
global.document = { createElement: () => makeEl() };
/* 杜绝任何真实系统通知 / IPC */
global.Notification = class { constructor() {} close() {} };
global.native = {
  _readImpl: async () => null,
  readSkinPhoto(file) { return this._readImpl(file); },
  saveSkinPhoto: async () => 'p-mock.jpg',
  deleteSkinPhoto: async () => {},
  analyzeSkinPhoto: async () => ({ ok: false, error: 'stub: not used' })
};

/* ---------------- 合成 db（全部为本测试构造的假数据） ---------------- */
function synthDb() {
  return {
    skin: { logs: {}, photos: [], predictions: {}, weeklyReports: {}, stats: {}, aiAutoRun: null },
    rhythm: { sleeps: [], meals: [] },
    strength: { days: {}, bmiProfile: { heightCm: 170, weightKg: 65, age: 30, sex: '男', activity: 'moderate' } },
    settings: {},
    skincare: { cycles: [] }
  };
}
global.Store = {
  db: synthDb(),
  settings() { return this.db.settings; },
  save() {},
  activeCycle() { return null; },
  daySkincare() { return {}; },
  dayTraining() { return { seconds: 0 }; }
};
function freshDb() { Store.db = synthDb(); }

/* ---------------- 真实引擎 + 真实护肤模块（被测对象） ---------------- */
global.SkinEngine = require(path.join(SRC, 'js/skin-engine.js'));
const Skincare = require(path.join(SRC, 'js/skincare.js'));

/* ---------------- 合成皮肤日志（3 天，全假数据） ---------------- */
function mkLog(over) {
  return Object.assign({
    acneTotal: 2, acneNew: 0, eyes: 1, pores: 1, spots: 0, redness: 1,
    oil: 1, dry: 1, barrier: 1, overall: 7, period: false, note: ''
  }, over);
}
function seedThreeDays() {
  freshDb();
  Store.db.skin.logs = {
    '2026-09-12': mkLog({ acneTotal: 4, acneNew: 2, eyes: 2, redness: 2, oil: 2, barrier: 2, overall: 5, note: '熬夜火锅' }),
    '2026-09-13': mkLog({ acneTotal: 1, acneNew: 0, eyes: 0, redness: 0, dry: 0, barrier: 0, overall: 9, note: '早睡' }),
    '2026-09-14': mkLog({ acneTotal: 2, acneNew: 1, overall: 7 })
  };
  return Store.db.skin.logs;
}
function mkRep(weekEnd, avgScore) {
  return {
    weekEnd, avgScore, daysLogged: 3, acneNewTotal: 2,
    best: { date: '2026-09-05', score: 90 }, worst: { date: '2026-09-03', score: 70 },
    sleepAvgMin: 420, sleepDays: 3, lateDays: 1
  };
}
function ph(i, kind) {
  const d = `2026-09-${String(i).padStart(2, '0')}`;
  return { id: 'ph' + i, date: d, kind, file: `f${i}.jpg`, weightKg: undefined, createdAt: d + 'T08:00:00Z' };
}

/* =====================================================================
   a) 3 天日志 + 1 份周报 → 洞察卡渲染「皮肤周报」details、
      data-copy-week、健康简报按钮、CSV 按钮；明细含「记录 3 天」
   ===================================================================== */
test('a) 3 天日志+1 份周报：周报 details / data-copy-week / 健康简报 / CSV 全部渲染', () => {
  const logs = seedThreeDays();
  Store.db.skin.weeklyReports = {
    '2026-09-14': {
      weekEnd: '2026-09-14', avgScore: 80, daysLogged: 3, acneNewTotal: 2,
      best: { date: '2026-09-13', score: 85 }, worst: { date: '2026-09-12', score: 75 },
      sleepAvgMin: 420, sleepDays: 3, lateDays: 1
    }
  };
  const html = Skincare._skinInsightCard();

  /* 「皮肤周报」details（summary 在 details 内）与份数文案 */
  assert.ok(html.includes('<details'), '应渲染 <details> 周报容器');
  assert.ok(html.indexOf('<details') < html.indexOf('皮肤周报'), 'summary「皮肤周报」应在 details 内');
  assert.ok(html.includes('皮肤周报（1 份，每周自动生成）'), 'summary 文案含份数');
  /* 复制周报按钮（值为周报结束日） */
  assert.ok(html.includes('data-copy-week="2026-09-14"'), '含 data-copy-week 复制按钮');
  /* 健康简报按钮 + CSV 导出按钮 */
  assert.ok(html.includes('id="sk-brief"') && html.includes('复制健康简报'), '含健康简报按钮');
  assert.ok(html.includes('id="sk-csv"') && html.includes('皮肤CSV'), '含 CSV 导出按钮');
  /* 周报明细行：天数 / 新痘 / 最好 / 睡眠均 / 晚食 */
  assert.ok(html.includes('记录 3 天'), '周报明细含「记录 3 天」');
  assert.ok(html.includes('记录 3 天 · 新痘 2 颗'), '明细行天数+新痘');
  assert.ok(html.includes('最好 09-13（85）'), '明细行最好日');
  assert.ok(html.includes('7h0m'), '明细行睡眠均 420min → 7h0m');
  assert.ok(html.includes('晚食 1 天'), '明细行晚食天数');
  /* 单份周报无上一份可对比 → 不渲染「较上周」（delta===null 分支） */
  assert.ok(!html.includes('较上周'), '单份周报时无「较上周」差值');
  /* 环境自证：3 天合成日志经真实引擎算出评分（供走势图用） */
  const scores = Object.keys(logs).sort().map(d => SkinEngine.scoreSkin(logs[d]).score);
  assert.deepEqual(scores, scores.map(Number), '评分均可计算');
  assert.ok(scores.every(s => typeof s === 'number'), `3 天日志评分真实可算：${scores.join(',')}`);
});

/* =====================================================================
   b) 周报差值：两份周报（80 与 75）→ delta = 75-80 = -5，渲染「较上周 -5」
      + 下跌样式（#b4552e）；反向（75→80）用不同数据 → 「较上周 +5」+ 绿色（#1d6e4f）
   ===================================================================== */
test('b) 周报差值：80→75 渲染「较上周 -5」下跌样式；反向 75→80 渲染「较上周 +5」绿色样式', () => {
  seedThreeDays();
  const cur = mkRep('2026-09-14', 75);

  /* 上一份均分 80 → 本份 75：delta = -5，产品逻辑 delta<0 → color:#b4552e（暖红/下跌） */
  Store.db.skin.weeklyReports = { '2026-09-07': mkRep('2026-09-07', 80), '2026-09-14': cur };
  const htmlDown = Skincare._skinInsightCard();
  assert.ok(htmlDown.includes('（较上周 -5）'), 'delta 80→75 应渲染「较上周 -5」');
  assert.ok(htmlDown.includes('color:#b4552e'), '-5 走下跌样式 color:#b4552e');

  /* 反向：不同数据，上一份 75 → 本份 80：delta = +5，delta>=0 → color:#1d6e4f（绿色） */
  Store.db.skin.weeklyReports = { '2026-09-07': mkRep('2026-09-07', 75), '2026-09-14': mkRep('2026-09-14', 80) };
  const htmlUp = Skincare._skinInsightCard();
  assert.ok(htmlUp.includes('（较上周 +5）'), 'delta 75→80 应渲染「较上周 +5」');
  assert.ok(htmlUp.includes('color:#1d6e4f'), '+5 走绿色样式 color:#1d6e4f');
});

/* =====================================================================
   c) 无周报数据 → 不渲染「皮肤周报」details；有日志仍走数据分支
   ===================================================================== */
test('c) 无周报：不渲染「皮肤周报」details，数据分支照常', () => {
  seedThreeDays();
  Store.db.skin.weeklyReports = {};
  const html = Skincare._skinInsightCard();
  assert.ok(!html.includes('皮肤周报'), '无周报数据时不得出现「皮肤周报」');
  assert.ok(!html.includes('data-copy-week'), '无周报数据时不得出现 data-copy-week');
  /* 仍有 3 天日志 → 走数据分支（洞察卡 + 关联 n=3 提示），而非空态文案 */
  assert.ok(html.includes('互通洞察'), '仍渲染洞察卡');
  assert.ok(html.includes('最近 3 天'), '标题含「最近 3 天」');
  assert.ok(html.includes('当前 n=3'), '关联强度提示 n=3');
  assert.ok(!html.includes('记录几天皮肤状态后，这里会开始分析'), '有日志时不渲染空态文案');
});

/* =====================================================================
   d) _photoOverviewModal：<4 张拦截 / 12 张九宫格均匀取样 / 恰好 4 张放行
   ===================================================================== */
test('d1) 照片 <4 张：toast「照片不足」且 openModal 未被调用（body 照不计入）', () => {
  freshDb();
  Store.db.skin.photos = [ph(1, 'skin'), ph(2, 'skin'), ph(3, 'skin'), ph(4, 'body'), ph(5, 'body')];
  toasts.length = 0; openModalCalls.length = 0;
  Skincare._photoOverviewModal();
  assert.ok(toasts.some(t => t.msg.includes('照片不足')), `应 toast「照片不足」，实际 toasts=${JSON.stringify(toasts.map(t => t.msg))}`);
  assert.equal(openModalCalls.length, 0, 'openModal 不应被调用');
});

test('d2) 12 张照片：openModal 恰 1 次，9 个 figure，均匀去重索引，含首尾日期', () => {
  freshDb();
  Store.db.skin.photos = Array.from({ length: 12 }, (_, i) => ph(i + 1, 'skin'));
  toasts.length = 0; openModalCalls.length = 0;
  Skincare._photoOverviewModal();
  assert.equal(openModalCalls.length, 1, 'openModal 恰被调用 1 次');
  const html = openModalCalls[0].html;
  assert.equal((html.match(/<figure/g) || []).length, 9, 'figure 数 = 9（最多九宫格）');
  const idxObs = [...html.matchAll(/data-idx="(\d+)"/g)].map(m => Number(m[1]));
  const idxExp = [...new Set(Array.from({ length: 9 }, (_, i) => Math.round(i * (12 - 1) / (9 - 1))))];
  assert.deepEqual(idxObs, idxExp, `data-idx 应为均匀取样去重索引 [${idxExp.join(',')}]，实际 [${idxObs.join(',')}]`);
  /* 首（最旧 2026-09-01）尾（最新 2026-09-12）日期：标题与 caption */
  assert.ok(html.includes('2026-09-01') && html.includes('2026-09-12'), '标题含首尾完整日期');
  assert.ok(html.includes('09-01') && html.includes('09-12'), 'caption 含首尾 MM-DD');
  assert.equal(toasts.length, 0, '12 张路径无任何 toast（不误报照片不足）');
});

test('d3) 边界恰好 4 张：放行，4 个 figure，idx 含 3', () => {
  freshDb();
  Store.db.skin.photos = [ph(1, 'skin'), ph(2, 'skin'), ph(3, 'skin'), ph(4, 'skin')];
  toasts.length = 0; openModalCalls.length = 0;
  Skincare._photoOverviewModal();
  assert.equal(openModalCalls.length, 1, '恰好 4 张应放行（openModal 1 次）');
  const html4 = openModalCalls[0].html;
  assert.equal((html4.match(/<figure/g) || []).length, 4, 'figure 数 = 4');
  const idx = [...html4.matchAll(/data-idx="(\d+)"/g)].map(m => m[1]);
  assert.deepEqual(idx, ['0', '1', '2', '3'], `idx 应为 [0,1,2,3]，实际 [${idx.join(',')}]`);
});

/* =====================================================================
   e) _loadPhotoImgs 三路径（null / 异常 / 正常）→ missing 标记、title 清理、
      src 设置互不污染
   ===================================================================== */
test('e1) readSkinPhoto 返回 null：missing=1、title 挂失败文案、src 清空、alt 不被污染', async () => {
  freshDb();
  const img = makeEl({ dataset: { photoFile: 'gone.jpg' }, src: 'data:image/jpeg;base64,OLDSRC=', title: '旧title', alt: '2026-09-10' });
  const scope = makeEl({ _q: [img] });
  global.native._readImpl = async () => null;
  const missing = await Skincare._loadPhotoImgs(scope);
  assert.equal(missing, 1, '缺失计数 = 1');
  assert.equal(img.dataset.missing, '1', 'data-missing="1"');
  assert.ok(!img.src, '旧 src 已清除');
  assert.match(img.title, /照片无法读取/, 'title 含「照片无法读取」');
  assert.equal(img.alt, '2026-09-10', 'alt 保持日期语义不被失败文案污染');
});

test('e2) readSkinPhoto 抛异常（IPC reject）：与 null 同样按缺失处理', async () => {
  freshDb();
  const img = makeEl({ dataset: { photoFile: 'broken.jpg' }, src: 'data:image/jpeg;base64,OLDSRC=', title: '旧title', alt: '2026-09-11' });
  const scope = makeEl({ _q: [img] });
  global.native._readImpl = async () => { throw new Error('ipc broken'); };
  const missing = await Skincare._loadPhotoImgs(scope);
  assert.equal(missing, 1, '异常路径缺失计数 = 1');
  assert.equal(img.dataset.missing, '1', 'data-missing="1"');
  assert.match(img.title, /权限异常/, 'title 含「权限异常」');
  assert.ok(!img.src, '无 src');
});

test('e3) 正常 b64：jpg/png MIME 正确、missing/title 清除、alt 保留（同批次互不污染）', async () => {
  freshDb();
  const imgJpg = makeEl({ dataset: { photoFile: 'ok.jpg' }, src: 'data:image/jpeg;base64,OLDSRC=', title: '旧title', alt: '2026-09-12' });
  const imgPng = makeEl({ dataset: { photoFile: 'ok.png' }, src: '', title: '', alt: '2026-09-13' });
  const scope = makeEl({ _q: [imgJpg, imgPng] });
  global.native._readImpl = async (file) => file.endsWith('.png') ? 'UE5HQg==' : 'c3R1Yg==';
  const missing = await Skincare._loadPhotoImgs(scope);
  assert.equal(missing, 0, '正常路径缺失计数 = 0');
  assert.equal(imgJpg.src, 'data:image/jpeg;base64,c3R1Yg==', 'jpg → image/jpeg data URI');
  assert.equal(imgPng.src, 'data:image/png;base64,UE5HQg==', 'png → image/png data URI（MIME 正确）');
  assert.ok(!('missing' in imgJpg.dataset), 'missing 标记已清除');
  assert.ok(!('title' in imgJpg), 'title 已清除（不残留旧失败文案）');
  assert.equal(imgJpg.alt, '2026-09-12', 'alt 保留');
});

test('e4) 混合批次 [正常, 缺失]：计数只算缺失 1 张，正常图有 src、缺失图有标记', async () => {
  freshDb();
  const imgOk = makeEl({ dataset: { photoFile: 'a.jpg' } });
  const imgGone = makeEl({ dataset: { photoFile: 'gone.jpg' } });
  const scope = makeEl({ _q: [imgOk, imgGone] });
  global.native._readImpl = async (file) => file === 'a.jpg' ? 'c3R1Yg==' : null;
  const missing = await Skincare._loadPhotoImgs(scope);
  assert.equal(missing, 1, '仅缺失计入返回计数');
  assert.ok(imgOk.src, '正常图 src 已设置');
  assert.equal(imgGone.dataset.missing, '1', '缺失图标记 missing=1');
  assert.ok(!imgGone.src, '缺失图无 src（正常图 src 不串给缺失图）');
});

/* =====================================================================
   f) 护肤串页回归：预测/周报抛错时，view() 仍必须换掉上一栏目 DOM
   ===================================================================== */
function dietRoot() {
  const bindable = () => makeEl({ appendChild() { return this; }, checked: false, onclick: null });
  return {
    html: '<div class="rhythm-page"><h1>吃饭与睡觉，记个大概就好。</h1></div>',
    set innerHTML(v) { this.html = String(v); },
    get innerHTML() { return this.html; },
    querySelector() { return bindable(); },
    querySelectorAll() { return []; },
    appendChild() {}
  };
}

test('f0) _skinContext 必须带 dateKey，预测才不会在打开护肤页时炸掉', () => {
  freshDb();
  const ctx = Skincare._skinContext();
  assert.equal(ctx.dateKey, TODAY);
  assert.doesNotThrow(() => SkinEngine.predictForDate(ctx));
});

test('f1) 预测抛错不得留下饮食 DOM', () => {
  freshDb();
  global.window = global.window || { addEventListener() {} };
  const orig = SkinEngine.predictForDate;
  SkinEngine.predictForDate = () => { throw new Error('predict boom'); };
  try {
    const root = dietRoot();
    assert.doesNotThrow(() => Skincare.view(root));
    assert.ok(root.innerHTML.includes('护肤周期') || root.innerHTML.includes('今日皮肤状态'),
      '护肤页应写入自己的 DOM');
    assert.ok(!root.innerHTML.includes('吃饭与睡觉'), '不得残留饮食文案');
  } finally {
    SkinEngine.predictForDate = orig;
  }
});

test('f2) 周报抛错不得留下力量/饮食 DOM', () => {
  freshDb();
  global.window = global.window || { addEventListener() {} };
  const orig = SkinEngine.weeklyReport;
  SkinEngine.weeklyReport = () => { throw new Error('week boom'); };
  try {
    const root = dietRoot();
    root.html = '<div class="view"><div class="st-tabs">力量训练</div></div>';
    assert.doesNotThrow(() => Skincare.view(root));
    assert.ok(!root.innerHTML.includes('力量训练'), '不得残留力量训练文案');
    assert.ok(root.innerHTML.includes('护肤周期') || root.innerHTML.includes('今日皮肤状态'),
      '护肤页应写入自己的 DOM');
  } finally {
    SkinEngine.weeklyReport = orig;
  }
});
