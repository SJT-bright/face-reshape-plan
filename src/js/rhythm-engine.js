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
      completeDays: d.completeDays && typeof d.completeDays === 'object' ? d.completeDays : {}, profile: d.profile || 'unset' };
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
    return null;
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
    if (data.sleeps.some(s => s.id !== input.id && s.end && start < Date.parse(s.end) && end > Date.parse(s.start))) return '这段时间与另一段睡眠重叠，请检查已有记录。';
    return null;
  }
  function sleepInput(date, startTime, endTime, recordedMinutes = null, id) {
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime === endTime) return null;
    return { id, startLocal: `${startTime > endTime ? addDay(date, -1) : date}T${startTime}`, endLocal: `${date}T${endTime}`, recordedMinutes };
  }
  function sleepMinutes(s) {
    const elapsed = (Date.parse(s.end) - Date.parse(s.start)) / MS;
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
    const meals = data.meals.filter(m => parse(m.local) && Number.isFinite(Date.parse(m.at)) && Date.parse(m.at) <= +now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const validSleeps = data.sleeps.filter(s => parse(s.startLocal) && parse(s.endLocal) && Date.parse(s.end) <= +now && Date.parse(s.end) > Date.parse(s.start) && Date.parse(s.end) - Date.parse(s.start) <= 1440 * MS);
    const conflicts = new Set(validSleeps.filter(s => meals.some(m => Date.parse(m.at) > Date.parse(s.start) && Date.parse(m.at) < Date.parse(s.end)) || validSleeps.some(t => t.id !== s.id && Date.parse(s.start) < Date.parse(t.end) && Date.parse(s.end) > Date.parse(t.start))).map(s => s.id));
    const sleeps = validSleeps.filter(s => !conflicts.has(s.id));
    const rows = dates.map(date => {
      const dm = meals.filter(m => day(m.local) === date);
      const ds = sleeps.filter(s => day(s.endLocal) === date);
      const mc = data.completeDays[date]?.meals === true, sc = data.completeDays[date]?.sleep === true;
      const hasConflict = validSleeps.some(s => conflicts.has(s.id) && day(s.endLocal) === date);
      const main = ds.filter(s => s.kind !== 'nap').sort((a, b) => (Date.parse(b.end) - Date.parse(b.start)) - (Date.parse(a.end) - Date.parse(a.start)))[0];
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
   * 手工分数（个人积累库 60-100）存在时按 60% 手工 + 40% 计算融合。 */
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
  const api = { normalize, localNow, addDay, parse, circularSD, validateMeal, validateSleep, sleepInput, sleepMinutes, analyze, completeBetween, sleepQuality, sleepPoints, daysBetweenKeys };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RhythmEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
