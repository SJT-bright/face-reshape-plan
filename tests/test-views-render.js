/* views 渲染断言测试（全 stub，零真实通知/存储/网络）：
   注入浏览器全局 stub 后加载真实 src/js/views.js，调用真实的
   Views.plan / Views.syncTimerUI / Views.badgeList / Views.checkBadgeUnlocks，
   对真实渲染产物（innerHTML、进度条、徽章、解锁通知）做断言。
   stub 风格参考 tests/test-ai-flow.js。

   加载方式说明：views.js 是浏览器脚本（顶层 `const Views`，无 module.exports），
   CommonJS 的 require 会把顶层 const 关在模块包装函数内、外部拿不到，
   故先用 require 验证可加载，再用 vm.runInThisContext 执行「同一份真实源码」
   并捕获 Views 绑定（仅拼接一行捕获语句，不改动被测文件内容）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const StoreCore = require('../src/js/store');

/* ---------- 真实 util（todayKey/esc/fmtSeconds/followCompletion/$/… 进入全局） ---------- */
const util = require('../src/js/util');
Object.assign(globalThis, util);
globalThis.UXCore = require('../src/js/ux-core');

/* ---------- 真实 views.js（require 验证 + vm 捕获 Views） ---------- */
const CATALOG_PATH = path.join(__dirname, '..', 'src', 'js', 'achievement-catalog.js');
vm.runInThisContext(fs.readFileSync(CATALOG_PATH, 'utf8'), { filename: CATALOG_PATH });
const VIEWS_PATH = path.join(__dirname, '..', 'src', 'js', 'views.js');
require(VIEWS_PATH); // CommonJS 入口可加载（导出为空对象，符合浏览器脚本现状）
vm.runInThisContext(fs.readFileSync(VIEWS_PATH, 'utf8') + '\n;globalThis.__views_under_test__ = Views;', { filename: VIEWS_PATH });
const Views = globalThis.__views_under_test__;
assert.ok(Views && typeof Views.plan === 'function', '真实 Views 未加载成功');

/* ---------- 环境全局 stub（只提供浏览器环境，不含任何被测逻辑） ---------- */
const toasts = [];
const toggleCalls = []; // documentElement.classList.toggle 记录器
const notifyCalls = []; // native.notify 记录器
let saveCalls = 0;
const registry = new Map(); // 选择器 → stub 元素（需要事后取回的元素在此注册）

function makeEl() {
  return {
    children: [], style: {}, dataset: {}, value: '', checked: false,
    textContent: '', innerHTML_: '', hidden: false, disabled: false, title: '',
    onclick: null, onchange: null, firstChild: null,
    addEventListener() {}, focus() {}, open: false,
    set innerHTML(v) { this.innerHTML_ = String(v); this.children = []; },
    get innerHTML() { return this.innerHTML_; },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); if (!this.firstChild) this.firstChild = c; return c; },
    querySelector(sel) { return registry.has(sel) ? registry.get(sel) : makeEl(); },
    querySelectorAll() { return []; },
    remove() {}, reportValidity() { return true; }
  };
}

/* root：innerHTML setter 捕获渲染产物；querySelector/All 返回假元素 */
function makeRoot() {
  const state = { html: '' };
  return {
    get capturedHtml() { return state.html; },
    set innerHTML(v) { state.html = String(v); },
    get innerHTML() { return state.html; },
    appendChild() {},
    querySelector(sel) { return registry.has(sel) ? registry.get(sel) : makeEl(); },
    querySelectorAll() { return []; }
  };
}

function register(sel, overrides = {}) {
  const el = Object.assign(makeEl(), overrides);
  registry.set(sel, el);
  return el;
}

function makeDocument() {
  const darkSet = new Set();
  return {
    documentElement: {
      classList: {
        contains(c) { return darkSet.has(c); },
        toggle(c, force) {
          toggleCalls.push([c, force]);
          const on = force === undefined ? !darkSet.has(c) : !!force;
          if (on) darkSet.add(c); else darkSet.delete(c);
          return on;
        },
        add(c) { darkSet.add(c); },
        remove(c) { darkSet.delete(c); }
      }
    },
    createElement() { return makeEl(); },
    fullscreenElement: null,
    exitFullscreen() {}
  };
}

function makeStore() {
  const db = {
    sessions: [{ id: 's1', name: '晨练', time: '07:40', days: [0, 1, 2, 3, 4, 5, 6], enabled: true, targetMinutes: 10, videoId: null }],
    settings: {
      dailyTargetMinutes: 15, eveningReviewTime: '22:00', keepInTray: false,
      skincareTimes: { morning: '08:00', noon: '12:00', evening: '20:30' },
      skinLogReminderTime: '21:30', darkMode: false
    },
    achievementsSeen: {},
    videos: [],
    logs: { training: {}, skincare: {} }
  };
  return Object.assign(Object.create(StoreCore), {
    db,
    settings() { return db.settings; },
    save() { saveCalls++; },
    videoById() { return null; },
    dayTraining() { return { seconds: 0, entries: [] }; },
    daySkincare() { return {}; },
    stats() { return { totalSec: 0, bestStreak: 0, metDays: 0, streak: 0, skStreak: 0 }; },
    followTotals() { return { completed: 0, total: 0 }; }
  });
}

function makeApp() {
  return {
    renderCalls: 0, refreshCalls: 0,
    _rerenderRoot: null, // 置为 root 时 render() 会真实重绘该视图（模拟 App.render → Views.plan 循环）
    render() { this.renderCalls++; if (this._rerenderRoot) Views.plan(this._rerenderRoot); },
    refreshStatusPill() { this.refreshCalls++; },
    updateMiniBar() {},
    go() {}, launchFollow() {}, openPracticeChooser() {},
    followVideoId: null, currentView: 'plan'
  };
}

function reset() {
  toasts.length = 0;
  toggleCalls.length = 0;
  notifyCalls.length = 0;
  saveCalls = 0;
  registry.clear();
  global.Store = makeStore();
  global.App = makeApp();
  global.Session = { active: null };
  global.document = makeDocument();
  global.native = { notify: (title, body) => notifyCalls.push({ title, body }) };
  global.toast = (msg) => toasts.push(msg);
}

/* ================= 用例 0：P2 修复验证——保存设置后重渲染，显示态与存储一致 ================= */
test('pl-save：清空复盘时间保存 → 留空即关闭，且触发 App.render 重绘', () => {
  reset();
  const root = makeRoot();
  register('#pl-target', { value: '15' });
  register('#pl-review', { value: '' });
  register('#pl-tray', { checked: false });
  register('#pl-save', {});
  App._rerenderRoot = root;
  Views.plan(root);
  assert.equal(App.renderCalls, 0, '渲染阶段不应触发 App.render');

  root.querySelector('#pl-save').onclick();

  assert.equal(Store.db.settings.eveningReviewTime, '', '留空即关闭，不回填 22:00');
  assert.equal(App.renderCalls, 1, '保存后应调用 App.render 重渲染（P2 修复点）');
  assert.ok(
    root.capturedHtml.includes('id="pl-review"'),
    '重绘后仍有复盘时间输入框'
  );
  assert.ok(!root.capturedHtml.includes('value="22:00"'), '留空后不应被写回 22:00');
  assert.ok(toasts.some((m) => m.includes('设置已保存')));
});

/* ================= 用例 0b：快捷导入默认折叠 ================= */
test('Views.plan：快捷导入默认收成 details 芯片，不含 open，表单仍在折叠体内', () => {
  reset();
  const root = makeRoot();
  Views.plan(root);
  const html = root.capturedHtml;
  assert.ok(html.includes('id="pl-quick-fold"'), '应渲染折叠容器');
  assert.ok(/<details class="pl-quick-fold" id="pl-quick-fold">/.test(html), 'details 默认不得带 open');
  assert.ok(html.includes('pl-quick-fold-btn'), '收起态是 summary 芯片');
  assert.ok(html.includes('id="pl-quick"') && html.includes('id="pl-quick-go"'), '展开后仍能解析导入');
  assert.ok(!html.includes('<h3>⚡ 快捷导入训练计划'), '不再用整张卡片占首屏');
});

test('Views.importModal：部分视频信息获取失败时说明仅保存了链接', async () => {
  reset();
  const oldOpenModal = global.openModal;
  const oldCloseModal = global.closeModal;
  const oldBilibili = global.Bilibili;
  const oldVideoLink = global.VideoLink;
  const oldWindow = global.window;
  try {
    const card = makeEl();
    register('#imv-text', { value: 'BV1ok\nBV1pending' });
    register('#imv-add');
    register('#imv-local');
    global.openModal = () => card;
    global.closeModal = () => {};
    global.Bilibili = { parse: line => ({ bvid: line, page: 1 }) };
    global.VideoLink = { parse: line => ({ source: 'bilibili', bvid: line, aid: null, page: 1 }) };
    global.window = { native: { fetchBilibiliInfo: async id => id === 'BV1ok'
      ? { ok: true, title: '已获取信息的视频', durationSec: 300 }
      : { ok: false } } };

    Views.importModal();
    await registry.get('#imv-add').onclick();

    assert.equal(Store.db.videos.length, 2);
    assert.equal(Store.db.videos[1].title, 'BV1pending', '获取失败的视频只保存 BV 引用');
    assert.ok(toasts.includes('已保存 2 个视频，其中 1 个仅保存链接，视频信息待获取'));
    assert.equal(saveCalls, 1);
  } finally {
    global.openModal = oldOpenModal;
    global.closeModal = oldCloseModal;
    global.Bilibili = oldBilibili;
    global.VideoLink = oldVideoLink;
    global.window = oldWindow;
  }
});

/* ================= 用例 1：提醒中枢渲染 ================= */
test('Views.plan：提醒中枢聚合渲染训练会话/护肤三时段/皮肤记录与夜间开关', () => {
  reset();
  const root = makeRoot();
  Views.plan(root);
  const html = root.capturedHtml;
  for (const expected of [
    '提醒中枢',
    '⏰ 跟练安排提醒',
    '晨练 07:40',
    '按安排日期',
    '🧴 护肤三时段',
    '08:00',
    '📝 皮肤状态记录',
    '每晚 21:30',
    'id="pl-dark"'
  ]) {
    assert.ok(html.includes(expected), `渲染产物应包含「${expected}」`);
  }
});

/* ================= 用例 2：夜间开关行为 ================= */
test('pl-dark onchange：classList.toggle 收到 dark/true，且 darkMode 入库', () => {
  reset();
  const root = makeRoot();
  register('#pl-dark', {});
  Views.plan(root);
  const dark = registry.get('#pl-dark');
  assert.equal(typeof dark.onchange, 'function', '渲染后应绑定夜间开关 onchange');

  dark.checked = true;
  dark.onchange();

  assert.deepEqual(toggleCalls, [['dark', true]], '应切换 documentElement 的 dark 类');
  assert.equal(Store.db.settings.darkMode, true, '开关状态应写入 settings.darkMode');
  assert.ok(saveCalls >= 1, '切换后应持久化');
});

/* ================= 用例 3：完播进度渲染（syncTimerUI） =================
   threshold = max(120, round(600*0.8)) = 480。
   500s → round(500/480*100)=104 → min(100) → 100%；
   300s → 300/480 = 62.5%，Math.round 半值进位 → 63%（任务书示意 62 为截断口径，真实四舍五入为 63）。 */
test('syncTimerUI：完播进度条显隐、宽度与剩余分钟文案', () => {
  reset();
  for (const sel of ['#t-big', '#t-toggle', '#t-stop', '#t-meta', '#t-complete', '#t-complete-fill', '#t-complete-text']) {
    register(sel, {});
  }
  const root = makeRoot();
  global.followCompletion = util.followCompletion;
  Session.active = { videoId: 'v1', seconds: 500, running: true };
  Store.videoById = (id) => ({ id: 'v1', durationSec: 600 });
  Store.dayTraining = () => ({ seconds: 600, entries: [] });

  Views.syncTimerUI(root);

  assert.equal(registry.get('#t-complete').hidden, false, '有视频时长且进行中应显示完播进度条');
  assert.equal(registry.get('#t-complete-fill').style.width, '100%', '500/480 超过 100% 应封顶');
  assert.ok(
    registry.get('#t-complete-text').textContent.includes('已达到完整跟练门槛'),
    `达标文案应含「已达到完整跟练门槛」，实际：${registry.get('#t-complete-text').textContent}`
  );
  assert.equal(registry.get('#t-stop').disabled, false, '进行中应允许结束并记录');
  assert.equal(registry.get('#t-stop').textContent, '✓ 结束并记录');

  Session.active.seconds = 300;
  Views.syncTimerUI(root);

  assert.equal(registry.get('#t-complete-fill').style.width, '63%', '300/480=62.5%，Math.round → 63%');
  assert.ok(
    registry.get('#t-complete-text').textContent.includes('完整跟练门槛 63% · 还差 3 分钟'),
    `未达标文案应明确门槛进度，实际：${registry.get('#t-complete-text').textContent}`
  );

  Session.active = { videoId: 'v1', seconds: 0, awaitingPlay: true };
  Views.syncTimerUI(root);
  assert.equal(registry.get('#t-stop').textContent, '结束（不记录）', '尚未播放时不能承诺会保存记录');
});

/* ================= 用例 4：成就等级系列与解锁（badgeSeries / seriesProgress / checkBadgeUnlocks） ================= */
test('badgeSeries：原有系列仍按统计派生，扩展系列无记录时为 0；checkBadgeUnlocks 通知一次且幂等', () => {
  reset();
  Store.stats = () => ({ totalSec: 4000, bestStreak: 3, metDays: 1, streak: 1, skStreak: 0 });
  Store.followTotals = () => ({ completed: 12, total: 13 });

  const series = Views.badgeSeries();
  assert.ok(series.length >= 40, `扩展后应有很多系列，实际 ${series.length}`);
  assert.ok(series.reduce((n, s) => n + s.tiers.length, 0) >= 16, '总档位应不少于原来的 16');
  const byKey = Object.fromEntries(series.map((s) => [s.key, s]));
  assert.equal(byKey.st_sessions.value, 0, '没有力量记录时次数为 0');
  assert.equal(byKey.rh_eve.value, 0, '没有进餐时晚上加餐为 0');
  assert.equal(byKey.fc_morning.value, 0);
  assert.equal(byKey.fc_starts.value, 13, '开练次数用 followTotals.total');
  assert.equal(byKey.follow.value, 12);
  assert.equal(byKey.hours.value, Math.floor(4000 / 3600), '时长系列按小时取整');
  assert.equal(byKey.streak.value, 3);
  assert.equal(byKey.skincare.value, 0);

  /* 等级解析：completed=12 → follow Lv.2（10 次），下一级 30 */
  const prog = Views.seriesProgress(byKey.follow);
  assert.equal(prog.lv, 2);
  assert.equal(prog.next.need, 30);
  assert.equal(prog.pct, 40); // 12/30

  assert.equal(Object.keys(Store.db.achievementsSeen).length, 0);
  Views.checkBadgeUnlocks();

  /* 原有档位仍解锁；开练 13 次再解锁 fc_starts Lv.1。没有饮食/力量/护肤记录的新系列保持 0。 */
  assert.equal(notifyCalls.length, 1, '首次解锁应推 1 次系统通知');
  assert.ok(notifyCalls[0].title.includes('解锁新成就'), `通知标题应含「解锁新成就」，实际：${notifyCalls[0].title}`);
  const seen = Store.db.achievementsSeen;
  for (const key of ['follow_lv1', 'follow_lv2', 'hours_lv1', 'streak_lv1', 'first_lv1', 'fc_starts_lv1']) {
    assert.equal(seen[key], true, `满足档位 ${key} 应写入 achievementsSeen`);
  }
  assert.equal(seen.st_sessions_lv1, undefined);
  assert.equal(seen.rh_meals_lv1, undefined);
  assert.equal(Object.keys(seen).length, 6, '本组统计下恰有 6 个档位入 seen');

  Views.checkBadgeUnlocks();
  assert.equal(notifyCalls.length, 1, '重复检查不应再通知（幂等）');

  /* 静默迁移：silent=true 只登记不通知 */
  Store.db.achievementsSeen = {};
  notifyCalls.length = 0;
  Views.checkBadgeUnlocks({ silent: true });
  assert.equal(notifyCalls.length, 0, '静默模式不推通知');
  assert.equal(Object.keys(Store.db.achievementsSeen).length, 6);
});

test('AchievementCatalog：从已有进餐、力量和护肤记录计数，不另存进度', () => {
  const cat = require('../src/js/achievement-catalog');
  const store = {
    db: {
      logs: {
        training: {},
        skincare: { '2026-09-01': { morning: ['a'], day: [], evening: ['b'] } }
      },
      rhythm: {
        meals: [
          { local: '2026-09-01T08:00', kind: 'meal', mealType: 'breakfast' },
          { local: '2026-09-01T12:00', kind: 'meal', mealType: 'lunch' },
          { local: '2026-09-01T18:30', kind: 'meal', mealType: 'dinner' },
          { local: '2026-09-01T21:00', kind: 'snack', mealType: 'evening-snack' },
          { local: '2026-09-02T08:10', kind: 'meal', mealType: 'breakfast' }
        ],
        sleeps: [],
        completeDays: {}
      },
      strength: {
        days: {
          '2026-09-01': {
            status: 'completed', isRest: false, bodyPart: '胸', confirmedDurationMinutes: 40,
            supplements: { creatineTaken: true },
            actions: [{ setsDone: 4, weightKg: 20 }]
          }
        }
      }
    },
    stats() { return { metDays: 0 }; },
    followTotals() { return { total: 0, completed: 0 }; }
  };
  const facts = cat.facts(store);
  assert.equal(facts.threeMeals, 1);
  assert.equal(facts.eveningSnacks, 1);
  assert.equal(facts.mealDays, 2);
  assert.equal(facts.mealRun, 2);
  assert.equal(facts.sessions, 1);
  assert.equal(facts.totalSets, 4);
  assert.equal(facts.loggedMin, 40);
  assert.equal(facts.creatine, 1);
  assert.equal(facts.bothEnds, 1);
  const series = cat.series(store);
  assert.equal(series.length, 50, '扩展成就系列数');
  for (const item of series) {
    const rel = `achievements-grok/${item.key}.png`;
    assert.equal(item.iconSrc, rel, `${item.key} 应绑定 Grok 原创图`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'assets', rel)), `${item.key} 图标文件不存在：${rel}`);
  }
  assert.equal(series.find((s) => s.key === 'fc_morning').iconSrc, 'achievements-grok/fc_morning.png');
  assert.equal(series.find((s) => s.key === 'fc_daytime').iconSrc, 'achievements-grok/fc_daytime.png');
  assert.equal(series.find((s) => s.key === 'fc_skinany').iconSrc, 'achievements-grok/fc_skinany.png');
});

test('成就卡：全部扩展系列使用 Grok 原创 PNG', () => {
  reset();
  global.Icon3D = { makeIcon() { return { outerHTML: '' }; } };
  global.AchievementCalendar = { render() {} };
  const root = makeRoot();
  Views.achievements(root);
  const html = root.capturedHtml;
  assert.match(html, /src="assets\/achievements-grok\/fc_morning\.png"/);
  assert.match(html, /src="assets\/achievements-grok\/fc_daytime\.png"/);
  assert.doesNotMatch(html, /fc_morning\.svg/);
  assert.doesNotMatch(html, /fc_daytime\.svg/);
  assert.match(html, /src="assets\/achievements-grok\/fc_skinany\.png"/);
});
