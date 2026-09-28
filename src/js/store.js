/* 数据中心：加载 / 保存 / 派生计算（今日训练、护肤打卡、达标判断） */

const Store = {
  db: null,
  _saveTimer: null,

  async init() {
    this.db = await window.native.loadData();
    if (!this.db.skincare) this.db.skincare = { cycles: [] };
    if (!this.db.logs) this.db.logs = { training: {}, skincare: {} };
    if (!this.db.logs.training) this.db.logs.training = {};
    if (!this.db.logs.skincare) this.db.logs.skincare = {};
    this.db.reminderState = this.db.reminderState || {};
    this.db.rhythm = RhythmEngine.normalize(this.db.rhythm);
    if (typeof UXCore !== 'undefined') UXCore.migrate(this.db, todayKey());
    this._committed = JSON.parse(JSON.stringify(this.db));
    return this.db;
  },

  /* Small JSON commits use an acknowledged synchronous IPC. Legacy click handlers
     cannot run a success toast or close a form before the disk rename succeeds. */
  save(immediate) {
    clearTimeout(this._saveTimer);
    const write = () => {
      const next = JSON.parse(JSON.stringify(this.db));
      try {
        const ok = window.native.saveDataSync(next);
        if (ok !== true) throw new Error('记录写入失败，输入已保留，请重试');
        this._committed = next; this._failed = null;
        this._statsVersion = (this._statsVersion || 0) + 1; /* stats() 同帧缓存失效 */
        if (typeof UX !== 'undefined') UX.saved();
        return true;
      } catch (error) {
        this._failed = next;
        if (this._committed) this.db = JSON.parse(JSON.stringify(this._committed));
        if (typeof UX !== 'undefined') UX.saveFailed(error);
        throw error;
      }
    };
    return write();
  },
  flushSync() {
    clearTimeout(this._saveTimer);
    if (typeof Session !== 'undefined') this.db.activeFollow = Session.active ? {...Session.active, running:false} : null;
    if (this._failed) return false; // Never overwrite a failed edit silently during exit.
    return this.save(true);
  },
  targetFor(date) { return typeof UXCore !== 'undefined' ? UXCore.target(this.db,date) : (this.settings().dailyTargetMinutes || 15); },

  settings() { return this.db.settings; },

  videoById(id) { return this.db.videos.find(v => v.id === id) || null; },
  sessionById(id) { return this.db.sessions.find(s => s.id === id) || null; },

  /* ---------- 训练日志 ---------- */
  dayTraining(dateStr) {
    return this.db.logs.training[dateStr] || { seconds: 0, entries: [] };
  },
  addTrainingEntry(dateStr, entry) {
    const day = this.db.logs.training[dateStr] || { seconds: 0, entries: [] };
    if (day.targetMinutes == null) day.targetMinutes = this.targetFor(dateStr);
    day.entries.push(entry);
    day.seconds += Math.round(entry.seconds || 0);
    this.db.logs.training[dateStr] = day;
    this.save();
  },
  updateTrainingEntry(dateStr, entryId, patch) {
    const day = this.db.logs.training[dateStr];
    if (!day) return;
    const en = day.entries.find(e => e.id === entryId);
    if (!en) return;
    const oldSec = Math.round(en.seconds || 0);
    Object.assign(en, patch);
    const newSec = Math.round(en.seconds || 0);
    day.seconds += (newSec - oldSec);
    this.save();
  },
  removeTrainingEntry(dateStr, entryId) {
    const day = this.db.logs.training[dateStr];
    if (!day) return;
    const idx = day.entries.findIndex(e => e.id === entryId);
    if (idx < 0) return;
    day.seconds = Math.max(0, day.seconds - Math.round(day.entries[idx].seconds || 0));
    day.entries.splice(idx, 1);
    this.save();
  },

  /* ---------- 跟练完播统计 ----------
     completed 判定见 util.followCompletion（≥80% 视频时长且 ≥120s；无时长按 3 分钟）。
     manual 补记不算完整次数——没有真实观看过程。 */
  videoStats(videoId) {
    const t = this.db.logs.training;
    let total = 0, completed = 0, seconds = 0;
    const days = new Set();
    for (const d of Object.keys(t)) {
      for (const e of t[d].entries || []) {
        if (e.videoId !== videoId) continue;
        total++; seconds += e.seconds || 0; days.add(d);
        if (e.completed) completed++;
      }
    }
    return { total, completed, seconds, days: days.size };
  },
  followTotals() {
    const t = this.db.logs.training;
    let completed = 0, total = 0;
    for (const d of Object.keys(t)) {
      for (const e of t[d].entries || []) {
        if (e.manual) continue;
        total++;
        if (e.completed) completed++;
      }
    }
    return { completed, total };
  },
  dayTargetMet(dateStr) {
    const day = this.dayTraining(dateStr);
    return day.seconds >= this.targetFor(dateStr) * 60;
  },
  dayRatio(dateStr) {
    const target = Math.max(1, this.targetFor(dateStr) * 60);
    return Math.min(1.35, this.dayTraining(dateStr).seconds / target);
  },

  /* ---------- 护肤 ---------- */
  activeCycle(dateStr) {
    const d = dateStr || todayKey();
    return (this.db.skincare.cycles || []).find(c =>
      c.startDate && d >= c.startDate && (!c.endDate || d <= c.endDate)) || null;
  },
  daySkincare(dateStr) {
    return this.db.logs.skincare[dateStr] || { morning: [], day: [], evening: [] };
  },
  toggleSkincareStep(dateStr, phase, stepId) {
    const day = this.db.logs.skincare[dateStr] || { morning: [], day: [], evening: [] };
    const list = day[phase] || [];
    const i = list.indexOf(stepId);
    if (i >= 0) list.splice(i, 1); else list.push(stepId);
    day[phase] = list;
    this.db.logs.skincare[dateStr] = day;
    this.save();
    return i < 0; // 返回是否为勾选
  },
  daySkincareDone(dateStr) {
    const cyc = this.activeCycle(dateStr);
    if (!cyc) return false;
    const day = this.daySkincare(dateStr);
    const ev = cyc.steps.evening || [];
    return ev.length > 0 && ev.every(s => (day.evening || []).includes(s.id));
  },

  /* ---------- 成就统计 ---------- */
  /* 同帧缓存：成就页一次渲染会调 stats() 2-3 次；任何 save() 后失效 */
  stats() {
    const key = todayKey() + ':' + (this._statsVersion || 0);
    if (this._statsCache && this._statsCache.key === key) return this._statsCache.value;
    const t = this.db.logs.training;
    const dates = Object.keys(t).sort();
    const totalSec = dates.reduce((s, d) => s + (t[d].seconds || 0), 0);
    let metDays = 0, streak = 0, bestStreak = 0;
    // 连续达标（从今天往回看；今天未达标不打断，从昨天起算）
    let cursor = todayKey();
    if (!this.dayTargetMet(cursor)) cursor = addDays(cursor, -1);
    while (cursor >= '2000-01-01' && this.dayTargetMet(cursor)) {
      streak++; cursor = addDays(cursor, -1);
      if (streak > 3650) break;
    }
    // 历史最长连续：单遍扫描（旧实现内层 slice+filter 为 O(N²)，3 年数据成就页一帧百万级比较）
    let run = 0, prevMetDate = null;
    for (const d of dates) {
      if (this.dayTargetMet(d)) {
        metDays++;
        run = (prevMetDate && daysBetween(prevMetDate, d) === 1) ? run + 1 : 1;
        bestStreak = Math.max(bestStreak, run);
        prevMetDate = d;
      }
    }
    // 护肤连续打卡
    let skStreak = 0;
    let c = todayKey();
    if (!this.daySkincareDone(c)) c = addDays(c, -1);
    while (c >= '2000-01-01' && this.daySkincareDone(c)) { skStreak++; c = addDays(c, -1); if (skStreak > 3650) break; }
    const value = { totalSec, metDays, streak, bestStreak: Math.max(bestStreak, streak), skStreak };
    this._statsCache = { key, value };
    return value;
  }
};

/* node 测试可用（浏览器端 module 未定义，无影响） */
if (typeof module !== 'undefined' && module.exports) module.exports = Store;
