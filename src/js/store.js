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
    this.normalizeCollections();
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

  /* 旧视频不改写，缺少 collectionId 时仍属于原瘦脸库。 */
  normalizeCollections() {
    this.db.settings = this.db.settings || {};
    this.db.videos = this.db.videos || [];
    this.db.videoFolderExclusions = this.db.videoFolderExclusions || [];
    this.db.logs = this.db.logs || { training: {}, skincare: {} };
    this.db.logs.videoWatching = this.db.logs.videoWatching || {};
    if (!Array.isArray(this.db.videoCollections)) {
      this.db.videoCollections = [
        { id: 'face', name: '瘦脸护理', periods: [] },
        { id: 'awakening', name: '认知唤醒', periods: ['morning', 'evening'] }
      ];
    }
    if (!this.db.videoCollections.some(c => c.id === 'face')) {
      this.db.videoCollections.unshift({ id: 'face', name: '瘦脸护理', periods: [] });
    }
    if (!this.db.videoCollections.some(c => c.id === this.db.settings.videoMode)) this.db.settings.videoMode = 'face';
  },
  collections() { this.normalizeCollections(); return this.db.videoCollections; },
  collectionById(id) { return this.collections().find(c => c.id === id) || null; },
  currentMode() { this.normalizeCollections(); return this.db.settings.videoMode; },
  currentCollection() { return this.collectionById(this.currentMode()); },
  videoMode(video) { return video?.collectionId || video?.mode || 'face'; },
  videosForMode(mode) {
    const id = mode || this.currentMode();
    return (this.db.videos || []).filter(v => this.videoMode(v) === id);
  },
  setMode(id) {
    if (!this.collectionById(id)) throw Error('这个视频板块已不存在');
    if (this.db.settings.videoMode === id) return;
    this.db.settings.videoMode = id;
    this.save(true);
  },
  _collectionName(name, exceptId) {
    const value = String(name || '').trim();
    if (!value || value.length > 40) throw Error('请填写 1–40 个字的板块名称');
    if (this.collections().some(c => c.id !== exceptId && c.name === value)) throw Error('已有同名板块，请换一个名称');
    return value;
  },
  _collectionPeriods(periods) {
    const value = [...new Set((Array.isArray(periods) ? periods : []).filter(p => ['morning', 'evening'].includes(p)))];
    if (!value.length) throw Error('请选择早上或晚上，也可以都选');
    return value;
  },
  createCollection(name, periods = ['morning']) {
    const collection = { id: uid('collection'), name: this._collectionName(name), periods: this._collectionPeriods(periods) };
    this.db.videoCollections.push(collection);
    this.save(true);
    return collection;
  },
  updateCollection(id, patch) {
    const collection = this.collectionById(id);
    if (!collection) throw Error('这个视频板块已不存在');
    const name = patch.name == null ? collection.name : this._collectionName(patch.name, id);
    const periods = patch.periods == null ? collection.periods : (id === 'face' ? [] : this._collectionPeriods(patch.periods));
    Object.assign(collection, { name, periods });
    this.save(true);
    return collection;
  },
  deleteCollection(id) {
    if (id === 'face') throw Error('原瘦脸护理板块需要保留');
    if (!this.collectionById(id)) return false;
    const removed = new Set(this.videosForMode(id).map(v => v.id));
    this.db.videoCollections = this.db.videoCollections.filter(c => c.id !== id);
    this.db.videos = this.db.videos.filter(v => !removed.has(v.id));
    delete this.db.logs.videoWatching[id];
    if (this.db.settings.videoMode === id) this.db.settings.videoMode = 'face';
    if (this.db.activeFollow && removed.has(this.db.activeFollow.videoId)) this.db.activeFollow = null;
    this.save(true);
    return true;
  },
  addVideo(video, mode) {
    const id = mode || this.currentMode();
    if (!this.collectionById(id)) throw Error('这个视频板块已不存在，请重新选择导入位置');
    video.collectionId = id;
    this.rememberVideoPath(video);
    this.db.videos.push(video);
    return video;
  },
  rememberVideoPath(video) {
    /* 删除自定义板块的引用后，共用媒体文件也不能被自动读入瘦脸库。 */
    if (this.videoMode(video) === 'face' || video.source !== 'local' || !video.localPath) return;
    const excluded = this.db.videoFolderExclusions || (this.db.videoFolderExclusions = []);
    if (!excluded.includes(video.localPath)) excluded.push(video.localPath);
  },
  /* 删除本地视频时记排除。face 模式不走 rememberVideoPath，否则瘦脸库删了还会被扫回来。 */
  excludeLocalVideo(localPath) {
    if (typeof localPath !== 'string' || !localPath) return;
    const excluded = this.db.videoFolderExclusions || (this.db.videoFolderExclusions = []);
    if (!excluded.includes(localPath)) excluded.push(localPath);
  },

  videoById(id) { return this.db.videos.find(v => v.id === id) || null; },
  sessionById(id) { return this.db.sessions.find(s => s.id === id) || null; },

  /* 自定义板块的观看时长单独保存，不增加瘦脸达标或跟练成就。 */
  dayWatching(dateStr, mode) {
    const id = mode || this.currentMode();
    if (id === 'face') return this.dayTraining(dateStr);
    return this.db.logs.videoWatching?.[id]?.[dateStr] || { seconds: 0, entries: [] };
  },
  watchingTarget(dateStr, mode) { const plans=typeof DailyPlanCore!=='undefined'?DailyPlanCore:require('./daily-plan-core');return plans.target(this.db,mode||this.currentMode(),dateStr); },
  addWatchingEntry(dateStr, entry, mode) {
    const id = mode || this.currentMode();
    if (id === 'face') return this.addTrainingEntry(dateStr, entry);
    this.normalizeCollections();
    const dates = this.db.logs.videoWatching[id] || (this.db.logs.videoWatching[id] = {});
    const day = dates[dateStr] || { seconds: 0, entries: [] };
    if(day.targetMinutes==null)day.targetMinutes=this.watchingTarget(dateStr,id);
    const sec = Math.round(entry.seconds || 0);
    this._tagPeriod(entry);
    day.entries.push({ ...entry, collectionId: id });
    day.seconds += sec;
    this._rebuildPeriod(day);
    dates[dateStr] = day;
    this.save();
  },
  updateWatchingEntry(dateStr, entryId, patch, mode) {
    const id = mode || this.currentMode();
    if (id === 'face') return this.updateTrainingEntry(dateStr, entryId, patch);
    const day = this.db.logs.videoWatching?.[id]?.[dateStr];
    const entry = day?.entries.find(e => e.id === entryId);
    if (!entry) return;
    const oldSec = Math.round(entry.seconds || 0);
    Object.assign(entry, patch);
    const newSec = Math.round(entry.seconds || 0);
    day.seconds = Math.max(0, day.seconds + newSec - oldSec);
    this._rebuildPeriod(day);
    this.save();
  },
  removeWatchingEntry(dateStr, entryId, mode) {
    const id = mode || this.currentMode();
    if (id === 'face') return this.removeTrainingEntry(dateStr, entryId);
    const day = this.db.logs.videoWatching?.[id]?.[dateStr];
    const index = day?.entries.findIndex(e => e.id === entryId) ?? -1;
    if (index < 0) return;
    const sec = Math.round(day.entries[index].seconds || 0);
    day.seconds = Math.max(0, day.seconds - sec);
    day.entries.splice(index, 1);
    this._rebuildPeriod(day);
    this.save();
  },

  /* ---------- 时段分账 ----------
     会话 entry 带 period（'morning'|'evening'，启动时段；由界面/自动流程写入，缺省按 entry.start 推断并回写到 entry），
     当日按时段汇总进 day.byPeriod = { morning: 秒, evening: 秒 }。
     总秒数（seconds）语义不变：目标判定、趋势、成就、提醒全部继续用总数；
     旧记录没有 byPeriod/period 时读取端按 entry 标签兜底，一切照旧。 */
  _periodOf(entry) {
    return entry && (entry.period === 'morning' || entry.period === 'evening') ? entry.period : null;
  },
  _startPeriodOf(entry) {
    if (this._periodOf(entry)) return this._periodOf(entry);
    const min = typeof minutesOf === 'function' ? minutesOf(entry?.start) : NaN;
    return Number.isFinite(min) ? (min < 12 * 60 ? 'morning' : 'evening') : null;
  },
  /* 记账时把归属时段写进 entry；已带合法 period 的不覆盖 */
  _tagPeriod(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const period = this._startPeriodOf(entry);
    if (period && entry.period !== period) entry.period = period;
    return period;
  },
  /* entry 是分账的唯一事实源：每次记账后从 entries 整体重建 byPeriod。
     单日条目量级小（日常 <50 条），重建比增量维护更抗损坏——坏键直接被丢弃、不会漂移。 */
  _rebuildPeriod(day) {
    const by = {};
    for (const e of Array.isArray(day?.entries) ? day.entries : []) {
      const p = this._periodOf(e);
      if (p) by[p] = (by[p] || 0) + Math.max(0, Math.round(e?.seconds || 0));
    }
    if (by.morning > 0 || by.evening > 0) day.byPeriod = by;
    else delete day.byPeriod;
  },
  _entryPeriodSum(day, period) {
    let sum = 0;
    for (const e of Array.isArray(day?.entries) ? day.entries : []) if (this._periodOf(e) === period) sum += Math.round(e?.seconds || 0);
    return sum;
  },
  _periodSeconds(day, period) {
    if (!day || typeof day !== 'object') return 0;
    if (period !== 'morning' && period !== 'evening') return Math.max(0, Math.round(day.seconds) || 0);
    const total = Math.max(0, Math.round(day.seconds) || 0);
    const by = day.byPeriod;
    if (by && typeof by === 'object' && !Array.isArray(by) && Number.isFinite(Number(by[period]))) {
      /* 分账不应超过当日总数；越界（损坏/伪造大数）时钳到总数 */
      return Math.max(0, Math.min(Math.round(Number(by[period])), total));
    }
    /* 记录损坏或旧数据缺分账字段时，按 entry 的 period 标签兜底汇总，不崩溃 */
    return Math.min(this._entryPeriodSum(day, period), total);
  },
  dayTrainingPeriod(dateStr, period) { return this._periodSeconds(this.dayTraining(dateStr), period); },
  dayWatchingPeriod(dateStr, period, mode) {
    const id = mode || this.currentMode();
    if (id === 'face') return this.dayTrainingPeriod(dateStr, period);
    return this._periodSeconds(this.db.logs.videoWatching?.[id]?.[dateStr], period);
  },

  /* ---------- 训练日志 ---------- */
  dayTraining(dateStr) {
    return this.db.logs.training[dateStr] || { seconds: 0, entries: [] };
  },
  addTrainingEntry(dateStr, entry) {
    const day = this.db.logs.training[dateStr] || { seconds: 0, entries: [] };
    if (day.targetMinutes == null) day.targetMinutes = this.targetFor(dateStr);
    const sec = Math.round(entry?.seconds || 0);
    this._tagPeriod(entry);
    day.entries.push(entry);
    day.seconds += sec;
    this._rebuildPeriod(day);
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
    this._rebuildPeriod(day);
    this.save();
  },
  removeTrainingEntry(dateStr, entryId) {
    const day = this.db.logs.training[dateStr];
    if (!day) return;
    const idx = day.entries.findIndex(e => e.id === entryId);
    if (idx < 0) return;
    const sec = Math.round(day.entries[idx].seconds || 0);
    day.seconds = Math.max(0, day.seconds - sec);
    day.entries.splice(idx, 1);
    this._rebuildPeriod(day);
    this.save();
  },

  /* ---------- 跟练完播统计 ----------
     completed 判定见 util.followCompletion（≥80% 视频时长且 ≥120s；无时长按 3 分钟）。
     manual 补记不算完整次数——没有真实观看过程。 */
  videoStats(videoId) {
    const mode = this.videoMode(this.videoById(videoId));
    const t = mode === 'face' ? this.db.logs.training : (this.db.logs.videoWatching?.[mode] || {});
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
