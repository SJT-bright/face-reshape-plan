/* 瘦脸早晚钟在 settings.practiceClock；其他板块只读 DailyPlanCore.config，不另存一套时间。 */
const FixedPracticeCore = {
  clock(db, mode) {
    const source = mode === 'face'
      ? (db && db.settings && db.settings.practiceClock) || {}
      : DailyPlanCore.config(db || {}, mode);
    const keep = (value) => DailyPlanCore.time(value) !== null ? value : '';
    return { morning: keep(source && source.morning), evening: keep(source && source.evening) };
  },
  timeFor(db, mode, period) {
    if (period !== 'morning' && period !== 'evening') return '';
    return this.clock(db, mode)[period];
  },
  pins(db, mode, period) {
    try {
      const list = db.settings.fixedPractice[mode][period];
      if (!Array.isArray(list)) return [];
      return list.filter(id => typeof id === 'string').slice();
    } catch {
      return [];
    }
  },
  isPinned(db, mode, period, id) {
    return this.pins(db, mode, period).includes(id);
  },
  pin(db, mode, period, id, on) {
    if ((period !== 'morning' && period !== 'evening') || typeof id !== 'string' || id === '') return;
    if (!on) {
      const list = db && db.settings && db.settings.fixedPractice && db.settings.fixedPractice[mode]
        ? db.settings.fixedPractice[mode][period] : null;
      if (!Array.isArray(list)) return;
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i] === id) list.splice(i, 1);
      return;
    }
    db.settings ||= {};
    if (!db.settings.fixedPractice || typeof db.settings.fixedPractice !== 'object' || Array.isArray(db.settings.fixedPractice)) {
      db.settings.fixedPractice = {};
    }
    const all = db.settings.fixedPractice;
    if (!all[mode] || typeof all[mode] !== 'object' || Array.isArray(all[mode])) all[mode] = {};
    if (!Array.isArray(all[mode][period])) all[mode][period] = [];
    const list = all[mode][period];
    if (!list.includes(id)) list.push(id);
  },
  setFaceClock(db, value) {
    const source = value || {};
    const morning = source.morning == null ? '' : String(source.morning);
    const evening = source.evening == null ? '' : String(source.evening);
    if ((morning && DailyPlanCore.time(morning) === null) || (evening && DailyPlanCore.time(evening) === null)) {
      throw Error('请填写有效的练习时间');
    }
    if (morning && evening && morning === evening) throw Error('早上和晚上的练习时间需要不同');
    db.settings ||= {};
    db.settings.practiceClock = { morning, evening };
    return db.settings.practiceClock;
  },
  migrateFace(db) {
    const sessions = Array.isArray(db && db.sessions) ? db.sessions : [];
    let changed = false;
    for (const session of sessions) {
      if (!session || typeof session !== 'object' || !session.fixedDaily) continue;
      if (session.period === 'morning' || session.period === 'evening') continue;
      /* 12:00 起算晚上；没有合法时间也归晚上，避免再单独排一个每日固定练时间。 */
      const minutes = DailyPlanCore.time(session.time);
      const period = minutes === null || minutes >= 720 ? 'evening' : 'morning';
      session.period = period;
      changed = true;
      if (minutes === null) continue;
      db.settings ||= {};
      if (!db.settings.practiceClock || typeof db.settings.practiceClock !== 'object' || Array.isArray(db.settings.practiceClock)) {
        db.settings.practiceClock = {};
      }
      const side = db.settings.practiceClock[period];
      if (side == null || side === '') {
        db.settings.practiceClock[period] = session.time;
        changed = true;
      }
    }
    return changed;
  },
  applyClock(db) {
    const clock = this.clock(db, 'face');
    const sessions = Array.isArray(db && db.sessions) ? db.sessions : [];
    let count = 0;
    for (const session of sessions) {
      if (!session || !session.fixedDaily) continue;
      if (session.period !== 'morning' && session.period !== 'evening') continue;
      const time = clock[session.period];
      if (!time || session.time === time) continue;
      session.time = time;
      count += 1;
    }
    return count;
  }
};
if (typeof module !== 'undefined') module.exports = FixedPracticeCore;
