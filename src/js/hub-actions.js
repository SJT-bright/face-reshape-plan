/* 中控提示器联动：接收主进程转发的远程动作，复用应用自身逻辑执行后回执。
 * 动作三种：skip-today（力量跳过）/ done（完成：力量·瘦脸操·护肤时段）/ postpone（今日提醒顺延）。
 * 数据一律走 Store（应用自己的保存链路，保存后自动重写 hub-today.json），主进程不直接改文件。
 * 与应用内操作的对应关系：
 *   skip-today(strength)  ≡ 力量页「今天不练了」（note 固定「从中控提示器跳过」）
 *   done(strength)        ≡ 力量页「完成今天，进入下一训练日」
 *   done(training)        ≡ 成就日历「手动记录」整节完成（记满当日目标分钟）
 *   done(skincare-*)      ≡ 护肤页「全部完成」勾满该时段步骤
 *   postpone              ≡ 提醒的「稍后提醒」（分钟数可指定，应用内固定 10 分钟）
 * 睡前复盘/记录昨晚睡眠没有可安全远程写入的单一数据结构，如实返回错误。 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.native || !window.native.onHubAction) return;

  const SKIN_PHASE_BY_ID = { 'skincare-morning': 'morning', 'skincare-noon': 'day', 'skincare-evening': 'evening' };
  /* hub 任务 id → reminders-v2 时间线里的提醒 id（键格式 `YYYY-MM-DD|提醒id`） */
  const REMINDER_BY_HUB_ID = {
    'skincare-morning': 'care-morning',
    'skincare-noon': 'care-day',
    'skincare-evening': 'care-evening',
    'sleep': 'sleep',
    'review': 'review'
  };
  const CARE_LABELS = { morning: '晨间护理', day: '日间护理', evening: '晚间护理' };

  const isHHmm = (t) => /^\d{1,2}:\d{2}$/.test(t || '');
  const modules = () => {
    const s = Store.settings() || {};
    return s.enabledModules || ['follow', 'skincare', 'nutrition', 'strength', 'achievements'];
  };

  /* Store.init 是异步的：动作在数据就绪前到达时等一等，避免误报失败 */
  let readyWaiter = null;
  function ensureReady() {
    if (Store.db) return Promise.resolve(true);
    if (!readyWaiter) {
      readyWaiter = new Promise((resolve) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (Store.db || Date.now() - t0 > 8000) { clearInterval(iv); resolve(!!Store.db); }
        }, 100);
      });
    }
    return readyWaiter;
  }

  function importMeal(meal) {
    if (!meal || !/^[a-f0-9]{64}$/.test(meal.sourceKey || '') ||
        !Number.isSafeInteger(meal.revision) || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(meal.local || '') ||
        !['active','cancelled'].includes(meal.state) || !['started','finished'].includes(meal.timeKind) ||
        typeof meal.foodText !== 'string' || meal.foodText.length > 180 ||
        !Number.isSafeInteger(meal.photoCount) || meal.photoCount < 0 || meal.photoCount > 1000 ||
        !Number.isFinite(Date.parse(meal.at || '')) || !meal.at.startsWith(meal.local + ':') || !meal.at.endsWith('+08:00')) {
      return {ok:false,error:'餐食字段无效'};
    }
    const rhythm = Store.db.rhythm = RhythmEngine.normalize(Store.db.rhythm);
    const imports = rhythm.mealImportVersions || {};
    const known = imports[meal.sourceKey];
    const existing = rhythm.meals.find(m => m.sourceKey === meal.sourceKey);
    if (known?.state === 'manual-deleted') return {ok:false,conflict:true,error:'这餐已在应用内删除，不会自动恢复'};
    if (existing && existing.manualOverride) return {ok:false,conflict:true,error:'这餐已在应用内手动修改，请先在应用内核对'};
    if (known && known.revision > meal.revision) return {ok:true,sourceKey:meal.sourceKey,stale:true};
    if (known && known.revision === meal.revision && known.state === 'cancelled' && meal.state === 'active') {
      return {ok:true,sourceKey:meal.sourceKey,stale:true};
    }
    if (meal.state === 'active' && !existing && rhythm.meals.some(m => m.local === meal.local)) {
      return {ok:false,conflict:true,error:'同一分钟已有应用内进餐记录，请先核对避免重复'};
    }
    if (!RhythmEngine.parse(meal.local)) return {ok:false,error:'进餐日期或时刻无效'};
    const mealType = RhythmEngine.classifyMealType(meal.local);
    if (meal.state === 'active' && !mealType) return {ok:false,error:'进餐时刻无效'};
    if (existing && meal.state === 'active' && existing.local === meal.local &&
        existing.sourceRevision === meal.revision && existing.foodText === meal.foodText &&
        existing.photoCount === meal.photoCount && existing.timeKind === meal.timeKind) {
      return {ok:true,sourceKey:meal.sourceKey,alreadyDone:true};
    }
    const previous = structuredClone(rhythm);
    try {
      rhythm.mealImportVersions = imports;
      rhythm.mealImportVersions[meal.sourceKey] = {revision:meal.revision,state:meal.state};
      if (meal.state === 'cancelled') {
        rhythm.meals = rhythm.meals.filter(m => m.sourceKey !== meal.sourceKey);
      } else {
        const record = {...existing,
          id: existing?.id || 'wx-meal-' + meal.sourceKey.slice(0,24),
          source:'weixin-life-diary',sourceKey:meal.sourceKey,sourceRevision:meal.revision,
          at:new Date(meal.at).toISOString(),local:meal.local,offset:480,
          kind:RhythmEngine.mealTypeKind(mealType) === 'snack' ? 'snack' : 'meal',mealType,
          foodText:meal.foodText,photoCount:meal.photoCount,timeKind:meal.timeKind};
        if (existing) rhythm.meals[rhythm.meals.indexOf(existing)] = record;
        else rhythm.meals.push(record);
      }
      rhythm.completeDays = rhythm.completeDays || {};
      if (existing?.local) rhythm.completeDays[existing.local.slice(0,10)] = {...rhythm.completeDays[existing.local.slice(0,10)],meals:false};
      rhythm.completeDays[meal.local.slice(0,10)] = {...rhythm.completeDays[meal.local.slice(0,10)],meals:false};
      Store.save(true);
      return {ok:true,sourceKey:meal.sourceKey,state:meal.state};
    } catch {
      Store.db.rhythm = previous;
      return {ok:false,retryable:true,error:'应用存储暂不可用，稍后重试'};
    }
  }

  function importPhoto(photo) {
    if(!photo || !/^[a-f0-9]{64}$/.test(photo.sourceKey || '') ||
        !Number.isSafeInteger(photo.revision) || photo.revision<1 ||
        !['meal','skin','body'].includes(photo.kind) || !RhythmEngine.parse(photo.local) ||
        !/^wx-[a-f0-9]{64}\.(jpg|png|webp|heic)$/.test(photo.file || '') ||
        !/^[a-f0-9]{64}$/.test(photo.sha256 || '') || !['sent','occurred'].includes(photo.timeKind) ||
        typeof photo.at!=='string' || !photo.at.startsWith(photo.local+':') || !photo.at.endsWith('+08:00') ||
        !Number.isFinite(Date.parse(photo.sentAt)) || typeof photo.note!=='string' || photo.note.length>180 ||
        (photo.mealSourceKey!=null && !/^[a-f0-9]{64}$/.test(photo.mealSourceKey))) {
      return {ok:false,error:'照片记录字段无效'};
    }
    const previous={rhythm:structuredClone(Store.db.rhythm),skin:structuredClone(Store.db.skin),
      photoImportVersions:structuredClone(Store.db.photoImportVersions)};
    const versions=Store.db.photoImportVersions || {};
    const known=versions[photo.sourceKey];
    const receipt={ok:true,sourceKey:photo.sourceKey,sha256:photo.sha256,kind:photo.kind,file:photo.file};
    if(known?.state==='manual-deleted')return {ok:false,conflict:true,error:'这张照片已在应用内删除，请先核对'};
    if(known && known.revision>photo.revision)return {...receipt,stale:true};
    try {
      Store.db.rhythm=RhythmEngine.normalize(Store.db.rhythm);
      Store.db.skin=Store.db.skin || {photos:[]};
      const mealPhotos=Store.db.rhythm.mealPhotos || [];
      const skinPhotos=Store.db.skin.photos || [];
      const existing=[...mealPhotos,...skinPhotos].find(p=>p.sourceKey===photo.sourceKey);
      if(existing && existing.sha256!==photo.sha256)return {ok:false,conflict:true,error:'原始照片摘要发生变化，请先核对'};
      if(existing && ['sourceRevision','kind','file','sha256','local','sentAt','timeKind','note','mealSourceKey'].every(key=>
          existing[key]===(key==='sourceRevision' ? photo.revision : photo[key])))return {...receipt,alreadyDone:true};
      const record={...existing,id:existing?.id || 'wx-photo-'+photo.sourceKey.slice(0,24),
        source:'weixin-life-diary',sourceKey:photo.sourceKey,sourceRevision:photo.revision,
        kind:photo.kind,file:photo.file,sha256:photo.sha256,mime:photo.mime,
        local:photo.local,at:photo.at,sentAt:photo.sentAt,timeKind:photo.timeKind,
        date:photo.local.slice(0,10),note:photo.note,mealSourceKey:photo.mealSourceKey,
        angle:existing?.angle || 'unknown',createdAt:photo.sentAt};
      Store.db.rhythm.mealPhotos=mealPhotos.filter(p=>p.sourceKey!==photo.sourceKey);
      Store.db.skin.photos=skinPhotos.filter(p=>p.sourceKey!==photo.sourceKey);
      (photo.kind==='meal' ? Store.db.rhythm.mealPhotos : Store.db.skin.photos).push(record);
      versions[photo.sourceKey]={revision:photo.revision,state:'active',kind:photo.kind};
      Store.db.photoImportVersions=versions;
      Store.save(true);
      return receipt;
    }catch{
      Store.db.rhythm=previous.rhythm;Store.db.skin=previous.skin;
      Store.db.photoImportVersions=previous.photoImportVersions;
      return {ok:false,retryable:true,error:'照片记录暂时无法保存，稍后重试'};
    }
  }

  /* ---------- 力量训练 ---------- */
  function strengthContext() {
    const state = Core.normalize(Store.db);
    const date = todayKey();
    return { state, date, info: Core.todayPlan(state, date) };
  }
  function alreadyResolved(day) {
    return day.status === 'completed' || day.status === 'skipped'
      ? `今天的力量训练已收尾（${day.status === 'skipped' ? '已跳过' : '已完成'}），如需修改请在应用内重开`
      : null;
  }
  function doSkipStrength() {
    const { state, date, info } = strengthContext();
    if (!info || !info.day) return { ok: false, error: '今天没有力量训练安排' };
    const doneMsg = alreadyResolved(info.day);
    if (doneMsg) return { ok: false, error: doneMsg };
    /* 预览日还没有快照：先落快照再跳过（与力量页「今天不练了」一致） */
    if (!Core.dayRecord(state, date)) {
      const s = Core.startTraining(state, { date });
      if (!s.ok) return { ok: false, error: s.error };
    }
    const r = Core.skipAndAdvance(state, { date, note: '从中控提示器跳过' });
    if (!r.ok) return { ok: false, error: r.error };
    Store.save(true);
    return { ok: true, date, dayName: r.day.name, status: 'skipped' };
  }
  function doDoneStrength() {
    const { state, date, info } = strengthContext();
    if (!info || !info.day) return { ok: false, error: '今天没有力量训练安排' };
    if (info.day.isRest) return { ok: false, error: '今天是休息日，无需完成力量训练' };
    const doneMsg = alreadyResolved(info.day);
    if (doneMsg) return { ok: false, error: doneMsg };
    if (!Core.dayRecord(state, date)) {
      const s = Core.startTraining(state, { date });
      if (!s.ok) return { ok: false, error: s.error };
    }
    const f = Core.finishAndAdvance(state, { date, note: '从中控提示器完成' });
    if (!f.ok) return { ok: false, error: f.error };
    Store.save(true);
    return { ok: true, date, dayName: f.day.name, status: f.day.status };
  }

  /* ---------- 瘦脸操：手动补记一节完整跟练 ---------- */
  function doDoneTraining() {
    const date = todayKey();
    const day = Store.db.logs.training[date] || { seconds: 0, entries: [] };
    if ((day.entries || []).some((e) => e.source === 'hub')) {
      return { ok: true, alreadyDone: true, note: '今天已有从中控完成的记录，未重复追加' };
    }
    const target = Math.max(1, Math.round(Store.targetFor(date) || Store.settings().dailyTargetMinutes || 15));
    Store.addTrainingEntry(date, {
      id: uid('en'), manual: true, completed: true, source: 'hub',
      note: '从中控提示器完成', start: hhmm(), end: hhmm(), seconds: target * 60
    });
    return { ok: true, date, seconds: target * 60, targetMinutes: target };
  }

  /* ---------- 护肤：勾满当日对应时段（并集写入，不取消已勾步骤） ---------- */
  function doDoneSkincare(id) {
    const date = todayKey();
    const phase = SKIN_PHASE_BY_ID[id];
    const cyc = Store.activeCycle(date);
    if (!cyc) return { ok: false, error: '当前没有进行中的护肤周期' };
    const steps = (cyc.steps || {})[phase] || [];
    if (!steps.length) return { ok: false, error: '该时段没有护肤步骤' };
    Store.db.logs.skincare[date] = Store.db.logs.skincare[date] || { morning: [], day: [], evening: [] };
    const dayLog = Store.db.logs.skincare[date];
    dayLog[phase] = Array.from(new Set([...(dayLog[phase] || []), ...steps.map((s) => s.id)]));
    Store.save(true);
    return { ok: true, date, phase, steps: dayLog[phase].length, cycle: cyc.name || '' };
  }

  /* ---------- 提醒顺延：等价应用内「稍后提醒」（分钟数可指定） ---------- */
  function doPostpone(id, minutes) {
    const date = todayKey();
    const now = Date.now();
    const mods = modules();
    const targets = [];

    if (id === 'training') {
      /* 瘦脸操提醒按「今天生效的每个跟练安排」走，与 reminders-v2 时间线同源 */
      if (!mods.includes('follow')) return { ok: false, error: '跟练提醒模块未启用，没有可推迟的提醒' };
      const weekday = new Date().getDay();
      for (const s of Store.db.sessions || []) {
        if (s.enabled && (s.days || []).includes(weekday) && isHHmm(s.time)) {
          targets.push({ key: `${date}|${s.id}`, title: s.name });
        }
      }
    } else {
      const remId = REMINDER_BY_HUB_ID[id];
      if (!remId) return { ok: false, error: '该任务没有对应的系统提醒，无法推迟' };
      let live = false, done = false, title = '';
      if (remId === 'review') {
        title = '晚间复盘';
        live = isHHmm(Store.settings().eveningReviewTime);
        const cd = (Store.db.rhythm && Store.db.rhythm.completeDays && Store.db.rhythm.completeDays[date]) || null;
        done = !!(cd && cd.meals && cd.sleep);
      } else if (remId === 'sleep') {
        title = '记录昨晚睡眠';
        live = mods.includes('nutrition') && isHHmm(Store.settings().sleepLogReminderTime);
        done = ((Store.db.rhythm && Store.db.rhythm.sleeps) || []).some((x) => x.end && x.kind !== 'nap' && (x.endLocal || '').slice(0, 10) === date);
      } else {
        const phase = { 'care-morning': 'morning', 'care-day': 'day', 'care-evening': 'evening' }[remId];
        title = CARE_LABELS[phase];
        const cyc = Store.activeCycle(date);
        const steps = (cyc && (cyc.steps || {})[phase]) || [];
        live = mods.includes('skincare') && steps.length > 0 && isHHmm((Store.settings().skincareTimes || {})[phase]);
        done = steps.length > 0 && steps.every((x) => ((Store.db.logs.skincare[date] || {})[phase] || []).includes(x.id));
      }
      if (!live) return { ok: false, error: '今天没有对应的提醒可推迟' };
      if (done) return { ok: true, note: `${title}今天已完成，无需推迟` };
      targets.push({ key: `${date}|${remId}`, title });
    }

    if (!targets.length) return { ok: false, error: '今天没有对应的提醒可推迟' };
    const until = now + minutes * 60000;
    Store.db.reminderActions = Store.db.reminderActions || {};
    for (const t of targets) {
      const old = Store.db.reminderActions[t.key] || {};
      Store.db.reminderActions[t.key] = { ...old, snoozeUntil: until, skip: false, fired: false, updatedAt: now };
    }
    Store.save(true);
    return { ok: true, snoozed: targets.map((t) => t.title), minutes, snoozeUntil: until };
  }

  /* ---------- 动作分发 ---------- */
  async function handle(payload) {
    const op = payload && payload.op;
    const id = payload && payload.id;
    if (!(await ensureReady())) return { ok: false, retryable: true, error: '应用数据尚未加载完成，请稍后重试' };
    try {
      if (op === 'meal-import') return importMeal(payload.meal);
      if (op === 'photo-import') return importPhoto(payload.photo);
      if (op === 'skip-today') {
        if (id !== 'strength') return { ok: false, error: 'skip-today 仅支持力量训练（id: strength）' };
        return doSkipStrength();
      }
      if (op === 'done') {
        if (id === 'strength') return doDoneStrength();
        if (id === 'training') return doDoneTraining();
        if (SKIN_PHASE_BY_ID[id]) return doDoneSkincare(id);
        if (id === 'review' || id === 'sleep') return { ok: false, error: '该任务请在应用内操作' };
        return { ok: false, error: `未知任务 id：${String(id)}` };
      }
      if (op === 'postpone') {
        const raw = Number(payload.minutes);
        const minutes = Number.isFinite(raw) && raw > 0 ? Math.min(1440, Math.max(1, Math.round(raw))) : 15;
        return doPostpone(String(id || ''), minutes);
      }
      return { ok: false, error: `未知 op：${String(op)}` };
    } catch (e) {
      return { ok: false, error: '执行失败：' + String((e && e.message) || e) };
    }
  }

  window.HubActions = { handle };
  window.native.onHubAction((payload) => {
    Promise.resolve()
      .then(() => handle(payload))
      .then((result) => {
        try { if (result && result.ok && typeof App !== 'undefined') App.render(); } catch { /* 刷新界面失败不影响回执 */ }
        try { window.native.hubActionDone({ actionId: payload && payload.actionId, result }); } catch { /* 回执失败由主进程 5 秒超时兜底 */ }
      });
  });
  if (window.native.hubActionReady) window.native.hubActionReady();
})();
