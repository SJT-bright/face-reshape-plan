/* Pure calculations; incomplete records never stand in for fasting or zero sleep. */
(function (root) {
  const E = typeof module !== 'undefined' && module.exports ? require('./rhythm-evidence') : root.RhythmEvidence;
  const MS = 60000;
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const day = local => local.slice(0, 10);
  const clock = local => Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
  function localNow(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function addDay(key, n) {
    const d = new Date(`${key}T12:00`); d.setDate(d.getDate() + n); return day(localNow(d));
  }
  function parse(local) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local || '')) return null;
    const date = new Date(local);
    if (!Number.isFinite(+date) || localNow(date) !== local || Number(local.slice(0, 4)) < 2000) return null;
    return { iso: date.toISOString(), local, offset: date.getTimezoneOffset() };
  }
  function normalize(value) {
    const d = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return { ...d, version: 1, meals: Array.isArray(d.meals) ? d.meals : [], sleeps: Array.isArray(d.sleeps) ? d.sleeps : [],
      completeDays: d.completeDays && typeof d.completeDays === 'object' ? d.completeDays : {}, profile: d.profile || 'unset',
      sugarLog: d.sugarLog && typeof d.sugarLog === 'object' ? d.sugarLog : {} };
  }
  function circularSD(values) {
    if (values.length < 2) return null;
    const angles = values.map(v => v * Math.PI / 720);
    const r = Math.min(1, Math.hypot(mean(angles.map(Math.cos)), mean(angles.map(Math.sin))));
    return r < 1e-12 ? 720 : Math.max(0, Math.min(720, Math.sqrt(-2 * Math.log(r)) * 720 / Math.PI));
  }
  function validateMeal(input, data, now = Date.now()) {
    const p = parse(input.local);
    if (!p) return '请填写有效的进餐日期和时间。';
    if (+new Date(p.iso) > now) return '还没到这个时间，请记录已经发生的进餐。';
    if (data.meals.some(m => m.id !== input.id && m.local === input.local)) return '这个时间已有一条进餐记录，可以直接编辑它。';
    if (input.mealType != null && !MEAL_TYPE_WINDOWS.some(w => w.id === input.mealType)) return '餐别不在可选范围内，请重新选择。';
    return null;
  }
  /* ---------- 餐别（正餐 + 各时段加餐，全天左闭右开） ----------
   * 记一餐时直接选：早餐 / 上午加餐 / 午餐 / 下午加餐 / 晚餐 / 晚上加餐 / 夜宵。
   * 分类带是设计取值，盖住膳食指南的推荐用餐时刻（早 6:30–8:30 / 午 11:30–13:30 / 晚 18:00–20:00），
   * 加餐带填在正餐之间。记录时按时刻自动预选，可以手改。
   * kind：meal = 正餐，snack = 加餐。晚上加餐是独立餐别，不再另设「吃了一餐 / 加餐」下拉。
   * 旧记录的 breakfast / lunch / dinner / supper 仍在白名单里。无 mealType 时展示层按时刻兜底，不回写。
   * 数值同步登记在 rhythm-evidence.rules.mealType；边界见 docs/meal-timing-workout-design.md。
   * 只用于展示和餐后锻炼时机，不是营养评估。 */
  const MEAL_TYPE_WINDOWS = [
    { id: 'breakfast', label: '早餐', kind: 'meal', start: 5 * 60, end: 9 * 60 + 30 },
    { id: 'morning-snack', label: '上午加餐', kind: 'snack', start: 9 * 60 + 30, end: 11 * 60 },
    { id: 'lunch', label: '午餐', kind: 'meal', start: 11 * 60, end: 14 * 60 },
    { id: 'afternoon-snack', label: '下午加餐', kind: 'snack', start: 14 * 60, end: 17 * 60 },
    { id: 'dinner', label: '晚餐', kind: 'meal', start: 17 * 60, end: 20 * 60 },
    { id: 'evening-snack', label: '晚上加餐', kind: 'snack', start: 20 * 60, end: 22 * 60 + 30 },
    { id: 'supper', label: '夜宵', kind: 'snack', start: 22 * 60 + 30, end: 29 * 60 } // 22:30–次日 04:59
  ];
  function classifyMealType(local) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local || '')) return null;
    const hours = Number(local.slice(11, 13)), minutes = Number(local.slice(14, 16));
    if (hours > 23 || minutes > 59) return null;
    const hit = MEAL_TYPE_WINDOWS.find(w => w.end <= 1440
      ? minutes + hours * 60 >= w.start && minutes + hours * 60 < w.end
      : minutes + hours * 60 >= w.start || minutes + hours * 60 < w.end - 1440);
    return hit ? hit.id : null;
  }
  function mealTypeLabel(id) {
    const hit = MEAL_TYPE_WINDOWS.find(w => w.id === id);
    return hit ? hit.label : null;
  }
  function mealTypeKind(id) {
    const hit = MEAL_TYPE_WINDOWS.find(w => w.id === id);
    return hit ? hit.kind : null;
  }
  /* 编辑旧记录：已存的餐别优先。旧数据若是「正餐 + kind=snack」，改选该时刻对应的加餐，没有就落到晚上加餐。 */
  function resolveMealSelection(record, timeValue) {
    const fallback = classifyMealType(timeValue);
    if (!record) return fallback;
    const stored = record.mealType && mealTypeLabel(record.mealType) ? record.mealType : null;
    const snackish = record.kind === 'snack';
    if (stored && !(snackish && mealTypeKind(stored) === 'meal')) return stored;
    const guessed = classifyMealType(record.local || timeValue);
    if (mealTypeKind(guessed) === 'snack') return guessed;
    if (snackish) return 'evening-snack';
    return stored || fallback;
  }
  function validateSleep(input, data, now = Date.now()) {
    const a = parse(input.startLocal), b = input.endLocal ? parse(input.endLocal) : null;
    if (!a || (input.endLocal && !b)) return '请填写有效的睡觉和起床日期、时间。';
    if (!b) return '请按手环填写起床时间，一次保存完整的睡眠记录。';
    const start = a && +new Date(a.iso), end = b ? +new Date(b.iso) : now;
    if (start > now || end > now) return '请记录已经发生的睡眠时间。';
    if (b && end <= start) return '起床时间应晚于睡觉时间；跨夜时请检查日期。';
    if (b && end - start > 24 * 60 * MS) return '这段记录超过 24 小时，请检查起床日期。';
    if (input.recordedMinutes != null && (!Number.isInteger(input.recordedMinutes) || input.recordedMinutes <= 0 || input.recordedMinutes > (end - start) / MS)) return '手环睡眠时长应大于 0，且不超过入睡到起床的时间。';
    if (input.awakeMinutes != null && (!Number.isInteger(input.awakeMinutes) || input.awakeMinutes < 0 || input.awakeMinutes >= (end - start) / MS)) return '夜间清醒总时间应为不小于 0 的整数分钟，且小于入睡到起床的时间跨度。';
    if (data.sleeps.some(s => s.id !== input.id && s.end && start < Date.parse(s.end) && end > Date.parse(s.start))) return '这段时间与另一段睡眠重叠，请检查已有记录。';
    return null;
  }
  function sleepInput(date, startTime, endTime, recordedMinutes = null, id, awakeMinutes = null) {
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime === endTime) return null;
    return { id, startLocal: `${startTime > endTime ? addDay(date, -1) : date}T${startTime}`, endLocal: `${date}T${endTime}`, recordedMinutes, awakeMinutes };
  }
  /* 累计睡眠口径：入睡→起床跨度 − 夜间清醒总时间（手环「清醒」时长）。
     未填清醒时间时回退：导入记录自带的手环时长 → 纯时间差。 */
  function hasSleep(s) {
    if(!s)return false;
    return s.durationOnly?Number.isInteger(s.recordedMinutes)&&s.recordedMinutes>0&&s.recordedMinutes<=1440&&/^\d{4}-\d{2}-\d{2}$/.test(s.endLocal||''):!!s.end;
  }
  function sleepMinutes(s) {
    if(s.durationOnly)return hasSleep(s)?s.recordedMinutes:null;
    const elapsed = (Date.parse(s.end) - Date.parse(s.start)) / MS;
    if (Number.isInteger(s.awakeMinutes) && s.awakeMinutes >= 0 && s.awakeMinutes < elapsed) return elapsed - s.awakeMinutes;
    return Number.isInteger(s.recordedMinutes) && s.recordedMinutes > 0 && s.recordedMinutes <= elapsed ? s.recordedMinutes : elapsed;
  }
  function completeBetween(data, a, b, field = 'meals') {
    if (a > b) return false;
    // Bounded: only within 24-hour pairs (at most three calendar dates).
    for (let d = day(a), count = 0; d <= day(b); d = addDay(d, 1)) {
      if (++count > 3 || data.completeDays[d]?.[field] !== true) return false;
    }
    return true;
  }
  function analyze(raw, options = {}) {
    const data = normalize(raw), now = options.now || new Date();
    const today = day(localNow(now)), window = options.days === 30 ? 30 : 7;
    const endDay = addDay(today, -1), startDay = addDay(endDay, 1 - window);
    const dates = Array.from({ length: window }, (_, i) => addDay(startDay, i));
    const inWindow = d => d >= startDay && d <= endDay;
    /* 性能：冲突配对只可能发生在窗口 ±3 天邻域内（beforeBed 回看最多一天），
       先预过滤再扫描——三年数据量下把平方级扫描压回线性（扫描只发生在邻域子集上） */
    const nearDay = d => d >= addDay(startDay, -3) && d <= addDay(endDay, 3);
    const meals = data.meals.filter(m => m && parse(m.local) && nearDay(day(m.local)) && Number.isFinite(Date.parse(m.at)) && Date.parse(m.at) <= +now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const validSleeps = data.sleeps.filter(s => s && parse(s.startLocal) && parse(s.endLocal) && nearDay(day(s.endLocal)) && Date.parse(s.end) <= +now && Date.parse(s.end) > Date.parse(s.start) && Date.parse(s.end) - Date.parse(s.start) <= 1440 * MS);
    const conflicts = new Set(validSleeps.filter(s => meals.some(m => Date.parse(m.at) > Date.parse(s.start) && Date.parse(m.at) < Date.parse(s.end)) || validSleeps.some(t => t.id !== s.id && Date.parse(s.start) < Date.parse(t.end) && Date.parse(s.end) > Date.parse(t.start))).map(s => s.id));
    const sleeps = [...validSleeps.filter(s => !conflicts.has(s.id)),...data.sleeps.filter(s=>s.durationOnly&&hasSleep(s)&&nearDay(day(s.endLocal))&&day(s.endLocal)<=today)];
    const rows = dates.map(date => {
      const dm = meals.filter(m => day(m.local) === date);
      const ds = sleeps.filter(s => day(s.endLocal) === date);
      const mc = data.completeDays[date]?.meals === true, sc = data.completeDays[date]?.sleep === true;
      const hasConflict = validSleeps.some(s => conflicts.has(s.id) && day(s.endLocal) === date);
      const main = ds.filter(s => !s.durationOnly && s.kind !== 'nap').sort((a, b) => (Date.parse(b.end) - Date.parse(b.start)) - (Date.parse(a.end) - Date.parse(a.start)))[0];
      return { date, meals: dm, sleeps: ds, mealComplete: mc, sleepComplete: sc,
        sleepMinutes: sc && ds.length && !hasConflict ? ds.reduce((n, s) => n + sleepMinutes(s), 0) : null,
        first: mc && dm.length ? dm[0] : null, last: mc && dm.length ? dm[dm.length - 1] : null,
        main: sc && !hasConflict ? main : null };
    });
    const gaps = [], eatingSpans = [], beforeBed = [], afterWake = [];
    rows.forEach(r => {
      if (r.mealComplete && r.meals.length > 1) {
        eatingSpans.push((Date.parse(r.last.at) - Date.parse(r.first.at)) / MS);
        r.meals.slice(1).forEach((m, i) => gaps.push((Date.parse(m.at) - Date.parse(r.meals[i].at)) / MS));
      }
    });
    // Each main sleep is paired in actual chronological order, never by HH:mm subtraction.
    rows.filter(r => r.main).forEach(r => {
      const s = r.main, start = Date.parse(s.start), end = Date.parse(s.end);
      const previous = meals.filter(m => Date.parse(m.at) <= start && start - Date.parse(m.at) <= 1440 * MS).at(-1);
      const nextSleep = data.sleeps.filter(t => Date.parse(t.start) >= end && t.kind !== 'nap').map(t => Date.parse(t.start)).sort((a, b) => a - b)[0] || Infinity;
      const next = meals.find(m => Date.parse(m.at) >= end && Date.parse(m.at) < nextSleep && Date.parse(m.at) - end <= 1440 * MS);
      if (previous && previous.offset === s.startOffset && completeBetween(data, previous.local, s.startLocal)) beforeBed.push({ date: r.date, minutes: (start - Date.parse(previous.at)) / MS });
      if (next && next.offset === s.endOffset && day(next.local) <= endDay && completeBetween(data, s.endLocal, next.local)) afterWake.push({ date: r.date, minutes: (Date.parse(next.at) - end) / MS });
    });
    const sleepValues = rows.map(r => r.sleepMinutes).filter(n => n !== null);
    const firstValues = rows.filter(r => r.first).map(r => clock(r.first.local));
    const bedValues = rows.filter(r => r.main).map(r => clock(r.main.startLocal));
    const metrics = { sleep: mean(sleepValues), beforeBed: mean(beforeBed.map(p => p.minutes)), afterWake: mean(afterWake.map(p => p.minutes)),
      mealGap: mean(gaps), gapVariation: gaps.length > 1 ? Math.sqrt(mean(gaps.map(n => (n - mean(gaps)) ** 2))) : null, eatingSpan: mean(eatingSpans), firstVariation: circularSD(firstValues), bedVariation: circularSD(bedValues) };
    const alerts = [], R = E.rules;
    const add = (id, title, text, sources) => alerts.push({ id, title, text, sources });
    const shortCount = sleepValues.filter(n => n < R.shortSleep.minutes).length;
    const nearCount = beforeBed.filter(p => p.minutes < R.nearBed.minutes).length;
    if (data.profile === 'adult') {
      if (sleepValues.length >= R.shortSleep.minimumDays && shortCount >= R.shortSleep.repeatedDays && metrics.sleep < R.shortSleep.minutes) add('short-sleep', '睡眠时间值得多留一点', `${sleepValues.length} 个完整日里，${shortCount} 天记录的睡眠时长不足 7 小时。持续偏短可能影响精力和代谢；可以先给夜间睡眠多留一些时间。若持续困倦，可咨询医生。`, R.shortSleep.sources);
      if (beforeBed.length >= R.nearBed.minimumPairs && nearCount >= R.nearBed.repeatedPairs) add('near-bed', '几次进餐靠近睡前', `${beforeBed.length} 组完整记录中，${nearCount} 次进餐离睡觉不到 2 小时。若有夜间反酸，可尝试把晚餐提前，睡前留出约 2–3 小时；不据此判断体脂变化。`, R.nearBed.sources);
      if (firstValues.length >= R.variability.minimumDays && metrics.firstVariation > R.variability.minutes) add('meal-variation', '首次进食时间有些变化', `已记全的 ${firstValues.length} 天里，首次进食的时刻波动较大。可以试着让每日安排更接近，不必为了时间点跳餐。`, R.variability.sources);
      if (bedValues.length >= R.variability.minimumDays && metrics.bedVariation > R.variability.minutes) add('sleep-variation', '入睡安排有些变化', `已记全的 ${bedValues.length} 天里，主要睡眠的开始时刻波动较大。可以先让睡觉和起床的安排更稳定。`, R.variability.sources);
    }
    const sufficient = sleepValues.length >= 5 && firstValues.length >= 5 && beforeBed.length >= 3;
    return { version: E.version, window, startDay, endDay, rows, metrics, alerts, beforeBed, afterWake,
      counts: { sleepDays: sleepValues.length, mealDays: firstValues.length, mealGaps: gaps.length, eatingSpans: eatingSpans.length, bedDays: bedValues.length, beforeBed: beforeBed.length, afterWake: afterWake.length, conflicts: validSleeps.filter(s => conflicts.has(s.id) && inWindow(day(s.endLocal))).length },
      state: data.profile !== 'adult' ? 'descriptive' : alerts.length ? 'attention' : sufficient ? 'no-flags' : 'insufficient' };
  }
  /* ---------- 睡眠质量体系（数据模型来自「个人积累库」sleep_daily_records） ----------
   * score: 0-100 综合分 = 时长(45) + 深睡/REM 结构(25) + 夜醒(10) + 晨起感受(20)；
   * 手工分数（个人积累库 60-100）存在时按 60% 手工 + 40% 计算融合。
   * 出处分层：时长带 6.5–9h 对齐 NSF 7–9h 口径；深睡 18%/REM 20% 参考值取自正常睡眠结构文献带
   * （N3 约 13–23%、REM 约 20–25%，Carskadon & Dement）——为带内取值；
   * 夜醒每次扣 3、晨起感受分档、四项配比与 60/40 融合为设计取值。总表见 docs/scoring-parameters.md */
  function sleepQuality(rec) {
    const dur = Math.max(0, Math.round(rec.durationMinutes || 0));
    if (!dur) return null;
    // 时长 45 分：6.5–9 小时满分，越短扣得越快，过长缓扣
    let durScore;
    if (dur >= 390 && dur <= 540) durScore = 45;
    else if (dur < 390) durScore = Math.max(18, 45 - (390 - dur) / 60 * 9);
    else durScore = Math.max(30, 45 - (dur - 540) / 60 * 6);
    // 结构 25 分：深睡 18%±10 个百分点、REM 20%±12 个百分点（缺该项就拿不到该部分，不倒扣）
    let structScore = 0;
    const deepPct = rec.deepMinutes ? rec.deepMinutes / dur : null;
    const remPct = rec.remMinutes ? rec.remMinutes / dur : null;
    if (deepPct != null) structScore += Math.max(0, 15 - Math.abs(deepPct - 0.18) / 0.10 * 15);
    if (remPct != null) structScore += Math.max(0, 10 - Math.abs(remPct - 0.20) / 0.12 * 10);
    // 夜醒 10 分：每次 -3，未知给 6（中性）
    const awakeEpisodes = rec.awakeEpisodes;
    const awakeScore = Number.isInteger(awakeEpisodes) ? Math.max(0, 10 - awakeEpisodes * 3) : 6;
    // 晨起感受 20 分：1→6 … 5→20，未知给 14（中性）
    const feelTable = [0, 6, 11, 15, 18, 20];
    const feelScore = Number.isInteger(rec.morningFeeling) && rec.morningFeeling >= 1 && rec.morningFeeling <= 5 ? feelTable[rec.morningFeeling] : 14;
    const computed = Math.max(0, Math.min(100, Math.round(durScore + structScore + awakeScore + feelScore)));
    const manual = Number.isInteger(rec.qualityScore) ? Math.max(0, Math.min(100, rec.qualityScore)) : null;
    const score = manual != null ? Math.round(manual * 0.6 + computed * 0.4) : computed;
    return { score, computed, manual, deepPct, remPct };
  }
  function daysBetweenKeys(a, b) {
    return Math.round((Date.parse(b + 'T12:00') - Date.parse(a + 'T12:00')) / 86400000);
  }
  /* 睡眠积分：按日期逐条累计。
   * 记录 +5；时长≥7h +10；综合分≥80 +10；早睡（23:00–00:30 间入睡）+5；连续记录每满 7 天 +20。 */
  function sleepPoints(entries) {
    let total = 0, streak = 0, prev = null;
    const detail = [];
    for (const r of entries.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const pts = [];
      let p = 5; pts.push(['记录 +5', 5]);
      if ((r.minutes || 0) >= 420) { p += 10; pts.push(['时长≥7h +10', 10]); }
      if ((r.score ?? 0) >= 80) { p += 10; pts.push(['评分≥80 +10', 10]); }
      const t = r.asleepTime || '';
      const early = (t >= '23:00' && t <= '23:59') || (t >= '00:00' && t <= '00:30');
      if (early) { p += 5; pts.push(['早睡 +5', 5]); }
      streak = (prev != null && daysBetweenKeys(prev, r.date) === 1) ? streak + 1 : 1;
      if (streak > 0 && streak % 7 === 0) { p += 20; pts.push(['连续7天 +20', 20]); }
      total += p;
      detail.push({ date: r.date, points: p, breakdown: pts, streak });
      prev = r.date;
    }
    return { total, detail };
  }
  /* ---------- 今晚入睡建议（早上记录睡眠后生成） ----------
     依据与决策表见 docs/sleep-advice-design.md。规则来源：
     - 时长目标：NSF 成人 7–9 小时（Hirshkowitz 2015 Delphi 共识）；有足够记录时用个人近 7 次均值并夹在 7–9h；
     - 规律性优先：入睡时刻与近期习惯差 >60 分钟时向习惯时刻靠拢一半
       （NSF 2023 规律性共识 Sletten 2023；Windred 2023：规律性对健康的预测不弱于时长）；
     - 入睡潜伏期预留 15 分钟（健康成人正常约 10–20 分钟，Sleep Foundation）；
     - 昨晚偏短或质量偏低 → 今晚卧床机会 +30 分钟（睡眠压力/腺苷机制，Borbély 两过程模型）；
     - 周期数（约 90 分钟）仅作展示性参考：周期实际 70–120 分钟且个体差异大，
       睡眠分期无法提前精确预测（Sleep Health Foundation 对睡眠计算器的批评）——不做周期对齐宣称。 */
  function circularMeanMinutes(values) {
    if (!values.length) return null;
    const angles = values.map(v => v * Math.PI / 720);
    const x = mean(angles.map(Math.cos)), y = mean(angles.map(Math.sin));
    if (!Number.isFinite(x) || !Number.isFinite(y) || (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12)) return null;
    return ((Math.atan2(y, x) * 720 / Math.PI) % 1440 + 1440) % 1440;
  }
  function circularShift(minutes, delta) { return ((minutes + delta) % 1440 + 1440) % 1440; }
  function circularDiffMinutes(a, b) {
    const d = ((a - b) % 1440 + 1440) % 1440;
    return d > 720 ? 1440 - d : d;
  }
  /* 圆环中点：a 向 b 沿较短弧走一半（用于「向习惯入睡时刻靠拢」） */
  function circularMidpoint(a, b) {
    let d = ((b - a) % 1440 + 1440) % 1440;
    if (d > 720) d -= 1440;
    return circularShift(a, d / 2);
  }
  /* 圆环 medoid：取与其它时刻圆环距离之和最小的数据点，抗离群值。
     circular 均值会被跨午夜离群值拉偏（如 6 晚 23:00 + 1 晚 03:00 被拉到 20:22），medoid 仍停在 23:00 */
  function circularMedoidMinutes(values) {
    if (!values.length) return null;
    if (values.length === 1) return ((values[0] % 1440) + 1440) % 1440;
    let best = null, bestSum = Infinity;
    for (const a of values) {
      let sum = 0;
      for (const b of values) sum += circularDiffMinutes(a, b);
      if (sum < bestSum) { bestSum = sum; best = a; }
    }
    return ((best % 1440) + 1440) % 1440;
  }
  function clockText(minutes) {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  function sleepAdvice(raw, now = new Date(), options = {}) {
    const opts = options || {};
    const trainingSetsYesterday = Number.isFinite(opts.trainingSetsYesterday) ? opts.trainingSetsYesterday : null;
    const data = normalize(raw);
    const today = day(localNow(now));
    const mains = data.sleeps
      .filter(s => s && s.kind !== 'nap' && parse(s.startLocal) && parse(s.endLocal) && Date.parse(s.end) > Date.parse(s.start) && Date.parse(s.end) <= +now) // 倒挂记录与 analyze 同口径排除（负时长会产出「-15.5 小时」荒谬文案）
      .map(s => ({
        date: s.endLocal.slice(0, 10),
        wake: clock(s.endLocal), bed: clock(s.startLocal), minutes: sleepMinutes(s),
        score: sleepQuality({ durationMinutes: sleepMinutes(s), deepMinutes: s.deepMinutes ?? null, remMinutes: s.remMinutes ?? null,
          awakeEpisodes: s.awakeEpisodes ?? null, morningFeeling: s.morningFeeling ?? null, qualityScore: s.qualityScore ?? null })?.score ?? null,
        awakeEpisodes: Number.isInteger(s.awakeEpisodes) ? s.awakeEpisodes : null,
        morningFeeling: Number.isInteger(s.morningFeeling) ? s.morningFeeling : null
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.wake - b.wake);
    if (!mains.length) return null;
    const recent = mains.slice(-7);
    const last = mains[mains.length - 1];
    const avg = mean(recent.map(r => r.minutes));
    const reasons = [];
    /* 目标时长：个人近 7 次均值（≥3 次记录时），否则 NSF 通用 7.5 小时；都夹在 7–9h */
    const target = mains.length >= 3 && avg != null
      ? Math.round(Math.max(420, Math.min(540, avg)) / 15) * 15
      : 450;
    reasons.push(mains.length >= 3 && avg != null
      ? `近 ${recent.length} 次平均睡眠约 ${Math.round(avg / 6) / 10} 小时，目标取 ${Math.round(target / 6) / 10} 小时（NSF 成人推荐 7–9 小时）`
      : `记录还少（${mains.length} 次），先按通用目标 7.5 小时（NSF 成人推荐 7–9 小时）`);
    /* 昨晚偏短或质量偏低 → 多留 30 分钟卧床机会。
       质量判定用夜醒/晨起感受等成分，不用综合分——综合分含时长罚分，
       会让长睡眠者被误判为「质量低」而继续加量（时长与质量不双重计分） */
    let extended = target;
    if (last.minutes < target - 45) {
      extended = Math.min(extended + 30, 570);
      reasons.push(`昨晚约 ${Math.round(last.minutes / 6) / 10} 小时偏短，今晚多留 30 分钟卧床时间（清醒时的睡眠压力需要更长的睡眠来消散）`);
    }
    /* 昨日训练容量高 → 今晚多留恢复窗口（2026-09-22 补充）。
       训练适应（肌蛋白合成）主要在睡眠中完成；大容量日的恢复需求更高。
       15 组为肌群周推荐带（10–20 组）的上半段入口，作为「容量偏高」的操作阈值，
       来源同 strength-core 的 Schoenfeld 2017 / Baz-Valle 2022 推荐带；+15 分钟为设计取值。 */
    if (trainingSetsYesterday !== null && trainingSetsYesterday >= 15) {
      extended = Math.min(extended + 15, 570);
      reasons.push(`昨日训练 ${trainingSetsYesterday} 组（容量偏高），今晚多留 15 分钟恢复窗口——训练适应主要在睡眠中完成`);
    }
    const lastQualityLow = (Number.isInteger(last.awakeEpisodes) && last.awakeEpisodes >= 3)
      || (Number.isInteger(last.morningFeeling) && last.morningFeeling <= 2)
      || (last.score != null && last.score < 60 && last.minutes >= 390 && last.minutes <= 540);
    if (lastQualityLow) {
      extended = Math.min(extended + 30, 570);
      reasons.push(`昨晚睡眠质量偏低（夜醒多或晨起感受差），今晚多留 30 分钟卧床机会`);
    }
    /* 起床锚点：优先用用户指定的「明早起床时间」（如次日需早起/晚起），
       否则取近 3 次起床时刻的 medoid（抗离群值，某晚晚起不会拉偏锚点）。
       习惯入睡时刻取「昨晚之前」的夜晚（昨晚本身可能是熬夜异常值，不适合当习惯基准） */
    const override = Number.isFinite(opts.wakeOverrideMinutes) && opts.wakeOverrideMinutes >= 0 && opts.wakeOverrideMinutes < 1440
      ? opts.wakeOverrideMinutes : null;
    const wakeAnchor = override != null ? override : circularMedoidMinutes(mains.slice(-3).map(r => r.wake));
    const habitNights = recent.length >= 2 ? recent.slice(0, -1) : recent;
    const habitualBed = circularMedoidMinutes(habitNights.map(r => r.bed));
    let bed = circularShift(wakeAnchor, -(extended + 15));
    let blended = false;
    if (recent.length >= 3 && habitualBed != null && circularDiffMinutes(bed, habitualBed) > 60) {
      bed = circularMidpoint(bed, habitualBed);
      blended = true;
      reasons.push('计算时刻与近期入睡习惯差得较多，已向习惯时刻靠拢——规律性对白天状态的影响不弱于时长本身');
    }
    const cycles = Math.max(4, Math.round(extended / 90));
    if (override != null) reasons.push(`按你指定的明早 ${clockText(override)} 起床计算（明天有特殊安排时使用）`);
    return {
      date: today,
      bedtime: clockText(bed),
      wake: clockText(wakeAnchor),
      opportunityMinutes: extended,
      cycles,
      avgMinutes: avg != null ? Math.round(avg) : null,
      lastMinutes: last.minutes,
      lastScore: last.score,
      samples: mains.length,
      blended,
      wakeOverride: override != null,
      reasons,
      disclaimer: '启发式参考、非医疗建议；入睡按 15 分钟潜伏期估算，睡眠分期无法提前精确预测（周期长度 70–120 分钟因人而异）。'
    };
  }
  /* ---------- 今日饮食参考（目标口径，非实际摄入统计） ----------
     原理与出处见 docs/nutrition-advice-design.md。要点：
     - BMR 用 Mifflin-St Jeor、活动系数 TDEE（与 strength-core 同式，保持模块独立可测）；
     - 蛋白质：周刺激组 ≥10 → 1.6 g/kg、>20 → 1.8 g/kg（ISSN 运动人群带 1.4–2.0，Jäger 2017）；
       1–9 组与无训练记录 → 1.2 g/kg（无记录档为保守取值：高于中国 DRIs 2023 成人 RNI ≈0.98、低于 ISSN 带下限 1.4；65 岁以上 DRIs 为 1.17）；
       每餐参考 ISSN 单次剂量带 0.25–0.4 g/kg（≈20–40g 起，全食餐取上端 0.4）；
     - 脂肪：供能 25% 起步（中国 AMDR 20–30% 中点）；碳水余量越出 50–65%E 时在带内调脂肪让位，不可行则如实披露；
     - 碳水：余量供能 ÷4 且受 50–65%E 约束，同时给出 g/kg 对照 3–5 g/kg 常用带（ACSM）；
     - 饮水：30–35 ml/kg 夹在 1500–2500ml（30–35 为通行经验值；中国居民膳食指南 2022 给 1500–1700ml）；
     - 固定提示：盐 <5g/天、添加糖 <50g（最好 <25g，按更严一档提示）（中国居民膳食指南 2022）；
     - 应用只记餐次时间（刻意不记食物构成），「今天吃了多少」如实呈现 N 餐与进食跨度，不虚构热量。 */
  const NUTRIENT_ACTIVITY_FACTORS = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
  function nutritionAdvice(profile, ctx) {
    const c = ctx || {};
    const w = profile && Number(profile.weightKg), h = Number(profile && profile.heightCm);
    if (!(w > 20 && w <= 400) || !(h > 80 && h <= 250)) return null;
    const ageRaw = Number(profile.age);
    const ageAssumed = !Number.isInteger(ageRaw) || ageRaw < 10 || ageRaw > 100;
    const age = ageAssumed ? 30 : ageRaw;
    const sexAssumed = profile.sex !== '男' && profile.sex !== '女';
    const sex = profile.sex === '女' ? '女' : '男';
    const bmr = Math.round(10 * w + 6.25 * h - 5 * age + (sex === '女' ? -161 : 5));
    /* 活动系数白名单取值（profile.activity 若命中 Object 原型键如 "toString" 会得到函数，连锁产生 NaN） */
    const activityAssumed = !['sedentary', 'light', 'moderate', 'active'].includes(profile.activity);
    const activity = activityAssumed ? 'moderate' : profile.activity;
    const tdee = Math.round(bmr * NUTRIENT_ACTIVITY_FACTORS[activity]);
    const weeklySets = Number.isFinite(c.weeklySets) ? c.weeklySets : null;
    const proteinPerKg = weeklySets == null ? 1.2 : weeklySets > 20 ? 1.8 : weeklySets >= 10 ? 1.6 : 1.2;
    const proteinG = Math.round(w * proteinPerKg);
    /* 碳水余量须落在 50–65%E：越界时先在 20–30%E 带内调脂肪让位；
       两者都到界仍不可行（蛋白供能 >30%，小体重高训练量/大体重久坐等组合）则如实披露，不硬凑 */
    let fatG = Math.round(tdee * 0.25 / 9);
    let carbsG = Math.max(0, Math.round((tdee - proteinG * 4 - fatG * 9) / 4));
    const carbPctOf = g => (g * 4 / tdee) * 100;
    let carbAdjustNote = '';
    if (carbPctOf(carbsG) < 50) {
      carbsG = Math.round(tdee * 0.50 / 4);
      fatG = Math.round((tdee - proteinG * 4 - carbsG * 4) / 9);
      if (fatG * 9 < tdee * 0.20) {
        fatG = Math.round(tdee * 0.20 / 9);
        carbsG = Math.max(0, Math.round((tdee - proteinG * 4 - fatG * 9) / 4));
        carbAdjustNote = `该体型下蛋白目标优先：碳水供能比约 ${Math.round(carbPctOf(carbsG))}%，仍低于 50–65% 参考带（脂肪已到 20% 下限）`;
      } else {
        carbAdjustNote = '蛋白目标优先：脂肪已在 20–30% 带内下调，把碳水供能比拉回 50–65%';
      }
    } else if (carbPctOf(carbsG) > 65) {
      carbsG = Math.round(tdee * 0.65 / 4);
      fatG = Math.round((tdee - proteinG * 4 - carbsG * 4) / 9);
      if (fatG * 9 > tdee * 0.30) {
        fatG = Math.round(tdee * 0.30 / 9);
        carbsG = Math.max(0, Math.round((tdee - proteinG * 4 - fatG * 9) / 4));
        carbAdjustNote = `该体型下碳水供能比约 ${Math.round(carbPctOf(carbsG))}%，仍高于 50–65% 参考带（脂肪已到 30% 上限）`;
      } else {
        carbAdjustNote = '脂肪已在 20–30% 带内上调，把碳水供能比压回 50–65%';
      }
    }
    const waterRaw = Math.round(w * 32.5 / 100) * 100;
    const waterMl = Math.max(1500, Math.min(2500, waterRaw));
    const tier = weeklySets == null ? 'no-record' : weeklySets > 20 ? 'high' : weeklySets >= 10 ? 'training' : 'light';
    /* 每餐参考 ISSN 单次剂量带 0.25–0.4 g/kg（全食餐取上端）：主口径固定按 4 餐折算（1.6÷4=0.4 恰在上端）。
       不随当天已记次数变化——「一天还没过完」不能被折算成「每餐超标」（02:30 监督复核 P1-2）；
       当天次数只作中性进度信息，超过 4 次时说明加餐无需每次都配蛋白。 */
    const rawCount = Math.floor(Number(c.mealCount) || 0);
    const perMealG = Math.round(proteinG / 4);
    const perMealPerKg = Math.round(proteinPerKg / 4 * 100) / 100;
    const notes = [];
    notes.push(weeklySets == null
      ? '蛋白 1.2 g/kg 为保守取值：高于中国 DRIs 2023 成人 RNI ≈0.98 g/kg（65 岁以上 1.17）、低于 ISSN 运动人群带下限 1.4'
      : weeklySets > 20 ? '蛋白 1.8 g/kg，取 ISSN 运动人群带 1.4–2.0 的上段（周刺激组 >20，恢复压力更大）'
        : weeklySets >= 10 ? '蛋白 1.6 g/kg，取 ISSN 运动人群带 1.4–2.0 的常用值'
          : '蛋白 1.2 g/kg，周刺激组 1–9 按轻训练量取值（低于 ISSN 运动人群带下限 1.4）');
    notes.push(`蛋白目标共 ${proteinG}g：按 4 餐分摊约每餐 ${perMealG}g（≈${perMealPerKg} g/kg；ISSN 单次参考带 0.25–0.4 g/kg，全食餐取上端）`);
    if (perMealPerKg > 0.4) notes.push(`单餐折算高于 0.4 g/kg 参考带上端——可按约 ${Math.ceil(proteinPerKg / 0.4)} 餐分摊（单次剂量是优化参考、不是上限）`);
    if (rawCount >= 1) notes.push(`今天已记 ${rawCount} 次进食${rawCount >= 4 ? '，加餐无需每次都配蛋白' : ''}`);
    if (carbAdjustNote) notes.push(carbAdjustNote);
    notes.push('盐 <5g/天；添加糖 <50g（最好 <25g，本卡按更严一档提示）（中国居民膳食指南 2022）');
    if (ageAssumed) notes.push('年龄缺省，基础代谢按 30 岁估算');
    if (sexAssumed) notes.push('性别缺省，基础代谢按男性估算（女性同体型约低 10%）');
    if (activityAssumed) notes.push('活动水平缺省，按中度活动估算热量');
    if (waterMl !== waterRaw) notes.push('饮水按 30–35 ml/kg 计算后已截取到 1500–2500ml 带内');
    return {
      bmr, tdee, proteinG, proteinPerKg, fatG, carbsG,
      carbsPerKg: Math.round(carbsG / w * 10) / 10,
      fatPct: Math.round(fatG * 9 / tdee * 100),
      waterMl, waterClamped: waterMl !== waterRaw, tier,
      perMealG, perMealPerKg, ageAssumed, sexAssumed, activityAssumed,
      notes,
      disclaimer: '目标为一般性推荐摄入，非实际摄入统计、非医疗建议；孕期、肾病等特殊状况请遵医嘱。规律训练档蛋白供能比通常高于普通成人 10–15%E 参考带（卫健委 2017 标准）——运动营养按 g/kg 计（ISSN）。'
    };
  }
  /* 今天吃了多少（应用口径）：只统计餐次时间——N 餐、首次/末次、进食跨度 */
  function summarizeMealsToday(raw, dateKey) {
    const data = normalize(raw);
    const meals = data.meals.filter(m => m && parse(m.local) && m.local.slice(0, 10) === dateKey).sort((a, b) => a.local.localeCompare(b.local));
    if (!meals.length) return { count: 0, first: null, last: null, spanMinutes: null };
    const span = (Date.parse(meals[meals.length - 1].local) - Date.parse(meals[0].local)) / 60000;
    return { count: meals.length, first: meals[0].local.slice(11), last: meals[meals.length - 1].local.slice(11), spanMinutes: Math.round(span) };
  }
  /* ---------- 血糖友好习惯参考（habit-based，非血糖测量） ----------
   * 原理与出处见 docs/scoring-parameters.md §7。要点：
   * - 添加糖目标「<50g、最好 <25g」[A]（中国居民膳食指南 2022）；四档估区到系数的映射 [C]；
   * - 进食跨度带（≤12h 佳、>14h 差）[B-观察性]（限时进食与血糖反应的研究；小时数映射 [C]）；
   * - 晚间进食阈值 20:30/21:30 [B-观察性]（生物钟下调晚间糖耐量；阈值映射 [C]）；
   * - 因子权重 0.45/0.30/0.25 与合成方式 [C]；缺哪个因子就按剩余权重归一，全缺返回 null；
   * - 与大脑的关系只做关联性表述（血糖波动与注意力/困倦的观察性证据），不预测认知表现。 */
  const SUGAR_TIERS = [
    { label: '无甜食', est: '约 0g 添加糖', factor: 100 },
    { label: '少量', est: '估 <10g 添加糖（指南带内）', factor: 85 },
    { label: '适量', est: '估 10–25g（接近「最好 <25g」上沿）', factor: 60 },
    { label: '偏多', est: '估 >25g（超出「最好 <25g」）', factor: 30 }
  ];
  function setSugarTier(raw, dateKey, tier) {
    const data = normalize(raw);
    if (!Number.isInteger(tier) || tier < 0 || tier > 3 || !isFinite(Date.parse(dateKey))) return null;
    data.sugarLog[dateKey] = tier;
    return tier;
  }
  function glycemicScore(raw, dateKey) {
    const data = normalize(raw);
    const factors = [];
    const tierRaw = data.sugarLog[dateKey];
    const tier = Number.isInteger(tierRaw) && tierRaw >= 0 && tierRaw <= 3 ? tierRaw : null; // 越界档位（脏数据）按缺档处理
    if (tier !== null) {
      const t = SUGAR_TIERS[tier];
      factors.push({ key: 'sugar', label: `甜食·${t.label}`, weight: 0.45, factor: t.factor, note: `${t.est}；添加糖目标 <50g、最好 <25g（中国居民膳食指南 2022）` });
    }
    const meals = data.meals.filter(m => m && parse(m.local) && m.local.slice(0, 10) === dateKey).sort((a, b) => a.local.localeCompare(b.local));
    if (meals.length >= 2) {
      const span = (Date.parse(meals[meals.length - 1].local) - Date.parse(meals[0].local)) / 60000;
      const hours = span / 60;
      const factor = hours <= 12 ? 100 : hours <= 14 ? 70 : 40;
      factors.push({ key: 'span', label: `进食跨度 ${Math.round(hours * 10) / 10}h`, weight: 0.30, factor, note: '限时进食研究：约 ≤12h 的进食窗口与更好的血糖反应相关；>14h 计为不利' });
    }
    if (meals.length >= 1) {
      const last = clock(meals[meals.length - 1].local);
      /* 夜宵可落到次日清晨：00:00–05:59 比较前 +1440，避免被当成上午（≤20:30 → 100） */
      const lateAt = last < 6 * 60 ? last + 1440 : last;
      const factor = lateAt <= 20 * 60 + 30 ? 100 : lateAt <= 21 * 60 + 30 ? 75 : 50;
      factors.push({ key: 'late', label: `末次进食 ${clockText(last)}`, weight: 0.25, factor, note: '生物钟使晚间糖耐量下降：20:30 前完餐计优，21:30 后计不利（观察性证据）' });
    }
    if (!factors.length) return null;
    const wsum = factors.reduce((s, f) => s + f.weight, 0);
    const score = Math.round(factors.reduce((s, f) => s + f.factor * f.weight, 0) / wsum);
    /* 明日行动映射（2026-09-22 补充）：只对「今天记录到的具体习惯」给一条可执行的调整，
       不引入新评分；阈值与打分口径一致（添加糖指南 / 进食跨度 ≤12h / 末餐 20:30 前）。 */
    const tomorrowActions = [];
    const sugarFactor = factors.find((f) => f.key === 'sugar');
    if (sugarFactor && Number.isInteger(data.sugarLog[dateKey]) && data.sugarLog[dateKey] >= 2) {
      tomorrowActions.push('今天甜食档为「适量/偏多」——明天先把甜食压回「少量」档，其他习惯不动');
    }
    const spanFactor = factors.find((f) => f.key === 'span');
    const spanHours = spanFactor ? Number(String(spanFactor.label).match(/跨度\s([\d.]+)h/)?.[1]) : NaN;
    if (Number.isFinite(spanHours) && spanHours > 12) {
      tomorrowActions.push(`今天进食跨度 ${spanHours}h——明天把首餐推晚 30 分钟或末餐提前 30 分钟，向 ≤12h 靠拢`);
    }
    const lateFactor = factors.find((f) => f.key === 'late');
    if (lateFactor && lateFactor.factor < 100) {
      tomorrowActions.push('今天末餐偏晚——明天尝试提前 30 分钟吃完最后一餐');
    }
    return {
      date: dateKey, score, factors,
      tomorrowActions,
      disclaimer: '血糖友好「习惯」参考分：按你的记录评估习惯，不是血糖测量；血糖波动与注意力/困倦的关联为观察性证据，不预测任何认知表现。'
    };
  }
  const api = { normalize, localNow, addDay, parse, circularSD, validateMeal, validateSleep, sleepInput, sleepMinutes, hasSleep, analyze, completeBetween, sleepQuality, sleepPoints, daysBetweenKeys, sleepAdvice, circularMeanMinutes, circularMedoidMinutes, circularShift, circularDiffMinutes, circularMidpoint, clockText, nutritionAdvice, summarizeMealsToday, SUGAR_TIERS, setSugarTier, glycemicScore, MEAL_TYPE_WINDOWS, classifyMealType, mealTypeLabel, mealTypeKind, resolveMealSelection };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RhythmEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
