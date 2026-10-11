/* 成就扩展。数值全部从已有记录派生，不新存一份进度。 */
(function (root) {
  const MAIN = { breakfast: 1, lunch: 1, dinner: 1 };
  const SNACK = { 'morning-snack': 1, 'afternoon-snack': 1, 'evening-snack': 1, supper: 1 };

  function pad(n) { return String(n).padStart(2, '0'); }
  function dayText(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function addDays(key, n) {
    const d = new Date(`${key}T12:00:00`);
    d.setDate(d.getDate() + n);
    return dayText(d);
  }
  function validLocal(local) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local || '');
  }
  function longestRun(dates) {
    const uniq = [...new Set(dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    let best = 0, run = 0, prev = null;
    for (const d of uniq) {
      run = prev && addDays(prev, 1) === d ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    }
    return best;
  }
  function weekKey(key) {
    const d = new Date(`${key}T12:00:00`);
    const back = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - back);
    return dayText(d);
  }
  function hoursBetween(a, b) {
    const ms = new Date(b).getTime() - new Date(a).getTime();
    return Number.isFinite(ms) ? ms / 3600000 : null;
  }
  function occasion(meal) {
    const known = meal.mealType && (MAIN[meal.mealType] || SNACK[meal.mealType]);
    if (known) return meal.mealType;
    if (typeof RhythmEngine !== 'undefined' && RhythmEngine.classifyMealType) {
      const guessed = RhythmEngine.classifyMealType(meal.local);
      if (meal.kind === 'snack' && RhythmEngine.mealTypeKind && RhythmEngine.mealTypeKind(guessed) !== 'snack') return null;
      return guessed;
    }
    return null;
  }
  function isSnack(meal) {
    return meal.kind === 'snack' || !!SNACK[occasion(meal)];
  }
  function setsOf(action) {
    if (Array.isArray(action.sets)) return action.sets.filter((s) => s && s.done).length;
    return typeof action.setsDone === 'number' && action.setsDone > 0 ? action.setsDone : 0;
  }
  function avgReps(text) {
    const nums = String(text || '').replace(/^\s*\d+\s*[x×*]\s*/, '').match(/\d+(?:\.\d+)?/g);
    if (!nums || !nums.length) return 0;
    return nums.reduce((sum, n) => sum + Number(n), 0) / nums.length;
  }
  function maxKgOf(action) {
    let max = 0;
    if (Array.isArray(action.sets)) {
      for (const set of action.sets) {
        if (set && set.done && typeof set.weightKg === 'number' && set.weightKg > max) max = set.weightKg;
      }
    } else if ((action.setsDone || 0) > 0 && typeof action.weightKg === 'number' && action.weightKg > max) {
      max = action.weightKg;
    }
    return max;
  }
  function volumeOfAction(action) {
    if (Array.isArray(action.sets)) {
      return action.sets.filter((s) => s && s.done).reduce((sum, set) => {
        const weight = typeof set.weightKg === 'number' ? set.weightKg : 0;
        return sum + (Number(set.reps) || 0) * weight;
      }, 0);
    }
    const sets = typeof action.setsDone === 'number' ? action.setsDone : 0;
    const reps = avgReps(action.repsText) || avgReps(action.plannedRepsText);
    const weight = typeof action.weightKg === 'number' ? action.weightKg : 0;
    return sets * reps * weight;
  }
  function repsOf(action) {
    const loaded = maxKgOf(action) > 0;
    if (!loaded && /支撑|平板/.test(String(action.name || ''))) return 0;
    if (Array.isArray(action.sets)) {
      return action.sets.filter((s) => s && s.done).reduce((sum, set) => sum + (Number(set.reps) || 0), 0);
    }
    const sets = typeof action.setsDone === 'number' ? action.setsDone : 0;
    return Math.round(sets * (avgReps(action.repsText) || avgReps(action.plannedRepsText)));
  }
  function bodyweightSets(action) {
    if (Array.isArray(action.sets)) return action.sets.filter((s) => s && s.done && !(s.weightKg > 0)).length;
    if ((action.setsDone || 0) > 0 && !(action.weightKg > 0)) return action.setsDone;
    return 0;
  }
  function dayTags(day) {
    const tags = new Set();
    const blob = `${day.bodyPart || ''} ${day.name || ''}`;
    if (/胸/.test(blob)) tags.add('push');
    if (/背/.test(blob)) tags.add('pull');
    if (/腿|臀/.test(blob)) tags.add('legs');
    for (const action of day.actions || []) {
      if (setsOf(action || {}) <= 0) continue;
      const name = String(action.name || '');
      if (/卧推|俯卧撑|推胸|飞鸟|肩推/.test(name)) tags.add('push');
      if (/划船|下拉|引体|弯举/.test(name)) tags.add('pull');
      if (/深蹲|硬拉|腿举|腿弯举|臀桥|箭步|弓步|提踵/.test(name)) tags.add('legs');
    }
    return tags;
  }
  function gapDays(a, b) {
    return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
  }
  function minutesOf(day) {
    if (day.confirmedDurationMinutes != null && day.confirmedDurationMinutes !== '') return Number(day.confirmedDurationMinutes) || 0;
    return Math.round((day.totalSeconds || 0) / 60);
  }
  function phaseLen(day, key) {
    return day && Array.isArray(day[key]) ? day[key].length : 0;
  }

  function facts(store) {
    const db = (store && store.db) || {};
    const stats = store && store.stats ? store.stats() : {};
    const follow = store && store.followTotals ? store.followTotals() : {};
    const training = (db.logs && db.logs.training) || {};
    const skin = (db.logs && db.logs.skincare) || {};
    const meals = ((db.rhythm && db.rhythm.meals) || []).filter((m) => m && validLocal(m.local));
    const sleeps = ((db.rhythm && db.rhythm.sleeps) || []).filter((s) => s && (s.durationOnly&&Number.isInteger(s.recordedMinutes)&&s.recordedMinutes>0&&s.recordedMinutes<=1440&&/^\d{4}-\d{2}-\d{2}$/.test(s.endLocal||'')||validLocal(s.startLocal)&&validLocal(s.endLocal)&&s.endLocal>s.startLocal));
    const mains = sleeps.filter((s) => s.kind !== 'nap');
    const complete = (db.rhythm && db.rhythm.completeDays) || {};
    const strengthDays = db.strength && db.strength.days ? db.strength.days : {};

    let trainDays = 0, weekend = 0, manual = 0, manualSec = 0, multi = 0;
    const videos = new Set(), doneVideos = new Set();
    for (const key of Object.keys(training)) {
      const day = training[key] || {};
      const entries = Array.isArray(day.entries) ? day.entries : [];
      if ((day.seconds || 0) > 0) {
        trainDays++;
        const wd = new Date(`${key}T12:00:00`).getDay();
        if (wd === 0 || wd === 6) weekend++;
      }
      if (entries.length >= 2) multi++;
      for (const entry of entries) {
        if (!entry) continue;
        if (entry.manual) {
          manual++;
          manualSec += entry.seconds || 0;
        }
        if (entry.videoId) {
          videos.add(entry.videoId);
          if (entry.completed && !entry.manual) doneVideos.add(entry.videoId);
        }
      }
    }

    let morning = 0, daytime = 0, bothEnds = 0, anySkin = 0, allThree = 0, steps = 0, trainAndSkin = 0;
    const skinKeys = new Set([...Object.keys(skin), ...Object.keys(training)]);
    for (const key of skinKeys) {
      const day = skin[key];
      const m = phaseLen(day, 'morning'), d = phaseLen(day, 'day'), e = phaseLen(day, 'evening');
      if (m) morning++;
      if (d) daytime++;
      if (m && e) bothEnds++;
      if (m && d && e) allThree++;
      if (m || d || e) anySkin++;
      steps += m + d + e;
      if ((m || d || e) && training[key] && (training[key].seconds || 0) > 0) trainAndSkin++;
    }

    const mealDates = meals.map((m) => m.local.slice(0, 10));
    const byDate = {};
    let eveningSnacks = 0, snacks = 0;
    for (const meal of meals) {
      const date = meal.local.slice(0, 10);
      const id = occasion(meal);
      if (!byDate[date]) byDate[date] = new Set();
      if (id) byDate[date].add(id);
      if (id === 'evening-snack') eveningSnacks++;
      if (isSnack(meal)) snacks++;
    }
    let threeMeals = 0;
    for (const ids of Object.values(byDate)) {
      if (ids.has('breakfast') && ids.has('lunch') && ids.has('dinner')) threeMeals++;
    }
    let mealsFull = 0, sleepFull = 0, bothFull = 0;
    for (const date of Object.keys(complete)) {
      const row = complete[date] || {};
      if (row.meals === true) mealsFull++;
      if (row.sleep === true) sleepFull++;
      if (row.meals === true && row.sleep === true) bothFull++;
    }
    const mainSorted = mains.filter(s=>!s.durationOnly).slice().sort((a, b) => a.startLocal.localeCompare(b.startLocal));
    let beforeBed = 0, afterWake = 0;
    for (const sleep of mainSorted) {
      const next = mainSorted.find((s) => s.startLocal > sleep.endLocal);
      const before = meals.some((m) => m.local <= sleep.startLocal && hoursBetween(m.local, sleep.startLocal) != null && hoursBetween(m.local, sleep.startLocal) <= 24);
      if (before) beforeBed++;
      const after = meals.some((m) => m.local >= sleep.endLocal && hoursBetween(sleep.endLocal, m.local) != null && hoursBetween(sleep.endLocal, m.local) <= 24 && (!next || m.local < next.startLocal));
      if (after) afterWake++;
    }

    const trained = [];
    let doneSessions = 0, totalSets = 0, actionHits = 0, creatine = 0, protein = 0, loggedMin = 0;
    let fullDays = 0, halfHours = 0, volumeKg = 0, repTotal = 0, bwSets = 0, maxKg = 0;
    const parts = new Set();
    const liftDays = new Map();
    const liftFirst = new Map();
    const weekMoves = new Map();
    const strengthKeys = Object.keys(strengthDays).sort();
    for (const key of strengthKeys) {
      const day = strengthDays[key];
      if (day && day.supplements && day.supplements.creatineTaken === true) creatine++;
      if (day && day.supplements && day.supplements.proteinPowderTaken === true) protein++;
      if (!day || day.isRest || (day.status !== 'completed' && day.status !== 'partial')) continue;
      trained.push(key);
      if (day.status === 'completed') doneSessions++;
      if (day.bodyPart) parts.add(String(day.bodyPart));
      const minutes = minutesOf(day);
      loggedMin += minutes;
      if (minutes >= 30) halfHours++;
      let daySets = 0;
      const namesToday = new Set();
      let full = day.status === 'completed' && Array.isArray(day.actions) && day.actions.length > 0;
      for (const action of day.actions || []) {
        const item = action || {};
        const n = setsOf(item);
        daySets += n;
        totalSets += n;
        if (n > 0) {
          actionHits++;
          const name = String(item.name || '').trim();
          if (name) namesToday.add(name);
        }
        volumeKg += volumeOfAction(item);
        repTotal += repsOf(item);
        bwSets += bodyweightSets(item);
        const kg = maxKgOf(item);
        if (kg > maxKg) maxKg = kg;
        const planned = Number.isInteger(item.plannedSets) && item.plannedSets > 0 ? item.plannedSets : 1;
        if (n < planned) full = false;
        const name = String(item.name || '').trim();
        if (name && kg > 0) {
          if (!liftFirst.has(name)) liftFirst.set(name, { key, kg });
          else if (key !== liftFirst.get(name).key && kg > liftFirst.get(name).kg) liftFirst.get(name).up = true;
        }
      }
      if (full && daySets > 0) fullDays++;
      for (const name of namesToday) liftDays.set(name, (liftDays.get(name) || 0) + 1);
      const wk = weekKey(key);
      if (!weekMoves.has(wk)) weekMoves.set(wk, new Set());
      for (const tag of dayTags(day)) weekMoves.get(wk).add(tag);
    }
    const weeks = new Set(trained.map(weekKey));
    let chain = 0, run = 0, prevTrain = null;
    for (const key of trained) {
      run = prevTrain && gapDays(prevTrain, key) <= 4 ? run + 1 : 1;
      if (run > chain) chain = run;
      prevTrain = key;
    }
    let sameLift = 0;
    for (const n of liftDays.values()) if (n > sameLift) sameLift = n;
    let heavier = 0;
    for (const item of liftFirst.values()) if (item.up) heavier++;
    let pplWeeks = 0;
    for (const tags of weekMoves.values()) {
      if (tags.has('push') && tags.has('pull') && tags.has('legs')) pplWeeks++;
    }

    return {
      metDays: stats.metDays || 0,
      followTotal: follow.total || 0,
      trainDays, weekend, manual, manualMin: Math.floor(manualSec / 60),
      videos: videos.size, doneVideos: doneVideos.size, multi, trainAndSkin,
      morning, daytime, bothEnds, anySkin, allThree, steps,
      meals: meals.length, mealDays: new Set(mealDates).size, mealRun: longestRun(mealDates),
      threeMeals, eveningSnacks, snacks,
      mains: mains.length, mainRun: longestRun(mains.map((s) => s.endLocal.slice(0, 10))),
      naps: sleeps.filter((s) => s.kind === 'nap').length,
      mealsFull, sleepFull, bothFull, beforeBed, afterWake,
      sessions: trained.length, doneSessions, totalSets, actionHits,
      parts: parts.size, creatine, protein, loggedMin,
      trainRun: longestRun(trained), weeks: weeks.size,
      fullDays, halfHours, volumeKg: Math.round(volumeKg), repTotal, bwSets, maxKg,
      chain, sameLift, heavier, pplWeeks
    };
  }

  function row(key, group, name, desc, unit, value, steps) {
    return {
      key, group, name, desc, unit, value, ico: '',
      iconSrc: `achievements-grok/${key}.png`,
      tiers: steps.map((step, i) => ({ lv: i + 1, need: step[0], name: step[1] }))
    };
  }

  function series(store) {
    const f = facts(store);
    return [
      row('fc_met', 'follow', '累计达标天数', '当天训练达到当日目标的天数，不要求连着练。', '天', f.metDays, [[10, '达标十天'], [40, '达标四十天'], [100, '达标一百天']]),
      row('fc_traindays', 'follow', '有时长的训练日', '这一天训练秒数大于 0 就计 1 天，没到目标也算。', '天', f.trainDays, [[5, '练过五天'], [25, '练过二十五天'], [80, '练过八十天']]),
      row('fc_weekend', 'follow', '周末训练日', '周六或周日，而且当天有训练时长。', '天', f.weekend, [[2, '周末两天'], [8, '周末八天'], [24, '周末二十四天']]),
      row('fc_manual', 'follow', '手动补记条数', '在成就日历或别处手补的训练条数。', '次', f.manual, [[1, '补记一次'], [12, '补记十二次'], [40, '补记四十次']]),
      row('fc_manualmin', 'follow', '手动补记分钟', '只加总手补记录的分钟，跟练计时不算。', '分钟', f.manualMin, [[60, '补记一小时'], [180, '补记三小时'], [600, '补记十小时']]),
      row('fc_vids', 'follow', '跟练过的视频', '不同视频各算 1 个，打开过并留下 videoId 才算。', '个', f.videos, [[2, '两个视频'], [5, '五个视频'], [12, '十二个视频']]),
      row('fc_viddone', 'follow', '练完过的视频', '完整跟练过的不同视频个数，同个视频练很多次仍算 1 个。', '个', f.doneVideos, [[3, '练完三个'], [6, '练完六个'], [10, '练完十个']]),
      row('fc_starts', 'follow', '开练次数', '点开跟练的次数，没到完整门槛也算。', '次', f.followTotal, [[8, '开练八次'], [40, '开练四十次'], [120, '开练一百二十次']]),
      row('fc_multiday', 'follow', '一天多条记录', '同一天留下至少两条训练记录。', '天', f.multi, [[3, '多条三天'], [12, '多条十二天'], [36, '多条三十六天']]),
      row('fc_both', 'follow', '当天既训练又护肤', '同一天有训练时长，也做了至少一个时段的护肤。', '天', f.trainAndSkin, [[4, '同做四天'], [16, '同做十六天'], [50, '同做五十天']]),

      row('st_sessions', 'strength', '力量训练次数', '完成或部分完成的力量训练日，休息日不算。', '次', f.sessions, [[1, '第一次力量'], [10, '十次力量'], [30, '三十次力量'], [100, '一百次力量']]),
      row('st_done', 'strength', '完整收尾', '状态是已完成的力量训练日。', '次', f.doneSessions, [[1, '收尾一次'], [12, '收尾十二次'], [40, '收尾四十次']]),
      row('st_sets', 'strength', '累计完成组数', '已完成的组相加。逐组记录按点过完成的组计，汇总记录按填写的组数计。', '组', f.totalSets, [[20, '二十组'], [100, '一百组'], [400, '四百组']]),
      row('st_actions', 'strength', '写下实际的动作', '一个训练日里，某个动作有完成组，就计 1 次。', '次', f.actionHits, [[5, '五个动作'], [30, '三十个动作'], [120, '一百二十个动作']]),
      row('st_run', 'strength', '连续力量训练', '前后日期都有力量训练的最长一段，中间空一天就断开。', '天', f.trainRun, [[2, '连两天'], [5, '连五天'], [14, '连十四天']]),
      row('st_weeks', 'strength', '有训练的周', '这一周里至少有一天力量训练，按自然周计。', '周', f.weeks, [[2, '两周'], [8, '八周'], [24, '二十四周']]),
      row('st_parts', 'strength', '练过的部位', '不同训练部位各算 1 个，例如胸、背、腿。', '个', f.parts, [[2, '两个部位'], [4, '四个部位'], [6, '六个部位']]),
      row('st_minutes', 'strength', '力量训练累计时长', '各训练日记录的分钟相加；手填时长优先，旧记录采用计时时长。', '分钟', f.loggedMin, [[60, '满一小时'], [600, '满十小时'], [3000, '满五十小时']]),
      row('st_creatine', 'strength', '肌酸打卡', '把肌酸标成已服的天数，休息日也算。', '天', f.creatine, [[3, '肌酸三天'], [20, '肌酸二十天'], [60, '肌酸六十天']]),
      row('st_protein', 'strength', '蛋白粉打卡', '把蛋白粉标成已服的天数，休息日也算。', '天', f.protein, [[3, '蛋白粉三天'], [20, '蛋白粉二十天'], [60, '蛋白粉六十天']]),
      row('st_min30', 'strength', '满三十分钟', '一次力量训练记录时长满 30 分钟；手填时长优先，旧记录采用计时时长。', '次', f.halfHours, [[1, '跨过半小时'], [12, '十二次跨过'], [40, '四十次跨过'], [90, '九十次跨过']]),
      row('st_full', 'strength', '按计划做完', '这一天已完成，而且每个动作的完成组数都不少于计划组数。', '天', f.fullDays, [[1, '第一次全部对上'], [8, '全部对上八天'], [24, '全部对上二十四天'], [80, '全部对上八十天']]),
      row('st_chain', 'strength', '四日内回练', '相邻两次力量训练相隔不超过 4 天，取最长的一串。', '次', f.chain, [[2, '串上两次'], [8, '串上八次'], [24, '串上二十四次'], [48, '串上四十八次']]),
      row('st_reps', 'strength', '做完的次数', '已完成组的次数相加。没负重的平板和支撑不计。', '次', f.repTotal, [[10, '记上十次'], [500, '记上五百次'], [3000, '记上三千次'], [20000, '记上两万次']]),
      row('st_volume', 'strength', '训练容量', '完成组的重量乘以次数，单位是公斤。', 'kg', f.volumeKg, [[100, '累计一百公斤'], [20000, '累计两万公斤'], [120000, '累计十二万公斤'], [400000, '累计四十万公斤']]),
      row('st_maxkg', 'strength', '单组最重', '已经做完的组里，最重的那一个重量。', 'kg', f.maxKg, [[10, '十公斤那一组'], [30, '三十公斤那一组'], [60, '六十公斤那一组'], [100, '一百公斤那一组']]),
      row('st_heavier', 'strength', '比起步更重', '某个动作后来的重量超过了自己第一次记下的重量。', '个', f.heavier, [[1, '有一个动作加重了'], [3, '有三个动作加重了'], [8, '有八个动作加重了']]),
      row('st_bw', 'strength', '自重组数', '做完且没有填写重量的组。', '组', f.bwSets, [[1, '徒手第一组'], [30, '徒手三十组'], [150, '徒手一百五十组'], [600, '徒手六百组']]),
      row('st_lift', 'strength', '同一个动作出勤', '同一个动作名出现过的训练天数，取最多的那个动作。', '天', f.sameLift, [[1, '某个动作满一天'], [4, '某个动作满四天'], [12, '某个动作满十二天'], [36, '某个动作满三十六天']]),
      row('st_ppl', 'strength', '推拉腿凑齐', '同一周里，推、拉、腿三类都至少做完过一组。', '周', f.pplWeeks, [[1, '第一次三类到齐'], [4, '到齐四周'], [12, '到齐十二周'], [30, '到齐三十周']]),

      row('rh_meals', 'rhythm', '记下进餐', '每保存一条带时间的进餐计 1 次，不看吃了什么。', '次', f.meals, [[1, '第一餐'], [15, '十五餐'], [60, '六十餐']]),
      row('rh_meal_days', 'rhythm', '有进餐的天数', '某一天至少有一条进餐就计 1 天，同一天多条不重复计。', '天', f.mealDays, [[1, '有餐一天'], [7, '有餐七天'], [30, '有餐三十天']]),
      row('rh_meal_run', 'rhythm', '连续记餐', '前后日期都有进餐记录的最长一段。', '天', f.mealRun, [[3, '连三天'], [7, '连七天'], [21, '连二十一天']]),
      row('rh_three', 'rhythm', '一天三餐都有', '同一天里早餐、午餐、晚餐都有记录。加餐和夜宵不顶这三餐。', '天', f.threeMeals, [[1, '齐一天'], [7, '齐七天'], [21, '齐二十一天']]),
      row('rh_eve', 'rhythm', '晚上加餐有记录', '餐别是晚上加餐的条数。只说明记下了，不评价该不该吃。', '次', f.eveningSnacks, [[1, '晚加餐一次'], [5, '晚加餐五次'], [15, '晚加餐十五次']]),
      row('rh_snacks', 'rhythm', '加餐有记录', '上午、下午、晚上的加餐和夜宵，每条计 1 次。', '次', f.snacks, [[1, '加餐一次'], [10, '加餐十次'], [30, '加餐三十次']]),
      row('rh_meals_full', 'rhythm', '进食标成记全', '某一天把进餐确认成已经记全。', '天', f.mealsFull, [[1, '记全一天'], [7, '记全七天'], [21, '记全二十一天']]),
      row('rh_sleeps', 'rhythm', '记下主睡眠', '不是午睡、而且写了入睡和起床的睡眠段。', '次', f.mains, [[1, '主睡眠一次'], [7, '主睡眠七次'], [30, '主睡眠三十次']]),
      row('rh_sleep_run', 'rhythm', '连续记睡眠', '起床日前后相接、都有主睡眠的最长一段。午睡不能把断开的日子接上。', '晚', f.mainRun, [[3, '连三晚'], [7, '连七晚'], [21, '连二十一晚']]),
      row('rh_naps', 'rhythm', '记下午睡', '类型是午睡、而且写了起止时间的段数。', '次', f.naps, [[1, '午睡一次'], [5, '午睡五次'], [15, '午睡十五次']]),
      row('rh_sleep_full', 'rhythm', '睡眠标成记全', '某一天把睡眠确认成已经记全。', '天', f.sleepFull, [[1, '录全一天'], [7, '录全七天'], [21, '录全二十一天']]),
      row('rh_both_full', 'rhythm', '同一天两项都记全', '同一天的进餐和睡眠都确认记全。', '天', f.bothFull, [[1, '两项齐一天'], [7, '两项齐七天'], [21, '两项齐二十一天']]),
      row('rh_before', 'rhythm', '睡前对得上进餐', '一段主睡眠开始前 24 小时内能找到进餐记录。只说明对得上，不分长短。', '次', f.beforeBed, [[1, '睡前一次'], [7, '睡前七次'], [21, '睡前二十一次']]),
      row('rh_after', 'rhythm', '醒后对得上进餐', '一段主睡眠结束后 24 小时内、下一段主睡眠之前能找到进餐记录。', '次', f.afterWake, [[1, '醒后一次'], [7, '醒后七次'], [21, '醒后二十一次']]),

      row('fc_morning', 'skin', '早间护肤天数', '早间步骤有勾选的天数，不要求连续。', '天', f.morning, [[6, '早间六天'], [24, '早间二十四天'], [80, '早间八十天']]),
      row('fc_daytime', 'skin', '日间护肤天数', '日间步骤有勾选的天数。', '天', f.daytime, [[4, '日间四天'], [16, '日间十六天'], [50, '日间五十天']]),
      row('fc_ampm', 'skin', '早晚都做的天数', '同一天早间和晚间都有勾选。', '天', f.bothEnds, [[5, '早晚五天'], [20, '早晚二十天'], [60, '早晚六十天']]),
      row('fc_skinany', 'skin', '护肤打卡天数', '早、中、晚任一有勾选就计 1 天。', '天', f.anySkin, [[3, '打卡三天'], [25, '打卡二十五天'], [90, '打卡九十天']]),
      row('fc_skin3', 'skin', '三个时段都做', '同一天早、中、晚都有勾选。', '天', f.allThree, [[3, '三段三天'], [18, '三段十八天'], [45, '三段四十五天']]),
      row('fc_steps', 'skin', '护肤步骤勾选', '全部日期、全部时段勾过的步骤数相加。取消勾选后这个数会下降。', '次', f.steps, [[12, '勾选十二次'], [80, '勾选八十次'], [300, '勾选三百次']])
    ];
  }

  const api = { facts, series };
  if (typeof module !== 'undefined' && module.filename && module.filename.endsWith('achievement-catalog.js')) module.exports = api;
  root.AchievementCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
