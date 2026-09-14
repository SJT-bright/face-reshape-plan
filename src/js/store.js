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
    return this.db;
  },

  /* 防抖保存（写盘由主进程完成） */
  save(immediate) {
    clearTimeout(this._saveTimer);
    const doSave = () => window.native.saveData(JSON.parse(JSON.stringify(this.db)));
    if (immediate) return doSave();
    else this._saveTimer = setTimeout(doSave, 400);
  },

  /* 退出前同步落盘，防止丢最后一分钟 */
  flushSync() {
    clearTimeout(this._saveTimer);
    window.native.saveDataSync(JSON.parse(JSON.stringify(this.db)));
  },

  settings() { return this.db.settings; },

  videoById(id) { return this.db.videos.find(v => v.id === id) || null; },
  sessionById(id) { return this.db.sessions.find(s => s.id === id) || null; },

  /* ---------- 训练日志 ---------- */
  dayTraining(dateStr) {
    return this.db.logs.training[dateStr] || { seconds: 0, entries: [] };
  },
  addTrainingEntry(dateStr, entry) {
    const day = this.db.logs.training[dateStr] || { seconds: 0, entries: [] };
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
  dayTargetMet(dateStr) {
    const day = this.dayTraining(dateStr);
    return day.seconds >= (this.settings().dailyTargetMinutes || 15) * 60;
  },
  dayRatio(dateStr) {
    const target = Math.max(1, (this.settings().dailyTargetMinutes || 15) * 60);
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
  stats() {
    const t = this.db.logs.training;
    const dates = Object.keys(t).sort();
    const totalSec = dates.reduce((s, d) => s + (t[d].seconds || 0), 0);
    let metDays = 0, streak = 0, bestStreak = 0, curRun = 0;
    // 连续达标（从今天往回看；今天未达标不打断，从昨天起算）
    let cursor = todayKey();
    if (!this.dayTargetMet(cursor)) cursor = addDays(cursor, -1);
    while (cursor >= '2000-01-01' && this.dayTargetMet(cursor)) {
      streak++; cursor = addDays(cursor, -1);
      if (streak > 3650) break;
    }
    // 历史最长连续
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      if (this.dayTargetMet(d)) {
        curRun++;
        if (i === 0 || daysBetween(dates[i - 1], d) >= 1) {
          // 仅当与前一个达标日相邻才延续；否则重新开跑
          if (i > 0) {
            const prevMet = dates.slice(0, i).filter(x => this.dayTargetMet(x));
            const prev = prevMet[prevMet.length - 1];
            curRun = (prev && daysBetween(prev, d) === 1) ? curRun : 1;
          }
          bestStreak = Math.max(bestStreak, curRun);
        }
      }
    }
    for (const d of dates) if (this.dayTargetMet(d)) metDays++;
    // 护肤连续打卡
    let skStreak = 0;
    let c = todayKey();
    if (!this.daySkincareDone(c)) c = addDays(c, -1);
    while (c >= '2000-01-01' && this.daySkincareDone(c)) { skStreak++; c = addDays(c, -1); if (skStreak > 3650) break; }
    return { totalSec, metDays, streak, bestStreak: Math.max(bestStreak, streak), skStreak };
  }
};
