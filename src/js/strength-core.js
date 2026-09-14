/* 力量训练领域核心 —— 从「个人积累库」健身板块移植（v0.26.1 manual-exercise）
   保留的迭代精华：
   - 模板 → 版本 → 训练日 → 动作 四层模型，改版出快照、历史不可变
   - 训练日状态机 not-started → in-progress → partial / completed / skipped（含收尾决议与重开）
   - 周期轮转（完成/跳过自动进入下一训练日）+ 审计事件
   - 计划 vs 实际分离与进步对比
   - 业务日期以 Asia/Shanghai 为准
   舍弃（不适用于本应用）：幂等键表、冻结提交、服务器端乐观锁——
   本应用为单窗口 JSON 文档 + 防抖落盘 + 退出同步落盘，已有等价保障；
   各记录保留 revision 便于将来扩展。 */
(function (root) {
  'use strict';

  const DAY_STATUSES = ['not-started', 'in-progress', 'partial', 'completed', 'skipped'];
  const STATUS_LABELS = {
    'not-started': '未开始', 'in-progress': '进行中',
    partial: '部分完成', completed: '已完成', skipped: '已跳过'
  };
  const MAX_TEMPLATE_DAYS = 366;
  const MAX_ACTIONS_PER_DAY = 500;
  const MAX_REVISION = 2147483647;

  /* ---------- 业务日期（Asia/Shanghai） ---------- */
  function isBusinessDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function businessDate(now) {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now || new Date());
    const get = (t) => parts.find((p) => p.type === t) && parts.find((p) => p.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }

  /* ---------- 数据初始化 ---------- */
  function emptyState() {
    return { templates: [], cycle: {}, days: {}, events: [], progress: [] };
  }
  function normalize(db) {
    const src = db.strength && typeof db.strength === 'object' ? db.strength : {};
    const s = {
      templates: Array.isArray(src.templates) ? src.templates : [],
      cycle: src.cycle && typeof src.cycle === 'object' ? src.cycle : {},
      days: src.days && typeof src.days === 'object' ? src.days : {},
      events: Array.isArray(src.events) ? src.events : [],
      progress: Array.isArray(src.progress) ? src.progress : []
    };
    db.strength = s;
    return s;
  }
  function uid(prefix) {
    return (prefix || 'st') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function fail(error) { return { ok: false, error }; }

  /* ---------- 校验（对应原模块 contracts.ts 的边界） ---------- */
  function isBoundedInt(v, max) {
    return Number.isInteger(v) && v >= 0 && v <= max;
  }
  function validateWeightKg(v) {
    return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000);
  }
  function validateAction(a) {
    if (!a || typeof a.name !== 'string' || !a.name.trim() || a.name.trim().length > 200) return '动作名需为 1~200 字';
    if (a.actionKey !== undefined && (!a.actionKey || String(a.actionKey).length > 128)) return '动作标识过长';
    if (!isBoundedInt(a.plannedSets | 0, 10000)) return '计划组数无效';
    for (const key of ['plannedRepsText', 'plannedWeightText', 'targetText', 'note']) {
      if (a[key] !== undefined && a[key] !== null && typeof a[key] !== 'string') return '动作说明需为文本';
      if (typeof a[key] === 'string' && a[key].length > 4000) return '动作说明过长';
    }
    return null;
  }
  function validateTemplateInput(input) {
    if (!input || typeof input !== 'object') return '模板数据无效';
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 160) return '模板名需为 1~160 字';
    const days = Array.isArray(input.days) ? input.days : [];
    if (!days.length || days.length > MAX_TEMPLATE_DAYS) return `训练日需为 1~${MAX_TEMPLATE_DAYS} 个`;
    const dayKeys = new Set();
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (!d || typeof d.name !== 'string' || !d.name.trim() || d.name.trim().length > 160) return `第 ${i + 1} 个训练日名称无效`;
      const key = typeof d.dayKey === 'string' && d.dayKey.trim() ? d.dayKey.trim() : `day-${i + 1}`;
      if (key.length > 128 || dayKeys.has(key)) return `训练日标识重复或过长：${key}`;
      dayKeys.add(key);
      if (!Array.isArray(d.actions) || !d.actions.length) return `训练日「${d.name}」至少要有一个动作`;
      if (d.actions.length > MAX_ACTIONS_PER_DAY) return `训练日「${d.name}」动作数过多`;
      const actKeys = new Set();
      for (let j = 0; j < d.actions.length; j++) {
        const a = d.actions[j];
        const err = validateAction(a);
        if (err) return `训练日「${d.name}」第 ${j + 1} 个动作：${err}`;
        const ak = a.actionKey && String(a.actionKey).trim() ? String(a.actionKey).trim() : `act-${i + 1}-${j + 1}`;
        if (ak.length > 128 || actKeys.has(ak)) return `动作标识重复或过长：${ak}`;
        actKeys.add(ak);
      }
    }
    return null;
  }

  /* ---------- 模板与版本 ---------- */
  function templateById(state, templateId) {
    return state.templates.find((t) => t.id === templateId) || null;
  }
  function currentVersion(tpl) {
    return tpl.versions.find((v) => v.revision === tpl.currentRevision) || null;
  }
  function versionOf(tpl, revision) {
    return tpl.versions.find((v) => v.revision === revision) || null;
  }
  /* replace-template：整版替换。旧版本保留，历史训练日引用的旧版本不受影响。 */
  function replaceTemplate(state, input, now) {
    const err = validateTemplateInput(input);
    if (err) return fail(err);
    const stamp = (now || new Date()).toISOString();
    const tpl = templateById(state, input.id);
    if (!tpl) {
      const created = {
        id: input.id || uid('tpl'), name: input.name.trim(), currentRevision: 1,
        createdAt: stamp, updatedAt: stamp,
        versions: [{
          revision: 1, effectiveFrom: businessDate(now), changeNote: String(input.changeNote || '初始版本'),
          createdAt: stamp,
          days: input.days.map((d, i) => ({
            dayKey: d.dayKey || `day-${i + 1}`, name: d.name.trim(),
            bodyPart: String(d.bodyPart || ''), isRest: !!d.isRest,
            note: String(d.note || ''), ordinal: i,
            actions: d.actions.map((a, j) => ({
              actionKey: a.actionKey || `act-${i + 1}-${j + 1}`, name: a.name.trim(),
              plannedSets: a.plannedSets | 0, plannedRepsText: String(a.plannedRepsText || ''),
              plannedWeightText: String(a.plannedWeightText || ''), targetText: String(a.targetText || ''),
              note: String(a.note || ''), ordinal: j
            }))
          }))
        }]
      };
      state.templates.push(created);
      state.cycle[created.id] = { currentDayKey: created.versions[0].days[0].dayKey, revision: 1, updatedAt: stamp };
      pushEvent(state, { date: businessDate(now), type: 'started', templateId: created.id, note: '创建模板' }, now);
      return { ok: true, template: created };
    }
    const nextRevision = tpl.currentRevision + 1;
    if (nextRevision > MAX_REVISION) return fail('版本号已达上限');
    tpl.versions.push({
      revision: nextRevision, effectiveFrom: businessDate(now),
      changeNote: String(input.changeNote || '').trim() || '更新计划', createdAt: stamp,
      days: input.days.map((d, i) => ({
        dayKey: d.dayKey || `day-${i + 1}`, name: d.name.trim(),
        bodyPart: String(d.bodyPart || ''), isRest: !!d.isRest, note: String(d.note || ''), ordinal: i,
        actions: d.actions.map((a, j) => ({
          actionKey: a.actionKey || `act-${i + 1}-${j + 1}`, name: a.name.trim(),
          plannedSets: a.plannedSets | 0, plannedRepsText: String(a.plannedRepsText || ''),
          plannedWeightText: String(a.plannedWeightText || ''), targetText: String(a.targetText || ''),
          note: String(a.note || ''), ordinal: j
        }))
      }))
    });
    tpl.currentRevision = nextRevision;
    tpl.name = input.name.trim();
    tpl.updatedAt = stamp;
    // 轮转指针仍指向同 dayKey；新版本里没有就回到第一个训练日
    const cycle = state.cycle[tpl.id];
    const stillThere = currentVersion(tpl).days.some((d) => d.dayKey === cycle.currentDayKey);
    if (!stillThere) cycle.currentDayKey = currentVersion(tpl).days[0].dayKey;
    cycle.revision += 1; cycle.updatedAt = stamp;
    pushEvent(state, { date: businessDate(now), type: 'corrected', templateId: tpl.id, note: `更新到第 ${nextRevision} 版` }, now);
    return { ok: true, template: tpl };
  }

  /* ---------- 事件 ---------- */
  function pushEvent(state, evt, now) {
    state.events.push(Object.assign({
      id: uid('evt'), at: (now || new Date()).toISOString(),
      fromDayKey: null, toDayKey: null, note: ''
    }, evt, { id: evt.id || uid('evt') }));
  }

  /* ---------- 训练日快照 ---------- */
  function dayRecord(state, date) { return state.days[date] || null; }
  /* 按轮转指针把「当前应练的训练日」快照成当天记录（计划部分不可变地拷贝进来） */
  function snapshotDay(state, tpl, date, now) {
    const cycle = state.cycle[tpl.id];
    const version = currentVersion(tpl);
    const planDay = version.days.find((d) => d.dayKey === cycle.currentDayKey);
    if (!planDay) return null;
    return {
      date, templateId: tpl.id, templateRevision: tpl.currentRevision, dayKey: planDay.dayKey,
      name: planDay.name, bodyPart: planDay.bodyPart, isRest: !!planDay.isRest, note: planDay.note || '',
      status: 'not-started', totalSeconds: 0, startedAt: null, pausedAt: null,
      revision: 1,
      supplements: { creatineTaken: null, proteinPowderTaken: null, note: '' },
      confirmedDurationMinutes: null, note: '', completionText: '',
      actions: planDay.actions.map((a) => ({
        actionKey: a.actionKey, name: a.name, plannedSets: a.plannedSets,
        plannedRepsText: a.plannedRepsText, plannedWeightText: a.plannedWeightText,
        targetText: a.targetText,
        setsDone: null, repsText: '', weightKg: null, durationMinutes: null, note: ''
      })),
      resolution: null,
      createdAt: (now || new Date()).toISOString()
    };
  }

  /* ---------- 命令（与原模块命令同名同语义） ---------- */
  function requireDay(state, date) {
    const day = dayRecord(state, date);
    if (!day) return fail('这一天还没有训练记录');
    return { ok: true, day };
  }

  /* 默认模板：最近一次轮转更新的那个（与 todayPlan 预览一致） */
  function defaultTemplate(state) {
    const withCycle = state.templates
      .map((t) => ({ t, c: state.cycle[t.id] }))
      .filter((x) => x.c)
      .sort((a, b) => (b.c.updatedAt || '').localeCompare(a.c.updatedAt || ''));
    return withCycle.length ? withCycle[0].t : null;
  }

  function startTraining(state, input, now) {
    const date = input.date || businessDate(now);
    if (!isBusinessDate(date)) return fail('日期格式无效');
    const existing = dayRecord(state, date);
    if (existing && existing.status === 'completed') return fail('这一天已完成，如需重练请先重开');
    let day = existing;
    if (!day) {
      const tpl = input.templateId ? templateById(state, input.templateId) : defaultTemplate(state);
      if (!tpl) return fail('还没有训练模板，请先建立或导入模板');
      day = snapshotDay(state, tpl, date, now);
      if (!day) return fail('轮转指针指向的训练日不存在，请重新选择');
      state.days[date] = day;
    }
    day.status = 'in-progress';
    day.startedAt = day.startedAt || (now || new Date()).toISOString();
    day.pausedAt = null;
    day.revision += 1;
    const cycle = state.cycle[day.templateId];
    if (cycle && cycle.currentDayKey !== day.dayKey) {
      // 手动开始非当前指针日：指针跟随
      pushEvent(state, { date, type: 'corrected', templateId: day.templateId, fromDayKey: cycle.currentDayKey, toDayKey: day.dayKey, note: '手动开始指定训练日' }, now);
      cycle.currentDayKey = day.dayKey; cycle.revision += 1; cycle.updatedAt = (now || new Date()).toISOString();
    } else {
      pushEvent(state, { date, type: 'started', templateId: day.templateId, fromDayKey: cycle ? cycle.currentDayKey : null, note: '开始训练' }, now);
    }
    return { ok: true, day };
  }

  function pauseTraining(state, input, now) {
    const got = requireDay(state, input.date || businessDate(now));
    if (!got.ok) return got;
    const day = got.day;
    if (day.status !== 'in-progress') return fail('只有进行中的训练可以暂停');
    day.pausedAt = (now || new Date()).toISOString();
    day.revision += 1;
    return { ok: true, day };
  }

  function resumeTraining(state, input, now) {
    const got = requireDay(state, input.date || businessDate(now));
    if (!got.ok) return got;
    const day = got.day;
    if (day.status !== 'in-progress' || !day.pausedAt) return fail('没有已暂停的训练可继续');
    day.pausedAt = null;
    day.revision += 1;
    return { ok: true, day };
  }

  /* save-training：只更新实际完成数据；不动计划快照。 */
  function saveTraining(state, input, now) {
    const date = input.date || businessDate(now);
    const got = requireDay(state, date);
    if (!got.ok) return got;
    const day = got.day;
    if (day.status === 'completed' || day.status === 'skipped') return fail('这一天已收尾，重开后才能修改');
    /* actions 可省略：补剂/备注/确认时长等部分字段保存不带动作补丁 */
    if (input.actions !== undefined && !Array.isArray(input.actions)) return fail('实际数据无效');
    const patches = input.actions || [];
    const byKey = new Map(day.actions.map((a) => [a.actionKey, a]));
    for (const patch of patches) {
      const target = byKey.get(patch.actionKey);
      if (!target) return fail(`动作不存在：${patch.actionKey || '(空)'}`);
      if (patch.setsDone !== undefined && patch.setsDone !== null && !isBoundedInt(patch.setsDone, 10000)) return '完成组数无效';
      if (patch.weightKg !== undefined && !validateWeightKg(patch.weightKg)) return '负重数值无效';
      for (const key of ['repsText', 'note']) {
        if (patch[key] !== undefined && typeof patch[key] === 'string' && patch[key].length > 4000) return '备注过长';
      }
      if (patch.setsDone !== undefined) target.setsDone = patch.setsDone;
      if (patch.repsText !== undefined) target.repsText = String(patch.repsText || '').slice(0, 4000);
      if (patch.weightKg !== undefined) target.weightKg = patch.weightKg;
      if (patch.durationMinutes !== undefined) {
        if (patch.durationMinutes !== null && !isBoundedInt(patch.durationMinutes, 525600)) return '时长无效';
        target.durationMinutes = patch.durationMinutes;
      }
      if (patch.note !== undefined) target.note = String(patch.note || '').slice(0, 4000);
    }
    if (typeof input.totalSeconds === 'number' && Number.isFinite(input.totalSeconds) && input.totalSeconds >= 0) {
      day.totalSeconds = Math.round(input.totalSeconds);
    }
    if (input.confirmedDurationMinutes !== undefined) {
      if (input.confirmedDurationMinutes !== null && !isBoundedInt(input.confirmedDurationMinutes, 525600)) return fail('确认时长无效');
      day.confirmedDurationMinutes = input.confirmedDurationMinutes;
    }
    if (input.supplements !== undefined) {
      const s = input.supplements || {};
      if (s.creatineTaken !== undefined && s.creatineTaken !== null && typeof s.creatineTaken !== 'boolean') return fail('肌酸打卡无效');
      if (s.proteinPowderTaken !== undefined && s.proteinPowderTaken !== null && typeof s.proteinPowderTaken !== 'boolean') return fail('蛋白粉打卡无效');
      if (s.note !== undefined && String(s.note).length > 4000) return fail('补剂备注过长');
      day.supplements = {
        creatineTaken: s.creatineTaken !== undefined ? s.creatineTaken : day.supplements.creatineTaken,
        proteinPowderTaken: s.proteinPowderTaken !== undefined ? s.proteinPowderTaken : day.supplements.proteinPowderTaken,
        note: s.note !== undefined ? String(s.note).slice(0, 4000) : day.supplements.note
      };
    }
    if (input.note !== undefined) day.note = String(input.note || '').slice(0, 4000);
    if (input.completionText !== undefined) day.completionText = String(input.completionText || '').slice(0, 4000);
    // 状态语义：进行中且填了实际数据不降级；是否 partial 由收尾（finish）按完成度定档
    const touched = day.actions.some((a) => a.setsDone !== null && a.setsDone !== undefined);
    if (day.status === 'not-started' && touched) {
      day.status = 'in-progress';
      day.startedAt = day.startedAt || (now || new Date()).toISOString();
    }
    day.revision += 1;
    return { ok: true, day };
  }

  function advanceCycle(state, tpl, fromDayKey, type, date, now) {
    const version = currentVersion(tpl);
    const idx = version.days.findIndex((d) => d.dayKey === fromDayKey);
    const next = version.days[(idx + 1 + version.days.length) % version.days.length];
    const cycle = state.cycle[tpl.id];
    cycle.currentDayKey = next.dayKey;
    cycle.revision += 1;
    cycle.updatedAt = (now || new Date()).toISOString();
    pushEvent(state, { date, type, templateId: tpl.id, fromDayKey, toDayKey: next.dayKey, note: type === 'advanced' ? '完成并轮转' : '跳过并轮转' }, now);
    return next;
  }

  /* finish-and-advance：完成当天并轮转到下一个训练日。计划与实际在收尾时一并定档。 */
  function finishAndAdvance(state, input, now) {
    const date = input.date || businessDate(now);
    const got = requireDay(state, date);
    if (!got.ok) return got;
    const day = got.day;
    if (day.status === 'completed' || day.status === 'skipped') return fail('这一天已经收尾');
    if (input.note !== undefined && typeof input.note === 'string' && input.note.length > 4000) return fail('收尾备注过长');
    const allDone = day.actions.length > 0 && day.actions.every((a) => a.setsDone !== null && a.setsDone !== undefined && a.setsDone >= a.plannedSets);
    const touched = day.actions.some((a) => a.setsDone !== null && a.setsDone !== undefined);
    day.resolution = { outcome: 'completed', note: String(input.note || ''), cycleAdvanced: true, resolvedAt: (now || new Date()).toISOString() };
    // 完成度定档：全部达标 → completed；练了一部分 → partial；没练也算完成（用户主动收尾）
    day.status = allDone || !touched ? 'completed' : 'partial';
    day.pausedAt = null;
    day.revision += 1;
    const tpl = templateById(state, day.templateId);
    if (tpl) advanceCycle(state, tpl, day.dayKey, 'advanced', date, now);
    pushEvent(state, { date, type: 'completed', templateId: day.templateId, note: '训练日完成' }, now);
    return { ok: true, day };
  }

  function skipAndAdvance(state, input, now) {
    const date = input.date || businessDate(now);
    const got = requireDay(state, date);
    if (!got.ok) return got;
    const day = got.day;
    if (day.status === 'completed' || day.status === 'skipped') return fail('这一天已经收尾');
    day.resolution = { outcome: 'skipped', note: String(input.note || ''), cycleAdvanced: true, resolvedAt: (now || new Date()).toISOString() };
    day.status = 'skipped';
    day.pausedAt = null;
    day.revision += 1;
    const tpl = templateById(state, day.templateId);
    if (tpl) advanceCycle(state, tpl, day.dayKey, 'advanced', date, now);
    return { ok: true, day };
  }

  /* resolve-day / reopen-day */
  function resolveDay(state, input, now) {
    const got = requireDay(state, input.date || businessDate(now));
    if (!got.ok) return got;
    const day = got.day;
    if (input.status !== undefined && !DAY_STATUSES.includes(input.status)) return fail('状态无效');
    if (input.status && input.status !== day.status) {
      day.status = input.status;
      pushEvent(state, { date: day.date, type: 'corrected', templateId: day.templateId, note: `状态改为 ${STATUS_LABELS[input.status] || input.status}` }, now);
    }
    if (input.note !== undefined) day.resolution = { note: String(input.note || '').slice(0, 4000), resolvedAt: (now || new Date()).toISOString() };
    day.revision += 1;
    return { ok: true, day };
  }

  function reopenDay(state, input, now) {
    const got = requireDay(state, input.date || businessDate(now));
    if (!got.ok) return got;
    const day = got.day;
    if (day.status !== 'completed' && day.status !== 'skipped' && day.status !== 'partial') {
      return fail('只有已收尾或部分完成的训练日可以重开');
    }
    day.status = 'in-progress';
    day.resolution = null;
    day.pausedAt = null;
    day.revision += 1;
    pushEvent(state, { date: day.date, type: 'reset', templateId: day.templateId, note: '重开训练日' }, now);
    return { ok: true, day };
  }

  /* select-cycle-day：手动把轮转指针指到某个训练日 */
  function selectCycleDay(state, input, now) {
    const tpl = templateById(state, input.templateId);
    if (!tpl) return fail('模板不存在');
    const version = currentVersion(tpl);
    if (!version.days.some((d) => d.dayKey === input.dayKey)) return fail('训练日不存在');
    const cycle = state.cycle[tpl.id];
    const from = cycle.currentDayKey;
    cycle.currentDayKey = input.dayKey;
    cycle.revision += 1;
    cycle.updatedAt = (now || new Date()).toISOString();
    if (from !== input.dayKey) {
      pushEvent(state, { date: businessDate(now), type: 'corrected', templateId: tpl.id, fromDayKey: from, toDayKey: input.dayKey, note: '手动选择训练日' }, now);
    }
    return { ok: true, cycle };
  }

  /* record-progress-decision：记录身体指标/动作对比的主观决策 */
  function recordProgressDecision(state, input, now) {
    if (!input || !input.note || !String(input.note).trim()) return fail('决策内容不能为空');
    if (String(input.note).length > 4000) return fail('决策内容过长');
    const entry = {
      id: uid('pgd'), templateId: input.templateId || null, actionKey: input.actionKey || null,
      note: String(input.note).trim(), at: (now || new Date()).toISOString()
    };
    state.progress.push(entry);
    return { ok: true, entry };
  }

  /* ---------- 查询 ---------- */
  /* 当天视图：已有记录用记录；否则用轮转指针生成预览（不落库） */
  function todayPlan(state, date) {
    const existing = dayRecord(state, date);
    if (existing) return { day: existing, preview: false };
    const tpl = state.templates
      .map((t) => ({ t, c: state.cycle[t.id] }))
      .filter((x) => x.c)
      .sort((a, b) => (b.c.updatedAt || '').localeCompare(a.c.updatedAt || ''))[0];
    if (!tpl) return { day: null, preview: false };
    const version = currentVersion(tpl.t);
    const planDay = version && version.days.find((d) => d.dayKey === tpl.c.currentDayKey);
    if (!planDay) return { day: null, preview: false };
    return {
      day: {
        date, templateId: tpl.t.id, templateRevision: tpl.t.currentRevision, dayKey: planDay.dayKey,
        name: planDay.name, bodyPart: planDay.bodyPart, isRest: !!planDay.isRest, note: planDay.note || '',
        status: 'not-started', totalSeconds: 0, actions: planDay.actions.map((a) => ({
          actionKey: a.actionKey, name: a.name, plannedSets: a.plannedSets,
          plannedRepsText: a.plannedRepsText, plannedWeightText: a.plannedWeightText,
          targetText: a.targetText, setsDone: null, repsText: '', weightKg: null, durationMinutes: null, note: ''
        }))
      },
      preview: true, templateName: tpl.t.name
    };
  }

  /* 进步对比：同一动作上一次的实际数据 → 本次应超越的基线与差值 */
  function lastActual(state, templateId, actionKey, beforeDate) {
    const dates = Object.keys(state.days).filter((d) => d < beforeDate)
      .filter((d) => state.days[d].templateId === templateId)
      .sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      const day = state.days[dates[i]];
      if (day.status === 'skipped') continue;
      const act = (day.actions || []).find((a) => a.actionKey === actionKey);
      if (act && (act.setsDone !== null || act.weightKg !== null || act.repsText)) {
        return { date: dates[i], action: act };
      }
    }
    return null;
  }
  function progressDelta(state, templateId, actionKey, date, current) {
    const last = lastActual(state, templateId, actionKey, date);
    if (!last) return null;
    const cur = current || { setsDone: null, repsText: '', weightKg: null };
    const wCur = typeof cur.weightKg === 'number' ? cur.weightKg : null;
    const wLast = typeof last.action.weightKg === 'number' ? last.action.weightKg : null;
    const sCur = typeof cur.setsDone === 'number' ? cur.setsDone : null;
    const sLast = typeof last.action.setsDone === 'number' ? last.action.setsDone : null;
    return {
      lastDate: last.date,
      last: { setsDone: sLast, repsText: last.action.repsText || '', weightKg: wLast },
      delta: {
        weightKg: wCur !== null && wLast !== null ? Math.round((wCur - wLast) * 10) / 10 : null,
        setsDone: sCur !== null && sLast !== null ? sCur - sLast : null
      }
    };
  }

  /* 训练量：组数 × 平均次数 × 负重。自重（未填负重）按 0 计入容量，但计入组数与时长。 */
  function avgReps(text) {
    const nums = String(text || '').match(/\d+(\.\d+)?/g);
    if (!nums || !nums.length) return null;
    return nums.reduce((a, b) => a + Number(b), 0) / nums.length;
  }
  function volumeOf(day) {
    let volume = 0, sets = 0;
    for (const a of day.actions || []) {
      const done = typeof a.setsDone === 'number' ? a.setsDone : 0;
      sets += done;
      const reps = avgReps(a.repsText) || avgReps(a.plannedRepsText);
      const weight = typeof a.weightKg === 'number' ? a.weightKg : 0;
      if (reps) volume += done * reps * weight;
    }
    return { sets, volume: Math.round(volume * 10) / 10 };
  }

  /* 近 N 天汇总 */
  function statsSummary(state, today, days) {
    const from = addDays(today, -(days - 1));
    const dates = Object.keys(state.days).filter((d) => d >= from && d <= today).sort();
    let completed = 0, skipped = 0, partial = 0, seconds = 0, volume = 0, sets = 0;
    for (const d of dates) {
      const day = state.days[d];
      if (day.status === 'completed') completed++;
      else if (day.status === 'skipped') skipped++;
      else if (day.status === 'partial') partial++;
      seconds += day.totalSeconds || 0;
      const v = volumeOf(day);
      volume += v.volume; sets += v.sets;
    }
    return { days: dates.length, completed, skipped, partial, seconds, volume: Math.round(volume), sets };
  }

  /* ---------- 进步可视化：肌群评分（移植自 training-metrics.ts，算法保真） ---------- */
  const DEFAULT_WEEKLY_SET_TARGET = 10;
  const MUSCLE_DEFINITIONS = [
    { key: 'shoulders', label: '肩部', view: 'both' },
    { key: 'chest', label: '胸部', view: 'front' },
    { key: 'back', label: '背部', view: 'back' },
    { key: 'biceps', label: '肱二头肌', view: 'front' },
    { key: 'triceps', label: '肱三头肌', view: 'back' },
    { key: 'forearms', label: '前臂', view: 'both' },
    { key: 'core', label: '核心', view: 'front' },
    { key: 'glutes', label: '臀部', view: 'back' },
    { key: 'quadriceps', label: '股四头肌', view: 'front' },
    { key: 'hamstrings', label: '腿后侧', view: 'back' },
    { key: 'calves', label: '小腿', view: 'both' }
  ];
  const ACTION_RULES = [
    { pattern: /卧推|推胸|俯卧撑|飞鸟|夹胸|chest\s*press|bench\s*press/iu, weights: { chest: 1, triceps: 0.5, shoulders: 0.5 } },
    { pattern: /推举|肩推|侧平举|前平举|反向飞鸟|face\s*pull|overhead\s*press/iu, weights: { shoulders: 1, triceps: 0.5 } },
    { pattern: /引体|下拉|划船|高位下拉|pull.?up|row/iu, weights: { back: 1, biceps: 0.5, forearms: 0.5 } },
    { pattern: /硬拉|deadlift/iu, weights: { hamstrings: 1, glutes: 1, back: 0.5, forearms: 0.5 } },
    { pattern: /深蹲|腿举|腿屈伸|箭步|弓步|squat|leg\s*press|lunge/iu, weights: { quadriceps: 1, glutes: 0.5, hamstrings: 0.5 } },
    { pattern: /腿弯举|腘绳|腿后|leg\s*curl/iu, weights: { hamstrings: 1 } },
    { pattern: /臀推|臀桥|hip\s*thrust|glute\s*bridge/iu, weights: { glutes: 1, hamstrings: 0.5 } },
    { pattern: /弯举|二头|curl/iu, weights: { biceps: 1, forearms: 0.5 } },
    { pattern: /三头|下压|臂屈伸|skull\s*crusher|pushdown/iu, weights: { triceps: 1 } },
    { pattern: /腕弯举|小臂|前臂|握力|wrist|grip/iu, weights: { forearms: 1 } },
    { pattern: /卷腹|腹轮|平板|核心|侧桥|crunch|plank/iu, weights: { core: 1 } },
    { pattern: /提踵|小腿|calf/iu, weights: { calves: 1 } }
  ];

  function round(value, digits = 1) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }
  function clamp(value, min = 0, max = 100) {
    return Math.min(max, Math.max(min, value));
  }
  function shiftDate(dateStr, days) {
    return addDays(dateStr, days);
  }
  function numericValues(text, maximum) {
    return (String(text || '').match(/\d+(?:\.\d+)?/gu) ?? [])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0 && value <= maximum);
  }
  function repeatOrPad(values, count) {
    if (!values.length || count <= 0) return [];
    if (values.length === 1) return Array.from({ length: count }, () => values[0]);
    return Array.from({ length: count }, (_, index) => values[index] ?? values[values.length - 1]);
  }
  /* Brzycki(≤8 次，≤10 次区间内最准) 与 Epley(高次数偏 high 估) 的混合：
     9–10 次取两式平均，消除各自在区间上端的系统性偏差（LeSuer 1997：公式精度随动作而异，±5% 仅在 ≤10 次到力竭时成立） */
  function estimateE1rmKg(weightKg, repetitions) {
    if (weightKg <= 0 || repetitions < 1 || repetitions > 10) return null;
    if (repetitions <= 8) return round(weightKg * 36 / (37 - repetitions));
    const brzycki = weightKg * 36 / (37 - repetitions);
    const epley = weightKg * (1 + repetitions / 30);
    return round((brzycki + epley) / 2);
  }
  function summarizeTrainingSet(sets, repsText, weightText) {
    const safeSets = Math.max(0, Math.min(sets, 100));
    const rawReps = numericValues(repsText, 100);
    const repsBySet = repeatOrPad(rawReps, safeSets);
    const totalReps = rawReps.length === 1 && safeSets > 1
      ? rawReps[0] * safeSets
      : repsBySet.reduce((total, value) => total + value, 0);
    const pounds = /(?:\blb\b|lbs|磅)/iu.test(weightText);
    const rawWeights = numericValues(weightText, 2000).map((value) => (pounds ? value * 0.45359237 : value));
    const weightsBySet = repeatOrPad(rawWeights, safeSets);
    const averageWeightKg = weightsBySet.length > 0
      ? round(weightsBySet.reduce((total, value) => total + value, 0) / weightsBySet.length)
      : null;
    const maxWeightKg = weightsBySet.length > 0 ? round(Math.max(...weightsBySet)) : null;
    const loadVolumeKg = weightsBySet.length > 0 && repsBySet.length > 0
      ? round(weightsBySet.reduce((total, weight, index) => total + weight * (repsBySet[index] ?? 0), 0))
      : null;
    const estimates = weightsBySet
      .map((weight, index) => estimateE1rmKg(weight, repsBySet[index] ?? 0))
      .filter((value) => value !== null);
    return {
      totalReps, averageWeightKg, maxWeightKg, loadVolumeKg,
      averageReps: repsBySet.length > 0 ? round(totalReps / repsBySet.length, 1) : null,
      bestE1rmKg: estimates.length > 0 ? round(Math.max(...estimates)) : null
    };
  }
  /* 动作名 → 肌群权重：主肌群 1，辅助 0.5；匹配不到再按训练日名称推断 */
  function inferMuscleWeights(actionName, dayLabel) {
    const rule = ACTION_RULES.find((r) => r.pattern.test(actionName));
    if (rule) return rule.weights;
    const label = `${dayLabel || ''} ${actionName}`;
    const result = {};
    if (/肩|三角/u.test(label)) result.shoulders = 1;
    if (/胸/u.test(label)) result.chest = 1;
    if (/背|斜方|背阔/u.test(label)) result.back = 1;
    if (/二头/u.test(label)) result.biceps = result.biceps ?? 0.5;
    if (/三头/u.test(label)) result.triceps = result.triceps ?? 0.5;
    if (/小臂|前臂/u.test(label)) result.forearms = result.forearms ?? 0.5;
    if (/腹|核心/u.test(label)) result.core = 1;
    if (/臀/u.test(label)) result.glutes = 1;
    if (/股四/u.test(label)) result.quadriceps = 1;
    if (/腘绳|腿后/u.test(label)) result.hamstrings = 1;
    if (/小腿/u.test(label)) result.calves = 1;
    if (/腿/u.test(label) && !result.quadriceps && !result.hamstrings && !result.calves) {
      result.quadriceps = 1;
      result.hamstrings = 0.5;
      result.glutes = result.glutes ?? 0.5;
    }
    return result;
  }
  function createWindowStats() {
    return {
      sets: 0, stimSets: 0, loadVolumeKg: 0, dates: new Set(), actions: new Set(),
      e1rmByAction: new Map(), loadByAction: new Map(), lastTrainedAt: null
    };
  }
  /* 记录每动作前两高的估算值：趋势用 top-2 平均，抗单次偶然波动 */
  function recordBest(target, action, value, muscleWeight) {
    if (value === null) return;
    const existing = target.get(action);
    if (!existing) { target.set(action, { best: value, second: null, muscleWeight }); return; }
    if (value > existing.best) {
      existing.second = existing.best;
      existing.best = value;
    } else if (existing.second === null || value > existing.second) {
      existing.second = value;
    }
  }
  function collapseTop2(map) {
    const out = new Map();
    for (const [action, rec] of map) {
      out.set(action, { value: rec.second !== null ? (rec.best + rec.second) / 2 : rec.best, muscleWeight: rec.muscleWeight, best: rec.best });
    }
    return out;
  }
  function weightedTrend(current, previous) {
    let total = 0, weights = 0;
    for (const [action, point] of current) {
      const baseline = previous.get(action);
      if (!baseline || baseline.value <= 0) continue;
      const weight = Math.min(point.muscleWeight, baseline.muscleWeight);
      total += clamp(point.value / baseline.value - 1, -0.5, 0.5) * weight;
      weights += weight;
    }
    return weights > 0 ? total / weights : null;
  }
  function trendScore(change, hasCurrent) {
    if (change === null) return hasCurrent ? 50 : 0;
    return clamp(50 + change * 100);
  }
  /* 周组数完成度：分段曲线替代硬封顶（剂量反应为连续曲线，10–20 组为推荐带，
     过量缓慢回落体现恢复成本：Schoenfeld 2017 / Baz-Valle 2022） */
  function setCompletionScore(weeklyStimSets) {
    if (weeklyStimSets <= 0) return 0;
    if (weeklyStimSets < 10) return clamp(weeklyStimSets / 10 * 90);
    if (weeklyStimSets <= 20) return clamp(90 + (weeklyStimSets - 10));
    return clamp(Math.max(85, 100 - (weeklyStimSets - 20)));
  }
  /* 次数区间 × 刺激性质折算：5–30 次全额（肌肥大有效区间），
     1–4 次主要训练神经与力量 → 0.6；>30 次偏耐力 → 0.7；未记次数 0.85 */
  function repStimMultiplier(averageReps) {
    if (averageReps === null || averageReps === undefined) return 0.85;
    if (averageReps >= 5 && averageReps <= 30) return 1;
    if (averageReps < 5) return 0.6;
    return 0.7;
  }
  /* 从训练日快照构造观测数据（跳过已跳过的日子；只统计有实际数据的动作） */
  function collectObservations(state, asOfDate) {
    const observations = [];
    for (const date of Object.keys(state.days)) {
      if (asOfDate && date > asOfDate) continue;
      const day = state.days[date];
      if (day.status === 'skipped') continue;
      for (const a of day.actions || []) {
        const sets = a.setsDone === null || a.setsDone === undefined ? 0 : a.setsDone;
        if (sets <= 0 && !a.repsText && (a.weightKg === null || a.weightKg === undefined)) continue;
        observations.push({
          businessDate: date,
          dayLabel: day.name || '',
          actionName: a.name,
          sets: sets > 0 ? sets : 0,
          repsText: a.repsText || '',
          weightText: a.weightKg !== null && a.weightKg !== undefined ? `${a.weightKg}kg` : ''
        });
      }
    }
    return observations;
  }
  /* 综合评分：增肌刺激 0.6×组数完成 + 0.25×容量趋势 + 0.15×频率；
     力量趋势 0.7×e1RM变化 + 0.2×重量变化 + 0.1×频率；综合 = 0.45/0.45/0.1 或 0.85/0.15 */
  function buildMuscleProgress(observations, asOfDate) {
    const recentStart = shiftDate(asOfDate, -27);
    const previousStart = shiftDate(asOfDate, -55);
    const previousEnd = shiftDate(asOfDate, -28);
    const windows = new Map(MUSCLE_DEFINITIONS.map((d) => [d.key, { recent: createWindowStats(), previous: createWindowStats() }]));
    for (const observation of observations) {
      const period = observation.businessDate >= recentStart && observation.businessDate <= asOfDate
        ? 'recent'
        : observation.businessDate >= previousStart && observation.businessDate <= previousEnd
          ? 'previous'
          : null;
      if (!period || observation.sets <= 0) continue;
      const summary = summarizeTrainingSet(observation.sets, observation.repsText, observation.weightText);
      const muscleWeights = inferMuscleWeights(observation.actionName, observation.dayLabel);
      for (const [key, muscleWeight] of Object.entries(muscleWeights)) {
        const stats = windows.get(key)[period];
        stats.sets += observation.sets * muscleWeight;
        stats.stimSets += observation.sets * muscleWeight * repStimMultiplier(summary.averageReps);
        stats.dates.add(observation.businessDate);
        stats.actions.add(observation.actionName);
        stats.loadVolumeKg += (summary.loadVolumeKg ?? 0) * muscleWeight;
        stats.lastTrainedAt = !stats.lastTrainedAt || observation.businessDate > stats.lastTrainedAt
          ? observation.businessDate : stats.lastTrainedAt;
        recordBest(stats.e1rmByAction, observation.actionName, summary.bestE1rmKg, muscleWeight);
        recordBest(stats.loadByAction, observation.actionName, summary.maxWeightKg, muscleWeight);
      }
    }
    return MUSCLE_DEFINITIONS.map((definition) => {
      const { recent, previous } = windows.get(definition.key);
      const recentE1rm = collapseTop2(recent.e1rmByAction);
      const previousE1rm = collapseTop2(previous.e1rmByAction);
      const recentLoad = collapseTop2(recent.loadByAction);
      const previousLoad = collapseTop2(previous.loadByAction);
      const e1rmChange = weightedTrend(recentE1rm, previousE1rm);
      const loadChange = weightedTrend(recentLoad, previousLoad);
      const weeklyStimSets = recent.stimSets / 4;
      const setCompletion = setCompletionScore(weeklyStimSets);
      const frequencyScore = clamp(recent.dates.size / 8 * 100);
      const volumeChange = previous.loadVolumeKg > 0
        ? clamp(recent.loadVolumeKg / previous.loadVolumeKg - 1, -0.5, 0.5)
        : null;
      const volumeScore = trendScore(volumeChange, recent.loadVolumeKg > 0);
      const hypertrophyScore = recent.sets > 0
        ? round(0.6 * setCompletion + 0.25 * volumeScore + 0.15 * frequencyScore, 0)
        : 0;
      const hasStrengthData = recentE1rm.size > 0;
      const strengthScore = hasStrengthData
        ? round(0.7 * trendScore(e1rmChange, true) + 0.2 * trendScore(loadChange, recentLoad.size > 0) + 0.1 * frequencyScore, 0)
        : null;
      const overallScore = strengthScore === null
        ? round(0.85 * hypertrophyScore + 0.15 * frequencyScore, 0)
        : round(0.45 * strengthScore + 0.45 * hypertrophyScore + 0.1 * frequencyScore, 0);
      const bestE1rm = [...recentE1rm.entries()].sort((a, b) => b[1].best - a[1].best)[0] ?? null;
      const actions = [...new Set([...recent.actions, ...previous.actions])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const lastTrainedAt = [recent.lastTrainedAt, previous.lastTrainedAt].filter((v) => v !== null).sort().at(-1) ?? null;
      const pairedActions = [...recentE1rm.keys()].filter((action) => previousE1rm.has(action)).length;
      const confidence = recent.sets <= 0
        ? 'none'
        : recent.dates.size >= 4 && previous.dates.size >= 2 && pairedActions > 0
          ? 'good'
          : 'limited';
      return {
        key: definition.key, label: definition.label, view: definition.view,
        recentSets: round(recent.sets), previousSets: round(previous.sets),
        recentSessions: recent.dates.size,
        recentLoadVolumeKg: recent.loadVolumeKg > 0 ? round(recent.loadVolumeKg) : null,
        bestE1rmKg: bestE1rm ? bestE1rm[1].best : null,
        bestE1rmAction: bestE1rm ? bestE1rm[0] : null,
        strengthChangePercent: e1rmChange === null ? null : round(e1rmChange * 100),
        loadChangePercent: loadChange === null ? null : round(loadChange * 100),
        strengthScore, hypertrophyScore, overallScore,
        frequencyScore: round(frequencyScore, 0), confidence, lastTrainedAt, actions
      };
    });
  }
  function muscleProgress(state, asOfDate) {
    return buildMuscleProgress(collectObservations(state, asOfDate), asOfDate);
  }

  /* ---------- 查询：历史分页 / 周日历 / 模板版本史 / 生效版本 ---------- */
  function historyEntries(state, page, pageSize) {
    const sorted = Object.keys(state.days).sort().reverse();
    const total = sorted.length;
    const start = (Math.max(1, page) - 1) * pageSize;
    return { total, entries: sorted.slice(start, start + pageSize).map((d) => state.days[d]) };
  }
  function weekDates(date) {
    if (!isBusinessDate(date)) return [];
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
    const monday = addDays(date, -((weekday + 6) % 7));
    return Array.from({ length: 7 }, (_, offset) => addDays(monday, offset));
  }
  function calendarRecords(state, date) {
    return weekDates(date).map((d) => state.days[d] || null);
  }
  function templateHistory(state) {
    const rows = [];
    for (const t of state.templates) {
      for (const v of t.versions) {
        rows.push({ templateId: t.id, name: t.name, revision: v.revision, effectiveFrom: v.effectiveFrom, changeNote: v.changeNote, createdAt: v.createdAt });
      }
    }
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.revision - a.revision);
  }
  function effectiveTemplate(state, date) {
    const candidates = state.templates
      .map((t) => ({ t, v: [...t.versions].filter((v) => v.effectiveFrom <= date).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.revision - b.revision).at(-1) }))
      .filter((x) => x.v)
      .sort((a, b) => String(b.t.updatedAt || '').localeCompare(String(a.t.updatedAt || '')));
    return candidates.length ? candidates[0] : null;
  }

  /* ---------- 成长曲线（移植自 trends-query.ts，公式保真） ---------- */
  const VOLUME_SET_WEIGHT = 5;   // 容量分：组数×5 + 次数×0.5（Schoenfeld 2017 / Baz-Valle 2022 剂量反应）
  const VOLUME_REP_WEIGHT = 0.5;
  const RECOMMENDED_WEEKLY_SETS = { min: 10, max: 20 };
  /* "12, 10, 8" 逐组相加；单个数且组数>1 视为每组次数（"10"×3组=30） */
  function parseRepsText(repsText, sets) {
    const numbers = (String(repsText || '').match(/\d+/gu) ?? []).map(Number).filter((value) => value > 0 && value <= 100);
    if (!numbers.length) return 0;
    if (numbers.length === 1 && sets > 1 && numbers[0] <= 50) return numbers[0] * sets;
    return numbers.slice(0, Math.max(sets, numbers.length)).reduce((total, value) => total + value, 0);
  }
  function computeVolume(sets, reps) {
    return Math.round((sets * VOLUME_SET_WEIGHT + reps * VOLUME_REP_WEIGHT) * 10) / 10;
  }
  function mondayOf(dateStr) {
    const date = new Date(`${dateStr}T12:00:00+08:00`);
    const weekday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - weekday);
    return date.toISOString().slice(0, 10);
  }
  function shiftWeek(weekStart, n) {
    const date = new Date(`${weekStart}T12:00:00+08:00`);
    date.setUTCDate(date.getUTCDate() + n * 7);
    return date.toISOString().slice(0, 10);
  }
  const BODY_PART_KEYWORDS = ['胸', '肩', '背', '腿', '手臂', '二头', '三头', '核心', '腹', '臀', '有氧'];
  function normalizeBodyPart(raw, dayName) {
    const label = String(raw || '').trim() || String(dayName || '').trim();
    if (!label) return '未分类';
    for (const keyword of BODY_PART_KEYWORDS) {
      if (label.includes(keyword)) return keyword === '二头' || keyword === '三头' ? '手臂' : keyword;
    }
    return label;
  }
  function trendsSnapshot(state, asOfDate, weekCountInput) {
    const weekCount = Math.max(4, Math.min(weekCountInput ?? 12, 52));
    const currentWeekStart = mondayOf(asOfDate);
    const weeks = [];
    for (let i = weekCount - 1; i >= 0; i--) weeks.push(shiftWeek(currentWeekStart, -i));
    const weekIndex = new Map(weeks.map((week, index) => [week, index]));
    const sessions = [];
    const observations = [];
    for (const date of Object.keys(state.days).sort()) {
      if (date < weeks[0] || date > asOfDate) continue;
      const day = state.days[date];
      if (day.isRest || day.status === 'skipped') continue;
      let sets = 0, reps = 0, loadVolumeKg = 0, hasLoadVolume = false, bestE1rmKg = null;
      const actionSummary = [];
      for (const a of day.actions || []) {
        const actualSets = a.setsDone === null || a.setsDone === undefined ? 0 : a.setsDone;
        if (actualSets <= 0 && !a.repsText && (a.weightKg === null || a.weightKg === undefined)) continue;
        const actionReps = parseRepsText(a.repsText, actualSets);
        const metrics = summarizeTrainingSet(actualSets, a.repsText, a.weightKg !== null && a.weightKg !== undefined ? `${a.weightKg}kg` : '');
        sets += actualSets;
        reps += actionReps;
        if (metrics.loadVolumeKg !== null) { loadVolumeKg += metrics.loadVolumeKg; hasLoadVolume = true; }
        if (metrics.bestE1rmKg !== null) bestE1rmKg = bestE1rmKg === null ? metrics.bestE1rmKg : Math.max(bestE1rmKg, metrics.bestE1rmKg);
        actionSummary.push({ name: a.name, sets: actualSets, reps: actionReps, weightKg: metrics.averageWeightKg, loadVolumeKg: metrics.loadVolumeKg, e1rmKg: metrics.bestE1rmKg });
        observations.push({ businessDate: date, dayLabel: `${day.bodyPart || ''} ${day.name || ''}`, actionName: a.name, sets: actualSets, repsText: a.repsText || '', weightText: a.weightKg !== null && a.weightKg !== undefined ? `${a.weightKg}kg` : '' });
      }
      if (!actionSummary.length) continue;
      sessions.push({
        businessDate: date, weekStart: mondayOf(date), bodyPart: normalizeBodyPart(day.bodyPart, day.name),
        dayName: day.name, sets, reps, volume: computeVolume(sets, reps),
        loadVolumeKg: hasLoadVolume ? Math.round(loadVolumeKg * 10) / 10 : null, bestE1rmKg, actions: actionSummary
      });
    }
    sessions.sort((a, b) => b.businessDate.localeCompare(a.businessDate));
    const aggregated = new Map();
    for (const session of sessions) {
      if (!weekIndex.has(session.weekStart)) continue;
      const index = weekIndex.get(session.weekStart);
      const series = aggregated.get(session.bodyPart) ?? weeks.map((weekStart) => ({ weekStart, sets: 0, reps: 0, sessions: 0, volume: 0 }));
      const point = series[index];
      point.sets += session.sets;
      point.reps += session.reps;
      point.sessions += 1;
      point.volume = computeVolume(point.sets, point.reps);
      aggregated.set(session.bodyPart, series);
    }
    const series = [...aggregated.entries()].map(([bodyPart, points]) => ({
      bodyPart,
      totalSets: points.reduce((total, p) => total + p.sets, 0),
      totalSessions: points.reduce((total, p) => total + p.sessions, 0),
      points
    })).sort((a, b) => b.totalSets - a.totalSets);
    let currentStreakWeeks = 0;
    const weeksWithTraining = new Set(sessions.map((s) => s.weekStart));
    let cursor = weeksWithTraining.has(currentWeekStart) ? currentWeekStart : shiftWeek(currentWeekStart, -1);
    while (weeksWithTraining.has(cursor)) {
      currentStreakWeeks += 1;
      cursor = shiftWeek(cursor, -1);
    }
    return { today: asOfDate, weeks, series, recentSessions: sessions.slice(0, 10), currentStreakWeeks, muscleProgress: buildMuscleProgress(observations, asOfDate) };
  }

  /* ---------- 计时决策与时长追加（P1-1/P1-2：走秒规则集中在 core，便于隔离测试） ---------- */
  /* 只有「今天的、进行中、未暂停」的训练才走秒；补记过去日期不自动计时 */
  function timerShouldRun(day, todayStr) {
    return !!day && day.status === 'in-progress' && !day.pausedAt && day.date === todayStr;
  }
  /* 把表上累计的秒数一次性并入当日时长（只加一次、有界）。
     有效累计区间由调用方保证：timer 只拥有其开始当天的日期（timerShouldRun 门卫），
     跨零点时 UI 的 tick 先落盘再停表，因此本函数不需要 today 参数，也不存在可伪造的 today。 */
  function advanceDaySeconds(state, date, extraSeconds) {
    const got = requireDay(state, date);
    if (!got.ok) return got;
    const day = got.day;
    if (day.status === 'completed' || day.status === 'skipped') return fail('这一天已收尾，不能追加时长');
    if (!Number.isFinite(extraSeconds) || extraSeconds < 0 || extraSeconds > 86400) return fail('追加时长无效');
    day.totalSeconds = Math.round((day.totalSeconds || 0) + extraSeconds);
    day.revision += 1;
    return { ok: true, day };
  }

  /* ---------- 导入（P1-4）：明确结构 → 整体校验 → 原子应用；坏数据不落库 ---------- */
  function importStr(v, min, max) {
    return typeof v === 'string' && v.length >= min && v.length <= max ? v : null;
  }
  function importInt(v, max) {
    return Number.isInteger(v) && v >= 0 && v <= max ? v : null;
  }
  function importCap(v, max) {
    return typeof v === 'string' && v.length <= max ? v : null;
  }
  function importWeightKg(v) {
    return v === null || v === undefined ? null
      : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 ? v : false;
  }
  /* 导入的标识符只允许安全字符集（用于状态键与对比关联，不进 DOM 属性） */
  const IMPORT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
  function importId(v) {
    return typeof v === 'string' && IMPORT_ID_PATTERN.test(v) ? v : null;
  }
  function firstNumber(text) {
    const m = String(text || '').match(/\d+(?:\.\d+)?/);
    const n = m ? Number(m[0]) : NaN;
    return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
  }
  /* 校验整个导入负载；返回 {ok:true, cleaned} 或 {ok:false, error}。失败时不改动 state。 */
  function validateImportPayload(state, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail('导入数据必须是 JSON 对象');
    const hasTemplates = Array.isArray(payload.templates);
    const hasDays = !!payload.days && typeof payload.days === 'object' && !Array.isArray(payload.days);
    if (!hasTemplates && !hasDays) return fail('导入结构无效：需要 { templates: [...] } 或 { days: {...} }（推荐用 scripts/export-strength-from-life-pivot.py 导出）');
    const cleaned = { templates: [], cycle: {}, days: {}, events: [], progress: [] };
    if (hasTemplates) {
      const ids = new Set();
      for (let i = 0; i < payload.templates.length; i++) {
        const t = payload.templates[i];
        if (!t || typeof t !== 'object' || Array.isArray(t)) return fail(`第 ${i + 1} 个模板不是对象`);
        const id = importId(t.id);
        if (!id) return fail(`第 ${i + 1} 个模板 id 无效（仅限字母数字_.:-，1~128 字符）`);
        if (ids.has(id)) return fail(`导入数据里模板 id 重复：${id}`);
        const name = importStr(t.name, 1, 160);
        const rev = importInt(t.currentRevision, MAX_REVISION);
        if (!name || rev === null) return fail(`模板 ${id} 名称或版本号无效`);
        if (!Array.isArray(t.versions) || !t.versions.length) return fail(`模板 ${id} 没有任何版本`);
        const versions = [];
        for (const v of t.versions) {
          if (!v || typeof v !== 'object') return fail(`模板 ${id} 存在无效版本`);
          const vr = importInt(v.revision, MAX_REVISION);
          if (vr === null || !isBusinessDate(v.effectiveFrom)) return fail(`模板 ${id} 版本 ${v.revision} 的生效日期无效`);
          const changeNote = importCap(v.changeNote ?? '', 1000);
          if (changeNote === null) return fail(`模板 ${id} 版本 ${vr} 变更说明过长`);
          if (!Array.isArray(v.days)) return fail(`模板 ${id} 版本 ${vr} 缺训练日数组`);
          const days = [];
          for (const d of v.days) {
            if (!d || typeof d !== 'object') return fail(`模板 ${id} 存在无效训练日`);
            const dk = importStr(d.dayKey, 1, 128);
            const dn = importStr(d.name, 1, 160);
            const bp = importCap(d.bodyPart ?? '', 160);
            const dnote = importCap(d.note ?? '', 4000);
            const dord = importInt(d.ordinal, 100000);
            if (!dk || !dn || bp === null || dnote === null || dord === null) return fail(`模板 ${id} 训练日 ${dn || dk} 字段无效`);
            if (!Array.isArray(d.actions)) return fail(`模板 ${id} 训练日 ${dn} 缺动作数组`);
            const actions = [];
            for (const a of d.actions) {
              if (!a || typeof a !== 'object') return fail(`模板 ${id} 动作数据无效`);
              const ak = importId(a.actionKey);
              const an = importStr(a.name, 1, 200);
              const ps = importInt(a.plannedSets, 10000);
              const prt = importCap(a.plannedRepsText ?? '', 4000);
              const pwt = importCap(a.plannedWeightText ?? '', 4000);
              const tt = importCap(a.targetText ?? '', 1000);
              const ant = importCap(a.note ?? '', 4000);
              const aord = importInt(a.ordinal, 100000);
              if (!ak || !an || ps === null || prt === null || pwt === null || tt === null || ant === null || aord === null) {
                return fail(`模板 ${id} 训练日 ${dn} 动作 ${an || ak} 字段无效`);
              }
              actions.push({ actionKey: ak, name: an, plannedSets: ps, plannedRepsText: prt, plannedWeightText: pwt, targetText: tt, note: ant, ordinal: aord });
            }
            days.push({ dayKey: dk, name: dn, bodyPart: bp, isRest: !!d.isRest, note: dnote, ordinal: dord, actions });
          }
          versions.push({ revision: vr, effectiveFrom: v.effectiveFrom, changeNote, createdAt: importCap(v.createdAt ?? '', 40) || '', days });
        }
        if (!versions.some((v) => v.revision === rev)) return fail(`模板 ${id} currentRevision 没有对应版本`);
        ids.add(id);
        cleaned.templates.push({ id, name, currentRevision: rev, createdAt: importCap(t.createdAt ?? '', 40) || '', updatedAt: importCap(t.updatedAt ?? '', 40) || '', versions });
      }
    }
    if (payload.cycle && typeof payload.cycle === 'object' && !Array.isArray(payload.cycle)) {
      for (const [k, c] of Object.entries(payload.cycle)) {
        if (!importId(k) || !c || typeof c !== 'object' || Array.isArray(c)) return fail('cycle 数据无效');
        const ck = importStr(c.currentDayKey, 1, 128);
        const cr = importInt(c.revision, MAX_REVISION);
        if (!ck || cr === null) return fail(`cycle ${k} 指针无效`);
        cleaned.cycle[k] = { currentDayKey: ck, revision: cr, updatedAt: importCap(c.updatedAt ?? '', 40) || '' };
      }
    }
    if (hasDays) {
      for (const [k, d] of Object.entries(payload.days)) {
        if (!isBusinessDate(k)) return fail(`训练日期无效：${String(k).slice(0, 24)}`);
        if (!d || typeof d !== 'object' || Array.isArray(d)) return fail(`训练日 ${k} 数据无效`);
        const status = typeof d.status === 'string' && DAY_STATUSES.includes(d.status) ? d.status : 'not-started';
        const totalSeconds = d.totalSeconds === undefined || d.totalSeconds === null ? 0 : importInt(d.totalSeconds, 86400 * 366);
        if (totalSeconds === null) return fail(`训练日 ${k} 时长无效`);
        const confMin = d.confirmedDurationMinutes === undefined || d.confirmedDurationMinutes === null
          ? null : importInt(d.confirmedDurationMinutes, 525600);
        if (confMin === false || confMin === undefined) return fail(`训练日 ${k} 确认时长无效`);
        if (!Array.isArray(d.actions)) return fail(`训练日 ${k} 缺动作数组`);
        const actions = [];
        for (const a of d.actions) {
          if (!a || typeof a !== 'object') return fail(`训练日 ${k} 动作数据无效`);
          const ak = importStr(a.actionKey, 1, 128);
          const an = importStr(a.name, 1, 200);
          const ps = a.plannedSets === undefined || a.plannedSets === null ? 0 : importInt(a.plannedSets, 10000);
          const sd = a.setsDone === undefined || a.setsDone === null ? null : importInt(a.setsDone, 10000);
          const prt = importCap(a.repsText ?? '', 4000);
          const pprt = importCap(a.plannedRepsText ?? '', 4000);
          const ppwt = importCap(a.plannedWeightText ?? '', 4000);
          const ptt = importCap(a.targetText ?? '', 1000);
          const wk = importWeightKg(a.weightKg);
          const dm = a.durationMinutes === undefined || a.durationMinutes === null ? null : importInt(a.durationMinutes, 525600);
          const ant = importCap(a.note ?? '', 4000);
          if (!ak || !an || ps === null || (a.setsDone !== undefined && a.setsDone !== null && sd === null)
            || prt === null || pprt === null || ppwt === null || ptt === null || wk === false || dm === undefined || ant === null) {
            return fail(`训练日 ${k} 动作 ${an || ak} 字段无效`);
          }
          actions.push({ actionKey: ak, name: an, plannedSets: ps, plannedRepsText: pprt, plannedWeightText: ppwt, targetText: ptt, setsDone: sd, repsText: prt, weightKg: wk, durationMinutes: dm, note: ant });
        }
        let resolution = null;
        if (d.resolution) {
          if (typeof d.resolution !== 'object' || Array.isArray(d.resolution)) return fail(`训练日 ${k} 收尾决议无效`);
          const rnote = importCap(d.resolution.note ?? '', 4000);
          if (rnote === null) return fail(`训练日 ${k} 收尾备注过长`);
          resolution = { outcome: typeof d.resolution.outcome === 'string' && d.resolution.outcome.length <= 32 ? d.resolution.outcome : 'completed', note: rnote, cycleAdvanced: !!d.resolution.cycleAdvanced, resolvedAt: importCap(d.resolution.resolvedAt ?? '', 40) || '' };
        }
        const dname = importCap(d.name ?? '', 160);
        const dbody = importCap(d.bodyPart ?? '', 160);
        const dnote = importCap(d.note ?? '', 4000);
        const dcomp = importCap(d.completionText ?? '', 4000);
        const snote = importCap((d.supplements || {}).note ?? '', 4000);
        if (dname === null || dbody === null || dnote === null || dcomp === null || snote === null) return fail(`训练日 ${k} 文本字段无效或超长`);
        const supp = d.supplements || {};
        cleaned.days[k] = {
          date: k, templateId: importStr(d.templateId, 1, 128) || '', templateRevision: importInt(d.templateRevision, MAX_REVISION) || 1,
          dayKey: importStr(d.dayKey, 0, 128) || '', name: dname, bodyPart: dbody,
          isRest: !!d.isRest, status, totalSeconds, startedAt: importCap(d.startedAt ?? '', 40) || null, pausedAt: null, revision: 1,
          supplements: { creatineTaken: typeof supp.creatineTaken === 'boolean' ? supp.creatineTaken : null, proteinPowderTaken: typeof supp.proteinPowderTaken === 'boolean' ? supp.proteinPowderTaken : null, note: snote },
          confirmedDurationMinutes: confMin, note: dnote, completionText: dcomp,
          actions, resolution, createdAt: importCap(d.createdAt ?? '', 40) || ''
        };
      }
    }
    for (const key of ['events', 'progress']) {
      const arr = payload[key];
      if (arr === undefined || arr === null) continue;
      if (!Array.isArray(arr)) return fail(`${key} 必须是数组`);
      if (arr.length > 5000) return fail(`${key} 数量超过 5000`);
      for (const e of arr) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) return fail(`${key} 条目无效`);
        const note = importCap(e.note ?? '', 4000);
        if (note === null) return fail(`${key} 备注过长`);
        if (key === 'events' && e.type !== undefined && (typeof e.type !== 'string' || e.type.length > 32)) return fail('事件类型无效');
      }
      cleaned[key] = arr.map((e) => ({ ...e, note: e.note ?? '' }));
    }
    return { ok: true, cleaned };
  }
  /* 校验通过后一次性应用：同 id 模板/同日期跳过，其余整体合并 */
  function applyImportPayload(state, cleaned) {
    let templates = 0, days = 0;
    for (const t of cleaned.templates) {
      if (state.templates.some((x) => x.id === t.id)) continue;
      state.templates.push(t); templates++;
    }
    for (const [k, v] of Object.entries(cleaned.cycle)) {
      if (!state.cycle[k] && state.templates.some((x) => x.id === k)) state.cycle[k] = v;
    }
    for (const [k, v] of Object.entries(cleaned.days)) {
      if (!state.days[k]) { state.days[k] = v; days++; }
    }
    state.events.push(...cleaned.events);
    state.progress.push(...cleaned.progress);
    return { ok: true, templates, days };
  }
  function importFrom(state, payload) {
    const v = validateImportPayload(state, payload);
    if (!v.ok) return v;
    return applyImportPayload(state, v.cleaned);
  }
  /* 旧应用表行结构 → 本应用原生结构（纯转换，不做任何合并；随后仍需 importFrom 校验） */
  function convertLegacyRows(payload) {
    const tplRows = Array.isArray(payload && payload.templates) ? payload.templates : [];
    const verRows = Array.isArray(payload.templateVersions) ? payload.templateVersions : [];
    const dayRows = Array.isArray(payload.templateDays) ? payload.templateDays : [];
    const actRows = Array.isArray(payload.templateActions) ? payload.templateActions : [];
    if (!tplRows.length) return fail('旧格式导入需要 templates 数组');
    const templates = [];
    for (const row of tplRows) {
      if (!row || !importStr(row.id, 1, 128) || !importStr(row.name, 1, 160) || !importInt(row.currentRevision, MAX_REVISION)) {
        return fail('旧格式 templates 行字段无效');
      }
      const versions = verRows.filter((v) => v.templateId === row.id)
        .sort((a, b) => a.revision - b.revision)
        .map((v) => ({
          revision: v.revision, effectiveFrom: String(v.effectiveFrom || '').slice(0, 10),
          changeNote: String(v.changeNote || ''), createdAt: String(v.createdAt || ''),
          days: dayRows.filter((d) => d.templateVersionId === v.id).sort((a, b) => a.ordinal - b.ordinal)
            .map((d) => ({
              dayKey: String(d.dayKey || ''), name: String(d.name || ''), bodyPart: String(d.bodyPart || ''),
              isRest: !!d.isRest, note: String(d.note || ''), ordinal: d.ordinal | 0,
              actions: actRows.filter((a) => a.templateDayId === d.id).sort((a, b) => a.ordinal - b.ordinal)
                .map((a) => ({
                  actionKey: String(a.actionKey || a.name || ''), name: String(a.name || ''),
                  plannedSets: a.plannedSets | 0, plannedRepsText: String(a.plannedRepsText || ''),
                  plannedWeightText: String(a.plannedWeightText || ''), targetText: String(a.targetText || ''),
                  note: String(a.note || ''), ordinal: a.ordinal | 0
                }))
            }))
        }));
      if (!versions.length) continue;
      templates.push({ id: row.id, name: row.name, currentRevision: row.currentRevision, createdAt: String(row.createdAt || ''), updatedAt: String(row.updatedAt || ''), versions });
    }
    const cycle = {};
    for (const row of tplRows) {
      const tpl = templates.find((t) => t.id === row.id);
      const ver = tpl && tpl.versions.find((v) => v.revision === row.currentRevision);
      if (ver && ver.days.length && !cycle[row.id]) {
        cycle[row.id] = { currentDayKey: ver.days[0].dayKey, revision: 1, updatedAt: String(row.updatedAt || '') };
      }
    }
    const days = {};
    const trainRows = Array.isArray(payload.trainingDays) ? payload.trainingDays : [];
    const trainActRows = Array.isArray(payload.trainingActions) ? payload.trainingActions : [];
    const resRows = Array.isArray(payload.dayResolutions) ? payload.dayResolutions : [];
    for (const row of trainRows) {
      const date = String(row.businessDate || '').slice(0, 10);
      if (days[date]) continue;
      days[date] = {
        date, templateId: String(row.templateId || ''), templateRevision: row.templateRevision | 0 || 1,
        dayKey: String(row.dayKey || ''), name: String(row.name || ''), bodyPart: '', isRest: false, note: '',
        status: typeof row.status === 'string' ? row.status : 'not-started',
        totalSeconds: Math.round((row.durationMinutes || 0) * 60),
        startedAt: row.startedAt ? String(row.startedAt) : null, pausedAt: null, revision: 1,
        supplements: { creatineTaken: null, proteinPowderTaken: null, note: '' },
        confirmedDurationMinutes: null, completionText: '',
        actions: trainActRows.filter((a) => a.dayId === row.id).map((a) => ({
          actionKey: String(a.actionKey || a.name || ''), name: String(a.name || ''), plannedSets: a.plannedSets | 0,
          plannedRepsText: String(a.plannedRepsText || ''), plannedWeightText: String(a.plannedWeightText || ''),
          targetText: '', setsDone: a.setsDone === undefined || a.setsDone === null ? null : a.setsDone,
          repsText: String(a.repsText || ''),
          weightKg: typeof a.weightKg === 'number' && Number.isFinite(a.weightKg) ? a.weightKg : firstNumber(a.actualWeightText),
          durationMinutes: a.durationMinutes === undefined ? null : a.durationMinutes, note: String(a.note || '')
        })),
        resolution: resRows.filter((x) => x.dayId === row.id || x.businessDate === row.businessDate)
          .map((x) => ({ outcome: 'completed', note: String(x.note || ''), cycleAdvanced: true, resolvedAt: String(x.resolvedAt || row.updatedAt || '') }))[0] || null,
        createdAt: String(row.createdAt || '')
      };
    }
    return { ok: true, native: { templates, cycle, days, events: [], progress: [] } };
  }

  const api = {
    DAY_STATUSES, STATUS_LABELS,
    isBusinessDate, businessDate, addDays,
    normalize, emptyState, validateTemplateInput,
    templateById, currentVersion, versionOf,
    replaceTemplate, selectCycleDay,
    startTraining, pauseTraining, resumeTraining, saveTraining,
    finishAndAdvance, skipAndAdvance, resolveDay, reopenDay,
    recordProgressDecision,
    todayPlan, dayRecord, lastActual, progressDelta, volumeOf, statsSummary,
    DEFAULT_WEEKLY_SET_TARGET, MUSCLE_DEFINITIONS,
    estimateE1rmKg, summarizeTrainingSet, inferMuscleWeights,
    setCompletionScore, repStimMultiplier,
    collectObservations, buildMuscleProgress, muscleProgress,
    timerShouldRun, advanceDaySeconds,
    validateImportPayload, applyImportPayload, importFrom, convertLegacyRows,
    historyEntries, weekDates, calendarRecords, templateHistory, effectiveTemplate,
    VOLUME_SET_WEIGHT, VOLUME_REP_WEIGHT, RECOMMENDED_WEEKLY_SETS,
    parseRepsText, computeVolume, mondayOf, shiftWeek, normalizeBodyPart, trendsSnapshot
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StrengthCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
