/* 力量训练视图 —— 从「个人积累库」健身板块移植
   数据存于 Store.db.strength（结构见 strength-core.js normalize）。
   五个标签页：今日训练 / 成长曲线 / 训练日模板（含模板更新记录） / 训练历史 / 进步可视化。
   今日训练支持日期导航与补记。每天只填写完成组数、实际次数和负重。
   页面不展示训练时长，保存时也不写入时长；旧记录里的时间字段原样留着，供导入兼容。 */

const Core = typeof window !== 'undefined' ? window.StrengthCore : require('./strength-core');

/* 进步可视化视觉参数（纯函数模块；浏览器端由 index.html 先于本文件加载，挂全局 ProgressVisual） */
const ProgressVisual = typeof window !== 'undefined' ? window.ProgressVisual : require('./progress-visual');

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

/* ---------- 健身模板库：一键套用常用分化 ----------
   动作名即全库统一标识：不同模板里的同名动作共享「上次重量」与递进建议，
   换模板（如三分化 ↔ 上下分化）个人的重量水平不断链。 */
const PRESET_TEMPLATES = [
  {
    name: '三分化 · 推拉腿（健身房）',
    tag: '最经典的三分化：推日 / 拉日 / 腿日轮转，适合每周 3–6 练',
    days: [
      { dayKey: 'push', name: '推日（胸肩三头）', bodyPart: '胸', actions: [
        { name: '杠铃卧推', plannedSets: 4, plannedRepsText: '8-12', targetText: '组间休息 3 分钟' },
        { name: '上斜哑铃卧推', plannedSets: 3, plannedRepsText: '10-12' },
        { name: '坐姿哑铃肩推', plannedSets: 3, plannedRepsText: '8-12' },
        { name: '哑铃侧平举', plannedSets: 3, plannedRepsText: '12-15' },
        { name: '绳索三头下压', plannedSets: 3, plannedRepsText: '10-15' }
      ] },
      { dayKey: 'pull', name: '拉日（背二头）', bodyPart: '背', actions: [
        { name: '高位下拉', plannedSets: 4, plannedRepsText: '10-12' },
        { name: '坐姿划船', plannedSets: 3, plannedRepsText: '10-12' },
        { name: '杠铃划船', plannedSets: 3, plannedRepsText: '8-12' },
        { name: '面拉', plannedSets: 3, plannedRepsText: '15-20' },
        { name: '哑铃弯举', plannedSets: 3, plannedRepsText: '10-12' }
      ] },
      { dayKey: 'legs', name: '腿日（臀腿）', bodyPart: '腿', actions: [
        { name: '杠铃深蹲', plannedSets: 4, plannedRepsText: '8-12', targetText: '组间休息 3 分钟' },
        { name: '腿举', plannedSets: 3, plannedRepsText: '10-12' },
        { name: '罗马尼亚硬拉', plannedSets: 3, plannedRepsText: '8-12' },
        { name: '腿弯举', plannedSets: 3, plannedRepsText: '10-15' },
        { name: '站姿提踵', plannedSets: 4, plannedRepsText: '15-20' }
      ] }
    ]
  },
  {
    name: '三分化 · 徒手启动',
    tag: '从零开始的三分化：徒手 + 弹力带，在家就能练',
    days: [
      { dayKey: 'push', name: '推日（胸肩三头）', bodyPart: '胸', actions: [
        { name: '俯卧撑', plannedSets: 4, plannedRepsText: '12-15', targetText: '力竭前留 2 次' },
        { name: '哑铃肩推', plannedSets: 4, plannedRepsText: '10-12', plannedWeightText: '轻重量' },
        { name: '凳上反屈伸', plannedSets: 3, plannedRepsText: '12-15' }
      ] },
      { dayKey: 'pull', name: '拉日（背二头）', bodyPart: '背', actions: [
        { name: '弹力带划船', plannedSets: 4, plannedRepsText: '12-15' },
        { name: '面拉', plannedSets: 3, plannedRepsText: '15' },
        { name: '弹力带弯举', plannedSets: 3, plannedRepsText: '12-15' }
      ] },
      { dayKey: 'legs', name: '腿日（臀腿）', bodyPart: '腿', actions: [
        { name: '徒手深蹲', plannedSets: 4, plannedRepsText: '15-20' },
        { name: '臀桥', plannedSets: 4, plannedRepsText: '15' },
        { name: '提踵', plannedSets: 4, plannedRepsText: '20' }
      ] }
    ]
  },
  {
    name: '上下肢分化',
    tag: '每周 4 练：上肢 / 下肢交替，频率高、恢复均匀',
    days: [
      { dayKey: 'upper-a', name: '上肢 A（水平推拉）', bodyPart: '胸', actions: [
        { name: '杠铃卧推', plannedSets: 4, plannedRepsText: '8-12' },
        { name: '杠铃划船', plannedSets: 4, plannedRepsText: '8-12' },
        { name: '上斜哑铃卧推', plannedSets: 3, plannedRepsText: '10-12' },
        { name: '坐姿划船', plannedSets: 3, plannedRepsText: '10-12' },
        { name: '哑铃弯举', plannedSets: 3, plannedRepsText: '10-12' }
      ] },
      { dayKey: 'lower-a', name: '下肢 A（蹲为主）', bodyPart: '腿', actions: [
        { name: '杠铃深蹲', plannedSets: 4, plannedRepsText: '8-12', targetText: '组间休息 3 分钟' },
        { name: '罗马尼亚硬拉', plannedSets: 3, plannedRepsText: '8-12' },
        { name: '腿举', plannedSets: 3, plannedRepsText: '10-12' },
        { name: '站姿提踵', plannedSets: 4, plannedRepsText: '15-20' }
      ] },
      { dayKey: 'upper-b', name: '上肢 B（垂直推拉）', bodyPart: '肩', actions: [
        { name: '坐姿哑铃肩推', plannedSets: 4, plannedRepsText: '8-12' },
        { name: '高位下拉', plannedSets: 4, plannedRepsText: '10-12' },
        { name: '哑铃侧平举', plannedSets: 3, plannedRepsText: '12-15' },
        { name: '面拉', plannedSets: 3, plannedRepsText: '15-20' },
        { name: '绳索三头下压', plannedSets: 3, plannedRepsText: '10-15' }
      ] },
      { dayKey: 'lower-b', name: '下肢 B（髋为主）', bodyPart: '臀', actions: [
        { name: '罗马尼亚硬拉', plannedSets: 4, plannedRepsText: '8-12' },
        { name: '腿举', plannedSets: 4, plannedRepsText: '10-12' },
        { name: '腿弯举', plannedSets: 3, plannedRepsText: '10-15' },
        { name: '臀桥', plannedSets: 3, plannedRepsText: '12-15' }
      ] }
    ]
  },
  {
    name: '全身适应',
    tag: '每周 2–3 练：动作少而全，适合恢复期或繁忙期',
    days: [
      { dayKey: 'full', name: '全身训练日', bodyPart: '腿', actions: [
        { name: '杠铃深蹲', plannedSets: 3, plannedRepsText: '8-12' },
        { name: '杠铃卧推', plannedSets: 3, plannedRepsText: '8-12' },
        { name: '坐姿划船', plannedSets: 3, plannedRepsText: '10-12' },
        { name: '坐姿哑铃肩推', plannedSets: 3, plannedRepsText: '8-12' },
        { name: '平板支撑', plannedSets: 3, plannedRepsText: '45-60' }
      ] }
    ]
  }
];

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
/* 整段只是组间休息时长时，今日记录不展示。模板原文和其他动作说明不改、不删。 */
function isPureRestDuration(text) {
  return /^组间休息\s*\d{1,3}\s*(?:分钟|分|min|秒|s)[.。]?$/i.test(String(text || '').trim());
}
function recordActionHint(action) {
  const target = String((action && action.targetText) || '').trim();
  const note = String((action && action.note) || '').trim();
  if (target && !isPureRestDuration(target)) return target;
  if (note && !isPureRestDuration(note)) return note;
  return '';
}

/* cubic-bezier(x1,y1,x2,y2) 缓动求值（与 CSS 过渡同曲线，仅用于视图层综合分数字滚动，P10.1） */
function cubicEase(x1, y1, x2, y2) {
  const coef = (a, b) => ({ A: 1 - 3 * b + 3 * a, B: 3 * b - 6 * a, C: 3 * a });
  const cx = coef(x1, x2), cy = coef(y1, y2);
  const bez = (c, t) => ((c.A * t + c.B) * t + c.C) * t;
  const slope = (c, t) => (3 * c.A * t + 2 * c.B) * t + c.C;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = bez(cx, t) - x;
      if (Math.abs(err) < 1e-5) break;
      const d = slope(cx, t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return bez(cy, t);
  };
}

/* 分数→颜色语义已由 progress-visual.levelOf 接管（4 档 + none 半透明灰逐字兼容）；
   保留同名转发，旧调用点不静默失色。肌群进步卡片内的渲染一律走 ProgressVisual。 */
function scoreColor(p) {
  const theme = typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return ProgressVisual.levelOf(p && p.overallScore, p && p.confidence, theme).color;
}
function formatChange(value) {
  if (value === null) return '数据不足';
  if (value === 0) return '持平';
  return `${value > 0 ? '+' : ''}${value}%`;
}
function confidenceLabel(value) {
  return { none: '暂无记录', limited: '样本较少', good: '趋势可参考' }[value] || value;
}

const Strength = {
  titles: { strength: '力量训练' },
  /* ui.date：业务日期字符串，null 表示今天；ui.historyPage：历史分页；ui.tplDraft：模板编辑器本地草稿；
     ui.advice：当前渲染的下次进步建议（供「把建议填入表格」使用） */
  ui: { tab: 'today', muscle: null, date: null, historyPage: 1, tplDraft: null, advice: null },

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
        ${tab==='today' ? this._bodyPhotosHtml(date) : ''}
      </div>`;

    $$('.st-tab', root).forEach((btn) => {
      btn.onclick = () => { this.ui.tab = btn.dataset.tab; App.render(); };
    });
    const photoAll=$('#st-photo-all',root);
    if(photoAll)photoAll.onclick=()=>{Skincare.ui.skinPhotoKind='body';App.go('skincare');$('#sk-skin-photos')?.scrollIntoView({block:'start'});};
    $$('[data-body-photo]',root).forEach(button=>{button.onclick=()=>{
      Skincare.ui.skinPhotoKind='body';
      const idx=Skincare._photoList('body').findIndex(p=>p.id===button.dataset.bodyPhoto);
      if(idx>=0)Skincare._photoViewer(idx);
    };});
    if(typeof Skincare!=='undefined')void Skincare._loadPhotoImgs(root);
    if (tab === 'today') {
      this._bindDateNav(root);
      if (info && info.day) this._bindToday(root, info);
      else this._bindEmpty(root);
      const advFill = $('#st-adv-fill', root);
      if (advFill) advFill.onclick = () => this._fillFromAdvice(root);
      const advApply = $('#st-adv-apply', root);
      if (advApply) advApply.onclick = () => this._applyAdviceToTemplate();
      const mealLog = $('#st-meal-log', root);
      if (mealLog) mealLog.onclick = () => App.go('nutrition');
      const edit = $('#st-tpl-edit', root);
      if (edit) edit.onclick = () => {
        if (info && info.day && info.day.templateId) {
          this.ui.tplEditId = info.day.templateId;
          this.ui.tplDraft = null;
        }
        this.ui.tab = 'template';
        App.render();
      };
      const cyc = $('#st-tpl-day', root);
      if (cyc) cyc.onclick = () => this._cycleModal();
      const presetBtn = $('#st-tpl-preset', root);
      if (presetBtn) presetBtn.onclick = () => this._presetModal();
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

  _bodyPhotosHtml(date) {
    const photos=(Store.db.skin?.photos || []).filter(p=>p.kind==='body' && p.date===date).slice(-6);
    return `<div class="card"><div class="rhythm-photo-heading"><h3>健身成果照片</h3><button class="btn small ghost" id="st-photo-all">查看全部健身照片</button></div><p class="hint">微信先说“健身成果照片”再发图，按日期保存在本机。</p>${photos.length ? `<div class="life-photo-grid">${photos.map(p=>`<button class="life-photo-thumb" type="button" data-body-photo="${esc(p.id)}"><img data-photo-file="${esc(p.file)}" data-photo-kind="body" alt="${esc(date)} 健身成果"><span>${p.local ? esc(p.local.slice(11)) : esc(date)}${p.source==='weixin-life-diary'?' · 微信':''}</span></button>`).join('')}</div>` : '<p class="hint">这一天还没有健身成果照片。</p>'}</div>`;
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
      ${this._mealTimingCard(date)}
      ${this._dateNavHtml(state)}
      ${info.day ? this._todayCard(info) : this._emptyCard()}
      ${info.day && !info.day.isRest ? this._adviceCard(state, info) : ''}
      <div class="card">
        <h3>📊 近 30 天
          <span class="h-extra">完成 ${sum.completed} · 部分 ${sum.partial} · 跳过 ${sum.skipped}</span>
        </h3>
        <div class="stat-row st-stats-3">
          <div class="stat-box"><b>${sum.completed}</b><span>完成天数</span></div>
          <div class="stat-box"><b>${sum.sets}</b><span>总组数</span></div>
          <div class="stat-box"><b>${sum.volume >= 1000 ? (sum.volume / 1000).toFixed(1) + ' t' : sum.volume + ' kg'}</b><span>训练容量</span></div>
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
          <button class="btn" id="st-tpl-edit">编辑这份模板</button>
          <button class="btn" id="st-tpl-day">选择训练日</button>
          <button class="btn" id="st-tpl-preset">从模板库新建</button>
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
        <div class="empty">这一天还没有训练记录。从模板库选一套分化开始（三分化 / 上下分化 / 全身），或导入旧应用的历史数据。</div>
        <div class="row">
          <button class="btn primary" id="st-preset">从模板库选择</button>
          <button class="btn" id="st-newtpl">新建空白模板</button>
          <button class="btn" id="st-import-empty">导入历史数据</button>
        </div>
      </div>`;
  },

  _bindEmpty(root) {
    const preset = $('#st-preset', root);
    if (preset) preset.onclick = () => this._presetModal();
    const blank = $('#st-newtpl', root);
    if (blank) blank.onclick = () => { this._blankDraft(); this.ui.tab = 'template'; App.render(); };
    const imp = $('#st-import-empty', root);
    if (imp) imp.onclick = () => this._importModal();
  },

  /* 模板库选择弹窗：一键套用常用分化。
     同名动作跨模板共享重量记录——换模板个人的肌肉水平不断链。 */
  _presetModal() {
    const card = openModal(`
      <h3>📚 选择健身模板</h3>
      <p class="hint">点击即套用。不同模板里的同名动作共享「上次重量」与递进建议：今天用三分化练、下周换上下分化，杠铃卧推的重量记录仍然连续。</p>
      <div class="today-list" id="st-preset-list" style="display:grid; gap:8px; margin-top:10px">
        ${PRESET_TEMPLATES.map((p, i) => `
          <div class="today-item" data-preset="${i}" style="cursor:pointer">
            <div class="t-name"><b>${esc(p.name)}</b>
              <span>${esc(p.tag)}</span>
              <i class="hint" style="display:block; font-style:normal">${p.days.map((d) => `${esc(d.name)}（${d.actions.length} 动作）`).join(' → ')}</i>
            </div>
          </div>`).join('')}
      </div>
      <div class="row" style="justify-content:flex-end; margin-top:12px"><button class="btn ghost" id="st-preset-close">关闭</button></div>`);
    $$('#st-preset-list .today-item', card).forEach((el) => {
      el.onclick = () => {
        const preset = PRESET_TEMPLATES[Number(el.dataset.preset)];
        const r = Core.replaceTemplate(Store.db.strength, {
          name: preset.name, changeNote: '从模板库创建',
          days: JSON.parse(JSON.stringify(preset.days))
        });
        if (!r.ok) { toast(r.error, 'red'); return; }
        this.ui.tplDraft = null;
        this.ui.tplDirty = false;
        this.ui.tplEditId = null;
        Store.save(true);
        closeModal();
        toast(`已创建「${preset.name}」，今天就能开始`);
        this.ui.tab = 'today';
        App.render();
      };
    });
    $('#st-preset-close', card).onclick = closeModal;
  },

  _todayCard(info) {
    const state = Store.db.strength;
    const day = info.day;
    /* 休息日且还没开始：不展示动作表，只给一张休息卡 + 一键进入下一训练日 */
    if (day.isRest && (info.preview || day.status === 'not-started')) {
      return `
      <div class="card" id="st-today">
        <h3>🛌 ${esc(day.name)}
          <span class="h-extra">休息日${info.preview ? ' · 预览' : ''}</span>
        </h3>
        ${this._belongHtml(state, info)}
        <div class="empty">今天是休息日：恢复为主，睡好吃好。休息完点下面的按钮轮转到下一个训练日；也可以先去练别的，回来再收尾。</div>
        <div class="row" style="margin-top:14px">
          <button class="btn primary" id="st-rest-done">✓ 休息完毕，进入下一训练日</button>
        </div>
      </div>`;
    }
    const st = Core.STATUS_LABELS[day.status] || day.status;
    const supp = day.supplements || {};
    return `
      <div class="card" id="st-today">
        <h3>🏋️ ${esc(day.name)}
          <span class="h-extra">${day.bodyPart ? esc(day.bodyPart) + ' · ' : ''}${st}${info.preview ? ' · 预览' : ''}</span>
        </h3>
        ${this._belongHtml(state, info)}
        ${info.preview && day.note ? `<div class="hint">${esc(day.note)}</div>` : ''}
        <p class="hint">默认带入初始计划或上次保存值，用上下箭头调整组数、次数和重量。每次保存都会留下变化记录，作为下次的基准。</p>
        <div class="st-table" id="st-actions">
          <div class="st-tr st-th">
            <span>动作</span><span>计划</span><span>完成组</span><span>实际次数</span><span>负重/自重</span><span>上次</span>
          </div>
          ${day.actions.map((a, i) => {
            /* 「上次」列改为 prefill 提示：占位符直接给出上次数据（跨模板全库统一），只改有提升的数字 */
            const baseline=Core.trainingBaseline(state,a,day.date);
            const locked=day.status==='completed'||day.status==='skipped';
            const last = Core.lastActual(state, a.name, day.date, true);
            const lastTxt = last ? `上次 ${last.date.slice(5)}` : '首次';
            const setsPh = last && typeof last.action.setsDone === 'number' ? `上次 ${last.action.setsDone} 组` : '';
            const lastLabel = last ? Core.weightLabelKg(last.action.weightKg) : '';
            const weightPh = last && typeof last.action.weightKg === 'number'
              ? `上次 ${lastLabel}×${last.action.repsText || '?'}` : '自重';
            const cue = recordActionHint(a);
            return `
            <div class="st-tr">
              <span class="st-name">${esc(a.name)}${cue ? `<i class="hint">${esc(cue)}</i>` : ''}</span>
              <span class="st-plan">${a.plannedSets} 组 × ${esc(a.plannedRepsText || '?')}${a.plannedWeightText ? ' · ' + esc(a.plannedWeightText) : ''}</span>
              <span><input class="input st-num" data-idx="${i}" data-key="setsDone" type="number" min="0" max="999" placeholder="${esc(setsPh)}" ${locked?'disabled':''} value="${a.setsDone??baseline.setsDone}"></span>
              <span><input class="input" data-idx="${i}" data-key="repsText" type="text" maxlength="60" placeholder="如 12-15" ${locked?'disabled':''} value="${esc(a.repsText||baseline.repsText)}"></span>
              <span><input class="input st-num" data-idx="${i}" data-key="weightKg" type="text" inputmode="decimal" maxlength="12" autocomplete="off" spellcheck="false" placeholder="${esc(weightPh)}" title="填数字（kg）；自重留空或写「自重」" aria-label="负重kg，留空按自重记" ${locked?'disabled':''} value="${(a.weightKg??baseline.weightKg)===0?'自重':esc(a.weightKg??baseline.weightKg)}"></span>
              <span class="st-last">${esc(lastTxt)}</span>
            </div>`;
          }).join('')}
        </div>
        ${this._adjustmentHistory(state,day.date)}
        <div class="st-supps" style="${S.supps}">
          <div class="st-supps-line" style="${S.suppsLine}">
            <button class="btn st-tri" data-sup="creatineTaken" data-state="${triState(supp.creatineTaken)}" data-no-icon="true">肌酸 · ${triLabel(supp.creatineTaken)}</button>
            <button class="btn st-tri" data-sup="proteinPowderTaken" data-state="${triState(supp.proteinPowderTaken)}" data-no-icon="true">蛋白粉 · ${triLabel(supp.proteinPowderTaken)}</button>
          </div>
          <div class="st-supps-line" style="${S.suppsLine}">
            <label style="${S.inlineLabel}; flex:1; min-width:200px">补剂备注
              <input class="input" id="st-supp-note" maxlength="500" placeholder="选填，如：训练后 30 分钟内" value="${esc(supp.note || '')}"></label>
            <label style="${S.inlineLabel}; flex:1; min-width:200px">当日备注
              <input class="input" id="st-day-note" maxlength="500" placeholder="选填" value="${esc(day.note || '')}"></label>
          </div>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn" id="st-prefill" data-no-icon="true"${day.status === 'completed' || day.status === 'skipped' ? ' disabled' : ''}>按计划填充</button>
          <button class="btn primary" id="st-save"${day.status === 'completed' || day.status === 'skipped' ? ' disabled' : ''}>保存实际数据</button>
          <button class="btn green" id="st-finish"${day.status === 'completed' || day.status === 'skipped' ? ' disabled' : ''}>✓ 完成并进入下一训练日</button>
          <button class="btn ghost" id="st-skip"${day.status === 'completed' || day.status === 'skipped' || day.status === 'partial' ? ' disabled' : ''}>跳过这一天</button>
        </div>
      </div>`;
  },

  _adjustmentHistory(state,date){
    const rows=(state.adjustments||[]).filter(x=>x.date===date).slice(-30).reverse();if(!rows.length)return '';
    const values=x=>`${x.setsDone??0} 组 × ${x.repsText||0} 次 · ${Core.weightLabelKg(x.weightKg)}`;
    return `<details class="soft-progress-history"><summary>已保存的变化 · ${rows.length} 条</summary>${rows.map(x=>`<p><b>${esc(x.name)}</b> · ${esc(new Date(x.savedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}))}<br>${esc(values(x.before))} → ${esc(values(x.after))}</p>`).join('')}</details>`;
  },
  _belongHtml(state, info) {
    const day = info.day;
    const tpls = state.templates || [];
    const curTpl = Core.templateById(state, day.templateId) || this._rotationTpl(state);
    const days = curTpl ? ((Core.currentVersion(curTpl) || {}).days || []) : [];
    const locked = day.status === 'completed' || day.status === 'skipped' || day.status === 'partial';
    const dis = locked ? 'disabled' : '';
    if (!tpls.length) return '';
    return `
      <div class="st-belong" id="st-belong">
        <label class="st-belong-k">所属模板
          <select class="input" id="st-belong-tpl" ${dis} aria-label="所属模板">
            ${tpls.map((t) => `<option value="${esc(t.id)}"${curTpl && t.id === curTpl.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select></label>
        <label class="st-belong-k">今天练哪一天
          <select class="input" id="st-belong-day" ${dis} aria-label="今天练哪一天">
            ${days.map((d) => `<option value="${esc(d.dayKey)}"${d.dayKey === day.dayKey ? ' selected' : ''}>${esc(d.name)}${d.isRest ? ' · 休息' : ''}</option>`).join('')}
          </select></label>
        <span class="hint">${locked ? '已收尾的日子不能改所属，请先重开。' : '练的时候可以直接改。换成别的训练日后，已填的组数会清空。'}</span>
      </div>`;
  },

  _bindBelong(root, info) {
    const tplSel = $('#st-belong-tpl', root);
    const daySel = $('#st-belong-day', root);
    if (!tplSel || !daySel) return;
    const fillDays = (templateId, selectedKey) => {
      const tpl = Core.templateById(Store.db.strength, templateId);
      const days = tpl ? ((Core.currentVersion(tpl) || {}).days || []) : [];
      const key = days.some((d) => d.dayKey === selectedKey) ? selectedKey : (days[0] && days[0].dayKey) || '';
      daySel.innerHTML = days.map((d) => `<option value="${esc(d.dayKey)}"${d.dayKey === key ? ' selected' : ''}>${esc(d.name)}${d.isRest ? ' · 休息' : ''}</option>`).join('');
      return key;
    };
    const apply = async () => {
      const templateId = tplSel.value;
      const dayKey = daySel.value;
      const day = info.day;
      if (day.templateId === templateId && day.dayKey === dayKey) return;
      const filled = !info.preview && (day.actions || []).some((a) => a.setsDone != null || (a.repsText && String(a.repsText).trim()) || a.weightKg != null || (Array.isArray(a.sets) && a.sets.some((s) => s && s.done)));
      if (filled) {
        const ok = await confirmModal('换所属训练日', '今天已经填了组数或次数。换成新的训练日后，这些填写会清空。', '换成这一天');
        if (!ok) {
          tplSel.value = day.templateId;
          fillDays(day.templateId, day.dayKey);
          return;
        }
      }
      const r = Core.assignTrainingDay(Store.db.strength, { date: day.date, templateId, dayKey });
      if (!r.ok) {
        toast(r.error, 'red');
        tplSel.value = day.templateId;
        fillDays(day.templateId, day.dayKey);
        return;
      }
      Store.save(true);
      toast('已切换所属训练日');
      App.render();
    };
    tplSel.onchange = () => { fillDays(tplSel.value, daySel.value); apply(); };
    daySel.onchange = () => apply();
  },

  _bindToday(root, info) {
    const state = Store.db.strength;
    const day = info.day;
    this._bindBelong(root, info);
    $$('#st-actions [data-key]', root).forEach((el) => {
      el.dataset.orig = el.value;
      el.addEventListener('input', () => {
        el.dataset.dirty = el.value === el.dataset.orig ? '' : '1';
      });
    });
    const saveBtn = $('#st-save', root);
    if (saveBtn) saveBtn.onclick = () => this._saveActual(root, day, false);
    /* 一键按计划值填充实际数据（计划写自重的动作填「自重」），改完仍需手动保存。
       表格里已有与计划不同的未保存输入时先弹一次确认，取消则全部手输原样保留（与「按建议填充」同一守卫）。 */
    const prefillBtn = $('#st-prefill', root);
    if (prefillBtn) prefillBtn.onclick = async () => {
      const rows = $$('#st-actions .st-tr', root).filter((tr) => tr.querySelector('.st-num'));
      /* 计划值 → 输入框字符串；检测与填充共用这一口径，保证「弹不弹确认」和「填什么」永远一致 */
      const planTargetOf = (a, key) => {
        if (key === 'setsDone') return a.plannedSets ? String(a.plannedSets) : '';
        if (key === 'repsText') return a.plannedRepsText || '';
        /* 计划里写「自重」的动作，填充时直接给「自重」文本（保存后记为 0） */
        const pw = Core.parseWeightInput(a.plannedWeightText);
        if (pw.ok && pw.value !== null) return pw.value === 0 ? '自重' : String(pw.value);
        if (!pw.ok) {
          const m = String(a.plannedWeightText || '').match(/\d+(?:\.\d+)?/);
          if (m) return m[0];
        }
        return '';
      };
      /* 空输入永不冲突；负重按解析值比较，「0」「0kg」「自重」是同一负重，不为此误弹确认 */
      const sameTarget = (key, cur, target) => {
        if (cur === target) return true;
        if (key !== 'weightKg') return false;
        const curW = Core.parseWeightInput(cur);
        const tgtW = Core.parseWeightInput(target);
        return curW.ok && tgtW.ok && curW.value !== null && curW.value === tgtW.value;
      };
      const hasConflict = rows.some((tr) => {
        const a = day.actions[Number(tr.querySelector('[data-idx]').dataset.idx)];
        if (!a) return false;
        return ['setsDone', 'repsText', 'weightKg'].some((key) => {
          const el = tr.querySelector(`[data-key="${key}"]`);
          const cur = el ? String(el.value).trim() : '';
          return cur !== '' && !sameTarget(key, cur, planTargetOf(a, key));
        });
      });
      if (hasConflict) {
        const ok = await confirmModal('覆盖已填写的数据？', '表格里有与计划不同的已填内容，按计划填充会覆盖这些未保存的输入。', '覆盖并填充');
        if (!ok) return;
      }
      rows.forEach((tr) => {
        const a = day.actions[Number(tr.querySelector('[data-idx]').dataset.idx)];
        if (!a) return;
        const set = (key, val) => {
          const el = tr.querySelector(`[data-key="${key}"]`);
          if (!el) return;
          el.value = val;
          if (el.value !== (el.dataset.orig || '')) el.dataset.dirty = '1';
        };
        set('setsDone', planTargetOf(a, 'setsDone'));
        set('repsText', planTargetOf(a, 'repsText'));
        set('weightKg', planTargetOf(a, 'weightKg'));
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
      Store.save(true);
      toast('休息完毕，进入下一训练日');
      App.render();
    };
    const finishBtn = $('#st-finish', root);
    if (finishBtn) finishBtn.onclick = () => this._saveActual(root, day, true);
    const skipBtn = $('#st-skip', root);
    if (skipBtn) skipBtn.onclick = () => this._skipModal(day);
    /* 补剂三态：未记 → 已服 ✓ → 未服 ✗ 循环，点击即落盘。
       只就地更新按钮文案/状态，不整页重绘——避免冲掉表格里未保存的手输（复核 P2） */
    $$('.st-tri', root).forEach((btn) => {
      btn.onclick = () => {
        const opened = this._ensureDay(day);
        if (!opened.ok) { toast(opened.error, 'red'); return; }
        const next = btn.dataset.state === 'unknown' ? true : btn.dataset.state === 'yes' ? false : null;
        const r = Core.saveTraining(state, { date: day.date, supplements: { [btn.dataset.sup]: next } });
        if (!r.ok) { toast(r.error, 'red'); return; }
        Store.save(true);
        btn.dataset.state = triState(next);
        const supName = btn.dataset.sup === 'creatineTaken' ? '肌酸' : '蛋白粉';
        btn.textContent = `${supName} · ${triLabel(next)}`;
      };
    });
    const dayNote = $('#st-day-note', root);
    if (dayNote) dayNote.onchange = () => {
      const opened = this._ensureDay(day);
      if (!opened.ok) { toast(opened.error, 'red'); return; }
      const r = Core.saveTraining(state, { date: day.date, note: dayNote.value });
      if (!r.ok) { toast(r.error, 'red'); return; }
      Store.save(true);
    };
    const suppNote = $('#st-supp-note', root);
    if (suppNote) suppNote.onchange = () => {
      const opened = this._ensureDay(day);
      if (!opened.ok) { toast(opened.error, 'red'); return; }
      const r = Core.saveTraining(state, { date: day.date, supplements: { note: suppNote.value } });
      if (!r.ok) { toast(r.error, 'red'); return; }
      Store.save(true);
    };
  },

  /* ================= 渐进超负荷：下次进步建议 ================= */
  /* 恢复上下文：昨晚主睡眠时长与连续不足晚数（来自 rhythm 记录）。
     供 nextSessionAdvice 做「恢复优先」降级；无 rhythm 数据时返回 null，不影响原建议。 */
  _recoveryContext(date) {
    try {
      const sleeps = (Store.db.rhythm && Store.db.rhythm.sleeps) || [];
      const night = (d) => {
        const list = sleeps.filter((s2) => s2.kind !== 'nap' && String(s2.endLocal || '').slice(0, 10) === d)
          .map((s2) => RhythmEngine.sleepMinutes(s2)).filter((m) => m > 0);
        return list.length ? Math.max(...list) : null;
      };
      const lastNight = night(date);
      if (lastNight == null) return null;
      let consecutive = 0;
      for (let i = 1; i <= 7; i++) {
        const m = night(Core.addDays(date, -i));
        if (m != null && m < 390) consecutive++;
        else break;
      }
      return { sleepMinutesLastNight: Math.round(lastNight), consecutiveShortNights: consecutive };
    } catch { return null; }
  },

/* 今日训练页的建议卡：按同一动作最近一次有数据的记录生成（Core.nextSessionAdvice 纯函数）。
     预览日/已收尾日只读展示；进行中的日子给「把建议填入表格」。 */
  _adviceCard(state, info) {
    const day = info.day;
    let advice = null;
    try { advice = Core.nextSessionAdvice(state, day, { recovery: this._recoveryContext(day.date) }); } catch { return ''; }
    if (!advice || !advice.hasAnyData) return '';
    this.ui.advice = advice;
    const dates = advice.items.map((i) => i.lastDate).filter(Boolean).sort();
    const refDate = dates.length ? dates[dates.length - 1].slice(5) : '';
    const canFill = !info.preview && day.status !== 'completed' && day.status !== 'skipped';
    return `
      <div class="card" id="st-advise">
        <h3>🎯 下次进步建议 <span class="h-extra">渐进超负荷 · 基于 ${esc(refDate)} 的实际数据</span></h3>
        <div class="st-table">
          ${advice.items.map((i) => this._adviceRowHtml(i)).join('')}
        </div>
        <div class="row" style="justify-content:space-between; margin-top:10px; align-items:center">
          <span class="hint">按你最近记下的组数、次数和负重给出下次参考。每一条右边是这次的说明。这是训练记录的趋势参考，不是固定的加重或减量表。</span>
          <span style="display:inline-flex; gap:6px">
            ${canFill ? '<button class="btn" id="st-adv-fill" data-no-icon="true">把建议填入表格</button>' : ''}
            <button class="btn" id="st-adv-apply" data-no-icon="true" title="以当前轮转模板为基础生成新版本，历史训练不受影响">按建议更新模板</button>
          </span>
        </div>
      </div>`;
  },

  _adviceRowHtml(i) {
    return `
      <div class="st-tr" style="grid-template-columns:minmax(110px,1fr) minmax(150px,1.2fr) minmax(200px,2.2fr)">
        <span class="st-name">${esc(i.name)}</span>
        <span class="st-plan"><b>${this._adviceTarget(i)}</b></span>
        <span class="st-last" style="white-space:normal">${esc(i.reason)}</span>
      </div>`;
  },

  /* ================= 餐后锻炼时机（饮食 × 训练时间窗） ================= */
  /* 就寝锚点：优先取今晚入睡建议（RhythmEngine.sleepAdvice），无睡眠数据时返回 null 走引擎默认 23:00 */
  _mealTimingBedMinutes() {
    try {
      const advice = RhythmEngine.sleepAdvice(Store.db.rhythm, new Date());
      if (advice && /^\d{2}:\d{2}$/.test(advice.bedtime || '')) {
        return Number(advice.bedtime.slice(0, 2)) * 60 + Number(advice.bedtime.slice(3, 5));
      }
    } catch { /* 无睡眠记录不影响默认锚点 */ }
    return null;
  },

  /* 力量训练时机提示：按上一次进食给出最早开始的钟点，不倒计时。
     正餐 ≥2 小时、加餐 ≥1 小时，取 Mayo Clinic（正餐 2–3 小时、大餐 3–4 小时、加餐约 1 小时）的保守下限。 */
  _mealHintCopy(advice) {
    if (!advice.hasMeal) {
      return {
        extra: '还没有进食记录',
        lead: '记下一餐吃完的时间后，这里会按那一餐告诉你力量训练最早几点开始。',
        note: '早餐、午餐、晚餐后至少 2 小时。上午加餐、下午加餐、晚上加餐后约 1 小时。不记吃了多少，所以正餐取 2 小时；很油很饱再自行多等约 1 小时。散步不用等这么久，餐后 10–15 分钟就可以。'
      };
    }
    const meal = advice.lastMeal;
    const v = advice.vigorous;
    const when = meal.priorDay ? `${meal.local.slice(5, 10)} ${meal.time}` : meal.time;
    const gapWord = meal.isSnack ? '加餐后约 1 小时' : '正餐后至少 2 小时';
    let lead;
    if (!v.feasible) {
      lead = `上次进食是${meal.typeLabel} ${when}。按 ${advice.bedtime} 就寝，力量训练要在 ${v.capText} 前结束，今晚已经排不开。可以散步或拉伸，力量训练改到明天 ${advice.performanceWindow.start}–${advice.performanceWindow.end}。`;
    } else if (v.ready || !advice.isToday) {
      lead = advice.isToday
        ? `上次进食是${meal.typeLabel} ${when}。${gapWord}的间隔已经过去，现在可以开始力量训练，请在 ${v.capText} 前结束。`
        : `这一天最后一次进食是${meal.typeLabel} ${meal.time}。力量训练最早 ${v.atText}，最晚 ${v.capText} 前结束。`;
    } else {
      lead = `上次进食是${meal.typeLabel} ${when}。力量训练建议 ${v.atText} 之后开始（${gapWord}），并在 ${v.capText} 前结束。`;
    }
    const note = meal.isSnack
      ? '加餐按约 1 小时（Mayo Clinic）。低强度散步餐后 10–15 分钟就可以，不必等这一小时。'
      : '正餐按至少 2 小时（Mayo Clinic 普通正餐 2–3 小时的下限；大餐 3–4 小时，很油很饱再多等约 1 小时）。低强度散步餐后 10–15 分钟就可以。睡前 2 小时内不做力量训练（Stutz 2019）。';
    return { extra: `上次 ${meal.typeLabel} ${when}`, lead, note };
  },

  _mealTimingCard(date) {
    let advice = null;
    try {
      const bedMinutes = this._mealTimingBedMinutes();
      advice = Core.postMealTimingAdvice((Store.db.rhythm && Store.db.rhythm.meals) || [], new Date(),
        { date, bedMinutes, bedSource: bedMinutes != null ? 'advice' : 'default' });
    } catch { return ''; }
    if (!advice) return '';
    const copy = this._mealHintCopy(advice);
    return `
      <div class="card st-meal-hint" id="st-meal-timing">
        <h3>力量训练时机 <span class="h-extra">${esc(copy.extra)}</span></h3>
        <p>${esc(copy.lead)}</p>
        <p class="hint">${esc(copy.note)}</p>
        <div class="row" style="justify-content:space-between; margin-top:8px; align-items:center">
          <span class="hint">${esc(advice.disclaimer)}</span>
          ${advice.hasMeal ? '' : '<button class="btn" id="st-meal-log" data-no-icon="true">去记一餐</button>'}
        </div>
      </div>`;
  },

  /* 建议值列：重量 × 次数 × 组数，加重时附带增量 */
  _adviceTarget(i) {
    const load = i.weightUnknown ? '负重待补'
      : (Core.weightLabelKg(i.weightKg) || '自重');
    const delta = i.modeLabel === '加重量' && i.deltaKg !== null && i.deltaKg !== undefined ? `（+${i.deltaKg}kg）` : '';
    return `${esc(i.modeLabel)}：${esc(load)}${i.repsText ? ' × ' + esc(i.repsText) : ''}${i.sets ? ' × ' + i.sets + ' 组' : ''}${esc(delta)}`;
  },

  /* 收尾后弹「下次练这个训练日」的建议；同内容也会显示在今日训练页的建议卡 */
  _adviceModal(day) {
    const state = Store.db.strength;
    let advice = null;
    try { advice = Core.nextSessionAdvice(state, day, { recovery: this._recoveryContext(day.date) }); } catch { return; }
    if (!advice || !advice.hasAnyData) return;
    this.ui.advice = advice;
    const card = openModal(`
      <h3>🎯 下次练「${esc(day.name)}」的进步建议</h3>
      <p class="hint">按这次记下的组数、次数和负重生成。下次这个训练日回来时，今日训练页会显示同样的建议。</p>
      <div class="st-table">
        ${advice.items.map((i) => this._adviceRowHtml(i)).join('')}
      </div>
      <p class="hint" style="margin-top:8px">具体加减以每条建议的说明为准。这是训练记录的趋势参考，不是处方。</p>
      <div class="row" style="justify-content:flex-end; margin-top:12px">
        <button class="btn primary" id="st-adv-close">知道了</button>
      </div>`);
    $('#st-adv-close', card).onclick = closeModal;
  },

  /* 一键把建议写进模板：以当前轮转模板为基础生成新版本（模板版本化，历史训练与快照不受影响）。
     只有带完成数据的动作会被改写（start 模式跳过）；确认后执行，建议仍是建议。 */
  _applyAdviceToTemplate() {
    const state = Store.db.strength;
    const advice = this.ui.advice;
    if (!advice || !advice.hasAnyData) { toast('还没有可应用的递进建议', 'red'); return; }
    const tpl = this._rotationTpl(state);
    if (!tpl) { toast('先建立模板', 'red'); return; }
    confirmModal('按建议更新模板？', `会以「${tpl.name}」当前版本为基础生成新版本：有建议值的动作改写组数/次数/负重，其余动作不变；历史训练不受影响。`, '生成新版本').then(ok => {
      if (!ok) return;
      const version = Core.currentVersion(tpl);
      const byKey = new Map(advice.items.map(i => [i.actionKey, i]));
      const days = version.days.map(d => ({
        dayKey: d.dayKey, name: d.name, bodyPart: d.bodyPart || '', isRest: !!d.isRest,
        actions: d.actions.map(a => {
          const it = byKey.get(a.actionKey);
          if (!it || it.mode === 'start') return { ...a };
          return {
            ...a,
            plannedSets: Number.isInteger(it.sets) && it.sets > 0 ? it.sets : a.plannedSets,
            plannedRepsText: it.repsText || a.plannedRepsText,
            plannedWeightText: Core.weightLabelKg(it.weightKg) || (it.bodyweight ? '自重' : a.plannedWeightText)
          };
        })
      }));
      const r = Core.replaceTemplate(state, { id: tpl.id, name: tpl.name, changeNote: `应用递进建议（基于 ${advice.date}）`, days });
      if (!r.ok) { toast(r.error, 'red'); return; }
      /* 清空编辑器内存草稿与 localStorage 草稿：否则旧草稿（基于旧版本）会盖掉刚写入的建议，
         重启后还会被草稿恢复机制复活（冲突检索 P1） */
      this.ui.tplDraft = null;
      this.ui.tplDirty = false;
      try { localStorage.removeItem(Drafts.prefix + 'template-model:' + (this.ui.tplEditId || 'current')); } catch {}
      Store.save(true);
      toast(`已生成第 ${r.template.currentRevision} 版模板，递进建议已写入计划 ✓`, 'green');
      App.render();
    });
  },

  /* 一键把建议值填进今日表格（首次动作留空按计划），保存仍需用户确认。
     表格里已有与建议不同的未保存输入时先弹确认，避免静默覆盖（P2-1）。 */
  async _fillFromAdvice(root) {
    const advice = this.ui.advice;
    if (!advice) return;
    const rows = $$('#st-actions .st-tr', root).filter((tr) => tr.querySelector('.st-num'));
    const targetOf = (it, key) => key === 'setsDone'
      ? (it.sets === null || it.sets === undefined ? '' : String(it.sets))
      : key === 'weightKg'
        ? (it.weightKg === null || it.weightKg === undefined || it.weightKg === 0
          ? (it.bodyweight || it.weightKg === 0 ? '自重' : '')
          : String(it.weightKg))
        : String(it.repsText || '');
    const hasConflict = rows.some((tr) => {
      const it = advice.items[Number(tr.querySelector('[data-idx]').dataset.idx)];
      if (!it || it.mode === 'start') return false;
      return ['setsDone', 'repsText', 'weightKg'].some((key) => {
        const el = tr.querySelector(`[data-key="${key}"]`);
        const cur = el ? String(el.value).trim() : '';
        return cur !== '' && cur !== targetOf(it, key);
      });
    });
    if (hasConflict) {
      const ok = await confirmModal('覆盖已填写的数据？', '表格里有与建议不同的已填内容，按建议填充会覆盖这些未保存的输入。', '覆盖并填充');
      if (!ok) return;
    }
    rows.forEach((tr) => {
      const it = advice.items[Number(tr.querySelector('[data-idx]').dataset.idx)];
      if (!it || it.mode === 'start') return;
      const set = (key, val) => {
        const el = tr.querySelector(`[data-key="${key}"]`);
        if (!el || val === null || val === undefined || val === '') return;
        el.value = val;
        if (el.value !== (el.dataset.orig || '')) el.dataset.dirty = '1';
      };
      set('setsDone', it.sets);
      set('repsText', it.repsText);
      set('weightKg', targetOf(it, 'weightKg'));
    });
    toast('已按建议填充，改完记得保存');
  },

  /* 预览日还没有快照。第一次保存或打补剂时先落成训练日，不写时长。 */
  _ensureDay(day) {
    const state = Store.db.strength;
    const existing = Core.dayRecord(state, day.date);
    if (existing) return { ok: true, day: existing };
    return Core.startTraining(state, { date: day.date });
  },

  /* 收集表格输入 → saveTraining；withFinish 时先保存再弹收尾确认。
     负重走 Core.resolveWeightInput：数字（可带 kg）原样入库，「自重」折算成 0，
     练了却没填重量也按自重（0）记，整行没动过才记 null（没记）。 */
  async _saveActual(root, day, withFinish) {
    const liveDay = Core.dayRecord(Store.db.strength, day.date) || day;
    if (liveDay.status === 'completed' || liveDay.status === 'skipped') {
      toast('这一天已收尾，重开后才能修改', 'red');
      return;
    }
    const actions = $$('#st-actions .st-tr', root)
      .filter((tr) => tr.querySelector('.st-num'))
      .map((tr) => {
        const idx = Number(tr.querySelector('[data-idx]').dataset.idx);
        const action = (liveDay.actions || [])[idx] || day.actions[idx] || {};
        const dirty = ['setsDone', 'repsText', 'weightKg'].some((key) => {
          const el = tr.querySelector(`[data-key="${key}"]`);
          return el && el.dataset.dirty === '1';
        });
        /* 没改过的行提交记录里的当前值。逐组弹窗刚保存后，主表输入仍可能是旧数字。 */
        if (!dirty && Array.isArray(action.sets)) {
          const kept = {
            actionKey: action.actionKey,
            setsDone: action.setsDone === undefined ? null : action.setsDone,
            repsText: action.repsText || '',
            weightKg: action.weightKg === undefined ? null : action.weightKg
          };
          if (Array.isArray(action.sets)) kept.sets = JSON.parse(JSON.stringify(action.sets));
          return kept;
        }
        const get = (key) => {
          const el = tr.querySelector(`[data-key="${key}"]`);
          return el ? el.value : '';
        };
        const sets = get('setsDone');
        const repsText = get('repsText').trim();
        const setsDone = sets === '' ? null : Math.max(0, Math.floor(Number(sets)));
        /* 这一行练过（有完成组数或有实际次数）就把留空当自重记；整行没动仍留 null */
        const weight = Core.resolveWeightInput(get('weightKg'), (setsDone || 0) > 0 || !!repsText);
        if (!weight.ok) {
          toast(`${action.name ? action.name + '：' : ''}${weight.error}`, 'red');
          return { invalid: true };
        }
        return {
          actionKey: action.actionKey,
          setsDone,
          repsText,
          weightKg: weight.value,
          summaryEdited: true
        };
      });
    if (actions.some((a) => a.invalid)) return;
    const opened = this._ensureDay(day);
    if (!opened.ok) { toast(opened.error, 'red'); return; }
    const previous=structuredClone(Store.db.strength);
    const patch = { date: day.date, actions };
    const r = Core.saveTraining(Store.db.strength, patch);
    if (!r.ok) { toast(r.error, 'red'); return; }
    try{if(!await Store.save(true))throw Error('write failed');}catch{Store.db.strength=previous;toast('保存失败，数值已保留，请重试','red');return;}
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
        App.render();
      };
      $('#st-fin-ok', card).onclick = () => {
        const text = $('#st-fin-text', card).value.trim();
        const note = $('#st-fin-note', card).value.trim();
        if (text) {
          const sr = Core.saveTraining(Store.db.strength, { date: day.date, completionText: text });
          if (!sr.ok) { toast(sr.error, 'red'); return; }
        }
        const fr = Core.finishAndAdvance(Store.db.strength, { date: day.date, note });
        if (!fr.ok) { toast(fr.error, 'red'); return; }
        Store.save(true); closeModal();
        toast('已收尾，轮转到下一训练日');
        this._adviceModal(day); /* 练完即给「下次练这个训练日」的递进建议 */
        if (typeof Views !== 'undefined' && Views.checkBadgeUnlocks) Views.checkBadgeUnlocks();
        App.render();
      };
    } else {
      toast('实际数据与变化已保存，下次沿用这次基准','green');
    }
    App.render();
  },

  /* 「今天不练了」：写明原因再跳过（原因持久化到收尾决议，历史/日详情可见，
     皮肤预测引擎会把该日按未训练处理）。预览日未开始时先落快照再跳过。 */
  _skipModal(day) {
    const state = Store.db.strength;
    const live = Core.dayRecord(state, day.date);
    if (live && (live.status === 'completed' || live.status === 'skipped')) {
      toast('这一天已收尾，重开后才能修改', 'red');
      return;
    }
    if (live && live.status === 'partial') {
      toast('这一天已经记了训练，要改成跳过请先重开', 'red');
      return;
    }
    const card = openModal(`
      <h3>⏭ 今天不练了？</h3>
      <p class="hint">这一天会记为「已跳过」并轮转到下一训练日。写下原因，历史里能提醒未来的自己。</p>
      <div class="row" id="st-skip-chips" style="gap:6px; flex-wrap:wrap; margin-top:10px">
        <button class="btn small ghost" data-r="加班/太忙" data-no-icon="true">加班/太忙</button>
        <button class="btn small ghost" data-r="身体不适" data-no-icon="true">身体不适</button>
        <button class="btn small ghost" data-r="外出/旅行" data-no-icon="true">外出/旅行</button>
        <button class="btn small ghost" data-r="状态不好" data-no-icon="true">状态不好</button>
        <button class="btn small ghost" data-r="主动休息" data-no-icon="true">主动休息</button>
      </div>
      <textarea class="textarea" id="st-skip-reason" rows="2" maxlength="200" placeholder="原因（可留空或补充），如：昨晚熬夜，今天主动休息恢复"></textarea>
      <div class="row" style="justify-content:flex-end; margin-top:12px">
        <button class="btn ghost" id="st-skip-cancel">取消</button>
        <button class="btn primary" id="st-skip-ok">记录今天不练并轮转</button>
      </div>`);
    $$('#st-skip-chips .btn', card).forEach((b) => {
      b.onclick = () => { $('#st-skip-reason', card).value = b.dataset.r; };
    });
    $('#st-skip-cancel', card).onclick = closeModal;
    $('#st-skip-ok', card).onclick = () => {
      const reason = $('#st-skip-reason', card).value.trim().slice(0, 200);
      /* 预览日还没有快照：先落快照再跳过 */
      if (!Core.dayRecord(state, day.date)) {
        const s = Core.startTraining(state, { date: day.date });
        if (!s.ok) { toast(s.error, 'red'); return; }
      }
      const r = Core.skipAndAdvance(state, { date: day.date, note: reason });
      if (!r.ok) { toast(r.error, 'red'); return; }
      Store.save(true);
      toast(reason ? `已记录今天不练（${reason.slice(0, 14)}），轮转到下一训练日` : '已记录今天不练，轮转到下一训练日');
      App.render();
    };
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
          const ok = p.sets >= rec.min && p.sets <= rec.max;
          const over = p.sets > rec.max;
          return `
          <div class="st-week-item" style="margin-bottom:12px">
            <div style="display:flex; align-items:baseline; gap:10px; font-size:13px; margin-bottom:4px">
              <b>${esc(s.bodyPart)}</b><span class="hint">${p.sets} 组 · ${p.sessions} 练</span>
              <em class="${ok ? 'is-ok' : ''}" style="font-style:normal; margin-left:auto; font-size:12px; color:${ok ? '#15803d' : over ? '#b45309' : 'rgba(44,58,71,.55)'}">${ok ? '处于参考区间' : over ? '超过参考区间上限' : `参考每周 ${rec.min}–${rec.max} 组`}</em>
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
        <div class="empty">还没有训练模板。可以从模板库选一套分化（三分化 / 上下分化 / 全身），或新建空白模板自己写。</div>
        <div class="row">
          <button class="btn primary" id="st-tpl-preset-empty">从模板库选择</button>
          <button class="btn" id="st-tpl-blank">新建空白模板</button>
          <button class="btn" id="st-tpl-import">导入数据（文本/JSON）</button>
        </div>
      </div>` : `
      <div class="card">
        <h3>✍️ 训练日模板 <span class="h-extra">${tpl ? `当前第 ${tpl.currentRevision} 版` : '新建模板'}</span></h3>
        <p class="hint">保存会创建不可变的新版本；历史训练及其计划快照不会被改写。部位（如 胸/背/腿）用于成长曲线归类。</p>
        ${(() => {
          const rot = this._rotationTpl(state);
          const same = tpl && rot && tpl.id === rot.id;
          const rotDay = rot && state.cycle[rot.id] ? state.cycle[rot.id].currentDayKey : '';
          const rotDayName = rot && rotDay ? ((Core.currentVersion(rot).days || []).find((d) => d.dayKey === rotDay) || {}).name : '';
          return `<div class="st-belong" style="margin-bottom:12px">
            <span class="hint">${same
              ? `今天训练所属就是这份模板${rotDayName ? ` · 当前练「${esc(rotDayName)}」` : ''}。要换一天，去「今日训练」顶上的下拉框。`
              : `今天训练所属是「${esc(rot ? rot.name : '未指定')}」${rotDayName ? ` · ${esc(rotDayName)}` : ''}。下面改的是另一份模板，不会自动变成今天在练的。`}</span>
            ${!same && rot ? `<button class="btn small" id="st-tpl-use-today" data-no-icon="true">用这份模板练今天</button>` : ''}
          </div>`;
        })()}
        ${state.templates.length > 1 ? `
        <div style="margin-bottom:10px">
          <label style="${S.inlineLabel}">编辑哪个模板
            <select class="input" id="st-tpl-select" style="max-width:300px">
              ${state.templates.map((t) => `<option value="${esc(t.id)}"${tpl && t.id === tpl.id ? ' selected' : ''}>${esc(t.name)}（第 ${t.currentRevision} 版）</option>`).join('')}
            </select></label>
          <span class="hint" style="margin-left:8px">只换编辑对象，不会改今天在练哪一份；切换会丢弃未保存的编辑</span>
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
          <datalist id="st-action-names">${this._actionNameOptions(state).map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
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

  /* 历史动作名去重清单：模板编辑器 datalist 用。同一动作沿用同一名字（→ 同一 actionKey），
     递进建议的「上次对比」与历史曲线才不断链 */
  _actionNameOptions(state) {
    const names = new Set();
    for (const t of state.templates || []) {
      for (const v of t.versions || []) {
        for (const d of v.days || []) {
          for (const a of d.actions || []) {
            const n = String(a.name || '').trim();
            if (n) names.add(n);
          }
        }
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
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
            <input class="input" data-ai="${ai}" data-akey="name" maxlength="200" placeholder="动作名" list="st-action-names" value="${esc(a.name)}">
            <input class="input st-num" data-ai="${ai}" data-akey="plannedSets" type="number" min="0" max="999" value="${esc(String(a.plannedSets))}">
            <input class="input" data-ai="${ai}" data-akey="plannedRepsText" maxlength="60" placeholder="12-15" value="${esc(a.plannedRepsText)}">
            <input class="input" data-ai="${ai}" data-akey="plannedWeightText" maxlength="120" placeholder="如 40kg" value="${esc(a.plannedWeightText)}">
            <input class="input" data-ai="${ai}" data-akey="targetText" maxlength="200" placeholder="选填" value="${esc(a.targetText)}">
            <div class="st-act-ops">
              <button class="btn ghost" data-move-act="${ai}" data-dir="-1" data-no-icon="true" style="padding:2px 7px" title="上移" ${ai === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn ghost" data-move-act="${ai}" data-dir="1" data-no-icon="true" style="padding:2px 7px" title="下移" ${ai === d.actions.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn ghost" data-del-act="${ai}" data-no-icon="true" style="padding:2px 7px" title="删除">删</button>
            </div>
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
    const useToday = $('#st-tpl-use-today', root);
    if (useToday) useToday.onclick = () => {
      const state = Store.db.strength;
      const tpl = this._editTpl(state);
      if (!tpl) return;
      const version = Core.currentVersion(tpl);
      const dayKey = (state.cycle[tpl.id] && state.cycle[tpl.id].currentDayKey)
        || (version.days[0] && version.days[0].dayKey);
      const r = Core.assignTrainingDay(state, { date: this.ui.date || Core.businessDate(), templateId: tpl.id, dayKey });
      if (!r.ok) { toast(r.error, 'red'); return; }
      Store.save(true);
      this.ui.tab = 'today';
      toast('今天改练这份模板了');
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
      const presetEmpty = $('#st-tpl-preset-empty', root);
      if (presetEmpty) presetEmpty.onclick = () => this._presetModal();
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
      /* 动作排序：上移/下移（边界禁用） */
      $$('[data-move-act]', dayEl).forEach((btn) => {
        btn.onclick = () => {
          const arr = draft.days[di].actions;
          const i2 = Number(btn.dataset.moveAct), j = i2 + Number(btn.dataset.dir);
          if (i2 < 0 || i2 >= arr.length || j < 0 || j >= arr.length) return;
          const tmp = arr[i2]; arr[i2] = arr[j]; arr[j] = tmp;
          this.ui.tplDirty = true;
          App.render();
        };
      });
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
    const theme = this._theme();
    const map = new Map(muscles.map((m) => [m.key, m]));
    const selected = map.get(this.ui.muscle)
      || muscles.find((m) => m.recentSets > 0)
      || muscles[0];
    this.ui.muscle = selected.key;
    const profile = state.bmiProfile || {};
    const h = Number(profile.heightCm), w = Number(profile.weightKg);
    const bmi = Core.bmi(h, w);
    const renderBmiExtra = () => {
      const age = Number(profile.age), sex = profile.sex, act = profile.activity;
      const range = Core.healthyWeightRange(h);
      const bmr = ['男','女'].includes(sex) && age>0 ? Core.bmrMifflin(sex, w, h, age) : null;
      const tdeeV = act ? Core.tdee(bmr, act) : null;
      const parts = [];
      if (range) parts.push(`健康体重 ${range.min}–${range.max} kg`);
      if (bmr) parts.push(`基础代谢 BMR ≈ ${bmr} kcal/天`);
      if (tdeeV) parts.push(`维持体重参考摄入 ≈ ${tdeeV} kcal/天`);
      return parts.join(' · ');
    };
    const bmiExtra = renderBmiExtra();
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
                const color = ProgressVisual.levelOf(p.overallScore, p.confidence, theme).color;
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
            <div class="st-scorehero">
              <strong>${selected.overallScore}</strong><span>/ 100 综合训练指数</span>
              ${this._excellentBadge(selected, theme)}
            </div>
            ${ProgressVisual.DIMENSIONS.map((dim) => this._meter(dim.key, selected, theme)).join('')}
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
            <div><p>身体指标</p><h4>我的基础数值</h4></div>
            <div class="st-bmi-inputs">
              <label>身高（cm）<input class="input" id="st-bmi-h" type="number" min="100" max="250" inputmode="decimal" value="${esc(String(profile.heightCm ?? ''))}"></label>
              <label>体重（kg）<input class="input" id="st-bmi-w" type="number" min="25" max="400" step="0.1" inputmode="decimal" value="${esc(String(profile.weightKg ?? ''))}"></label>
              <label>年龄<input class="input" id="st-bmi-age" type="number" min="10" max="100" inputmode="numeric" value="${esc(String(profile.age ?? ''))}" placeholder="岁"></label>
              <label>性别<select class="input" id="st-bmi-sex"><option value="">待补充</option><option value="男"${profile.sex === '男' ? ' selected' : ''}>男</option><option value="女"${profile.sex === '女' ? ' selected' : ''}>女</option></select></label>
              <label>活动水平<select class="input" id="st-bmi-act"><option value="">待补充</option>
                <option value="sedentary"${profile.activity === 'sedentary' ? ' selected' : ''}>久坐</option>
                <option value="light"${profile.activity === 'light' ? ' selected' : ''}>轻度活动</option>
                <option value="moderate"${profile.activity === 'moderate' ? ' selected' : ''}>中度活动</option>
                <option value="active"${profile.activity === 'active' ? ' selected' : ''}>高强度</option>
              </select></label>
            </div>
            <output class="st-bmi-output" id="st-bmi-out" aria-live="polite">
              ${bmi === null ? '<span>填写身高和体重后自动计算</span>' : `<strong>${bmi}</strong><span>${Core.bmiCategoryCN(bmi)}（中国标准）</span>`}
            </output>
            <div class="hint" id="st-bmi-extra" style="margin-top:6px">${bmiExtra}</div>
            <p class="hint">BMI = kg ÷ m²（中国成人标准 18.5–23.9 为正常），无法区分肌肉与脂肪；BMR 用 Mifflin-St Jeor 估算，维持体重参考摄入 = BMR × 活动系数。均为估算参考、非医学建议；其中性别与年龄会参与耐力常模分档（未填性别用合并宽松档、分数置信度降低），身高体重不参与训练进步评分。</p>
          </div>
          <details class="st-algorithm">
            <summary>查看评分算法</summary>
            <div>
              <p><strong>增肌刺激：</strong>刺激组数完成度 60% + 负重容量趋势 25% + 每周频率 15%。主肌群计 1 组、辅助肌群计 0.5 组；完成度按分段曲线：10 组/周 到 90 分，10–20 组爬升到 100（推荐带），超过 20 组缓慢回落到 85（过度容量的恢复成本）；次数区间折算刺激性质——5–30 次全额、1–4 次 0.6（偏神经/力量）、30 次以上 0.7、未记次数 0.85。</p>
              <p><strong>力量趋势：</strong>同一动作的估算 1RM 变化 70% + 阻力重量变化 20% + 频率 10%，趋势取各动作前两高记录的平均以抗单次波动。估算 1RM：≤8 次用 Brzycki，9–10 次取 Brzycki 与 Epley 的平均（两者在区间上端分别偏低/偏高，平均可消偏差）；公式精度仅对 ≤10 次接近力竭的组成立（±5%），是同动作趋势代理，不能替代真实极限测试。</p>
              <p><strong>耐力（绝对常模分）：</strong>每动作取最佳单组对照常模独立计 0–100 分，肌群取最高值（峰值原则，俯卧撑 50 个就代表胸部，不与卧推 10 次平均）。路径：负重动作有同窗重组锚点时，按「实际次数 ÷ 该 %1RM 下人群预测次数」查分段计分表（1.0 倍 = 人群平均 = 50 分）；俯卧撑、引体、卷腹、仰卧起坐查性别×年龄常模表（性别未填用合并宽松档、年龄按 20–29 岁，置信度降为有限）；其余自重动作按负荷档曲线；无锚点动作按通用宽档估计。容量累加不参与耐力分；↑/↓ 趋势仅作提示、不进分数。</p>
              <p>这是训练日志趋势，不是实际肌肉增长率或医疗诊断。合成权重（0.6/0.25/0.15、0.7/0.2/0.1、综合分双数据分支 0.35/0.35/0.2/0.1）为设计取值——文献只给出组数推荐带与 1RM 估算公式，不提供唯一合成比；全部参数的出处分层见 docs/scoring-parameters.md。</p>
            </div>
          </details>
        </div>
      </div>`;
  },

  /* 当前明暗主题（模块本身不做 DOM 查询，theme 由视图层判定后传入） */
  _theme() {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  },

  /* 达标徽标（P10.3）：综合分档位达到「出色」且 confidence==='good' 时显示静态徽标，无动画 */
  _excellentBadge(progress, theme) {
    const level = ProgressVisual.levelOf(progress.overallScore, progress.confidence, theme);
    if (level.tier !== ProgressVisual.MOTION.badgeTier || progress.confidence !== 'good') return '';
    return `<span class="st-excellent-badge">${esc(level.label)}</span>`;
  },

  /* 维度条：经 ProgressVisual.meterView 渲染（三态 empty/zero/ok + 趋势 chip，顺序按 DIMENSIONS 注册表：
     增肌刺激 → 力量趋势 → 耐力）。progress 行上耐力等新字段可能因引擎未就绪或数据为 null 而缺失，
     meterView 对非有限数一律按 empty 态防御，UI 不报错。 */
  _meter(dimensionKey, progress, theme) {
    const dim = ProgressVisual.DIMENSIONS.find((d) => d.key === dimensionKey);
    if (!dim) return '';
    const row = progress || {};
    const view = ProgressVisual.meterView({
      dimension: dimensionKey,
      score: row[dim.scoreField],
      /* P7.4：只有注册了 changeField 的维度（力量/耐力）有趋势；增肌传 undefined → empty → 无 chip */
      changePercent: dim.changeField ? row[dim.changeField] : undefined,
      confidence: row.confidence,
      theme
    });
    if (!view) return '';
    /* P5.5：视觉箭头对读屏隐藏，语义由 aria-label 完整承载 */
    const chip = dim.changeField
      ? `<span class="st-delta" data-tone="${view.delta.tone}">` +
        `${view.delta.arrow ? `<span aria-hidden="true">${view.delta.arrow}</span>` : ''}` +
        `${esc(view.delta.text.slice(view.delta.arrow.length))}</span>`
      : '';
    /* P5.2：无数据省略 aria-valuenow（修正把「无数据」读成 0 分的现状） */
    const valuenow = view.state === 'empty' ? '' : ` aria-valuenow="${view.fillPercent}"`;
    return `
      <div class="st-meter-row ${view.classes.join(' ')}">
        <div><span>${esc(view.label)}</span><span class="st-meter-val"><strong>${esc(view.valueText)}</strong>${chip}</span></div>
        <div class="st-meter" role="meter" aria-valuemin="0" aria-valuemax="100"${valuenow} aria-label="${esc(view.ariaLabel)}">
          <i style="width:${view.fillPercent}%"></i>
        </div>
      </div>`;
  },

  /* 综合分数字滚动（P10.1）：同肌群上次分差 ≥ MOTION.countUpMinDelta 才滚 countUpMs；
     prefers-reduced-motion 命中或首见肌群直接显示终值（HTML 初值即终值）。上次值存 ui._lastOverallScores（内存，不落盘）。 */
  _animateScoreHero(root) {
    const el = $('.st-scorehero strong', root);
    if (!el) return;
    const final = Number(el.textContent);
    if (!Number.isFinite(final)) return;
    const scores = this.ui._lastOverallScores || (this.ui._lastOverallScores = {});
    const prev = typeof scores[this.ui.muscle] === 'number' ? scores[this.ui.muscle] : null;
    scores[this.ui.muscle] = final;
    if (prev === null || Math.abs(final - prev) < ProgressVisual.MOTION.countUpMinDelta) return;
    /* CSS 兜底管不住 JS 逐帧写 textContent，必须再查一次 matchMedia（设计文档 §6） */
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (this._scoreRaf) cancelAnimationFrame(this._scoreRaf);
    const ease = cubicEase(0.22, 0.61, 0.36, 1); /* 与维度条 width 过渡同款缓动 */
    const from = prev, to = final;
    const duration = ProgressVisual.MOTION.countUpMs;
    const t0 = performance.now();
    el.textContent = String(from);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      el.textContent = String(Math.round(from + (to - from) * ease(t)));
      this._scoreRaf = t < 1 ? requestAnimationFrame(step) : null;
    };
    this._scoreRaf = requestAnimationFrame(step);
  },

  _bindProgress(root) {
    $$('.st-hotspot', root).forEach((btn) => {
      btn.onclick = () => { this.ui.muscle = btn.dataset.muscle; App.render(); };
    });
    this._animateScoreHero(root);
    const hInput = $('#st-bmi-h', root), wInput = $('#st-bmi-w', root);
    const ageInput = $('#st-bmi-age', root), sexInput = $('#st-bmi-sex', root), actInput = $('#st-bmi-act', root);
    if (!hInput || !wInput) return;
    const profile = Store.db.strength.bmiProfile || {};
    const saveProfile = () => {
      const h = Number(hInput.value), w = Number(wInput.value);
      const age = Number(ageInput.value);
      Store.db.strength.bmiProfile = {
        heightCm: Number.isFinite(h) && h > 0 ? h : undefined,
        weightKg: Number.isFinite(w) && w > 0 ? w : undefined,
        age: Number.isInteger(age) && age > 0 ? age : undefined,
        sex: ['男','女'].includes(sexInput.value) ? sexInput.value : '',
        activity: actInput.value
      };
      Store.db.profile=JSON.parse(JSON.stringify(Store.db.strength.bmiProfile));
      Store.save();
    };
    const recalc = () => {
      const h = Number(hInput.value), w = Number(wInput.value);
      const age = Number(ageInput.value);
      const sex = sexInput.value, act = actInput.value;
      const bmi = Core.bmi(h, w);
      const range = Core.healthyWeightRange(h);
      const bmr = ['男','女'].includes(sex) && age>0 ? Core.bmrMifflin(sex, w, h, age) : null;
      const tdeeV = act ? Core.tdee(bmr, act) : null;
      $('#st-bmi-out', root).innerHTML = bmi === null
        ? '<span>填写身高和体重后自动计算</span>'
        : `<strong>${bmi}</strong><span>${Core.bmiCategoryCN(bmi)}（中国标准）</span>`;
      const parts = [];
      if (range) parts.push(`健康体重 ${range.min}–${range.max} kg`);
      if (bmr) parts.push(`基础代谢 BMR ≈ ${bmr} kcal/天`);
      if (tdeeV) parts.push(`维持体重参考摄入 ≈ ${tdeeV} kcal/天`);
      $('#st-bmi-extra', root).textContent = parts.join(' · ');
    };
    const onChange = () => { recalc(); saveProfile(); };
    hInput.oninput = onChange;
    wInput.oninput = onChange;
    ageInput.oninput = onChange;
    sexInput.onchange = onChange;
    actInput.onchange = onChange;
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
    /* 不练原因：跳过的日子把收尾决议里的原因带出来，提醒未来的自己 */
    const reason = day.status === 'skipped' && day.resolution && day.resolution.note
      ? ` · 原因：${esc(String(day.resolution.note).slice(0, 16))}${String(day.resolution.note).length > 16 ? '…' : ''}` : '';
    return `
      <div class="st-history-row" data-date="${esc(day.date)}">
        <div class="t-time">${esc(day.date.slice(5))}</div>
        <div class="t-name"><b>${esc(day.name)}</b><span>${Core.STATUS_LABELS[day.status]} · ${v.sets} 组 · ${v.volume} kg${reason}</span></div>
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
            <span>${a.setsDone !== null && a.setsDone !== undefined ? `${a.setsDone} 组 × ${esc(a.repsText || '?')} · ${esc(Core.weightLabelKg(a.weightKg) || '自重')}` : '—'}</span>
          </div>`).join('')}
      </div>
      <div class="hint" style="margin-top:8px">${v.sets} 组 · 容量 ${v.volume} kg${day.resolution && day.resolution.note ? '<br>收尾：' + esc(day.resolution.note) : ''}</div>
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
    const date = this.ui.date || Core.businessDate();
    const info = Core.todayPlan(state, date);
    let tpl = (info.day && Core.templateById(state, info.day.templateId)) || this._rotationTpl(state);
    if (!tpl) { toast('先建立模板', 'red'); return; }
    const pickTpl = (id) => Core.templateById(state, id) || tpl;
    const listHtml = (t) => {
      const version = Core.currentVersion(t);
      const curKey = (info.day && info.day.templateId === t.id && info.day.dayKey)
        || (state.cycle[t.id] && state.cycle[t.id].currentDayKey);
      return (version.days || []).map((d) => `
        <div class="today-item st-cycle-day" data-key="${esc(d.dayKey)}" style="cursor:pointer; ${d.dayKey === curKey ? 'border-color:var(--accent);' : ''}">
          <div class="t-name"><b>${esc(d.name)}</b><span>${d.isRest ? '休息日' : d.actions.length + ' 个动作'}${d.dayKey === curKey ? ' · 当前' : ''}</span></div>
        </div>`).join('');
    };
    const card = openModal(`
      <h3>🔀 今天练哪一天</h3>
      <p class="hint">训练所属 = 哪一份模板里的哪一个训练日。练的时候也可以在今日训练页顶上直接改。</p>
      ${state.templates.length > 1 ? `
      <label class="field">所属模板</label>
      <select class="input" id="st-cycle-tpl">${state.templates.map((t) => `<option value="${esc(t.id)}"${t.id === tpl.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}
      <div class="today-list" id="st-cycle-list" style="margin-top:10px">${listHtml(tpl)}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="st-cycle-close">关闭</button></div>`);
    const bindDays = (t) => {
      $$('.st-cycle-day', card).forEach((el) => {
        el.onclick = async () => {
          const r = Core.assignTrainingDay(Store.db.strength, { date, templateId: t.id, dayKey: el.dataset.key });
          if (!r.ok) { toast(r.error, 'red'); return; }
          Store.save(true);
          closeModal();
          toast('已切换所属训练日');
          App.render();
        };
      });
    };
    bindDays(tpl);
    const tplSel = $('#st-cycle-tpl', card);
    if (tplSel) tplSel.onchange = () => {
      tpl = pickTpl(tplSel.value);
      $('#st-cycle-list', card).innerHTML = listHtml(tpl);
      bindDays(tpl);
    };
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
