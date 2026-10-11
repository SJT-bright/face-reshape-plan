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
  /* 权重为「设计取值」而非临床等价权重（痤疮/皮肤评估文献不提供各维度合成权重）；
     排序原则：炎症性/屏障类（痘痘、屏障、泛红）> 纹理（眼周、毛孔、斑）> 干燥。
     方法对齐文献处：痘痘按「病灶计数」计分——痤疮临床试验以炎性/非炎性病灶计数为主要终点
     （FDA 2005 痤疮试验指导；IGA 0–4 分级为全局口径）。参数溯源总表见 docs/scoring-parameters.md。 */
  const PARAMS = [
    { key: 'eyes', label: '眼周', levels: ['清爽', '轻微暗沉', '黑眼圈明显', '眼袋浮肿'], weight: 0.11 },
    { key: 'pores', label: '毛孔', levels: ['不明显', '轻微可见', '明显', '粗大'], weight: 0.10 },
    { key: 'spots', label: '斑/痘印', levels: ['几乎无', '少量', '中等', '明显'], weight: 0.08 },
    { key: 'redness', label: '泛红', levels: ['无', '轻微', '明显', '严重'], weight: 0.13 },
    { key: 'oil', label: '肤感', levels: ['偏干', '正常', '偏油', '很油'], weight: 0.08 },
    { key: 'dry', label: '干燥', levels: ['不干', '轻微', '起皮', '严重'], weight: 0.06 },
    { key: 'barrier', label: '屏障', levels: ['稳定', '紧绷', '刺痛', '敏感发作'], weight: 0.14 }
  ];
  const ACNE_WEIGHT = 0.30; /* 痘痘（计数+新增）权重；与 PARAMS 合计为 1。计数口径对齐临床终点，权重本身为设计取值 */

  /* ---------- 数据 ---------- */
  function normalize(db) {
    const src = db.skin && typeof db.skin === 'object' ? db.skin : {};
    db.skin = {
      logs: src.logs && typeof src.logs === 'object' ? src.logs : {},
      photos: Array.isArray(src.photos) ? src.photos : [],
      predictions: src.predictions && typeof src.predictions === 'object' ? src.predictions : {},
      weeklyReports: src.weeklyReports && typeof src.weeklyReports === 'object' ? src.weeklyReports : {},
      faceState: src.faceState && typeof src.faceState === 'object' ? src.faceState : {},
      comparison: src.comparison,
      aiAutoRun: src.aiAutoRun, /* 自动识图「今天已跑过」标记：必须跨渲染保留，否则每次进护肤页都重复上传照片 */
      stats: src.stats && typeof src.stats === 'object' ? src.stats : { seen: 0, hit: 0 }
    };
    return db.skin;
  }

  /* ---------- AI 面部状态（fullness 圆润感 / puffiness 水肿感 / definition 轮廓清晰度，0-3 主观视觉印象） ----------
     与 9 项皮肤参数分开存储：不参与 scoreSkin 权重，只用于「面部建议」的解读。 */
  function saveFaceState(db, dateKey, data) {
    const skin = normalize(db);
    const item = {};
    for (const key of ['fullness', 'puffiness', 'definition']) {
      const n = normAiInt(data ? data[key] : undefined, 0, 3);
      if (n !== null) item[key] = n;
    }
    if (!Object.keys(item).length) return null;
    item.at = new Date().toISOString();
    skin.faceState[dateKey] = item;
    return skin.faceState[dateKey];
  }
  /* 最近一次面部状态（默认 14 天内有效；AI 分析依赖照片，过旧不再解读） */
  function latestFaceState(db, todayKeyStr, maxAgeDays = 14) {
    const skin = normalize(db);
    const dates = Object.keys(skin.faceState).filter((d) => d <= todayKeyStr && addDays(todayKeyStr, -maxAgeDays) <= d).sort();
    if (!dates.length) return null;
    const date = dates[dates.length - 1];
    return { date, ...skin.faceState[date] };
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
    /* 主客观 30/70：客观参数为主，主观整体做校准；缺一项则用另一项。
       7:3 为设计取值（无文献给定主客观融合比），溯源见 docs/scoring-parameters.md */
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
    const picked = Object.keys(logs).filter((d) => d >= from && d < beforeDate && Number.isFinite(scoreSkin(logs[d])?.score)).sort();
    if (!picked.length) return null;
    const out = { n: picked.length, params: {}, score: median(picked.map((d) => scoreSkin(logs[d]).score)) };
    for (const p of PARAMS) out.params[p.key] = median(picked.map((d) => logs[d][p.key]).filter((v) => Number.isInteger(v)));
    out.acneTotal = median(picked.map((d) => logs[d].acneTotal).filter((v) => Number.isInteger(v)));
    return out;
  }

  /* ---------- 睡眠取数：按「醒来日期」归日（与 rhythm 模块一致） ---------- */
  function sleepForDate(sleeps, dateKey, nowMs) {
    const list = (sleeps || []).filter((s) => (s.end||s.durationOnly) && s.kind !== 'nap' && String(s.endLocal || '').slice(0, 10) === dateKey);
    const valid = list.filter((s) => {
      if(s.durationOnly)return Number.isInteger(s.recordedMinutes)&&s.recordedMinutes>0&&s.recordedMinutes<=1440&&Date.parse(s.endLocal+'T00:00')<=(nowMs||Infinity);
      const st = Date.parse(s.start), en = Date.parse(s.end);
      return Number.isFinite(st) && Number.isFinite(en) && en > st && en <= (nowMs || Infinity);
    });
    if (!valid.length) return null;
    /* 时长口径与 RhythmEngine.sleepMinutes 一致：跨度 − 夜间清醒 → 手环时长 → 纯跨度 */
    const minutes = Math.round(valid.reduce((n, s) => {
      if(s.durationOnly)return n+s.recordedMinutes;
      const span = (Date.parse(s.end) - Date.parse(s.start)) / 60000;
      if (Number.isInteger(s.awakeMinutes) && s.awakeMinutes >= 0 && s.awakeMinutes < span) return n + span - s.awakeMinutes;
      return n + (Number.isInteger(s.recordedMinutes) && s.recordedMinutes > 0 && s.recordedMinutes <= span ? s.recordedMinutes : span);
    }, 0));
    const starts = valid.filter(s=>!s.durationOnly).map((s) => String(s.startLocal || '')).sort();
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
    const dateKey = input && (input.dateKey || input.today);
    if (!dateKey || typeof dateKey !== 'string') throw new Error('predictForDate requires dateKey');
    const { nowMs, sleeps, meals, strengthDays, logs } = input;
    const prevDate = addDays(dateKey, -1);
    const th = personalThresholds(sleeps || [], meals || [], dateKey, nowMs);
    const sleep = sleepForDate(sleeps, dateKey, nowMs);        /* 昨晚（今晨醒来的那觉） */
    const prevTraining = strengthDays && strengthDays[prevDate];
    const trainedPrev = !!(prevTraining && (prevTraining.status === 'completed' || prevTraining.status === 'partial'));
    const trainingMinutes = trainedPrev && prevTraining.totalSeconds ? Math.round(prevTraining.totalSeconds / 60) : 0;
    const recents = recentLogs(logs || {}, dateKey, 3).filter(x=>Number.isFinite(scoreSkin(x.log)?.score));
    const last = recents.length ? recents[recents.length - 1].log : null;
    const evidence = { date: dateKey, sleepDate: sleep ? dateKey : null, sleepSamples: sleep ? sleep.sessions : 0,
      skinDates: recents.map(x=>x.date || x.dateKey).filter(Boolean), skinSamples: recents.length, source:'规则估算' };
    const missing = [...(!sleep ? ['当日结束的睡眠记录'] : []), ...(!recents.length ? ['近 3 天皮肤记录'] : [])];
    if (missing.length) return { dateKey, overallDir: null, status: sleep || recents.length ? 'partial':'empty', evidence, missing,
      items:[{dir:null, level:'info', title:'暂无足够记录', detail:'缺少：' + missing.join('、'), refs:[]}] };
    const out = [];

    /* R1 睡眠不足 → 皮质醇↑ → 皮脂↑/屏障修复↓。
       门槛自适应：≥10 天样本用个人 30 分位（钳制 5–7h），否则 6h 人群默认。 */
    if (sleep && sleep.minutes < th.shortSleepMin) {
      const h = Math.round(sleep.minutes / 6) / 10;
      const thH = Math.round(th.shortSleepMin / 6) / 10;
      out.push({
        dir: 'down', level: sleep.minutes <= th.shortSleepMin - 30 ? 'warn' : 'info',
        title: `昨晚约 ${h} 小时睡眠——预计今日皮肤状态下滑`,
        detail: `低于你的短睡眠门槛 ${thH} 小时${th.sleepPersonal ? '（据你近 28 天数据自学习）' : '（人群默认 6 小时）'}。睡眠不足会经 HPA 轴升高皮质醇：皮脂分泌增多、屏障修复变慢，出油、泛红和痘痘风险上升。`,
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
    /* R3 连续两晚不足 → 累积效应，提示更强（门槛同 R1 个人化） */
    if (sleep && sleep.minutes < th.shortSleepMin) {
      const prev = sleepForDate(sleeps, addDays(dateKey, -1), nowMs); /* 上一晚按醒来日归到昨天，不是前天 */
      if (prev && prev.minutes < th.shortSleepMin) {
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
    /* R9 前一日晚餐过晚 → 夜间胰岛素/节律负荷，可能浮肿出油。
       门槛自适应：≥10 天样本用个人 60 分位（钳制 20:00–23:00），否则 21:30 人群默认。 */
    if (Array.isArray(meals) && meals.length) {
      const dayMeals = meals.filter((m) => String(m.local || '').slice(0, 10) === prevDate);
      const lastMeal = dayMeals.map((m) => String(m.local || '')).sort().pop();
      if (lastMeal) {
        const lm = minutesOf(lastMeal.slice(11, 16));
        if (lm !== null && lm >= th.lateMealMin) {
          const thHm = `${String(Math.floor(th.lateMealMin / 60)).padStart(2, '0')}:${String(th.lateMealMin % 60).padStart(2, '0')}`;
          out.push({
            dir: 'down', level: 'info',
            title: `前一日 ${lastMeal.slice(11, 16)} 仍在进食——晨起浮肿/出油风险上修`,
            detail: `过晚进食会推高夜间胰岛素并与昼夜节律错位，可能与次日面部浮肿、出油增多相关（你的晚食门槛 ${thHm}${th.mealPersonal ? '，据你近 28 天数据自学习' : '，人群默认'}）。`,
            advice: '今天多喝水、饮食清淡；今晚把最后一餐尽量提前到 20:00 前。',
            refs: ['circadian', 'igf1']
          });
        }
      }
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
    /* R12 近 7 天训练刺激组超推荐带上限（>20 组/周）→ 恢复负荷信号（2026-09-22 补充）。
       过量训练与皮质醇升高、睡眠质量下降相关，间接影响皮肤屏障与出油；
       20 组为 Schoenfeld 2017 / Baz-Valle 2022 周推荐带上限（与 strength-core 同源）。
       输入 strengthWeeklyStimSets 由渲染端从 muscleProgress 取近 7 天汇总传入。 */
    if (Number.isFinite(input.strengthWeeklyStimSets) && input.strengthWeeklyStimSets > 20) {
      const w = Math.round(input.strengthWeeklyStimSets);
      out.push({
        dir: 'down', level: 'info',
        title: `本周训练量约 ${w} 组——恢复负荷偏高`,
        detail: `超过每周 10–20 组的推荐带上限。过量训练与皮质醇升高、睡眠变浅相关，可能反映为出油增多、屏障变慢或痘印消退变慢（阈值来自力量训练容量文献，皮肤关联为间接证据）。`,
        advice: '本周把训练量压回推荐带（减 2–3 组/每部位），优先睡眠与防晒；不必额外加护肤步骤。',
        refs: ['hpa', 'oyetakin']
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
    return { dateKey, overallDir, status: 'ready', evidence, missing: [], items: out };
  }

  /* ---------- 预测对账：记录当天日志时调用 ----------
     日预测只对「昨天有记录」的连续日期计命中：隔多天的 delta 是多日变化，
     计入会让命中率虚高（间隔退化几乎必中 down）。非连续日期标记 skipped 并留档。 */
  function verifyPrediction(state, dateKey, currentScore) {
    const dates = Object.keys(state.logs).filter((d) => d < dateKey).sort();
    const prevDate = dates.length ? dates[dates.length - 1] : null;
    const prev = prevDate ? scoreSkin(state.logs[prevDate]).score : null;
    const pred = state.predictions[dateKey];
    if (pred && pred.overallDir == null) return null;
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

  /* ---------- 饮食节律（近 N 天）：进食窗口 / 末餐 / 晚食天数 ----------
     数据来自饮食与睡眠模块的进餐记录；晚食阈值 21:30 与预测规则 R9 一致。
     单餐日无法算窗口；窗口超过 16 小时视为异常记录不计入均值。 */
  function minutesOf(hhmmStr) {
    const [h, m] = String(hhmmStr || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }
  function dietSummary(meals, today, nowMs, windowDays) {
    const n = windowDays || 7;
    const from = addDays(today, -(n - 1));
    const byDay = new Map();
    for (const m of meals || []) {
      const local = String((m && m.local) || '');
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) continue;
      const d = local.slice(0, 10);
      if (d < from || d > today) continue;
      const times = byDay.get(d) || [];
      times.push(local.slice(11, 16));
      byDay.set(d, times);
    }
    let winSum = 0, winN = 0, lastSum = 0, lastN = 0, lateDays = 0;
    for (const times of byDay.values()) {
      if (times.length < 2) continue;
      const sorted = times.slice().sort();
      const first = minutesOf(sorted[0]);
      const last = minutesOf(sorted[sorted.length - 1]);
      if (first === null || last === null || last <= first || last - first > 960) continue;
      winSum += last - first; winN++;
      lastSum += last; lastN++;
      if (last >= 21 * 60 + 30) lateDays++;
    }
    return {
      days: byDay.size,
      avgWindowHours: winN ? Math.round((winSum / winN) / 6) / 10 : null,
      avgLastMeal: lastN ? `${String(Math.floor(Math.round(lastSum / lastN) / 60)).padStart(2, '0')}:${String(Math.round(lastSum / lastN) % 60).padStart(2, '0')}` : null,
      lateDays
    };
  }

  /* ---------- 个人阈值（自学习）：积累 ≥10 天样本后，
     短睡眠门槛取个人 30 分位（钳制 5–7h），晚食门槛取 60 分位（钳制 20:00–23:00）；
     样本不足时回落人群默认值（6h / 21:30）。给出的是统计门槛，不是医学建议。 */
  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[idx];
  }
  function personalThresholds(sleeps, meals, today, nowMs) {
    const from = addDays(today, -28);
    const sleepMins = [];
    for (let d = addDays(today, -1); d >= from; d = addDays(d, -1)) {
      const s = sleepForDate(sleeps, d, nowMs);
      if (s) sleepMins.push(s.minutes);
    }
    const mealByDay = new Map();
    for (const m of meals || []) {
      const local = String((m && m.local) || '');
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) continue;
      const d = local.slice(0, 10);
      if (d < from || d > today) continue;
      const arr = mealByDay.get(d) || [];
      arr.push(local.slice(11, 16));
      mealByDay.set(d, arr);
    }
    const lastMeals = [];
    for (const times of mealByDay.values()) {
      if (times.length < 2) continue;
      const sorted = times.slice().sort();
      const f = minutesOf(sorted[0]), l = minutesOf(sorted[sorted.length - 1]);
      if (f === null || l === null || l <= f || l - f > 960) continue;
      lastMeals.push(l);
    }
    const shortSleepMin = sleepMins.length >= 10
      ? Math.min(420, Math.max(300, percentile(sleepMins.slice().sort((a, b) => a - b), 0.3)))
      : 360;
    const lateMealMin = lastMeals.length >= 10
      ? Math.min(1380, Math.max(1200, percentile(lastMeals.slice().sort((a, b) => a - b), 0.6)))
      : 1290;
    return {
      shortSleepMin, lateMealMin,
      sleepSample: sleepMins.length, mealSample: lastMeals.length,
      sleepPersonal: sleepMins.length >= 10, mealPersonal: lastMeals.length >= 10
    };
  }

  /* ---------- 皮肤周报：最近 7 天（含 weekEnd）汇总 ---------- */
  function weeklyReport(logs, sleeps, meals, weekEnd, nowMs) {
    const from = addDays(weekEnd, -6);
    let scoreSum = 0, scoreN = 0, acneNewTotal = 0;
    let best = null, worst = null, sleepMin = 0, sleepN = 0;
    for (let d = from; d <= weekEnd; d = addDays(d, 1)) {
      const l = logs[d];
      if (l) {
        const s = scoreSkin(l).score;
        if(Number.isFinite(s)){scoreSum += s; scoreN++;}
        acneNewTotal += Number(l.acneNew) || 0;
        if (best === null || s > best.score) best = { date: d, score: s };
        if (worst === null || s < worst.score) worst = { date: d, score: s };
      }
      const sl = sleepForDate(sleeps, d, nowMs);
      if (sl) { sleepMin += sl.minutes; sleepN++; }
    }
    const diet = dietSummary(meals, weekEnd, nowMs, 7);
    return {
      weekEnd,
      avgScore: scoreN ? Math.round(scoreSum / scoreN) : null,
      daysLogged: scoreN, acneNewTotal, best, worst,
      sleepAvgMin: sleepN ? Math.round(sleepMin / sleepN) : null, sleepDays: sleepN,
      lateDays: diet.lateDays
    };
  }

  /* ---------- 快速模式：用户只记「痘痘 + 肤感 + 整体感受」，
     未填参数由可观测信号推导（内置原理，显式值永远优先、推导值不写回日志）：
     - 眼周 ← 昨晚睡眠时长（<5.5h 记 3 级暗沉/浮肿风险，5.5–6.5h 记 2，6.5–7.5h 记 1，≥7.5h 记 0）：
       睡眠不足与眼周水肿/暗沉相关（HPA 轴水钠潴留 + 微循环变差）；
     - 肤感(油) ← 个人基线 + 修饰：睡眠不足/晚食上修一级（HPA 轴 → 皮脂腺，文献同 R1/R9）；
     - 泛红/屏障 ← 昨日惯性：屏障修复与炎症消退以夜间为主，日间连续性强，昨日值是最优短期预测；
     - 毛孔/斑/痘印/干燥 ← 28 天个人基线中位数：慢变量，日间波动小于主观观察误差，
       用个人基线是统计上最合理的近似（避免让用户每天评估本来一周才变一次的东西）。 */
  function deriveMissingParams(log, context) {
    const ctx = context || {};
    const sleep = ctx.sleep || null;
    const out = {};
    const put = (key, v) => {
      /* 显式值优先：用户已填的参数不进推导集合 */
      if (log && Number.isInteger(log[key])) return;
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        out[key] = Math.max(0, Math.min(3, Math.round(v)));
      }
    };
    if (sleep) {
      if (sleep.minutes < 330) put('eyes', 3);
      else if (sleep.minutes < 390) put('eyes', 2);
      else if (sleep.minutes >= 450) put('eyes', 0);
      else put('eyes', 1);
    } else if (ctx.baseline && ctx.baseline.params && ctx.baseline.params.eyes != null) {
      put('eyes', ctx.baseline.params.eyes);
    }
    if (ctx.baseline && ctx.baseline.params && ctx.baseline.params.oil != null) {
      let oil = ctx.baseline.params.oil;
      if ((sleep && sleep.minutes < 390) || ctx.lateMeal) oil = Math.min(3, oil + 1);
      put('oil', oil);
    }
    if (ctx.prevLog) {
      if (Number.isInteger(ctx.prevLog.redness)) put('redness', ctx.prevLog.redness);
      if (Number.isInteger(ctx.prevLog.barrier)) put('barrier', ctx.prevLog.barrier);
    }
    if (ctx.baseline && ctx.baseline.params) {
      if (ctx.baseline.params.pores != null) put('pores', ctx.baseline.params.pores);
      if (ctx.baseline.params.spots != null) put('spots', ctx.baseline.params.spots);
      if (ctx.baseline.params.dry != null) put('dry', ctx.baseline.params.dry);
    }
    return out;
  }
  /* 评分：log 显式值优先，缺失参数用推导值合成后按同一权重体系计算。
     返回 derived 供 UI 标注「含引擎估算」。 */
  function scoreSkinWithDerived(log, context) {
    if (!log) return null;
    const derived = deriveMissingParams(log, context);
    const eff = Object.assign({}, derived);
    for (const p of PARAMS) {
      if (Number.isInteger(log[p.key])) eff[p.key] = log[p.key];
    }
    const base = scoreSkin(Object.assign({}, eff, {
      acneTotal: log.acneTotal, acneNew: log.acneNew, overall: log.overall
    }));
    return { score: base.score, objective: base.objective, subjective: base.subjective, derived };
  }

  const api = { PARAMS, ACNE_WEIGHT, REFS, normalize, todayKey, addDays, scoreSkin, acneBadness, baseline, median, sleepForDate, predictForDate, verifyPrediction, pearson, correlate, recentLogs, risingStreak, bestLagCorrelation, normAiInt, dietSummary, minutesOf, personalThresholds, weeklyReport, deriveMissingParams, scoreSkinWithDerived, saveFaceState, latestFaceState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SkinEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
