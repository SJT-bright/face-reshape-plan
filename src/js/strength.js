/* 力量训练视图 —— 从「个人积累库」健身板块移植
   数据存于 Store.db.strength（结构见 strength-core.js normalize）。
   五个标签页：今日训练 / 成长曲线 / 训练日模板（含模板更新记录） / 训练历史 / 进步可视化。
   今日训练支持日期导航与补记；计时按天累计（totalSeconds），每 30 秒与暂停/保存/收尾时落盘。 */

const Core = typeof window !== 'undefined' ? window.StrengthCore : require('./strength-core');

/* 身体图热区：与原模块 BODY_HOTSPOTS 一致，百分比定位在 muscle-body-map-v2.png 上 */
const BODY_HOTSPOTS = [
  { key: 'shoulders', side: 'front', x: 18.8, y: 17.8, width: 5.5, height: 8.8, rotate: 12, radius: '62% 38% 48% 52%' },
  { key: 'shoulders', side: 'front', x: 32.9, y: 17.8, width: 5.5, height: 8.8, rotate: -12, radius: '38% 62% 52% 48%' },
  { key: 'chest', side: 'front', x: 23.0, y: 20.3, width: 5.2, height: 10.4, radius: '55% 42% 48% 62%' },
  { key: 'chest', side: 'front', x: 28.3, y: 20.3, width: 5.2, height: 10.4, radius: '42% 55% 62% 48%' },
  { key: 'biceps', side: 'front', x: 18.9, y: 25.1, width: 4.2, height: 13.6, rotate: 10 },
  { key: 'biceps', side: 'front', x: 34.2, y: 25.1, width: 4.2, height: 13.6, rotate: -10 },
  { key: 'forearms', side: 'front', x: 14.6, y: 38.2, width: 4.7, height: 15.0, rotate: 18 },
  { key: 'forearms', side: 'front', x: 38.0, y: 38.2, width: 4.7, height: 15.0, rotate: -18 },
  { key: 'core', side: 'front', x: 23.1, y: 29.7, width: 9.4, height: 20.1, radius: '32% 32% 45% 45%' },
  { key: 'quadriceps', side: 'front', x: 21.3, y: 49.4, width: 5.3, height: 18.0, rotate: 2, radius: '42% 42% 52% 52%' },
  { key: 'quadriceps', side: 'front', x: 29.1, y: 49.4, width: 5.3, height: 18.0, rotate: -2, radius: '42% 42% 52% 52%' },
  { key: 'calves', side: 'front', x: 21.6, y: 69.1, width: 4.4, height: 17.8, rotate: 2 },
  { key: 'calves', side: 'front', x: 29.8, y: 69.1, width: 4.4, height: 17.8, rotate: -2 },
  { key: 'shoulders', side: 'back', x: 62.5, y: 17.8, width: 5.6, height: 8.8, rotate: 12, radius: '62% 38% 48% 52%' },
  { key: 'shoulders', side: 'back', x: 76.0, y: 17.8, width: 5.6, height: 8.8, rotate: -12, radius: '38% 62% 52% 48%' },
  { key: 'back', side: 'back', x: 65.8, y: 18.8, width: 12.3, height: 26.4, clipPath: 'polygon(18% 0, 50% 10%, 82% 0, 100% 34%, 78% 100%, 50% 84%, 22% 100%, 0 34%)' },
  { key: 'triceps', side: 'back', x: 61.8, y: 25.0, width: 4.3, height: 13.7, rotate: 10 },
  { key: 'triceps', side: 'back', x: 78.0, y: 25.0, width: 4.3, height: 13.7, rotate: -10 },
  { key: 'forearms', side: 'back', x: 57.6, y: 38.3, width: 4.7, height: 15.0, rotate: 18 },
  { key: 'forearms', side: 'back', x: 81.8, y: 38.3, width: 4.7, height: 15.0, rotate: -18 },
  { key: 'glutes', side: 'back', x: 66.2, y: 44.9, width: 5.7, height: 11.2, radius: '58% 42% 52% 48%' },
  { key: 'glutes', side: 'back', x: 72.1, y: 44.9, width: 5.7, height: 11.2, radius: '42% 58% 48% 52%' },
  { key: 'hamstrings', side: 'back', x: 65.4, y: 54.6, width: 5.2, height: 17.2, rotate: 2 },
  { key: 'hamstrings', side: 'back', x: 73.3, y: 54.6, width: 5.2, height: 17.2, rotate: -2 },
  { key: 'calves', side: 'back', x: 65.7, y: 70.4, width: 4.6, height: 17.6, rotate: 2 },
  { key: 'calves', side: 'back', x: 73.9, y: 70.4, width: 4.6, height: 17.6, rotate: -2 }
];

/* ---------- 视图级常量与小组件 ---------- */
/* 标签页：顺序与文案与源应用对齐 */
const TABS = [
  { id: 'today', emoji: '🏋️', label: '今日训练' },
  { id: 'trends', emoji: '🔥', label: '成长曲线' },
  { id: 'template', emoji: '✍️', label: '训练日模板' },
  { id: 'history', emoji: '🗓️', label: '训练历史' },
  { id: 'progress', emoji: '🎯', label: '进步可视化' }
];
/* 成长曲线折线固定配色（按部位顺序循环取用） */
const CHART_COLORS = ['#4f7cff', '#22c55e', '#f97316', '#a855f7', '#ef4444',
  '#14b8a6', '#eab308', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16', '#64748b'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const WD_STATUS_LABELS = {
  completed: '已完成', partial: '部分完成', 'in-progress': '训练中',
  skipped: '已跳过', 'not-started': '待记录'
};
/* 新版块的内联布局（class 契约已留好，供 strength.css 后续接管） */
const S = {
  label: 'display:grid; gap:4px; font-size:12.5px; font-weight:600; color:rgba(44,58,71,.65)',
  inlineLabel: 'display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:rgba(44,58,71,.65)',
  dateform: 'display:flex; align-items:flex-end; gap:10px; flex-wrap:wrap',
  week: 'display:grid; grid-template-columns:repeat(7,1fr); gap:6px; margin-bottom:14px',
  wday: 'display:grid; gap:2px; justify-items:center; padding:7px 4px; border-radius:10px; border:1px solid rgba(44,58,71,.12); background:rgba(255,255,255,.55); cursor:pointer; font:inherit; font-size:11.5px; color:rgba(44,58,71,.8)',
  supps: 'display:grid; gap:8px; margin-top:12px; padding:10px 12px; border:1px dashed rgba(44,58,71,.18); border-radius:10px',
  suppsLine: 'display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:12.5px',
  sessionRow: 'display:flex; gap:12px; padding:9px 12px; border-radius:12px; background:rgba(255,255,255,.55); border:1px solid rgba(44,58,71,.06)',
  updateRow: 'display:grid; gap:3px; padding:10px 12px; border-radius:12px; background:rgba(255,255,255,.55); border:1px solid rgba(44,58,71,.06)',
  tplDay: 'display:grid; gap:8px; padding:12px; border:1px solid rgba(44,58,71,.08); border-radius:12px; background:rgba(255,255,255,.55)',
  meterWrap: 'position:relative; height:10px; border-radius:999px; background:rgba(44,58,71,.1); overflow:hidden',
  meterFill: 'position:absolute; top:0; left:0; height:100%; border-radius:999px; background:linear-gradient(135deg,#6d5df1,#4f7cff)'
};

function ymd(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return { y, m, d }; }
function mdDate(dateStr) { const { m, d } = ymd(dateStr); return `${m}月${d}日`; }
/* 周几按上海时区算（getUTCDay 于 +08:00 正午即该日星期） */
function weekdayOf(dateStr) { return new Date(`${dateStr}T12:00:00.000+08:00`).getUTCDay(); }
/* 周条状态文案：空记录按 待补记/未到/待记录；有记录按状态映射，休息日已完成显示「休息」 */
function weekDayStatus(rec, date, today) {
  if (!rec) return date < today ? '待补记' : date > today ? '未到' : '待记录';
  if (rec.isRest && rec.status === 'completed') return '休息';
  return WD_STATUS_LABELS[rec.status] || '待记录';
}
function weekStatusColor(label) {
  return { 已完成: '#15803d', 训练中: '#2f5fe0', 部分完成: '#c2410c', 休息: '#7c5cf0' }[label] || 'rgba(44,58,71,.55)';
}
function triLabel(v) { return v === true ? '已服 ✓' : v === false ? '未服 ✗' : '未记'; }
function triState(v) { return v === true ? 'yes' : v === false ? 'no' : 'unknown'; }

function scoreColor(p) {
  if (p.confidence === 'none') return 'rgba(121, 139, 130, 0.28)';
  if (p.overallScore >= 75) return '#3f8f6c';
  if (p.overallScore >= 50) return '#70aa8a';
  if (p.overallScore >= 25) return '#c59c58';
  return '#9aa69f';
}
function formatChange(value) {
  if (value === null) return '数据不足';
  if (value === 0) return '持平';
  return `${value > 0 ? '+' : ''}${value}%`;
}
function confidenceLabel(value) {
  return { none: '暂无记录', limited: '样本较少', good: '趋势可参考' }[value] || value;
}
function bmiCategory(value) {
  if (value < 18.5) return '偏低范围';
  if (value < 25) return '常规范围';
  if (value < 30) return '超重范围';
  return '肥胖范围';
}

const Strength = {
  titles: { strength: '力量训练' },
  timer: null, // { date, seconds, running }
  /* ui.date：业务日期字符串，null 表示今天；ui.historyPage：历史分页；ui.tplDraft：模板编辑器本地草稿 */
  ui: { tab: 'today', muscle: null, date: null, historyPage: 1, tplDraft: null },

  boot() {
    const state = Core.normalize(Store.db);
    if (Store.db.strength !== state) Store.save();
  },

  /* ================= 视图骨架 ================= */
  view(root) {
    this.boot();
    const state = Store.db.strength;
    const today = Core.businessDate();
    const date = this.ui.date || today;
    const tab = TABS.some((t) => t.id === this.ui.tab) ? this.ui.tab : 'today';
    this.ui.tab = tab;
    const info = tab === 'today' ? Core.todayPlan(state, date) : null;
    // 走秒决策统一走 Core.timerShouldRun：只有今天的进行中训练走秒（补记过去日期不计时）
    if (info && info.day) this._ensureTimerFor(info.day, today);
    let content = '';
    if (tab === 'today') content = this._todayTabHtml(state, today, date, info);
    else if (tab === 'trends') content = this._trendsView(state);
    // 模板更新记录是低频信息，并入训练日模板页底部，减少一层标签
    else if (tab === 'template') content = this._templateView(state) + this._updatesView(state);
    else if (tab === 'history') content = this._historyView(state);
    else content = this._progressHtml(state, today);

    root.innerHTML = `
      <div class="view">
        <div class="st-tabs" role="tablist" aria-label="力量训练视图">
          ${TABS.map((t) => `
            <button class="st-tab${tab === t.id ? ' active' : ''}" data-tab="${t.id}" role="tab"
              aria-selected="${tab === t.id}">${t.emoji} ${t.label}</button>`).join('')}
        </div>
        ${content}
      </div>`;

    $$('.st-tab', root).forEach((btn) => {
      btn.onclick = () => { this.ui.tab = btn.dataset.tab; App.render(); };
    });
    if (tab === 'today') {
      this._bindDateNav(root);
      if (info && info.day) this._bindToday(root, info);
      else this._bindEmpty(root);
      const edit = $('#st-tpl-edit', root);
      if (edit) edit.onclick = () => { this.ui.tab = 'template'; App.render(); };
      const cyc = $('#st-tpl-day', root);
      if (cyc) cyc.onclick = () => this._cycleModal();
      const recentAll = $('#st-recent-all', root);
      if (recentAll) recentAll.onclick = () => { this.ui.tab = 'history'; App.render(); };
      const imp = $('#st-import', root);
      if (imp) imp.onclick = () => this._importModal();
      const exp = $('#st-export', root);
      if (exp) exp.onclick = () => this._exportModal();
      $$('.st-history-row', root).forEach((el) => { el.onclick = () => this._dayModal(el.dataset.date); });
    } else if (tab === 'trends') {
      this._bindTrends(root);
    } else if (tab === 'template') {
      this._bindTemplate(root);
    } else if (tab === 'history') {
      this._bindHistory(root);
    } else if (tab === 'progress') {
      this._bindProgress(root);
    }
  },

  /* ================= 公共：日期导航（今日训练页） ================= */
  _dateNavHtml(state) {
    const today = Core.businessDate();
    const date = this.ui.date || today;
    const { y, m, d } = ymd(date);
    const marker = date === today ? '今天' : '补记';
    const dates = Core.weekDates(date);
    const records = Core.calendarRecords(state, date);
    return `
      <div class="st-datenav" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px">
        <div class="st-dn-cur">
          <b>${y} 年 ${m} 月 ${d} 日</b>
          <span class="hint">周${WEEKDAYS[weekdayOf(date)]} · ${marker}</span>
        </div>
        <div class="st-dn-ctrl" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
          <button class="btn ghost" id="st-dn-prev" data-no-icon="true" title="前一天" style="padding:5px 12px">‹</button>
          <input class="input" id="st-dn-date" type="date" max="${today}" value="${date}" style="width:150px">
          <button class="btn ghost" id="st-dn-next" data-no-icon="true" title="后一天" ${date >= today ? 'disabled' : ''} style="padding:5px 12px">›</button>
          <button class="btn" id="st-dn-today" data-no-icon="true" ${date === today ? 'disabled' : ''}>回今天</button>
        </div>
      </div>
      <div class="st-week" style="${S.week}">
        ${dates.map((d2, i) => {
          const rec = records[i];
          const label = weekDayStatus(rec, d2, today);
          const sel = d2 === date;
          return `
            <button class="st-wday" data-date="${d2}" data-no-icon="true" data-selected="${sel}"
              data-status="${rec ? rec.status : d2 < today ? 'miss' : d2 > today ? 'future' : 'todo'}"
              ${d2 > today ? 'disabled' : ''}
              style="${S.wday}; ${sel ? 'border-color:var(--accent,#4f7cff); box-shadow:0 0 0 2px rgba(79,124,255,.22); background:rgba(79,124,255,.08)' : ''}">
              <span class="st-wd-name">周${WEEKDAYS[weekdayOf(d2)]}</span>
              <span class="st-wd-num" style="font-weight:700; font-size:12.5px">${ymd(d2).m}/${ymd(d2).d}</span>
              <span class="st-wd-status" style="font-size:10.5px; color:${weekStatusColor(label)}">${label}</span>
            </button>`;
        }).join('')}
      </div>`;
  },

  _bindDateNav(root) {
    const today = Core.businessDate();
    const set = (v) => {
      if (!Core.isBusinessDate(v) || v > today) { toast('只能选择今天及以前的日期', 'red'); return; }
      this._flushTimer(); // 跨日期前先落秒，不丢也不串日期
      this.ui.date = v;
      App.render();
    };
    const prev = $('#st-dn-prev', root);
    if (prev) prev.onclick = () => set(Core.addDays(this.ui.date || today, -1));
    const next = $('#st-dn-next', root);
    if (next) next.onclick = () => set(Core.addDays(this.ui.date || today, 1));
    const input = $('#st-dn-date', root);
    if (input) input.onchange = () => { if (input.value) set(input.value); };
    const back = $('#st-dn-today', root);
    if (back) back.onclick = () => { this.ui.date = null; App.render(); };
    $$('.st-wday', root).forEach((btn) => {
      btn.onclick = () => { this.ui.date = btn.dataset.date; App.render(); };
    });
  },

  /* ================= 标签页一：今日训练 ================= */
  _todayTabHtml(state, today, date, info) {
    const sum = Core.statsSummary(state, today, 30);
    const recent = Object.keys(state.days).sort().reverse().slice(0, 10);
    return `
      ${this._dateNavHtml(state)}
      ${info.day ? this._todayCard(info) : this._emptyCard()}
      <div class="card">
        <h3>📊 近 30 天
          <span class="h-extra">完成 ${sum.completed} · 部分 ${sum.partial} · 跳过 ${sum.skipped} · 累计 ${fmtDuration(sum.seconds)}</span>
        </h3>
        <div class="stat-row">
          <div class="stat-box"><b>${sum.completed}</b><span>完成天数</span></div>
          <div class="stat-box"><b>${sum.sets}</b><span>总组数</span></div>
          <div class="stat-box"><b>${sum.volume >= 1000 ? (sum.volume / 1000).toFixed(1) + ' t' : sum.volume + ' kg'}</b><span>训练容量</span></div>
          <div class="stat-box"><b>${Math.round(sum.seconds / 60)}</b><span>分钟</span></div>
        </div>
      </div>
      <div class="card">
        <h3>🗓️ 最近训练日 <span class="h-extra">点行看计划 vs 实际</span></h3>
        ${recent.length ? `<div class="strength-history">
          ${recent.slice(0, 5).map((d) => this._historyRow(state.days[d])).join('')}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn ghost" id="st-recent-all" data-no-icon="true">查看全部 ${Object.keys(state.days).length} 条 →</button>
        </div>` : '<div class="empty">还没有训练记录。开始今天的第一练吧。</div>'}
      </div>
      <div class="card">
        <h3>⚙️ 模板与数据 <span class="h-extra">${(() => { const rot = this._rotationTpl(state); return rot ? esc(rot.name) + ' · 第 ' + rot.currentRevision + ' 版 · 当前轮转' : '未建立模板'; })()}</span></h3>
        <div class="row">
          <button class="btn" id="st-tpl-edit">编辑模板</button>
          <button class="btn" id="st-tpl-day">选择训练日</button>
          <button class="btn" id="st-import">导入数据（文本/JSON）</button>
          <button class="btn" id="st-export">导出备份</button>
        </div>
        ${state.events.length ? `<div class="hint" style="margin-top:10px">最近动态：${esc(state.events.slice(-3).reverse().map((e) => `${(e.date || String(e.at).slice(0, 10)).slice(5)} ${e.note}`).join(' · '))}</div>` : ''}
      </div>`;
  },

  _emptyCard() {
    return `
      <div class="card">
        <h3>🏋️ 力量训练 <span class="h-extra">模板 · 轮转 · 计划 vs 实际</span></h3>
        <div class="empty">这一天还没有训练记录。可以从示例模板开始，或导入旧应用导出的历史数据。</div>
        <div class="row">
          <button class="btn primary" id="st-sample">用示例模板开始</button>
          <button class="btn" id="st-newtpl">新建空白模板</button>
          <button class="btn" id="st-import-empty">导入历史数据</button>
        </div>
      </div>`;
  },

  _bindEmpty(root) {
    const sample = $('#st-sample', root);
    if (sample) sample.onclick = () => this._createSample();
    const blank = $('#st-newtpl', root);
    if (blank) blank.onclick = () => { this._blankDraft(); this.ui.tab = 'template'; App.render(); };
    const imp = $('#st-import-empty', root);
    if (imp) imp.onclick = () => this._importModal();
  },

  /* 示例模板：空态与模板页共用（部位用于成长曲线归类） */
  _createSample() {
    const r = Core.replaceTemplate(Store.db.strength, {
      name: '三分化启动计划',
      days: [
        { dayKey: 'push', name: '推日（胸肩三头）', bodyPart: '胸', actions: [
          { name: '俯卧撑', plannedSets: 4, plannedRepsText: '12-15', targetText: '力竭前留 2 次' },
          { name: '哑铃肩推', plannedSets: 4, plannedRepsText: '10-12', plannedWeightText: '轻重量' }
        ] },
        { dayKey: 'pull', name: '拉日（背二头）', bodyPart: '背', actions: [
          { name: '弹力带划船', plannedSets: 4, plannedRepsText: '12-15' },
          { name: '面拉', plannedSets: 3, plannedRepsText: '15' }
        ] },
        { dayKey: 'legs', name: '腿日（臀腿）', bodyPart: '腿', actions: [
          { name: '徒手深蹲', plannedSets: 4, plannedRepsText: '15-20' },
          { name: '臀桥', plannedSets: 4, plannedRepsText: '15' }
        ] }
      ]
    });
    if (!r.ok) { toast(r.error, 'red'); return; }
    this.ui.tplDraft = null;
    Store.save(true);
    toast('已创建示例模板');
    App.render();
  },

  _todayCard(info) {
    const state = Store.db.strength;
    const day = info.day;
    const today = Core.businessDate();
    /* 休息日且还没开始：不展示动作表，只给一张休息卡 + 一键进入下一训练日 */
    if (day.isRest && (info.preview || day.status === 'not-started')) {
      return `
      <div class="card" id="st-today">
        <h3>🛌 ${esc(day.name)}
          <span class="h-extra">${esc(info.templateName || '')} · 休息日${info.preview ? ' · 预览' : ''}</span>
        </h3>
        <div class="empty">今天是休息日：恢复为主，睡好吃好。休息完点下面的按钮轮转到下一个训练日；也可以先去练别的，回来再收尾。</div>
        <div class="row" style="margin-top:14px">
          <button class="btn primary" id="st-rest-done">✓ 休息完毕，进入下一训练日</button>
        </div>
      </div>`;
    }
    const st = Core.STATUS_LABELS[day.status] || day.status;
    /* P1-2：只有「今天的、进行中、未暂停」且秒表在走才算 running；补记过去日期不走秒 */
    const isToday = day.date === today;
    const running = isToday && Core.timerShouldRun(day, today)
      && !!this.timer && this.timer.date === day.date && this.timer.running;
    const totalSec = (day.totalSeconds || 0) + (this.timer && this.timer.date === day.date ? this.timer.seconds : 0);
    const supp = day.supplements || {};
    return `
      <div class="card" id="st-today">
        <h3>🏋️ ${esc(day.name)}
          <span class="h-extra">${esc(info.templateName || '')}${day.bodyPart ? ' · ' + esc(day.bodyPart) : ''} · ${st}${info.preview ? ' · 预览' : ''}</span>
        </h3>
        ${info.preview && day.note ? `<div class="hint">${esc(day.note)}</div>` : ''}
        <div class="st-timer-row">
          <div class="st-timer ${running ? 'running' : ''}" id="st-timer">${fmtSeconds(totalSec)}</div>
          <div class="row">
            ${!isToday && day.status === 'in-progress'
              ? '<span class="hint">补记不计时：时长请填下面的「确认时长」</span>'
              : (info.preview || day.status === 'not-started'
                ? '<button class="btn primary" id="st-start">▶ 开始训练</button>'
                : (running
                  ? '<button class="btn" id="st-pause">⏸ 暂停</button>'
                  : '<button class="btn primary" id="st-resume">▶ 继续</button>'))}
          </div>
        </div>
        <div class="st-table" id="st-actions">
          <div class="st-tr st-th">
            <span>动作</span><span>计划</span><span>完成组</span><span>实际次数</span><span>负重kg</span><span>上次</span>
          </div>
          ${day.actions.map((a, i) => {
            /* 「上次」列改为 prefill 提示：占位符直接给出上次数据，只改有提升的数字 */
            const last = Core.lastActual(state, day.templateId, a.actionKey, day.date);
            const lastTxt = last ? `上次 ${last.date.slice(5)}` : '首次';
            const setsPh = last && typeof last.action.setsDone === 'number' ? `上次 ${last.action.setsDone} 组` : '';
            const weightPh = last && typeof last.action.weightKg === 'number'
              ? `上次 ${last.action.weightKg}kg×${last.action.repsText || '?'}` : '自重';
            return `
            <div class="st-tr">
              <span class="st-name">${esc(a.name)}${a.note ? `<i class="hint">${esc(a.targetText || a.note)}</i>` : (a.targetText ? `<i class="hint">${esc(a.targetText)}</i>` : '')}</span>
              <span class="st-plan">${a.plannedSets} 组 × ${esc(a.plannedRepsText || '?')}${a.plannedWeightText ? ' · ' + esc(a.plannedWeightText) : ''}</span>
              <span><input class="input st-num" data-idx="${i}" data-key="setsDone" type="number" min="0" max="999" placeholder="${esc(setsPh)}" value="${a.setsDone !== null && a.setsDone !== undefined ? a.setsDone : ''}" ${info.preview ? 'disabled' : ''}></span>
              <span><input class="input" data-idx="${i}" data-key="repsText" type="text" maxlength="60" placeholder="如 12-15" value="${esc(a.repsText)}" ${info.preview ? 'disabled' : ''}></span>
              <span><input class="input st-num" data-idx="${i}" data-key="weightKg" type="number" min="0" step="0.5" placeholder="${esc(weightPh)}" value="${a.weightKg !== null && a.weightKg !== undefined ? a.weightKg : ''}" ${info.preview ? 'disabled' : ''}></span>
              <span class="st-last">${esc(lastTxt)}</span>
            </div>`;
          }).join('')}
        </div>
        ${!info.preview ? `
        <div class="st-supps" style="${S.supps}">
          <div class="st-supps-line" style="${S.suppsLine}">
            <button class="btn st-tri" data-sup="creatineTaken" data-state="${triState(supp.creatineTaken)}" data-no-icon="true">肌酸 · ${triLabel(supp.creatineTaken)}</button>
            <button class="btn st-tri" data-sup="proteinPowderTaken" data-state="${triState(supp.proteinPowderTaken)}" data-no-icon="true">蛋白粉 · ${triLabel(supp.proteinPowderTaken)}</button>
            <label style="${S.inlineLabel}">确认时长（分钟）
              <input class="input st-num" id="st-conf-min" type="number" min="0" step="1" placeholder="选填" value="${day.confirmedDurationMinutes !== null && day.confirmedDurationMinutes !== undefined ? day.confirmedDurationMinutes : ''}"></label>
          </div>
          <div class="st-supps-line" style="${S.suppsLine}">
            <label style="${S.inlineLabel}; flex:1; min-width:200px">补剂备注
              <input class="input" id="st-supp-note" maxlength="500" placeholder="选填，如：训练后 30 分钟内" value="${esc(supp.note || '')}"></label>
            <label style="${S.inlineLabel}; flex:1; min-width:200px">当日备注
              <input class="input" id="st-day-note" maxlength="500" placeholder="选填" value="${esc(day.note || '')}"></label>
          </div>
        </div>` : ''}
        ${!info.preview ? `
        <div class="row" style="margin-top:14px">
          <button class="btn" id="st-prefill" data-no-icon="true">按计划填充</button>
          <button class="btn primary" id="st-save">保存实际数据</button>
          <button class="btn green" id="st-finish">✓ 完成并进入下一训练日</button>
          <button class="btn ghost" id="st-skip">跳过这一天</button>
        </div>` : `
        <div class="row" style="margin-top:14px">
          <span class="hint">这是 ${(this.ui.date || Core.businessDate()) === Core.businessDate() ? '今天' : '当天'} 的计划预览，点「开始训练」后即可记录（可补记过去的日子）。</span>
        </div>`}
      </div>`;
  },

  _bindToday(root, info) {
    const state = Store.db.strength;
    const day = info.day;
    const startBtn = $('#st-start', root);
    if (startBtn) startBtn.onclick = () => {
      this._flushTimer(); // 先把可能挂在其他日期上的秒数落回它自己的日期，避免丢秒
      const r = Core.startTraining(state, { date: day.date });
      if (!r.ok) { toast(r.error, 'red'); return; }
      this._ensureTimerFor(r.day, Core.businessDate()); // 补记过去日期时这里不会启动秒表
      Store.save(true);
      App.render();
    };
    const pauseBtn = $('#st-pause', root);
    if (pauseBtn) pauseBtn.onclick = () => {
      this._flushTimer(); // 先落秒再暂停，不丢秒
      const r = Core.pauseTraining(state, { date: day.date });
      if (!r.ok) { toast(r.error, 'red'); return; }
      this._ensureTimerFor(r.day, Core.businessDate());
      Store.save(true);
      App.render();
    };
    const resumeBtn = $('#st-resume', root);
    if (resumeBtn) resumeBtn.onclick = () => {
      const r = Core.resumeTraining(state, { date: day.date });
      if (!r.ok) { toast(r.error, 'red'); return; }
      this._ensureTimerFor(r.day, Core.businessDate());
      Store.save(true);
      App.render();
    };
    const saveBtn = $('#st-save', root);
    if (saveBtn) saveBtn.onclick = () => this._saveActual(root, day, false);
    /* 一键按计划值填充实际数据（自重动作负重留空），改完仍需手动保存 */
    const prefillBtn = $('#st-prefill', root);
    if (prefillBtn) prefillBtn.onclick = () => {
      $$('#st-actions .st-tr', root).forEach((tr) => {
        if (!tr.querySelector('.st-num')) return;
        const a = day.actions[Number(tr.querySelector('[data-idx]').dataset.idx)];
        const set = (key, val) => {
          const el = tr.querySelector(`[data-key="${key}"]`);
          if (el) el.value = val;
        };
        set('setsDone', a.plannedSets || '');
        set('repsText', a.plannedRepsText || '');
        const w = String(a.plannedWeightText || '').match(/\d+(?:\.\d+)?/);
        set('weightKg', w ? w[0] : '');
      });
      toast('已按计划填充，改完记得保存');
    };
    /* 休息日一键收尾：开始即完成并轮转（无实际数据 → completed） */
    const restDone = $('#st-rest-done', root);
    if (restDone) restDone.onclick = () => {
      const s = Core.startTraining(state, { date: day.date });
      if (!s.ok) { toast(s.error, 'red'); return; }
      const f = Core.finishAndAdvance(state, { date: day.date, note: '休息日' });
      if (!f.ok) { toast(f.error, 'red'); return; }
      this.timer = null;
      Store.save(true);
      toast('休息完毕，进入下一训练日');
      App.render();
    };
    const finishBtn = $('#st-finish', root);
    if (finishBtn) finishBtn.onclick = () => this._saveActual(root, day, true);
    const skipBtn = $('#st-skip', root);
    if (skipBtn) skipBtn.onclick = async () => {
      if (!await confirmModal('跳过这一天的训练？', '这一天会标记为「已跳过」，轮转到下一个训练日。', '跳过')) return;
      this._flushTimer();
      const r = Core.skipAndAdvance(state, { date: day.date, note: '' });
      if (!r.ok) { toast(r.error, 'red'); return; }
      this.timer = null;
      Store.save(true);
      toast('已跳过，轮转到下一训练日');
      App.render();
    };
    /* 补剂三态：未记 → 已服 ✓ → 未服 ✗ 循环，点击即落盘 */
    $$('.st-tri', root).forEach((btn) => {
      btn.onclick = () => {
        const next = btn.dataset.state === 'unknown' ? true : btn.dataset.state === 'yes' ? false : null;
        const r = Core.saveTraining(state, { date: day.date, supplements: { [btn.dataset.sup]: next } });
        if (!r.ok) { toast(r.error, 'red'); return; }
        Store.save(true);
        App.render();
      };
    });
    const conf = $('#st-conf-min', root);
    if (conf) conf.onchange = () => {
      const raw = conf.value.trim();
      let val = null;
      if (raw !== '') {
        const n = Number(raw);
        if (!Number.isSafeInteger(n) || n < 0 || n > 525600) {
          toast('时长需为 0~525600 的整数分钟', 'red');
          conf.value = day.confirmedDurationMinutes !== null && day.confirmedDurationMinutes !== undefined ? day.confirmedDurationMinutes : '';
          return;
        }
        val = n;
      }
      const r = Core.saveTraining(state, { date: day.date, confirmedDurationMinutes: val });
      if (!r.ok) { toast(r.error, 'red'); return; }
      Store.save(true);
      toast('已记录确认时长');
    };
    const dayNote = $('#st-day-note', root);
    if (dayNote) dayNote.onchange = () => {
      const r = Core.saveTraining(state, { date: day.date, note: dayNote.value });
      if (!r.ok) { toast(r.error, 'red'); return; }
      Store.save(true);
    };
    const suppNote = $('#st-supp-note', root);
    if (suppNote) suppNote.onchange = () => {
      const r = Core.saveTraining(state, { date: day.date, supplements: { note: suppNote.value } });
      if (!r.ok) { toast(r.error, 'red'); return; }
      Store.save(true);
    };
  },

  /* 收集表格输入 → saveTraining；withFinish 时先保存再弹收尾确认 */
  async _saveActual(root, day, withFinish) {
    const actions = $$('#st-actions .st-tr', root)
      .filter((tr) => tr.querySelector('.st-num'))
      .map((tr) => {
        const get = (key) => {
          const el = tr.querySelector(`[data-key="${key}"]`);
          return el ? el.value : '';
        };
        const sets = get('setsDone');
        const weight = get('weightKg');
        return {
          actionKey: day.actions[Number(tr.querySelector('[data-idx]').dataset.idx)].actionKey,
          setsDone: sets === '' ? null : Math.max(0, Math.floor(Number(sets))),
          repsText: get('repsText').trim(),
          weightKg: weight === '' ? null : Number(weight)
        };
      });
    for (const a of actions) {
      if (a.weightKg !== null && (!Number.isFinite(a.weightKg) || a.weightKg < 0)) { toast('负重数值无效', 'red'); return; }
    }
    this._flushTimer();
    const r = Core.saveTraining(Store.db.strength, { date: day.date, actions });
    if (!r.ok) { toast(r.error, 'red'); return; }
    Store.save(true);
    if (withFinish) {
      const card = openModal(`
        <h3>✓ 完成并进入下一训练日</h3>
        <div class="field"><label>完成感言（可留空）</label><textarea class="textarea" id="st-fin-text" rows="3" maxlength="2000" placeholder="今天的收获、状态或想对自己说的话"></textarea></div>
        <div class="field"><label>收尾备注（可留空）</label><textarea class="textarea" id="st-fin-note" rows="2" maxlength="2000"></textarea></div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn ghost" id="st-fin-cancel">取消</button>
          <button class="btn primary" id="st-fin-ok">完成收尾</button>
        </div>`);
      $('#st-fin-cancel', card).onclick = () => {
        closeModal();
        // 取消收尾：训练仍在进行中，计时继续（P1-1）
        this._ensureTimerFor(Core.dayRecord(Store.db.strength, day.date), Core.businessDate());
        App.render();
      };
      $('#st-fin-ok', card).onclick = () => {
        const text = $('#st-fin-text', card).value.trim();
        const note = $('#st-fin-note', card).value.trim();
        closeModal();
        if (text) {
          const sr = Core.saveTraining(Store.db.strength, { date: day.date, completionText: text });
          if (!sr.ok) { toast(sr.error, 'red'); return; }
        }
        const fr = Core.finishAndAdvance(Store.db.strength, { date: day.date, note });
        if (!fr.ok) { toast(fr.error, 'red'); return; }
        this.timer = null;
        Store.save(true);
        toast('已收尾，轮转到下一训练日');
        App.render();
      };
    } else {
      // P1-1：保存后训练仍在进行 → 秒表继续走（秒数已随 _flushTimer 落盘，从 0 续计不双计）
      this._ensureTimerFor(Core.dayRecord(Store.db.strength, day.date), Core.businessDate());
      toast('已保存');
    }
    App.render();
  },

  /* P1-1/P1-2 走秒状态机唯一入口：开始/保存/暂停/继续/离开/跨日期都经这里收敛。
     该走秒时启动或续走（保存后秒数已落盘，从 0 续计，不双计）；
     不该走秒时先把秒数落回它自己的日期（不丢秒），再停表。 */
  _ensureTimerFor(day, todayStr) {
    if (Core.timerShouldRun(day, todayStr)) {
      const same = this.timer && this.timer.date === day.date;
      this.timer = { date: day.date, seconds: same ? (this.timer.seconds || 0) : 0, running: true };
    } else {
      this._flushTimer();
    }
  },

  _flushTimer() {
    if (!this.timer || !this.timer.running) return;
    const day = Core.dayRecord(Store.db.strength, this.timer.date);
    if (day && this.timer.seconds > 0) {
      Core.advanceDaySeconds(Store.db.strength, this.timer.date, this.timer.seconds);
    }
    this.timer = { date: this.timer.date, seconds: 0, running: false };
  },

  /* 每秒计时（由 App 全局 interval 调用） */
  tick() {
    if (!this.timer || !this.timer.running) return;
    if (App.currentView !== 'strength') { this._flushTimer(); Store.save(); return; }
    // 午夜边界：timer 只累计其拥有日期（训练开始当天）的秒数。
    // 跨零点先把零点前已累计秒数落回拥有日期，随即停表——零点后的时间不写回前日。
    if (Core.businessDate() !== this.timer.date) {
      this._flushTimer();
      Store.save();
      return;
    }
    this.timer.seconds += 1;
    const el = $('#st-timer');
    if (el) {
      const day = Core.dayRecord(Store.db.strength, this.timer.date);
      el.textContent = fmtSeconds((day ? day.totalSeconds || 0 : 0) + this.timer.seconds);
    }
    if (this.timer.seconds % 30 === 0) {
      this._flushTimer();
      this.timer.running = true; // 周期落盘后继续走秒
      Store.save();
    }
  },

  /* ================= 标签页二：成长曲线 ================= */
  _trendsView(state) {
    const snap = Core.trendsSnapshot(state, Core.businessDate(), 12);
    const totalSessions = snap.series.reduce((t, s) => t + s.totalSessions, 0);
    const totalSets = snap.series.reduce((t, s) => t + s.totalSets, 0);
    const rec = Core.RECOMMENDED_WEEKLY_SETS;
    const weekRows = snap.series
      .map((s) => ({ s, p: s.points[s.points.length - 1] }))
      .filter((x) => x.p && x.p.sets > 0);
    return `
      <div class="card">
        <h3>🔥 成长曲线 <span class="h-extra">近 ${snap.weeks.length} 周 · 按训练部位统计</span></h3>
        <div class="stat-row">
          <div class="stat-box"><b>${snap.currentStreakWeeks} 周</b><span>连续训练</span></div>
          <div class="stat-box"><b>${snap.series.length} 个</b><span>训练部位</span></div>
          <div class="stat-box"><b>${totalSessions} 次</b><span>累计训练</span></div>
          <div class="stat-box"><b>${totalSets} 组</b><span>累计组数</span></div>
        </div>
      </div>
      <div class="card">
        <h3>📈 每周容量曲线 <span class="h-extra">容量分 = 组数 × 5 + 次数 × 0.5</span></h3>
        ${snap.series.length ? this._trendsChartHtml(snap) : '<div class="empty">暂无训练记录。</div>'}
      </div>
      <div class="card">
        <h3>🗓️ 本周概览 <span class="h-extra">推荐每个部位每周 ${rec.min}–${rec.max} 组</span></h3>
        ${weekRows.length ? weekRows.map(({ s, p }) => {
          const ok = p.sets >= rec.min;
          return `
          <div class="st-week-item" style="margin-bottom:12px">
            <div style="display:flex; align-items:baseline; gap:10px; font-size:13px; margin-bottom:4px">
              <b>${esc(s.bodyPart)}</b><span class="hint">${p.sets} 组 · ${p.sessions} 练</span>
              <em class="${ok ? 'is-ok' : ''}" style="font-style:normal; margin-left:auto; font-size:12px; color:${ok ? '#15803d' : 'rgba(44,58,71,.55)'}">${ok ? '已进入推荐区间' : `推荐每周 ${rec.min}–${rec.max} 组`}</em>
            </div>
            <div class="st-meter-wrap" style="${S.meterWrap}">
              <i class="st-meter-band" style="position:absolute; top:0; left:50%; width:50%; height:100%; background:rgba(79,124,255,.14)"></i>
              <i class="st-meter-fill" style="${S.meterFill}; width:${Math.min(1, p.sets / rec.max) * 100}%"></i>
            </div>
          </div>`;
        }).join('') : '<div class="empty">本周还没有训练量，练一波再来看。</div>'}
      </div>
      <div class="card">
        <h3>🏋️ 最近训练 <span class="h-extra">最多 10 条</span></h3>
        ${snap.recentSessions.length ? `<div class="st-sessions" style="display:grid; gap:6px">
          ${snap.recentSessions.map((sess) => `
            <div class="st-session-row" style="${S.sessionRow}">
              <div class="t-name" style="flex:1; min-width:0">
                <b>${mdDate(sess.businessDate)} · ${esc(sess.bodyPart)}</b>
                <span class="hint">${esc(sess.dayName)} · ${sess.sets} 组 · ${sess.reps} 次 · 容量 ${sess.volume}${sess.loadVolumeKg !== null ? ' · 负重 ' + sess.loadVolumeKg + 'kg' : ''}</span>
                <i class="hint" style="display:block; font-style:normal">${esc(sess.actions.map((a) => `${a.name} ${a.sets}×${a.reps}`).join('，'))}</i>
              </div>
            </div>`).join('')}
        </div>` : '<div class="empty">近 12 周还没有训练记录。</div>'}
      </div>`;
  },

  /* 每周容量折线图：一个部位一条线，文字一律放 SVG 外的图例 */
  _trendsChartHtml(snap) {
    const W = 720, H = 260, padX = 14, padTop = 18, padBottom = 18;
    const n = snap.weeks.length;
    const maxVolume = snap.series.reduce((mx, s) => Math.max(mx, ...s.points.map((p) => p.volume)), 0);
    const maxVol = Math.max(10, maxVolume * 1.15);
    const x = (i) => (n > 1 ? padX + (i * (W - padX * 2)) / (n - 1) : W / 2);
    const y = (v) => H - padBottom - (v / maxVol) * (H - padTop - padBottom);
    const lines = snap.series.map((s, si) => {
      const color = CHART_COLORS[si % CHART_COLORS.length];
      const pts = s.points.map((p, i) => `${x(i).toFixed(1)},${y(p.volume).toFixed(1)}`).join(' ');
      const dots = s.points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.volume).toFixed(1)}" r="3.5" fill="${color}"/>`).join('');
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
    }).join('');
    return `
      <svg class="st-chart" viewBox="0 0 720 260" preserveAspectRatio="none" role="img" aria-label="每周训练容量曲线"
        style="display:block; width:100%; height:220px">${lines}</svg>
      <div class="st-chart-legend" style="display:flex; flex-wrap:wrap; gap:12px; margin-top:8px; font-size:12px; color:rgba(44,58,71,.7)">
        ${snap.series.map((s, si) => `
          <span><i class="st-legend-dot" style="display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; background:${CHART_COLORS[si % CHART_COLORS.length]}"></i>${esc(s.bodyPart)}</span>`).join('')}
      </div>`;
  },

  /* 成长曲线当前为只读展示，无交互元素 */
  _bindTrends() {},

  /* ================= 标签页三：训练日模板（整页编辑器） ================= */
  _templateView(state) {
    const today = Core.businessDate();
    const date = this.ui.date || today;
    const tpl = this._editTpl(state);
    const version = tpl ? Core.currentVersion(tpl) : null;
    // 草稿只在首次进入时从当前版本初始化，卡内编辑只改草稿，保存才落库；tplDirty 跟踪是否有未保存修改
    if (!this.ui.tplDraft && version) {
      this.ui.tplDirty = false;
      this.ui.tplDraft = {
        name: tpl.name, effectiveFrom: date, changeNote: '',
        days: version.days.map((d) => ({
          dayKey: d.dayKey, name: d.name, bodyPart: d.bodyPart || '', isRest: !!d.isRest,
          actions: d.actions.map((a) => ({
            actionKey: a.actionKey, name: a.name, plannedSets: a.plannedSets,
            plannedRepsText: a.plannedRepsText || '', plannedWeightText: a.plannedWeightText || '',
            targetText: a.targetText || ''
          }))
        }))
      };
    }
    const draft = this.ui.tplDraft;
    return `
      <div class="card st-dateform" style="${S.dateform}; margin-bottom:14px">
        <label style="${S.label}">记录日期
          <input class="input" id="st-tf-date" type="date" max="${today}" value="${date}"></label>
        <button class="btn" id="st-tf-go">切换日期</button>
      </div>
      ${!draft ? `
      <div class="card">
        <h3>✍️ 训练日模板</h3>
        <div class="empty">还没有训练模板。先定义训练日（例如推 / 拉 / 腿），再往每个训练日里添加动作。</div>
        <div class="row">
          <button class="btn primary" id="st-tpl-sample">用示例模板开始</button>
          <button class="btn" id="st-tpl-blank">新建空白模板</button>
          <button class="btn" id="st-tpl-import">导入数据（文本/JSON）</button>
        </div>
      </div>` : `
      <div class="card">
        <h3>✍️ 训练日模板 <span class="h-extra">${tpl ? `当前第 ${tpl.currentRevision} 版` : '新建模板'}</span></h3>
        <p class="hint">保存会创建不可变的新版本；历史训练及其计划快照不会被改写。部位（如 胸/背/腿）用于成长曲线归类。</p>
        ${state.templates.length > 1 ? `
        <div style="margin-bottom:10px">
          <label style="${S.inlineLabel}">编辑哪个模板
            <select class="input" id="st-tpl-select" style="max-width:300px">
              ${state.templates.map((t) => `<option value="${esc(t.id)}"${tpl && t.id === tpl.id ? ' selected' : ''}>${esc(t.name)}（第 ${t.currentRevision} 版）</option>`).join('')}
            </select></label>
          <span class="hint" style="margin-left:8px">切换会丢弃未保存的编辑</span>
        </div>` : ''}
        <div class="st-tpl-head" style="display:grid; grid-template-columns:1.1fr .8fr 1.3fr; gap:10px; margin-top:10px">
          <label style="${S.label}">模板名称
            <input class="input" id="st-tpl-name" maxlength="160" value="${esc(draft.name)}"></label>
          <label style="${S.label}">生效日期
            <input class="input" id="st-tpl-eff" type="date" value="${esc(draft.effectiveFrom)}"></label>
          <label style="${S.label}">变更说明
            <input class="input" id="st-tpl-note" maxlength="200" placeholder="为什么改？如：加量 10%" value="${esc(draft.changeNote || '')}"></label>
        </div>
        <div class="st-tpl-days" style="display:grid; gap:12px; margin:12px 0">
          ${draft.days.map((d, di) => this._tplDayHtml(d, di)).join('')}
        </div>
        <div class="row" style="justify-content:space-between">
          <div class="row" style="gap:8px">
            <button class="btn" id="st-day-add">+ 添加训练日</button>
            <button class="btn" id="st-tpl-import">导入数据（文本/JSON）</button>
            <button class="btn" id="st-tpl-export">导出备份</button>
          </div>
          <button class="btn primary" id="st-tpl-save">${tpl ? `保存为新版本（第 ${tpl.currentRevision + 1} 版）` : '创建模板'}</button>
        </div>
      </div>`}`;
  },

  _tplDayHtml(d, di) {
    return `
      <div class="st-tpl-day" data-di="${di}" style="${S.tplDay}">
        <div class="st-tpl-day-head" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
          <b>训练日 ${di + 1}</b>
          <label style="${S.inlineLabel}">日名
            <input class="input" data-dkey="name" maxlength="160" value="${esc(d.name)}"></label>
          <label style="${S.inlineLabel}">部位
            <input class="input" data-dkey="bodyPart" maxlength="40" placeholder="如 胸/背/腿" value="${esc(d.bodyPart)}"></label>
          <label style="display:inline-flex; align-items:center; gap:5px; font-size:12.5px">
            <input type="checkbox" data-dkey="isRest" ${d.isRest ? 'checked' : ''}> 休息日</label>
          <button class="btn ghost" data-del-day="${di}" data-no-icon="true" style="margin-left:auto; padding:4px 10px">删</button>
        </div>
        <div class="st-act-grid">
          <span>动作名</span><span>组数</span><span>次数</span><span>负重说明</span><span>目标</span><span></span>
        </div>
        ${d.actions.map((a, ai) => `
          <div class="st-act-row">
            <input class="input" data-ai="${ai}" data-akey="name" maxlength="200" placeholder="动作名" value="${esc(a.name)}">
            <input class="input st-num" data-ai="${ai}" data-akey="plannedSets" type="number" min="0" max="999" value="${esc(String(a.plannedSets))}">
            <input class="input" data-ai="${ai}" data-akey="plannedRepsText" maxlength="60" placeholder="12-15" value="${esc(a.plannedRepsText)}">
            <input class="input" data-ai="${ai}" data-akey="plannedWeightText" maxlength="120" placeholder="如 40kg" value="${esc(a.plannedWeightText)}">
            <input class="input" data-ai="${ai}" data-akey="targetText" maxlength="200" placeholder="选填" value="${esc(a.targetText)}">
            <button class="btn ghost" data-del-act="${ai}" data-no-icon="true" style="padding:4px 8px">删</button>
          </div>`).join('')}
        <button class="btn st-add" data-add-act="${di}" data-no-icon="true" style="justify-self:start; padding:5px 12px">+ 添加动作</button>
      </div>`;
  },

  _bindTemplate(root) {
    const draft = this.ui.tplDraft;
    const today = Core.businessDate();
    // 导入 / 导出 / 模板切换：空态与编辑态都可用
    const impBtn = $('#st-tpl-import', root);
    if (impBtn) impBtn.onclick = () => this._importModal();
    const expBtn = $('#st-tpl-export', root);
    if (expBtn) expBtn.onclick = () => this._exportModal();
    const sel = $('#st-tpl-select', root);
    if (sel) sel.onchange = async () => {
      if (this.ui.tplDirty) {
        const ok = await confirmModal('切换模板？', '编辑器里有未保存的修改，切换后会丢失。', '丢弃并切换');
        if (!ok) { App.render(); return; }
      }
      this.ui.tplEditId = sel.value;
      this.ui.tplDraft = null;
      this.ui.tplDirty = false;
      App.render();
    };
    // 记录日期表单：切换后 ui.date 更新，草稿的生效日期默认值跟随
    const go = $('#st-tf-go', root);
    if (go) go.onclick = () => {
      const v = $('#st-tf-date', root).value;
      if (!v || !Core.isBusinessDate(v)) { toast('日期格式无效', 'red'); return; }
      if (v > today) { toast('不能选择未来的日期', 'red'); return; }
      this.ui.date = v;
      if (draft) draft.effectiveFrom = v;
      App.render();
    };
    if (!draft) {
      const sample = $('#st-tpl-sample', root);
      if (sample) sample.onclick = () => this._createSample();
      const blank = $('#st-tpl-blank', root);
      if (blank) blank.onclick = () => { this._blankDraft(); App.render(); };
      return;
    }
    const bind = (id, key) => {
      const el = $(id, root);
      if (el) el.oninput = () => { draft[key] = el.value; this.ui.tplDirty = true; };
    };
    bind('#st-tpl-name', 'name');
    bind('#st-tpl-eff', 'effectiveFrom');
    bind('#st-tpl-note', 'changeNote');
    $$('.st-tpl-day', root).forEach((dayEl) => {
      const di = Number(dayEl.dataset.di);
      $$('[data-dkey]', dayEl).forEach((input) => {
        const key = input.dataset.dkey;
        if (input.type === 'checkbox') input.onchange = () => { draft.days[di].isRest = input.checked; this.ui.tplDirty = true; };
        else input.oninput = () => { draft.days[di][key] = input.value; this.ui.tplDirty = true; };
      });
      $$('[data-akey]', dayEl).forEach((input) => {
        const ai = Number(input.dataset.ai);
        const key = input.dataset.akey;
        input.oninput = () => {
          draft.days[di].actions[ai][key] = key === 'plannedSets' ? (Number(input.value) || 0) : input.value;
          this.ui.tplDirty = true;
        };
      });
      const delAct = (ai) => { draft.days[di].actions.splice(ai, 1); this.ui.tplDirty = true; App.render(); };
      $$('[data-del-act]', dayEl).forEach((btn) => { btn.onclick = () => delAct(Number(btn.dataset.delAct)); });
      const addAct = dayEl.querySelector('[data-add-act]');
      if (addAct) addAct.onclick = () => {
        draft.days[di].actions.push({ actionKey: uid('act'), name: '', plannedSets: 3, plannedRepsText: '', plannedWeightText: '', targetText: '' });
        this.ui.tplDirty = true;
        App.render();
      };
      const delDay = dayEl.querySelector('[data-del-day]');
      if (delDay) delDay.onclick = () => {
        if (draft.days.length <= 1) { toast('至少保留一个训练日', 'red'); return; }
        draft.days.splice(di, 1);
        this.ui.tplDirty = true;
        App.render();
      };
    });
    const addDay = $('#st-day-add', root);
    if (addDay) addDay.onclick = () => {
      draft.days.push({
        dayKey: uid('day'), name: `训练日 ${draft.days.length + 1}`, bodyPart: '', isRest: false,
        actions: [{ actionKey: uid('act'), name: '', plannedSets: 3, plannedRepsText: '', plannedWeightText: '', targetText: '' }]
      });
      this.ui.tplDirty = true;
      App.render();
    };
    const save = $('#st-tpl-save', root);
    if (save) save.onclick = () => this._saveTemplate();
  },

  /* 组装草稿 → replaceTemplate（保留 dayKey/actionKey，历史「上次」对比不断链） */
  _saveTemplate() {
    const state = Store.db.strength;
    const tpl = this._editTpl(state);
    const draft = this.ui.tplDraft;
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toast('请填写模板名称', 'red'); return; }
    const days = draft.days.map((d) => ({
      dayKey: d.dayKey || undefined, name: d.name, bodyPart: d.bodyPart || '', isRest: !!d.isRest,
      actions: d.actions.map((a) => ({
        actionKey: a.actionKey || undefined, name: a.name,
        plannedSets: Math.max(0, Number(a.plannedSets) | 0),
        plannedRepsText: a.plannedRepsText || '', plannedWeightText: a.plannedWeightText || '',
        targetText: a.targetText || ''
      }))
    }));
    const r = Core.replaceTemplate(state, { id: tpl ? tpl.id : undefined, name, changeNote: draft.changeNote, days });
    if (!r.ok) { toast(r.error, 'red'); return; }
    this.ui.tplDraft = null;
    Store.save(true);
    toast(tpl ? `已更新到第 ${r.template.currentRevision} 版` : '模板已创建');
    App.render();
  },

  _blankDraft() {
    this.ui.tplDraft = {
      name: '我的训练计划', effectiveFrom: this.ui.date || Core.businessDate(), changeNote: '首次创建',
      days: [{
        dayKey: uid('day'), name: '训练日 1', bodyPart: '', isRest: false,
        actions: [{ actionKey: uid('act'), name: '', plannedSets: 3, plannedRepsText: '', plannedWeightText: '', targetText: '' }]
      }]
    };
  },

  /* ================= 标签页四：训练历史 ================= */
  _historyView(state) {
    const today = Core.businessDate();
    const date = this.ui.date || today;
    const pageSize = 20;
    const page = Math.max(1, this.ui.historyPage || 1);
    const { total, entries } = Core.historyEntries(state, page, pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return `
      <div class="card st-dateform" style="${S.dateform}; margin-bottom:14px">
        <label style="${S.label}">记录日期
          <input class="input" id="st-hf-date" type="date" max="${today}" value="${date}"></label>
        <button class="btn" id="st-hf-go">查看这一天</button>
      </div>
      <div class="card">
        <h3>🗓️ 训练历史 <span class="h-extra">共 ${total} 条 · 点行看计划 vs 实际</span></h3>
        ${entries.length ? `<div class="strength-history">
          ${entries.map((d) => this._historyRow(d)).join('')}
        </div>` : '<div class="empty">还没有训练记录。</div>'}
        ${total > 0 ? `
        <div class="st-pager" style="display:flex; align-items:center; justify-content:center; gap:14px; margin-top:12px">
          <button class="btn ghost" id="st-page-prev" data-no-icon="true" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="hint">第 ${Math.min(page, totalPages)} / ${totalPages} 页 · 共 ${total} 条</span>
          <button class="btn ghost" id="st-page-next" data-no-icon="true" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
        </div>` : ''}
      </div>`;
  },

  _bindHistory(root) {
    const prev = $('#st-page-prev', root);
    if (prev) prev.onclick = () => { this.ui.historyPage = Math.max(1, (this.ui.historyPage || 1) - 1); App.render(); };
    const next = $('#st-page-next', root);
    if (next) next.onclick = () => { this.ui.historyPage = (this.ui.historyPage || 1) + 1; App.render(); };
    $$('.st-history-row', root).forEach((el) => { el.onclick = () => this._dayModal(el.dataset.date); });
    const go = $('#st-hf-go', root);
    if (go) go.onclick = () => {
      const v = $('#st-hf-date', root).value;
      const today = Core.businessDate();
      if (!v || !Core.isBusinessDate(v)) { toast('日期格式无效', 'red'); return; }
      if (v > today) { toast('不能选择未来的日期', 'red'); return; }
      this.ui.date = v;
      if (!Core.dayRecord(Store.db.strength, v)) { toast('这一天还没有训练记录', 'red'); return; }
      this._dayModal(v);
    };
  },

  /* ================= 标签页五：模板更新记录 ================= */
  _updatesView(state) {
    const rows = Core.templateHistory(state);
    return `
      <div class="card">
        <h3>📋 模板更新记录 <span class="h-extra">改版只增不改，历史训练不受影响</span></h3>
        ${rows.length ? `<div class="st-updates" style="display:grid; gap:8px; margin-top:10px">
          ${rows.map((r) => `
            <div class="st-update-row" style="${S.updateRow}">
              <b style="font-size:13.5px">第 ${r.revision} 版 · ${mdDate(r.effectiveFrom)}生效</b>
              <span style="font-size:12.5px; color:rgba(44,58,71,.72)">${esc(r.changeNote) || '（无变更说明）'}</span>
              <small class="hint">创建于 ${esc(String(r.createdAt).slice(0, 16).replace('T', ' '))}</small>
            </div>`).join('')}
        </div>` : '<div class="empty">还没有模板更新记录。</div>'}
      </div>`;
  },

  /* ================= 标签页六：进步可视化（移植自 body-progress-dashboard） ================= */
  _progressHtml(state, date) {
    const muscles = Core.muscleProgress(state, date);
    const map = new Map(muscles.map((m) => [m.key, m]));
    const selected = map.get(this.ui.muscle)
      || muscles.find((m) => m.recentSets > 0)
      || muscles[0];
    this.ui.muscle = selected.key;
    const profile = state.bmiProfile || {};
    const h = Number(profile.heightCm), w = Number(profile.weightKg);
    const bmi = h >= 100 && h <= 250 && w >= 25 && w <= 400
      ? Math.round(w / ((h / 100) ** 2) * 10) / 10 : null;
    return `
      <div class="card st-progress">
        <h3>🎯 全身训练进步 <span class="h-extra">最近 28 天 · 点击肌群查看力量与增肌刺激</span></h3>
        <div class="st-progress-grid">
          <div class="st-bodywrap">
            <div class="st-body-labels"><span>正面</span><span>背面</span></div>
            <div class="st-bodystage">
              <img class="st-bodyimg" src="assets/img/muscle-body-map-v2.png" alt="正面与背面肌群进步图" draggable="false">
              ${BODY_HOTSPOTS.map((spot, index) => {
                const p = map.get(spot.key);
                if (!p) return '';
                const color = scoreColor(p);
                return `<button type="button" class="st-hotspot${selected.key === p.key ? ' selected' : ''}"
                  data-muscle="${p.key}" data-no-icon="true" aria-label="${p.label}，综合训练指数 ${p.overallScore}"
                  aria-pressed="${selected.key === p.key}"
                  style="--muscle-fill:${color}; left:${spot.x}%; top:${spot.y}%; width:${spot.width}%; height:${spot.height}%;
                    border-radius:${spot.radius || '46%'}; ${spot.clipPath ? `clip-path:${spot.clipPath};` : ''}
                    transform:rotate(${spot.rotate || 0}deg);"></button>`;
              }).join('')}
            </div>
          </div>
          <div class="st-detail">
            <div class="st-detail-head">
              <div><p>当前肌群</p><h4>${esc(selected.label)}</h4></div>
              <span class="st-confidence" data-confidence="${selected.confidence}">${confidenceLabel(selected.confidence)}</span>
            </div>
            <div class="st-scorehero"><strong>${selected.overallScore}</strong><span>/ 100 综合训练指数</span></div>
            ${this._meter('增肌刺激', selected.hypertrophyScore, false)}
            ${this._meter('力量趋势', selected.strengthScore ?? 0, selected.strengthScore === null)}
            <dl class="st-facts">
              <div><dt>28 天有效组</dt><dd>${selected.recentSets} 组</dd></div>
              <div><dt>训练次数</dt><dd>${selected.recentSessions} 次</dd></div>
              <div><dt>估算 1RM</dt><dd>${selected.bestE1rmKg === null ? '—' : `${selected.bestE1rmKg} kg`}</dd></div>
              <div><dt>力量变化</dt><dd>${formatChange(selected.strengthChangePercent)}</dd></div>
              <div><dt>负重容量</dt><dd>${selected.recentLoadVolumeKg === null ? '—' : `${selected.recentLoadVolumeKg} kg`}</dd></div>
              <div><dt>最近训练</dt><dd>${selected.lastTrainedAt ?? '—'}</dd></div>
            </dl>
            <p class="st-actions-line">${selected.actions.length ? esc(selected.actions.join(' · ')) : '还没有能关联到这个部位的动作'}</p>
          </div>
        </div>
        <div class="st-lower-grid">
          <div class="st-bmi">
            <div><p>身体指标</p><h4>我的 BMI</h4></div>
            <div class="st-bmi-inputs">
              <label>身高（cm）<input class="input" id="st-bmi-h" type="number" min="100" max="250" inputmode="decimal" value="${esc(String(profile.heightCm ?? ''))}"></label>
              <label>体重（kg）<input class="input" id="st-bmi-w" type="number" min="25" max="400" step="0.1" inputmode="decimal" value="${esc(String(profile.weightKg ?? ''))}"></label>
            </div>
            <output class="st-bmi-output" id="st-bmi-out" aria-live="polite">
              ${bmi === null ? '<span>填写身高和体重后自动计算</span>' : `<strong>${bmi}</strong><span>${bmiCategory(bmi)}</span>`}
            </output>
            <p class="hint">BMI = kg ÷ m²，只是成人筛查指标，无法区分肌肉与脂肪，不参与训练进步评分。</p>
          </div>
          <details class="st-algorithm">
            <summary>查看评分算法</summary>
            <div>
              <p><strong>增肌刺激：</strong>刺激组数完成度 60% + 负重容量趋势 25% + 每周频率 15%。主肌群计 1 组、辅助肌群计 0.5 组；完成度按分段曲线：10 组/周 到 90 分，10–20 组爬升到 100（推荐带），超过 20 组缓慢回落到 85（过度容量的恢复成本）；次数区间折算刺激性质——5–30 次全额、1–4 次 0.6（偏神经/力量）、30 次以上 0.7、未记次数 0.85。</p>
              <p><strong>力量趋势：</strong>同一动作的估算 1RM 变化 70% + 阻力重量变化 20% + 频率 10%，趋势取各动作前两高记录的平均以抗单次波动。估算 1RM：≤8 次用 Brzycki，9–10 次取 Brzycki 与 Epley 的平均（两者在区间上端分别偏低/偏高，平均可消偏差）；公式精度仅对 ≤10 次接近力竭的组成立（±5%），是同动作趋势代理，不能替代真实极限测试。</p>
              <p>这是训练日志趋势，不是实际肌肉增长率或医疗诊断。</p>
            </div>
          </details>
        </div>
      </div>`;
  },

  _meter(label, value, unavailable) {
    return `
      <div class="st-meter-row">
        <div><span>${label}</span><strong>${unavailable ? '—' : value}</strong></div>
        <div class="st-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${unavailable ? 0 : value}" aria-label="${label}${unavailable ? '数据不足' : ` ${value} 分`}">
          <i style="width:${unavailable ? 0 : value}%"></i>
        </div>
      </div>`;
  },

  _bindProgress(root) {
    $$('.st-hotspot', root).forEach((btn) => {
      btn.onclick = () => { this.ui.muscle = btn.dataset.muscle; App.render(); };
    });
    const hInput = $('#st-bmi-h', root), wInput = $('#st-bmi-w', root);
    if (!hInput || !wInput) return;
    const saveBmi = () => {
      const h = Number(hInput.value), w = Number(wInput.value);
      if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return;
      Store.db.strength.bmiProfile = { heightCm: h, weightKg: w };
      Store.save();
    };
    const recalc = () => {
      const h = Number(hInput.value), w = Number(wInput.value);
      const bmi = h >= 100 && h <= 250 && w >= 25 && w <= 400
        ? Math.round(w / ((h / 100) ** 2) * 10) / 10 : null;
      $('#st-bmi-out', root).innerHTML = bmi === null
        ? '<span>填写身高和体重后自动计算</span>'
        : `<strong>${bmi}</strong><span>${bmiCategory(bmi)}</span>`;
    };
    hInput.oninput = () => { recalc(); saveBmi(); };
    wInput.oninput = () => { recalc(); saveBmi(); };
  },

  /* ================= 共享组件与弹窗 ================= */
  /* 当前轮转模板：与 Core.todayPlan 的预览逻辑一致（最近一次轮转更新的那个）。
     之前多处写死 templates[0]，有多个模板时会编辑/显示到不是在练的那一个。 */
  _rotationTpl(state) {
    return state.templates
      .map((t) => ({ t, c: state.cycle[t.id] }))
      .filter((x) => x.c)
      .sort((a, b) => (b.c.updatedAt || '').localeCompare(a.c.updatedAt || ''))
      .map((x) => x.t)[0] || state.templates[0] || null;
  },

  /* 模板编辑器的编辑目标：默认轮转模板，ui.tplEditId 可切换 */
  _editTpl(state) {
    const byId = this.ui.tplEditId ? state.templates.find((t) => t.id === this.ui.tplEditId) : null;
    return byId || this._rotationTpl(state);
  },

  _historyRow(day) {
    const v = Core.volumeOf(day);
    const cls = { completed: 'ok', partial: 'part', skipped: 'none', 'in-progress': 'now', 'not-started': 'none' }[day.status] || '';
    return `
      <div class="st-history-row" data-date="${esc(day.date)}">
        <div class="t-time">${esc(day.date.slice(5))}</div>
        <div class="t-name"><b>${esc(day.name)}</b><span>${Core.STATUS_LABELS[day.status]} · ${Math.round((day.totalSeconds || 0) / 60)} 分钟 · ${v.sets} 组 · ${v.volume} kg</span></div>
        <span class="tag ${cls}">${Core.STATUS_LABELS[day.status]}</span>
      </div>`;
  },

  _dayModal(date) {
    const state = Store.db.strength;
    const day = Core.dayRecord(state, date);
    if (!day) return;
    const v = Core.volumeOf(day);
    const card = openModal(`
      <h3>📋 ${day.date} · ${esc(day.name)} <span class="h-extra">${Core.STATUS_LABELS[day.status]}</span></h3>
      <div class="st-table">
        <div class="st-tr st-th"><span>动作</span><span>计划</span><span>实际</span></div>
        ${day.actions.map((a) => `
          <div class="st-tr">
            <span class="st-name">${esc(a.name)}</span>
            <span class="st-plan">${a.plannedSets} 组 × ${esc(a.plannedRepsText || '?')}${a.plannedWeightText ? ' · ' + esc(a.plannedWeightText) : ''}</span>
            <span>${a.setsDone !== null && a.setsDone !== undefined ? `${a.setsDone} 组 × ${esc(a.repsText || '?')}${a.weightKg !== null ? ' · ' + a.weightKg + 'kg' : ' · 自重'}` : '—'}</span>
          </div>`).join('')}
      </div>
      <div class="hint" style="margin-top:8px">${v.sets} 组 · 容量 ${v.volume} kg · ${fmtDuration(day.totalSeconds || 0)}${day.resolution && day.resolution.note ? '<br>收尾：' + esc(day.resolution.note) : ''}</div>
      <div class="row" style="margin-top:14px">
        ${day.status === 'completed' || day.status === 'skipped' || day.status === 'partial'
          ? '<button class="btn" id="st-reopen">重开这一天</button>' : ''}
        <button class="btn ghost" id="st-day-close">关闭</button>
      </div>`);
    const reopen = $('#st-reopen', card);
    if (reopen) reopen.onclick = () => {
      const r = Core.reopenDay(Store.db.strength, { date });
      if (!r.ok) { toast(r.error, 'red'); return; }
      Store.save(true);
      closeModal();
      toast('已重开');
      App.render();
    };
    $('#st-day-close', card).onclick = closeModal;
  },

  _cycleModal() {
    const state = Store.db.strength;
    const tpl = this._rotationTpl(state);
    if (!tpl) { toast('先建立模板', 'red'); return; }
    const version = Core.currentVersion(tpl);
    const cycle = state.cycle[tpl.id] || { currentDayKey: null };
    const card = openModal(`
      <h3>🔀 选择当前训练日 <span class="h-extra">${esc(tpl.name)} · 第 ${tpl.currentRevision} 版</span></h3>
      <div class="today-list">
        ${version.days.map((d) => `
          <div class="today-item st-cycle-day" data-key="${esc(d.dayKey)}" style="cursor:pointer; ${d.dayKey === cycle.currentDayKey ? 'border-color:var(--accent);' : ''}">
            <div class="t-name"><b>${esc(d.name)}</b><span>${d.actions.length} 个动作${d.dayKey === cycle.currentDayKey ? ' · 当前' : ''}</span></div>
          </div>`).join('')}
      </div>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="st-cycle-close">关闭</button></div>`);
    $$('.st-cycle-day', card).forEach((el) => {
      el.onclick = () => {
        const r = Core.selectCycleDay(Store.db.strength, { templateId: tpl.id, dayKey: el.dataset.key });
        if (!r.ok) { toast(r.error, 'red'); return; }
        Store.save(true);
        closeModal();
        toast('已切换训练日');
        App.render();
      };
    });
    $('#st-cycle-close', card).onclick = closeModal;
  },

  /* 数据导入：自动识别两种格式。
     ① 自由文本训练计划（如「第一天（胸＋三头）」＋「哑铃卧推 （4组/10/9kg）2min」）→ 先解析预览，确认后写入；
     ② JSON（本应用 strength 结构，或旧应用表行格式，自动转换）→ 整体校验、原子应用。
     坏数据不落库。 */
  _importModal() {
    const card = openModal(`
      <h3>📥 导入数据</h3>
      <p class="hint">粘贴或拖入文件即可，自动识别两种格式：<b>① 计划文本</b>——标题行如「第1天（胸＋三头）/ 练腹日 / 休息日」，动作行如「哑铃卧推 （4组/10/9kg）2min」，按 左组数 · 中次数 · 右重量 自动分列；<b>② JSON</b>——本应用备份或旧应用导出。解析结果先预览，确认后才写入；坏数据不落库。</p>
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:8px">
        <span class="hint">支持 .txt 计划文本 / .json 备份，可直接拖进输入框</span>
        <button class="btn" id="st-import-file-btn" data-no-icon="true">选择文件</button>
      </div>
      <input type="file" id="st-import-file" accept=".txt,.json,text/plain,application/json" style="display:none">
      <textarea class="textarea" id="st-import-text" rows="10" spellcheck="false" placeholder="第1天（胸＋三头）&#10;哑铃卧推 （4组/10/9kg）2min&#10;上斜卧推＋并拢上斜卧推 起始 （4组/10/9kg＋8/9kg）2min&#10;……&#10;或粘贴 {&quot;templates&quot;:[…]} JSON"></textarea>
      <div id="st-import-preview"></div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn ghost" id="st-import-cancel">取消</button>
        <button class="btn" id="st-import-parse" data-no-icon="true">解析预览</button>
        <button class="btn primary" id="st-import-go">导入</button>
      </div>`);
    $('#st-import-cancel', card).onclick = () => {
      this.ui._importPending = null;
      closeModal();
    };
    /* 粘贴/选文件/拖文件都走同一入口：停顿半秒自动解析，预览区实时刷新 */
    const ta = $('#st-import-text', card);
    const fileInput = $('#st-import-file', card);
    $('#st-import-file-btn', card).onclick = () => fileInput.click();
    const loadFile = async (file) => {
      if (!file) return;
      try {
        ta.value = await file.text();
        this._importAutoParse(card, ta.value);
      } catch { toast('文件读取失败', 'red'); }
    };
    fileInput.onchange = () => loadFile(fileInput.files && fileInput.files[0]);
    ta.ondragover = (e) => { e.preventDefault(); ta.style.borderColor = 'var(--accent,#4f7cff)'; };
    ta.ondragleave = () => { ta.style.borderColor = ''; };
    ta.ondrop = (e) => {
      e.preventDefault();
      ta.style.borderColor = '';
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      loadFile(f);
    };
    let deb = null;
    ta.oninput = () => {
      clearTimeout(deb);
      deb = setTimeout(() => this._importAutoParse(card, ta.value), 500);
    };
    $('#st-import-parse', card).onclick = () => this._importAutoParse(card, ta.value);
    $('#st-import-go', card).onclick = () => {
      const raw = $('#st-import-text', card).value;
      const state = Store.db.strength;
      /* —— 文本导入：使用已确认的解析结果 —— */
      if (!raw.trim().startsWith('{')) {
        const pend = this.ui._importPending;
        if (!pend) { toast('请先点「解析预览」确认解析结果', 'red'); return; }
        const name = ($('#st-imp-name', card).value || '').trim() || '导入的训练计划';
        const modeEl = card.querySelector('input[name="st-imp-mode"]:checked');
        const mode = modeEl ? modeEl.value : 'new';
        let r;
        if (mode === 'update') {
          const tpl = this._editTpl(state);
          if (!tpl) { toast('没有可更新的模板，请选择「新建模板」', 'red'); return; }
          r = Core.replaceTemplate(state, { id: tpl.id, name, changeNote: '文本导入更新', days: pend.days });
          if (r.ok) this.ui.tplEditId = tpl.id;
        } else {
          const now = new Date().toISOString();
          const tplId = uid('tpl');
          r = Core.importFrom(state, {
            templates: [{
              id: tplId, name, currentRevision: 1, createdAt: now, updatedAt: now,
              versions: [{ revision: 1, effectiveFrom: Core.businessDate(), changeNote: '文本导入创建', createdAt: now, days: pend.days }]
            }],
            cycle: { [tplId]: { currentDayKey: pend.days[0].dayKey, revision: 1, updatedAt: now } }
          });
          if (r.ok) this.ui.tplEditId = tplId;
        }
        if (!r.ok) { toast(r.error || '导入失败，未写入任何数据', 'red'); return; }
        this.ui._importPending = null;
        this.ui.tplDraft = null;
        this.ui.tplDirty = false;
        Store.save(true);
        closeModal();
        toast(mode === 'update' ? `已更新模板「${name}」` : `导入完成：${pend.days.length} 个训练日，已设为当前模板`);
        this.ui.tab = 'template'; /* 导入完成直接带到模板页看结果 */
        App.render();
        return;
      }
      /* —— JSON 导入 —— */
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { toast('JSON 解析失败：请粘贴单个完整的 JSON 对象', 'red'); return; }
      const r = this._import(parsed);
      if (!r.ok) { toast(r.error || '导入失败，未写入任何数据', 'red'); return; }
      this.ui._importPending = null;
      Store.save(true);
      closeModal();
      toast(`导入完成：新增模板 ${r.templates} 个，训练日 ${r.days} 天`);
      App.render();
    };
  },

  /* 导入弹窗的自动解析：输入变化后刷新预览区。JSON 给出提示，文本给预览或可行动的错误。 */
  _importAutoParse(card, text) {
    const pv = $('#st-import-preview', card);
    if (!pv) return;
    const t = String(text || '').trim();
    if (!t) { pv.innerHTML = ''; this.ui._importPending = null; return; }
    if (t.startsWith('{')) {
      pv.innerHTML = '<div class="hint" style="margin-top:8px">识别为 JSON 备份数据，点「导入」直接写入（整体校验，坏数据不落库）。</div>';
      this.ui._importPending = null;
      return;
    }
    const parsed = this._parsePlanText(text);
    if (!parsed.ok) {
      this.ui._importPending = null;
      pv.innerHTML = `<div class="hint" style="margin-top:8px; color:#b45309">还不能解析：${esc(parsed.error)}</div>`;
      return;
    }
    this._textImportPreview(card, parsed);
  },

  /* 文本解析结果预览：让用户确认分列是否正确、改名、选择新建还是更新当前模板 */
  _textImportPreview(card, parsed) {
    const state = Store.db.strength;
    const editTpl = this._editTpl(state);
    const days = parsed.days.map((d, i) => ({
      dayKey: `d${i + 1}`, name: d.name, bodyPart: d.bodyPart || '', isRest: !!d.isRest, note: '', ordinal: i,
      actions: d.actions.map((a, j) => ({
        actionKey: `d${i + 1}a${j + 1}`, name: a.name, plannedSets: a.plannedSets,
        plannedRepsText: a.plannedRepsText, plannedWeightText: a.plannedWeightText,
        targetText: a.targetText, note: '', ordinal: j
      }))
    }));
    this.ui._importPending = { name: parsed.name || '', days };
    const total = days.reduce((t, d) => t + d.actions.length, 0);
    const err = Core.validateTemplateInput({ name: '校验', days });
    $('#st-import-preview', card).innerHTML = `
      <div style="margin-top:10px; padding:10px 12px; border:1px dashed rgba(44,58,71,.2); border-radius:10px; display:grid; gap:8px">
        ${err ? `<div style="color:#b45309">解析结果未通过校验：${esc(err)}</div>` : ''}
        <div class="row" style="flex-wrap:wrap; gap:10px; align-items:flex-end">
          <label style="${S.inlineLabel}">模板名称
            <input class="input" id="st-imp-name" maxlength="160" value="${esc(parsed.name || '导入的训练计划')}"></label>
          <label style="${S.inlineLabel}"><input type="radio" name="st-imp-mode" value="new" checked> 新建模板</label>
          <label style="${S.inlineLabel}"><input type="radio" name="st-imp-mode" value="update" ${editTpl ? '' : 'disabled'}> 覆盖更新「${editTpl ? esc(editTpl.name) : '无模板'}」</label>
        </div>
        <div class="hint">解析出 ${days.length} 个训练日 · ${total} 个动作，点「导入」写入：</div>
        <div style="display:grid; gap:4px; font-size:12.5px">
          ${days.map((d) => `<div>· <b>${esc(d.name)}</b>${d.isRest ? '（休息日）' : ''}${d.bodyPart ? ' · ' + esc(d.bodyPart) : ''} —— ${d.actions.length ? esc(d.actions.map((a) => `${a.name} ${a.plannedSets}×${a.plannedRepsText || '?'}${a.plannedWeightText ? '/' + a.plannedWeightText : ''}`).join('，')) : '无动作'}</div>`).join('')}
        </div>
      </div>`;
  },

  /* 自由文本训练计划解析。列约定：最左组数、中间次数、右重量；
     「起始」标记与行尾时长（2min / 1分钟）归入目标列。返回 { ok, name?, days } 或 { ok:false, error }。 */
  _parsePlanText(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { ok: false, error: '内容为空' };
    const CN = '0-9一二三四五六七八九十';
    const isHeading = (l) => new RegExp(`^第\\s*[${CN}]+\\s*[天日]`).test(l)
      || /^day\s*\d+/i.test(l)
      || /^练腹/.test(l)
      || (/休息/.test(l) && l.length <= 24)
      || (/[天日]$/.test(l) && l.length <= 24 && !/\d\s*(kg|组|x)/i.test(l));
    const bodyPartOf = (l) => {
      const m = l.match(/[（(]([^）)]*)[）)]/);
      const pool = m ? m[1] : l;
      const hit = pool.match(/胸|背|肩|腿|臂|腹|臀|核心|有氧|手/);
      return hit ? hit[0] : '';
    };
    const parseAction = (line) => {
      let name = line, inner = null, after = '';
      const pm = line.match(/[（(]([^）)]*)[）)]/);
      if (pm) { inner = pm[1]; name = line.slice(0, pm.index); after = line.slice(pm.index + pm[0].length); }
      const qishi = /起始/.test(line);
      name = name.replace(/起始/g, '').trim().replace(/[：:，,]\s*$/, '');
      if (!name) return null;
      let sets = 0, reps = '', weight = '';
      if (inner !== null) {
        let rest = inner;
        const sm = rest.match(/^(\d+)\s*组/);
        if (sm) { sets = Number(sm[1]); rest = rest.slice(sm[0].length); }
        else {
          const xm = rest.match(/^(\d+)\s*[x×*]\s*(.+)$/);
          if (xm) { sets = Number(xm[1]); rest = xm[2]; }
        }
        /* 先摘出带单位的重量（9kg＋8/9kg 这类混写也能拆干净），剩余 token 归次数 */
        const wParts = [];
        const restNoW = rest.replace(/(\d+(?:\.\d+)?)\s*(?:kg|lb|公斤|磅)/gi, (m0, num) => {
          const w = `${num}kg`;
          if (!wParts.includes(w)) wParts.push(w);
          return ' ';
        });
        const tokens = restNoW.split(/[/＋+、,，;；\s]+/).map((t) => t.trim()).filter(Boolean);
        if (tokens.length >= 2 && !wParts.length && /^\d+(?:\.\d+)?$/.test(tokens[tokens.length - 1])) {
          weight = tokens.pop(); /* 无单位且右列纯数字 → 按用户的「右列是重量」约定，如 （2组/力竭/20） */
        }
        if (!weight && wParts.length) weight = wParts.join('＋');
        reps = tokens.join('＋');
      } else {
        const xm = line.match(/(\d+)\s*组\s*(?:[x×*]\s*(\S+))?/);
        if (xm) { sets = Number(xm[1]); reps = xm[2] || ''; }
      }
      const target = [];
      if (qishi) target.push('起始动作');
      const tm = after.match(/(\d+)\s*(?:min|分钟|分)(?![a-z0-9])/i);
      if (tm) target.push(`组间休息${Number(tm[1])}分钟`);
      return { name, plannedSets: sets, plannedRepsText: reps, plannedWeightText: weight, targetText: target.join('；') };
    };
    const days = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (isHeading(line)) {
        const name = line.split(/\s+/)[0].replace(/[：:]$/, '');
        days.push({ name, bodyPart: bodyPartOf(line), isRest: /休息|休一/.test(line), actions: [] });
        continue;
      }
      if (!days.length) return { ok: false, error: `第 ${idx + 1} 行「${line.slice(0, 12)}…」出现在第一个训练日标题之前，请补一行如「第1天（胸＋三头）」` };
      if (!/\d|[（(]/.test(line) && line.length > 16) continue; /* 无数字无括号的长句视为说明文字 */
      const a = parseAction(line);
      if (a) days[days.length - 1].actions.push(a);
    }
    if (!days.length) return { ok: false, error: '没有识别到训练日标题：请补一行如「第1天（胸＋三头）」或「练腹日」' };
    /* 领域校验要求每个训练日至少一个动作：空日（练腹跟课程、休息日）补占位，导入后可改 */
    for (const d of days) {
      if (!d.actions.length) {
        d.actions.push({
          name: d.isRest ? '休息' : '自由训练（按课程/当天安排）',
          plannedSets: 0, plannedRepsText: '', plannedWeightText: '', targetText: ''
        });
      }
    }
    return { ok: true, name: '', days };
  },

  /* 导出备份：把 strength 板块完整 JSON 交给用户（可粘回「导入数据」恢复） */
  _exportModal() {
    const json = JSON.stringify(Store.db.strength, null, 2);
    const card = openModal(`
      <h3>📤 导出力量训练数据</h3>
      <p class="hint">包含模板、轮转指针与训练历史。整段复制保存，或下载为文件；之后可通过「导入数据（文本/JSON）」粘回恢复。</p>
      <textarea class="textarea" id="st-export-text" rows="12" spellcheck="false" readonly>${esc(json)}</textarea>
      <div class="row" style="justify-content:flex-end">
        <button class="btn ghost" id="st-export-close">关闭</button>
        <button class="btn" id="st-export-copy">复制到剪贴板</button>
        <button class="btn primary" id="st-export-dl">下载备份文件</button>
      </div>`);
    $('#st-export-close', card).onclick = closeModal;
    $('#st-export-copy', card).onclick = async () => {
      const ta = $('#st-export-text', card);
      try { await navigator.clipboard.writeText(json); toast('已复制到剪贴板'); }
      catch { ta.select(); document.execCommand('copy'); toast('已复制到剪贴板'); }
    };
    $('#st-export-dl', card).onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `力量训练备份-${Core.businessDate()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('已下载备份文件');
    };
  },

  _import(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: '导入数据必须是 JSON 对象' };
    let payload = parsed;
    /* 旧应用表行格式（templates/templateVersions/trainingDays…）→ 先纯转换为本应用结构 */
    if (Array.isArray(parsed.templateVersions) || Array.isArray(payload.trainingDays)
      || (Array.isArray(parsed.templates) && parsed.templates.length > 0 && !parsed.templates.some((t) => t && t.versions))) {
      const conv = Core.convertLegacyRows(parsed);
      if (!conv.ok) return conv;
      payload = conv.native;
    }
    /* 整体校验 + 原子应用：校验失败时 state 完全不变 */
    return Core.importFrom(Store.db.strength, payload);
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = Strength;
