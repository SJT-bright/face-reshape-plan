/* 皮肤引擎 —— 皮肤状态的量化、基线对比、跨系统预测与验证（纯逻辑，node 可测）
   设计原则：
   - 参数 临床向：痘痘计数/新增、毛孔、色斑痘印、泛红、出油、干燥、屏障、主观整体
   - 互通 有据：每条预测规则引用可查的文献/机制（睡眠→皮质醇→屏障与皮脂；运动→血流与汗液清洁）
   - 预测 可证伪：每天先出方向性预测（升/降/平），记录后自动对账，累计命中率
   - 相关 谨慎：n≥10 才报告 Pearson r，避免小样本自欺 */

(function (root) {
  'use strict';

  /* ---------- 参数定义（0-3 四级；越高越需要关注） ----------
     权重依据：痘痘与屏障/炎症为皮肤状态主信号（合计~0.43）；
     眼周是睡眠质量的直接外显（0.11）；其余按日常可感知度配平。 */
  const PARAMS = [
    { key: 'eyes', label: '眼周', levels: ['清爽', '轻微暗沉', '黑眼圈明显', '眼袋浮肿'], weight: 0.11 },
    { key: 'pores', label: '毛孔', levels: ['不明显', '轻微可见', '明显', '粗大'], weight: 0.10 },
    { key: 'spots', label: '斑/痘印', levels: ['几乎无', '少量', '中等', '明显'], weight: 0.08 },
    { key: 'redness', label: '泛红', levels: ['无', '轻微', '明显', '严重'], weight: 0.13 },
    { key: 'oil', label: '出油', levels: ['偏干', '正常', '偏油', '很油'], weight: 0.08 },
    { key: 'dry', label: '干燥', levels: ['不干', '轻微', '起皮', '严重'], weight: 0.06 },
    { key: 'barrier', label: '屏障', levels: ['稳定', '紧绷', '刺痛', '敏感发作'], weight: 0.14 }
  ];
  const ACNE_WEIGHT = 0.30; /* 痘痘（计数+新增）权重；与 PARAMS 合计为 1 */

  /* ---------- 数据 ---------- */
  function normalize(db) {
    const src = db.skin && typeof db.skin === 'object' ? db.skin : {};
    db.skin = {
      logs: src.logs && typeof src.logs === 'object' ? src.logs : {},
      photos: Array.isArray(src.photos) ? src.photos : [],
      predictions: src.predictions && typeof src.predictions === 'object' ? src.predictions : {},
      stats: src.stats && typeof src.stats === 'object' ? src.stats : { seen: 0, hit: 0 }
    };
    return db.skin;
  }

  function todayKey(now) {
    const p = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now || new Date());
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }

  /* ---------- 评分：越高越好（0-100） ---------- */
  function acneBadness(log) {
    const total = Number(log.acneTotal) || 0;
    const fresh = Number(log.acneNew) || 0;
    return Math.min(4, total / 5) + Math.min(2, fresh); /* 20 颗封顶计入 + 新增每颗重计 */
  }
  function scoreSkin(log) {
    if (!log) return null;
    let bad = 0, wsum = 0;
    for (const p of PARAMS) {
      const v = Number.isInteger(log[p.key]) ? Math.max(0, Math.min(3, log[p.key])) : null;
      if (v === null) continue;
      bad += (v / 3) * p.weight;
      wsum += p.weight;
    }
    const acne = Number.isInteger(log.acneTotal) || Number.isInteger(log.acneNew);
    if (acne) { bad += Math.min(1, acneBadness(log) / 4) * ACNE_WEIGHT; wsum += ACNE_WEIGHT; }
    const objective = wsum > 0 ? Math.round((1 - bad / wsum) * 100) : null;
    const subjective = Number(log.overall) >= 1 && Number(log.overall) <= 10 ? Number(log.overall) * 10 : null;
    /* 主客观 30/70：客观参数为主，主观整体做校准；缺一项则用另一项 */
    const score = objective !== null && subjective !== null ? Math.round(objective * 0.7 + subjective * 0.3)
      : objective !== null ? objective : subjective;
    return { score, objective, subjective };
  }

  /* ---------- 基线：此前 windowDays 天内各参数的中位数 ---------- */
  function median(nums) {
    if (!nums.length) return null;
    const s = [...nums].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
  }
  function baseline(logs, beforeDate, windowDays) {
    const from = addDays(beforeDate, -(windowDays || 28));
    const picked = Object.keys(logs).filter((d) => d >= from && d < beforeDate).sort();
    if (!picked.length) return null;
    const out = { n: picked.length, params: {}, score: median(picked.map((d) => scoreSkin(logs[d]).score)) };
    for (const p of PARAMS) out.params[p.key] = median(picked.map((d) => logs[d][p.key]).filter((v) => Number.isInteger(v)));
    out.acneTotal = median(picked.map((d) => logs[d].acneTotal).filter((v) => Number.isInteger(v)));
    return out;
  }

  /* ---------- 睡眠取数：按「醒来日期」归日（与 rhythm 模块一致） ---------- */
  function sleepForDate(sleeps, dateKey, nowMs) {
    const list = (sleeps || []).filter((s) => s.end && s.kind !== 'nap' && String(s.endLocal || '').slice(0, 10) === dateKey);
    const valid = list.filter((s) => {
      const st = Date.parse(s.start), en = Date.parse(s.end);
      return Number.isFinite(st) && Number.isFinite(en) && en > st && en <= (nowMs || Infinity);
    });
    if (!valid.length) return null;
    const minutes = Math.round(valid.reduce((n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 60000, 0));
    const starts = valid.map((s) => String(s.startLocal || '')).sort();
    return { minutes, bedtime: starts[0] ? starts[0].slice(11, 16) : null, sessions: valid.length };
  }

  /* ---------- 预测规则（每条都带可查出处） ---------- */
  const REFS = {
    oyetakin: 'Oyetakin-White et al. 2015, Clin Exp Dermatol：长期差睡眠者皮肤内在老化迹象约为好睡眠者两倍，屏障恢复更慢',
    biophys: '睡眠剥夺对面部皮肤生物物理特性研究：一晚剥夺即出现经皮失水升高、屏障恢复受损，且与皮质醇升高相关',
    hpa: 'The Sleep–Skin Axis (MDPI, 2024)：睡眠剥夺经 HPA 轴升高皮质醇，加重炎症性皮肤病',
    sebum: 'Sleep Disturbances and Acne 综述【2025·PMC】：睡眠不足与面部皮脂失调、屏障恢复受损相关',
    circadian: 'Circadian Rhythms and Sebaceous Gland Function (J Dermatol)：昼夜节律紊乱与皮脂腺活动、痤疮严重度相关',
    li2025: 'Li F. et al. 2025, Physical Activity and Skin Health (PMC)：运动改善皮肤血流与氧营养输送；汗液加皮脂可能堵塞毛孔',
    aad: '美国皮肤病学会(AAD)：汗液本身不致痘；汗+油+菌混合且不及时清洁才会诱发',
    igf1: 'IGF-1 与痤疮研究：血清 IGF-1 升高与皮脂分泌过多相关；规律运动改善胰岛素敏感性、调节该通路'
  };
  /* 近 N 天有记录的日志（升序，早→近） */
  function recentLogs(logs, beforeDate, n) {
    return Object.keys(logs).filter((d) => d < beforeDate).sort().slice(-n).map((d) => ({ date: d, log: logs[d] }));
  }
  /* 参数连续上行天数（截至 beforeDate 前一天往回数，最多 maxDays 次比较） */
  function risingStreak(logs, beforeDate, key, maxDays) {
    const vals = [];
    let cursor = addDays(beforeDate, -1);
    for (let i = 0; i < (maxDays || 3); i++) {
      const lg = logs[cursor];
      if (!lg || !Number.isInteger(lg[key])) break;
      vals.unshift(lg[key]);
      cursor = addDays(cursor, -1);
    }
    let streak = 0;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] > vals[i - 1]) streak++;
      else break;
    }
    return streak;
  }
  /* 生理期模式学习：period 标记 ≥2 次、间隔合理才输出；
     学习「经期前 5 天窗口」的新痘均值 vs 平时，并推算下一次窗口 */
  function periodPattern(logs, asOfDate) {
    const starts = Object.keys(logs || {}).filter((d) => logs[d].period === true).sort();
    if (starts.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < starts.length; i++) {
      const g = Math.round((Date.parse(starts[i]) - Date.parse(starts[i - 1])) / 86400000);
      if (g >= 15 && g <= 60) gaps.push(g); /* 排除漏记/异常间隔 */
    }
    const cycleLen = gaps.length ? median(gaps) : null;
    if (!cycleLen || cycleLen < 15) return null;
    const lastStart = starts[starts.length - 1];
    let next = addDays(lastStart, cycleLen);
    let guard = 0;
    while (Date.parse(next) < Date.parse(asOfDate) && guard++ < 6) next = addDays(next, cycleLen);
    const daysToNext = Math.round((Date.parse(next) - Date.parse(asOfDate)) / 86400000);
    const pmsSet = new Set();
    for (const s of starts) for (let k = 1; k <= 5; k++) pmsSet.add(addDays(s, -k));
    const inPms = [], outside = [];
    for (const d of Object.keys(logs)) {
      const v = Number(logs[d].acneNew);
      if (!Number.isInteger(v)) continue;
      (pmsSet.has(d) ? inPms : outside).push(v);
    }
    const pmsAvg = inPms.length >= 3 ? Math.round(inPms.reduce((a, b) => a + b, 0) / inPms.length * 10) / 10 : null;
    const otherAvg = outside.length >= 3 ? Math.round(outside.reduce((a, b) => a + b, 0) / outside.length * 10) / 10 : null;
    return { starts, cycleLen, nextStart: next, daysToNext, pmsAvg, otherAvg };
  }
  /* 滞后相关：皮肤可能对 1-2 天前的睡眠更敏感（修复与炎症都有延迟）。
     三个滞后中选最大 |r| 本身有多重选择偏差，故每个滞后要求 n≥14（比普通相关更严），
     且 UI 措辞只说「关联最强」并披露选法——不构成因果结论。 */
  function bestLagCorrelation(entries, maxLag) {
    const byDate = new Map(entries.filter((e) => e.score !== null && e.sleepMinutes !== null).map((e) => [e.date, e]));
    let best = null;
    for (let lag = 0; lag <= (maxLag || 2); lag++) {
      const pairs = [];
      for (const e of byDate.values()) {
        const s = byDate.get(addDays(e.date, -lag));
        if (s) pairs.push([s.sleepMinutes, e.score]);
      }
      const r = pearson(pairs);
      if (r !== null && pairs.length >= 14 && (best === null || Math.abs(r) > Math.abs(best.r))) {
        best = { lag, r, n: pairs.length, strength: Math.abs(r) >= 0.5 ? '明显' : Math.abs(r) >= 0.25 ? '有一定关联' : '关联较弱' };
      }
    }
    return best;
  }
  /* AI 识图返回值严格校验：仅接受整数或纯整数字符串，并要求落在范围内。
     小数、空串、布尔、null、越界一律拒绝（返回 null），由调用方计数并提示。 */
  function normAiInt(v, min, max) {
    let n = v;
    if (typeof n === 'string') {
      if (!/^-?\d+$/.test(n.trim())) return null;
      n = Number(n.trim());
    }
    if (typeof n !== 'number' || !Number.isInteger(n)) return null;
    if (n < min || n > max) return null;
    return n;
  }
  /* 输入全部由调用方注入（保持纯函数）；输出方向性预测清单 */
  function predictForDate(input) {
    const { dateKey, nowMs, sleeps, meals, strengthDays, logs } = input;
    const prevDate = addDays(dateKey, -1);
    const sleep = sleepForDate(sleeps, dateKey, nowMs);        /* 昨晚（今晨醒来的那觉） */
    const prevTraining = strengthDays && strengthDays[prevDate];
    const trainedPrev = !!(prevTraining && (prevTraining.status === 'completed' || prevTraining.status === 'partial'));
    const trainingMinutes = trainedPrev && prevTraining.totalSeconds ? Math.round(prevTraining.totalSeconds / 60) : 0;
    const recents = recentLogs(logs || {}, dateKey, 3);
    const last = recents.length ? recents[recents.length - 1].log : null;
    const out = [];

    /* R1 睡眠不足 → 皮质醇↑ → 皮脂↑/屏障修复↓（≤5h 为研究中「差睡眠」口径，预警级更高） */
    if (sleep && sleep.minutes < 6 * 60) {
      const h = Math.round(sleep.minutes / 6) / 10;
      out.push({
        dir: 'down', level: sleep.minutes <= 5 * 60 ? 'warn' : 'info',
        title: `昨晚约 ${h} 小时睡眠——预计今日皮肤状态下滑`,
        detail: '睡眠不足会经 HPA 轴升高皮质醇：皮脂分泌增多、屏障修复变慢，出油、泛红和痘痘风险上升。',
        advice: '今天精简护肤：温和清洁＋加强保湿修护；不引入新的活性成分（酸/视黄醇）；出门做好防晒。',
        refs: ['biophys', 'hpa', 'sebum']
      });
    }
    /* R2 熬夜晚睡（即使时长够）→ 节律紊乱 */
    if (sleep && sleep.bedtime) {
      const hm = sleep.bedtime.split(':').map(Number);
      if (hm[0] >= 0 && hm[0] < 3 && sleep.minutes >= 6 * 60) {
        out.push({
          dir: 'down', level: 'info',
          title: `昨晚 ${sleep.bedtime} 才入睡——节律偏晚`,
          detail: '时长够但入睡过晚会打乱皮肤昼夜节律，与皮脂腺活动紊乱、痤疮加重相关。',
          advice: '今晚尽量提前 30–60 分钟入睡；白天避免用厚重底妆捂住皮肤。',
          refs: ['circadian']
        });
      }
    }
    /* R3 连续两晚不足 → 累积效应，提示更强 */
    if (sleep && sleep.minutes < 6 * 60) {
      const prev = sleepForDate(sleeps, addDays(dateKey, -2), nowMs);
      if (prev && prev.minutes < 6 * 60) {
        out.push({
          dir: 'down', level: 'warn',
          title: '连续两晚睡眠不足——累积损伤预警',
          detail: '慢性短睡眠与内在老化迹象翻倍、屏障功能下降相关（好睡眠者对照组）。',
          advice: '未来三天以「修护」为唯一主题：保湿、防晒、早睡；暂停去角质与面膜以外的功效叠加。',
          refs: ['oyetakin', 'biophys']
        });
      }
    }
    /* R4 睡眠充足 → 修复充分 */
    if (sleep && sleep.minutes >= 7.5 * 60 && (!last || (last.barrier || 0) <= 1)) {
      out.push({
        dir: 'up', level: 'good',
        title: `昨晚 ${Math.round(sleep.minutes / 6) / 10} 小时睡眠——修复窗口充分`,
        detail: '深睡眠期生长激素分泌集中，是皮肤修复的黄金时段；屏障状态好时更耐受功效成分。',
        advice: '今天适合正常推进功效步骤（维C/酸类按周期来）；继续防晒。',
        refs: ['oyetakin']
      });
    }
    /* R5 昨日训练 → 汗液清洁提醒（信息级，不判方向） */
    if (trainedPrev) {
      out.push({
        dir: 'flat', level: 'info',
        title: `昨日训练 ${trainingMinutes || ''} 分钟——注意清洁残留`,
        detail: '运动促进皮肤血流与养分输送是长期利好；但汗液混合皮脂与菌若不及时清洁，可能堵塞毛孔。',
        advice: '训练后尽快洗脸/洗澡，重点清洁发际线、下颌与背部；勤换枕套与毛巾。',
        refs: ['li2025', 'aad']
      });
    }
    /* R6 屏障/泛红活跃 → 避免刺激性成分 */
    if (last && ((Number(last.barrier) || 0) >= 2 || (Number(last.redness) || 0) >= 2)) {
      out.push({
        dir: 'down', level: 'warn',
        title: '屏障/泛红信号活跃——今日避开刺激',
        detail: '屏障受损时叠加酸类、视黄醇或磨砂会放大刺激，泛红可能加重。',
        advice: '停用一切功效型活性物；用含神经酰胺/泛醇的修护保湿；温水洁面；硬防晒（帽子/口罩）优先。',
        refs: ['hpa']
      });
    }
    /* R7 近两天新痘持续上升 → 活性炎症期 */
    if (recents.length >= 2) {
      const n0 = Number(recents[recents.length - 2].log.acneNew) || 0;
      const n1 = Number(last.acneNew) || 0;
      if (n1 >= 2 && n1 > n0) {
        out.push({
          dir: 'down', level: 'warn',
          title: `新痘连续上升（${n0}→${n1} 颗）——炎症活跃期`,
          detail: '新痘增多且加速，通常处于活性炎症阶段；此时叠加大补或高糖饮食会经 IGF-1 通路推高皮脂。',
          advice: '点涂抗炎产品代替全脸猛药；暂停厚重面霜/封闭性底妆；少奶少糖几天观察。',
          refs: ['igf1', 'sebum']
        });
      }
    }
    /* R9 前一日晚餐过晚 → 夜间胰岛素/节律负荷，可能浮肿出油 */
    if (Array.isArray(meals) && meals.length) {
      const dayMeals = meals.filter((m) => String(m.local || '').slice(0, 10) === prevDate);
      const lastMeal = dayMeals.map((m) => String(m.local || '')).sort().pop();
      if (lastMeal && Number(lastMeal.slice(11, 13)) >= 21) {
        out.push({
          dir: 'down', level: 'info',
          title: `前一日 ${lastMeal.slice(11, 16)} 仍在进食——晨起浮肿/出油风险上修`,
          detail: '过晚进食会推高夜间胰岛素并与昼夜节律错位，可能与次日面部浮肿、出油增多相关。',
          advice: '今天多喝水、饮食清淡；今晚把最后一餐尽量提前到 20:00 前。',
          refs: ['circadian', 'igf1']
        });
      }
    }
    /* R10 生理期窗口学习：临近个体化的预估窗口时上修痘痘风险 */
    const pp = periodPattern(logs || {}, dateKey);
    if (pp && pp.daysToNext >= 0 && pp.daysToNext <= 5) {
      out.push({
        dir: 'down', level: 'info',
        title: pp.daysToNext === 0 ? '今天处于预估生理期窗口——痘痘风险上修' : `约 ${pp.daysToNext} 天后进入生理期窗口`,
        detail: pp.pmsAvg !== null && pp.otherAvg !== null
          ? `你自己的数据显示：经期前窗口新痘平均 ${pp.pmsAvg} 颗/天，平时 ${pp.otherAvg} 颗/天（周期约 ${pp.cycleLen} 天）。`
          : '激素波动期常伴随皮脂增多与炎症加重，属常见生理性规律；多记录几个月可学到你的个人模式。',
        advice: '窗口期饮食清淡、睡眠优先；提前备好点涂抗炎产品，不叠加刺激成分。',
        refs: ['igf1', 'sebum']
      });
    }
    /* R11 毛孔/泛红/出油连续两天上行 → 趋势预警 */
    const rising = PARAMS.filter((p) => risingStreak(logs || {}, dateKey, p.key, 3) >= 2);
    if (rising.length) {
      out.push({
        dir: 'down', level: 'warn',
        title: `${rising.map((p) => p.label).join('、')}连续两天上行——趋势预警`,
        detail: '单项偶有波动是正常的，但连续上行通常对应真实变化：回想近期睡眠、清洁、产品和饮食哪个变了。',
        advice: '先回归基础三件套（温和清洁、保湿、防晒），暂停功效叠加，观察 2-3 天再决定是否调整。',
        refs: ['sebum']
      });
    }
    if (!out.length) {
      out.push({
        dir: 'flat', level: 'info',
        title: '今天没有特别的跨系统信号',
        detail: '昨晚睡眠与近期记录都在常规范围内，按当前护肤周期正常执行即可。',
        advice: '', refs: []
      });
    }
    /* 汇总方向：有 warn 且向下 → down；只有正向 → up；否则 flat */
    const dirs = out.map((p) => p.dir);
    const overallDir = dirs.includes('down') && out.some((p) => p.level === 'warn') ? 'down'
      : dirs.every((d) => d === 'up') ? 'up' : dirs.includes('down') ? 'down' : 'flat';
    return { dateKey, overallDir, items: out };
  }

  /* ---------- 预测对账：记录当天日志时调用 ----------
     日预测只对「昨天有记录」的连续日期计命中：隔多天的 delta 是多日变化，
     计入会让命中率虚高（间隔退化几乎必中 down）。非连续日期标记 skipped 并留档。 */
  function verifyPrediction(state, dateKey, currentScore) {
    const dates = Object.keys(state.logs).filter((d) => d < dateKey).sort();
    const prevDate = dates.length ? dates[dates.length - 1] : null;
    const prev = prevDate ? scoreSkin(state.logs[prevDate]).score : null;
    const pred = state.predictions[dateKey];
    if (!pred || pred.verified || prev === null || currentScore === null) return null;
    const gapDays = Math.round((Date.parse(dateKey) - Date.parse(prevDate)) / 86400000);
    if (gapDays !== 1) {
      pred.verified = { skipped: true, gapDays, checkedAt: new Date().toISOString() };
      return { skipped: true, gapDays };
    }
    const delta = currentScore - prev;
    const hit = pred.overallDir === 'down' ? delta < 0
      : pred.overallDir === 'up' ? delta > 0
        : Math.abs(delta) <= 3;
    pred.verified = { hit, delta, checkedAt: new Date().toISOString() };
    state.stats.seen += 1;
    if (hit) state.stats.hit += 1;
    return { hit, delta };
  }

  /* ---------- 相关性：n≥10 才给 Pearson r ---------- */
  function pearson(pairs) {
    const n = pairs.length;
    if (n < 10) return null;
    const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
    const my = pairs.reduce((s, p) => s + p[1], 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (const [x, y] of pairs) { const a = x - mx, b = y - my; num += a * b; dx += a * a; dy += b * b; }
    if (dx === 0 || dy === 0) return null;
    return Math.round((num / Math.sqrt(dx * dy)) * 100) / 100;
  }
  function correlate(series) {
    const sleepPairs = series.filter((s) => s.score !== null && s.sleepMinutes !== null).map((s) => [s.sleepMinutes, s.score]);
    const trainPairs = series.filter((s) => s.score !== null && s.trained !== null && s.trained !== undefined).map((s) => [s.trained ? 1 : 0, s.score]);
    const r = pearson(sleepPairs);
    const r2 = pearson(trainPairs);
    const label = (v) => v === null ? '数据不足（n<10）' : Math.abs(v) >= 0.5 ? '明显' : Math.abs(v) >= 0.25 ? '有一定关联' : '关联较弱';
    return {
      sleep: { r, n: sleepPairs.length, strength: label(r) },
      training: { r: r2, n: trainPairs.length, strength: label(r2) }
    };
  }

  const api = { PARAMS, ACNE_WEIGHT, REFS, normalize, todayKey, addDays, scoreSkin, acneBadness, baseline, median, sleepForDate, predictForDate, verifyPrediction, pearson, correlate, recentLogs, risingStreak, periodPattern, bestLagCorrelation, normAiInt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SkinEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
