/* 力量训练领域核心 —— 从「个人积累库」健身板块移植（v0.26.1 manual-exercise）
   保留的迭代精华：
   - 模板 → 版本 → 训练日 → 动作 四层模型，改版出快照、历史不可变
   - 训练日状态机 not-started → in-progress → partial / completed / skipped（含收尾决议与重开）
   - 周期轮转（完成/跳过自动进入下一训练日）+ 审计事件
   - 计划 vs 实际分离与进步对比
   - 业务日期用本地时区（原 Asia/Shanghai 口径已统一，跨时区使用不再错位）
   舍弃（不适用于本应用）：幂等键表、冻结提交、服务器端乐观锁——
   本应用为单窗口 JSON 文档 + 防抖落盘 + 退出同步落盘，已有等价保障；
   各记录保留 revision 便于将来扩展。 */
(function (root) {
  'use strict';

  /* 餐后锻炼时机（2026-09-26）依赖：规则阈值取自证据注册表 rhythm-evidence，
     餐别分类与时刻文案复用 rhythm-engine（index.html 中二者均先于本文件加载；node 测试按相对路径 require）。 */
  const E = typeof module !== 'undefined' && module.exports ? require('./rhythm-evidence') : root.RhythmEvidence;
  const RE = typeof module !== 'undefined' && module.exports ? require('./rhythm-engine') : root.RhythmEngine;

  const DAY_STATUSES = ['not-started', 'in-progress', 'partial', 'completed', 'skipped'];
  const STATUS_LABELS = {
    'not-started': '未开始', 'in-progress': '进行中',
    partial: '部分完成', completed: '已完成', skipped: '已跳过'
  };
  const MAX_TEMPLATE_DAYS = 366;
  const MAX_ACTIONS_PER_DAY = 500;
  const MAX_REVISION = 2147483647;
  /* 负重物理上限：与录入 UI（max 2000）及统计解析（numericValues）统一口径，防导入/异常值绕过 */
  const MAX_WEIGHT_KG = 2000;

  /* ---------- 业务日期（本地时区，与瘦脸日志/皮肤/提醒各模块一致；UTC+8 用户行为不变） ---------- */
  function isBusinessDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function businessDate(now) {
    const d = now instanceof Date ? now : (now ? new Date(now) : new Date());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const s = `${d.getFullYear()}-${mm}-${dd}`;
    return isBusinessDate(s) ? s : `${d.getFullYear()}-${mm}-${dd}`;
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
      progress: Array.isArray(src.progress) ? src.progress : [],
      baselines: src.baselines && typeof src.baselines === 'object' ? src.baselines : {},
      adjustments: Array.isArray(src.adjustments) ? src.adjustments : []
    };
    /* 身体档案（身高体重等）随白名单一并保留——此前每次渲染力量页都会把它抹掉，
       营养参考卡与进步可视化的输入会跨页面丢失（02:30 监督复核 P1-1） */
    if (db.profile || src.bmiProfile) s.bmiProfile = db.profile || src.bmiProfile;
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
    return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_WEIGHT_KG);
  }
  /* 负重输入解析（今日表格 + 逐组记录共用）。数字输入框打不进中文，所以这里把「自重 / 徒手 / BW」
     等同义词折算成 0，让两种写法都能进同一套记录机制；本函数只管文本→数值，
     「留空怎么算」由 resolveWeightInput 按有没有练决定。
     库里口径：0 = 明确的自重，null = 这一行没记。返回 { ok: true, value: number | null } 或 { ok: false, error }。 */
  const BW_INPUT_WORDS = ['自重', '徒手', '裸重', '自身体重', '自身重量', '体重', 'bw', 'bodyweight', '非负重', '不加重量'];
  const WEIGHT_INPUT_ERROR = '负重请填数字（kg），自重留空或写「自重」';
  function normalizeWeightText(raw) {
    return String(raw === null || raw === undefined ? '' : raw)
      .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10)) // 全角数字
      .replace(/[．。]/g, '.')
      .toLowerCase()
      .replace(/[\s_、,，]/g, '');
  }
  function parseWeightInput(raw) {
    const text = normalizeWeightText(raw);
    if (!text) return { ok: true, value: null };
    if (/^\d+(?:\.\d+)?(?:kg|千克|公斤)?$/.test(text)) {
      const value = Number(text.replace(/(?:kg|千克|公斤)$/, ''));
      if (!Number.isFinite(value) || value < 0) return { ok: false, error: WEIGHT_INPUT_ERROR };
      if (value > MAX_WEIGHT_KG) return { ok: false, error: `负重最大 ${MAX_WEIGHT_KG}kg` };
      return { ok: true, value };
    }
    if (BW_INPUT_WORDS.some((w) => text.includes(w))) {
      /* 「自重训练」仍是自重；「自重20」「体重60kg」含数字时不能静默记成 0。 */
      if (/\d/.test(text)) return { ok: false, error: WEIGHT_INPUT_ERROR };
      return { ok: true, value: 0 };
    }
    return { ok: false, error: WEIGHT_INPUT_ERROR };
  }
  /* 负重展示：0 一律显示「自重」，未记录返回空串由调用方给文案 */
  function weightLabelKg(v) {
    return typeof v === 'number' && Number.isFinite(v) ? (v === 0 ? '自重' : `${v}kg`) : '';
  }
  /* 保存口径（2026-09-28 起产品决定）：这一行动了（填了完成组数或实际次数）就把留空当自重记，
     因为绝大多数自重动作每次都留空重填太啰嗦；整行没动过仍记 null，避免把没练的动作当成自重记录。
     历史里已有的 null（旧口径的「没记重量」）保持原样，不事后改写。 */
  function resolveWeightInput(raw, hasWork) {
    const parsed = parseWeightInput(raw);
    if (!parsed.ok) return parsed;
    return parsed.value === null ? { ok: true, value: hasWork ? 0 : null } : parsed;
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
    if (!state.cycle || typeof state.cycle !== 'object') state.cycle = {};
    if (!state.cycle[tpl.id] || !state.cycle[tpl.id].currentDayKey) {
      const existingDays = (currentVersion(tpl) || {}).days || [];
      state.cycle[tpl.id] = {
        currentDayKey: (existingDays[0] && existingDays[0].dayKey) || '',
        revision: tpl.currentRevision || 1,
        updatedAt: stamp
      };
    }
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

  /* Defaults are unconfirmed until the user explicitly saves actual data. */
  function trainingBaseline(state, action, date) {
    const saved=state.baselines?.[actionNameKey(action.name)];
    const last=lastActual(state,action.name,date,true)?.action;
    const source=saved&&saved.date<=date?saved:last;
    const weight=parseWeightInput(action.plannedWeightText);
    const planWeight=weight.ok&&weight.value!=null?weight.value:Number(String(action.plannedWeightText||'').match(/\d+(?:\.\d+)?/)?.[0]||0);
    return {setsDone:source?.setsDone??action.plannedSets??0,repsText:source?.repsText||action.plannedRepsText||'0',weightKg:source?.weightKg??planWeight,sets:source?.sets,source:source?'saved':'plan'};
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
    const priorBaselines=new Map(day.actions.map(a=>[a.actionKey,trainingBaseline(state,a,date)]));
    const byKey = new Map(day.actions.map((a) => [a.actionKey, a]));
    for (const patch of patches) {
      const target = byKey.get(patch.actionKey);
      if (!target) return fail(`动作不存在：${patch.actionKey || '(空)'}`);
      if (patch.setsDone !== undefined && patch.setsDone !== null && !isBoundedInt(patch.setsDone, 10000)) return '完成组数无效';
      if (patch.weightKg !== undefined && !validateWeightKg(patch.weightKg)) return '负重数值无效';
      for (const key of ['repsText', 'note']) {
        if (patch[key] !== undefined && typeof patch[key] === 'string' && patch[key].length > 4000) return '备注过长';
      }
      if(patch.sets !== undefined){
        if(!Array.isArray(patch.sets)||patch.sets.length>100||patch.sets.some(s=>!Number.isInteger(s.reps)||s.reps<0||s.reps>999||!validateWeightKg(s.weightKg)))return fail('逐组记录无效');
        target.sets=JSON.parse(JSON.stringify(patch.sets));target.actualSource='per-set';
      } else if(patch.summaryEdited && target.sets && ((patch.setsDone!==undefined&&patch.setsDone!==target.setsDone)||(patch.repsText!==undefined&&patch.repsText!==target.repsText)||(patch.weightKg!==undefined&&patch.weightKg!==target.weightKg))) {
        delete target.sets; target.actualSource='summary';
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
    if(patches.length){
      state.baselines||={};state.adjustments||=[];
      for(const patch of patches){
        if(patch.setsDone===undefined&&patch.repsText===undefined&&patch.weightKg===undefined&&patch.sets===undefined)continue;
        const a=byKey.get(patch.actionKey),before=priorBaselines.get(patch.actionKey);
        const after={setsDone:a.setsDone,repsText:a.repsText,weightKg:a.weightKg,...(a.sets?{sets:JSON.parse(JSON.stringify(a.sets))}:{})};
        const adjustment={id:uid('adjust'),date,actionKey:a.actionKey,name:a.name,savedAt:(now||new Date()).toISOString(),before:{setsDone:before.setsDone,repsText:before.repsText,weightKg:before.weightKg},after};
        state.adjustments.push(adjustment);state.baselines[actionNameKey(a.name)]={...after,date,savedAt:adjustment.savedAt};
      }
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
    const alreadyAdvanced = !!(day.resolution && day.resolution.cycleAdvanced);
    const allDone = day.actions.length > 0 && day.actions.every((a) => a.setsDone !== null && a.setsDone !== undefined && a.setsDone >= a.plannedSets);
    const touched = day.actions.some((a) => a.setsDone !== null && a.setsDone !== undefined);
    day.resolution = { outcome: 'completed', note: String(input.note || ''), cycleAdvanced: true, resolvedAt: (now || new Date()).toISOString() };
    // 完成度定档：全部达标 → completed；练了一部分 → partial；没练也算完成（用户主动收尾）
    day.status = allDone || !touched ? 'completed' : 'partial';
    day.pausedAt = null;
    day.revision += 1;
    const tpl = templateById(state, day.templateId);
    if (tpl && !alreadyAdvanced) advanceCycle(state, tpl, day.dayKey, 'advanced', date, now);
    pushEvent(state, { date, type: 'completed', templateId: day.templateId, note: '训练日完成' }, now);
    return { ok: true, day };
  }

  function skipAndAdvance(state, input, now) {
    const date = input.date || businessDate(now);
    const got = requireDay(state, date);
    if (!got.ok) return got;
    const day = got.day;
    if (day.status === 'partial') return fail('这一天已经记了训练，要改成跳过请先重开');
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

  /* assign-training-day：把某一天的训练所属改到指定模板+训练日。
     预览日只动轮转指针；已开始未收尾则换成新一天的计划动作（计时保留）。 */
  function assignTrainingDay(state, input, now) {
    const date = input.date || businessDate(now);
    if (!isBusinessDate(date)) return fail('日期格式无效');
    const tpl = templateById(state, input.templateId);
    if (!tpl) return fail('模板不存在');
    const version = currentVersion(tpl);
    const planDay = version && version.days.find((d) => d.dayKey === input.dayKey);
    if (!planDay) return fail('训练日不存在');
    if (!state.cycle[tpl.id]) {
      state.cycle[tpl.id] = { currentDayKey: planDay.dayKey, revision: 0, updatedAt: '' };
    }
    const sel = selectCycleDay(state, { templateId: tpl.id, dayKey: input.dayKey }, now);
    if (!sel.ok) return sel;
    const existing = dayRecord(state, date);
    if (!existing) return { ok: true, preview: true, cycle: sel.cycle };
    if (existing.status === 'completed' || existing.status === 'skipped' || existing.status === 'partial') {
      return fail('这一天已经收尾。先重开，再换所属训练日');
    }
    if (existing.templateId === tpl.id && existing.dayKey === planDay.dayKey) {
      return { ok: true, day: existing, unchanged: true };
    }
    const fromDayKey = existing.dayKey;
    const snap = snapshotDay(state, tpl, date, now);
    existing.templateId = snap.templateId;
    existing.templateRevision = snap.templateRevision;
    existing.dayKey = snap.dayKey;
    existing.name = snap.name;
    existing.bodyPart = snap.bodyPart;
    existing.isRest = snap.isRest;
    existing.actions = snap.actions;
    existing.revision += 1;
    pushEvent(state, {
      date, type: 'corrected', templateId: tpl.id,
      fromDayKey, toDayKey: planDay.dayKey,
      note: `训练所属改为「${tpl.name} · ${planDay.name}」`
    }, now);
    return { ok: true, day: existing };
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
    if (existing) {
      const named = templateById(state, existing.templateId);
      return { day: existing, preview: false, templateName: named ? named.name : '' };
    }
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
  /* 动作按「名字」全库统一匹配（去空格、忽略英文大小写）：同一动作无论出现在哪份模板、
     哪个训练日，重量与次数记录都互通——个人的肌肉水平是跨模板的统一指标，
     换模板（三分化 ↔ 上下分化等）不会断掉「上次」与递进基线。 */
  function actionNameKey(name) {
    return String(name || '').trim().toLowerCase();
  }
  function lastActual(state, actionName, beforeDate, confirmedOnly = false) {
    const key = actionNameKey(actionName);
    if (!key) return null;
    const dates = Object.keys(state.days).filter((d) => d < beforeDate).sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      const day = state.days[dates[i]];
      if (day.status === 'skipped') continue;
      const act = (day.actions || []).find((a) => actionNameKey(a.name) === key);
      // Older start-only records used zero instead of null before any actual save.
      if (confirmedOnly && act && (day.revision || 0) <= 1
        && ['not-started', 'in-progress'].includes(day.status) && act.setsDone === 0
        && !String(act.repsText || '').trim() && act.weightKg == null
        && act.durationMinutes == null && !act.actualSource
        && !(Array.isArray(act.sets) && act.sets.some((s) => s && s.done))) continue;
      if (act && (act.setsDone != null || act.weightKg != null || act.repsText
        || (Array.isArray(act.sets) && act.sets.some((s) => s && s.done)))) {
        return { date: dates[i], action: act };
      }
    }
    return null;
  }
  function progressDelta(state, templateId, actionKey, date, current) {
    /* 兼容旧签名（templateId + actionKey）：先解析出动作名，再走全库统一查找 */
    let actionName = null;
    const tpl = templateById(state, templateId);
    if (tpl) {
      for (const v of tpl.versions) {
        for (const d of v.days || []) {
          const a = (d.actions || []).find((x) => x.actionKey === actionKey);
          if (a) { actionName = a.name; break; }
        }
        if (actionName) break;
      }
    }
    const last = actionName ? lastActual(state, actionName, date) : null;
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

  /* 训练量：组数 × 平均次数 × 负重。自重（记 0 或留空）按 0 计入容量，但计入组数与时长。 */
  /* 「3x8 / 3×8-12」是 组数×次数 写法：次数取 x 后面的部分，避免把组数误读成次数
     （实际数据列同样适用——用户会把手环/计划的组×次数原样抄进次数列） */
  function repsSpecText(text) {
    const m = String(text || '').match(/^\s*\d+\s*[x×*]\s*(.+?)\s*$/);
    return m ? m[1] : String(text || '');
  }
  function avgReps(text) {
    const nums = repsSpecText(text).match(/\d+(\.\d+)?/g);
    if (!nums || !nums.length) return null;
    return nums.reduce((a, b) => a + Number(b), 0) / nums.length;
  }
  function volumeOf(day) {
    let volume = 0, sets = 0;
    for (const a of day.actions || []) {
      if (Array.isArray(a.sets)) {
        /* 逐组记录：容量按已完成组逐组精确求和（不同重量不再因汇总平均口径丢失） */
        const done = a.sets.filter((s) => s && s.done);
        sets += done.length;
        volume += done.reduce((n, s) => n + (Number(s.reps) || 0) * (typeof s.weightKg === 'number' ? s.weightKg : 0), 0);
        continue;
      }
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
  /* 规则按序 first-match：细分族（后束/面拉、直臂上拉、举腿、反屈伸、腕/前臂、挺身）必须排在
     宽泛族（飞鸟、推举、下拉、下压、弯举）之前，否则被抢先归类。
     2026-09-21 审计修订：俯身飞鸟/面拉→肩后束、悬挂举腿→核心、凳上反屈伸→三头、直臂下压→背、
     转腕→前臂、山羊挺身→腘绳、农夫行走→前臂/核心；宽泛族归类保持不变。 */
  const ACTION_RULES = [
    { pattern: /面拉|face\s*pull|俯身.*飞鸟|反向飞鸟|后束|rear\s*delt|reverse\s*fly/iu, weights: { shoulders: 1, back: 0.5 } },
    { pattern: /卧推|推胸|俯卧撑|飞鸟|夹胸|chest\s*press|bench\s*press/iu, weights: { chest: 1, triceps: 0.5, shoulders: 0.5 } },
    { pattern: /推举|肩推|侧平举|前平举|overhead\s*press/iu, weights: { shoulders: 1, triceps: 0.5 } },
    { pattern: /直臂下压|直臂下拉|仰卧上拉|哑铃上拉|pullover/iu, weights: { back: 1, chest: 0.5 } },
    { pattern: /引体|下拉|划船|高位下拉|pull.?up|row/iu, weights: { back: 1, biceps: 0.5, forearms: 0.5 } },
    { pattern: /硬拉|deadlift/iu, weights: { hamstrings: 1, glutes: 1, back: 0.5, forearms: 0.5 } },
    { pattern: /山羊挺身|背屈伸|背伸展|hyperextension|back\s*extension|罗马椅/iu, weights: { hamstrings: 1, glutes: 0.5, back: 0.5 } },
    { pattern: /举腿|leg\s*raise|悬垂/iu, weights: { core: 1 } },
    { pattern: /深蹲|腿举|腿屈伸|箭步|弓步|squat|leg\s*press|lunge/iu, weights: { quadriceps: 1, glutes: 0.5, hamstrings: 0.5 } },
    { pattern: /腿弯举|腘绳|腿后|leg\s*curl/iu, weights: { hamstrings: 1 } },
    { pattern: /臀推|臀桥|hip\s*thrust|glute\s*bridge/iu, weights: { glutes: 1, hamstrings: 0.5 } },
    { pattern: /腕弯举|腕屈伸|转腕|小臂|前臂|握力|wrist|grip/iu, weights: { forearms: 1 } },
    { pattern: /弯举|二头|curl/iu, weights: { biceps: 1, forearms: 0.5 } },
    { pattern: /凳上反屈伸|凳上臂屈伸|双杠|bench\s*dip/iu, weights: { triceps: 1, chest: 0.5 } },
    { pattern: /三头|下压|臂屈伸|反屈伸|skull\s*crusher|pushdown/iu, weights: { triceps: 1 } },
    { pattern: /卷腹|腹轮|平板|核心|侧桥|腹肌|crunch|plank|死虫|鸟狗|转体/iu, weights: { core: 1 } },
    { pattern: /农夫行走|farmer/iu, weights: { forearms: 1, core: 0.5 } },
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
    const rawReps = numericValues(repsSpecText(repsText), 100);
    const repsBySet = repeatOrPad(rawReps, safeSets);
    const totalReps = rawReps.length === 1 && safeSets > 1
      ? rawReps[0] * safeSets
      : repsBySet.reduce((total, value) => total + value, 0);
    const pounds = /(?:\blb\b|lbs|磅)/iu.test(weightText);
    const rawWeights = numericValues(weightText, MAX_WEIGHT_KG).map((value) => (pounds ? value * 0.45359237 : value));
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
  function actionMetrics(action) {
    if(!Array.isArray(action.sets))return summarizeTrainingSet(action.setsDone || 0,action.repsText,weightLabelKg(action.weightKg));
    /* 逐组：0 是明确的自重，与留空一样不贡献负重容量，只计次数（自重动作只贡献组数不贡献容量） */
    const done=action.sets.filter(s=>s.done),totalReps=done.reduce((n,s)=>n+s.reps,0),weights=done.filter(s=>typeof s.weightKg==='number'&&s.weightKg>0),est=done.map(s=>estimateE1rmKg(s.weightKg||0,s.reps)).filter(x=>x!==null);
    return {totalReps,averageReps:done.length?totalReps/done.length:null,averageWeightKg:weights.length?weights.reduce((n,s)=>n+s.weightKg,0)/weights.length:null,maxWeightKg:weights.length?Math.max(...weights.map(s=>s.weightKg)):null,loadVolumeKg:weights.length?weights.reduce((n,s)=>n+s.weightKg*s.reps,0):null,bestE1rmKg:est.length?Math.max(...est):null};
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
      e1rmByAction: new Map(), loadByAction: new Map(), lastTrainedAt: null,
      repVolume: 0,   /* 耐力因子 B：Σ次数×肌群权重（自重计入，未记次数不计；区别于 loadVolumeKg） */
      fatigueSamples: [],   /* 耐力因子 C：窗内有效保持率样本（0–1） */
      enduranceByAction: new Map()   /* 耐力暂存：动作 → {ratios, zones, candidates}，锚点齐备后二次计算 */
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
  /* ---------- 肌肉耐力评分（enduranceScore，v2）—— 设计与溯源见 docs/muscle-endurance-design.md ----------
     v2 语义：绝对常模分 + 峰值取最优。单次表现对照动作常模/锚点 → 0–100，录入当天即有分，不依赖历史趋势；
     肌群分 = 各动作分的最高值（峰值），容量/组数/保持率/带占比退出合成（保留为展示统计）；
     趋势降级为独立 chip（enduranceChangePercent：峰值动作比值趋势优先、绝对分差回退）。
     路径阶梯（§3）：L1 锚点相对负荷 → L2 动作常模表 → L3 家族负荷档 → L4 通用宽档。 */
  const ENDURANCE_CONFIG = {
    /* —— v1 保留键：趋势 chip（11–30 次负重组比值）与展示统计（保持率/耐力带）链路继续用 —— */
    ANCHOR_MAX_REPS: 10,      // [A] LeSuer 1997：锚点只取 ≤10 次的组（与 estimateE1rmKg 一致）
    RATIO_REP_MIN: 11,        // [C] 趋势 chip 比值组的次数下限（锚点公式失效之后）
    RATIO_REP_MAX: 30,        // [C] 比值组次数上界；>30 次不入 L1（Epley 反解失真，§12）
    EPLEY_REP_CONSTANT: 30,   // [A] Epley 1985：反解 r = 30 × (1/pct − 1)
    ZONE_REP_MIN: 12,         // [A] ACSM 耐力带：≥12 次（展示统计用）
    ZONE_LOAD_MAX_PCT: 0.67,  // [A] ACSM 耐力带：≤67% 1RM
    FATIGUE_MIN_SETS: 2,      // [C] 展示统计：保持率需 ≥2 组
    /* —— v2 新增：绝对常模分（§3 / §8.2）—— */
    L1_PCT_MIN: 0.4,          // [C] L1 受理域下界（Epley 反解在轻负荷端系统性高估预测次数）
    L1_PCT_MAX: 0.833,        // [C] L1 受理域上界（更重即力量区间、是锚点原料）
    SCORE_RATIO_ANCHORS: [[0, 0], [0.5, 20], [1, 50], [1.5, 75], [2, 92], [2.5, 100]], // [C] m=1（人群平均）→50，前陡后平
    AGE_BAND_DEFAULT: '20-29', // [C] 年龄缺省档（本版唯一档：任何年龄都按 20-29 表处理，§3.2）
    /* L2 动作常模表（单组最大次数 → 分数锚点，男/女结构平行；键即动作名关键词）。层级逐条：
       俯卧撑 Golding/YMCA 20-29 [B·上线前须人工复核原文]；卷腹 ACSM 20-29 [B·待复核]；
       仰卧起坐 女=中国标准大一大二逐行锚点 [B·较可信]、男无可靠表（male: null → 走 L4，不挪用卷腹表冒充）；
       引体 [C·低置信占位：来源 URL 未能定位，待可定位来源后替换]。
       俯卧撑锚点 = 「档位次数下限 → 分数带下限」展开（很差 0-15 / 差 20-34 / 中下 35-44 / 中等 45-59 /
       中上 60-74 / 良好 75-89 / 优秀 90-100），优秀档「下限→90、+15 次→100」封顶。 */
    REP_NORMS: {
      俯卧撑: {
        male: [[0, 0], [8, 0], [20, 20], [25, 35], [30, 45], [35, 60], [45, 75], [54, 90], [69, 100]],
        female: [[0, 0], [1, 0], [5, 20], [10, 35], [15, 45], [21, 60], [34, 75], [48, 90], [63, 100]]
      },
      卷腹: {   // [B·待复核] ACSM 五档按设计文档 §3.2 直接给锚点
        male: [[0, 0], [16, 15], [17, 35], [26, 60], [34, 80], [40, 92], [55, 100]],
        female: [[0, 0], [14, 15], [15, 35], [23, 60], [30, 80], [36, 92], [50, 100]]
      },
      仰卧起坐: { // 女：中国标准大一大二（60 分=26 … 100 分=56）[B·较可信]
        male: null,
        female: [[0, 0], [25, 55], [26, 60], [36, 65], [39, 70], [42, 75], [45, 80], [48, 85], [52, 90], [56, 100]]
      },
      引体: {   // [C·占位，来源未定位]
        male: [[0, 0], [2, 15], [5, 35], [8, 45], [10, 59], [12, 75], [15, 90], [20, 100]],
        female: [[0, 0], [1, 20], [2, 45], [3, 60], [5, 75], [7, 90], [10, 100]]
      }
    },
    /* L3 自重家族（关键词匹配；跪姿须先于俯卧撑，避免误档）。coef 只决定负荷档，
       用户体重不参与（§2.4：reps 曲线计分只需要动作家族的负荷档，它是动作属性而非用户属性） */
    BW_COEF: [
      { keywords: ['跪姿'], coef: 0.49, curveKey: 'low' },        // [B] Ebben 2011 跪姿俯卧撑 ≈49%BW
      { keywords: ['俯卧撑'], coef: 0.64, curveKey: 'mid' },      // [B] Ebben 2011 标准俯卧撑 ≈64%BW
      { keywords: ['引体', '悬垂'], coef: 1.0, curveKey: 'high' }, // [C·算术] 自重全程
      { keywords: ['双杠', '臂屈伸'], coef: 0.7, curveKey: 'mid' } // [C·设计初值，文献缺口]
    ],
    /* L3 家族负荷档曲线（次数→分，50 分 ≈ 对应家族人群平均）[C] §3.3 */
    FAMILY_CURVES: {
      high: [[1, 25], [5, 50], [10, 75], [15, 92], [20, 100]],  // 高负荷档 coef ≥ 0.85（引体级）
      mid: [[5, 25], [18, 50], [30, 75], [42, 92], [55, 100]],  // 中负荷档 0.5–0.84（俯卧撑级）
      low: [[6, 25], [25, 50], [40, 72], [55, 88], [70, 100]]   // 低负荷档 < 0.5（跪姿级）
    },
    GENERIC_REPS_CURVE: [[3, 20], [8, 35], [15, 50], [25, 68], [35, 82], [50, 93], [65, 100]] // [C] L4 通用宽档
  };
  /* 预测某 %1RM 负荷下的力竭次数（Epley 反解）。有效域 (0, 1]；预测 <1 次 → null（pct=1 → 0 次） */
  function estimateEnduranceReps(percent1rm) {
    if (typeof percent1rm !== 'number' || !Number.isFinite(percent1rm) || percent1rm <= 0 || percent1rm > 1) return null;
    const predicted = Math.round(ENDURANCE_CONFIG.EPLEY_REP_CONSTANT * (1 / percent1rm - 1));
    return predicted >= 1 ? predicted : null;
  }
  /* 从汇总次数文本提取「逐组次数序列」，仅供抗疲劳因子使用。
     「10-12」连字符区间按区间处理、不产生保持率样本（区间与逐组歧义从保守）；
     数字个数 === 组数且 ≥2 组才视为逐组序列（「10」×3 组是每组次数复制，不是逐组实录） */
  function perSetRepsFromText(repsText, sets) {
    const text = repsSpecText(repsText);
    if (/\d\s*[-–—]\s*\d/u.test(text)) return [];
    const numbers = (text.match(/\d+/gu) ?? []).map(Number);
    if (!Number.isInteger(sets) || sets < ENDURANCE_CONFIG.FATIGUE_MIN_SETS || numbers.length !== sets) return [];
    return numbers;
  }
  /* 组间次数保持率：mean(r_i / r_1), i≥2，整体 clamp 到 [0,1]（后组更多不奖励）。
     保持率→耐力水平无公认定量映射，且组间休息未记录构成混淆（Richmond & Godard 2009）——粗指标 [C] */
  function fatigueRetention(repSeq) {
    const seq = Array.isArray(repSeq) ? repSeq : [];
    if (seq.length < ENDURANCE_CONFIG.FATIGUE_MIN_SETS) return null;
    const first = seq[0];
    if (typeof first !== 'number' || !Number.isFinite(first) || first <= 0) return null;
    let total = 0;
    for (let i = 1; i < seq.length; i++) total += seq[i] / first;
    return clamp(total / (seq.length - 1), 0, 1);
  }
  /* 单组相对负荷耐力比值：实际次数 / Epley 反解预测次数（ratio 保留 3 位小数）。
     锚点无效、重量缺失、pct 越界（含高次组重量反超锚点 pct > 1——锚点是估计值，反超即数据噪声）→ null */
  function enduranceRatioForSet(weightKg, reps, anchorE1rmKg) {
    if (typeof anchorE1rmKg !== 'number' || !Number.isFinite(anchorE1rmKg) || anchorE1rmKg <= 0) return null;
    if (typeof weightKg !== 'number' || !Number.isFinite(weightKg)) return null;
    const percent1rm = weightKg / anchorE1rmKg;
    const predictedReps = estimateEnduranceReps(percent1rm);
    if (predictedReps === null) return null;
    return { percent1rm: round(percent1rm, 3), predictedReps, ratio: round(reps / predictedReps, 3) };
  }
  /* 耐力带单组判据（ACSM：≥12 次且 ≤67% 1RM）。无锚点动作退化为「仅 ≥12 次」的次数代理
     （负荷判据不可用时不得虚构 [C 回退]）；自重（weightKg null）视为满足负荷判据 */
  function setInEnduranceZone(weightKg, reps, anchorE1rmKg) {
    if (!(reps >= ENDURANCE_CONFIG.ZONE_REP_MIN)) return false;
    const hasAnchor = typeof anchorE1rmKg === 'number' && Number.isFinite(anchorE1rmKg) && anchorE1rmKg > 0;
    if (!hasAnchor) return true;
    if (weightKg === null || weightKg === undefined) return true;
    return weightKg / anchorE1rmKg <= ENDURANCE_CONFIG.ZONE_LOAD_MAX_PCT;
  }
  /* 耐力带落带组计数（因子 D） */
  function enduranceZoneSetCount(setLoads, anchorE1rmKg) {
    let count = 0;
    for (const set of Array.isArray(setLoads) ? setLoads : []) {
      if (set && setInEnduranceZone(set.weightKg, set.reps, anchorE1rmKg)) count++;
    }
    return count;
  }
  /* ---------- v2 绝对常模分（docs/muscle-endurance-design.md §3/§8.1）：锚点曲线 → 常模表 → 家族档 → 宽档 ---------- */
  /* 通用锚点曲线插值：anchors = [[x,y],...] 升序，段内线性、两端 clamp（L2/L3/L4 曲线共用） */
  function scoreFromAnchors(anchors, x) {
    const points = Array.isArray(anchors) ? anchors.filter((p) => Array.isArray(p) && p.length >= 2) : [];
    if (!points.length || typeof x !== 'number' || !Number.isFinite(x)) return 0;
    if (x <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 1; i < points.length; i++) {
      if (x <= points[i][0]) {
        const [x0, y0] = points[i - 1];
        return y0 + (points[i][1] - y0) * (x - x0) / (points[i][0] - x0);
      }
    }
    return last[1];
  }
  /* 比值 → 绝对分（L1）：m=1（人群在该 %1RM 下的平均预测次数）→ 50 分，分段线性前陡后平（§3.1）；
     m<0 / 非有限数 → 0；两端由锚点曲线 clamp 到 0–100 */
  function enduranceScoreFromRatio(m) {
    if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) return 0;
    return round(clamp(scoreFromAnchors(ENDURANCE_CONFIG.SCORE_RATIO_ANCHORS, m), 0, 100), 0);
  }
  /* L2 常模曲线选择：sex '男'→male、'女'→female、其他→合并宽松档（男/女锚点逐点取中值，两表结构平行）。
     单侧缺表（如仰卧起坐-男）→ null：该家族对该性别不命中 L2，动作回退 L4（§3.2/§3.4） */
  function normCurveFor(norm, sex) {
    if (!norm) return null;
    const male = Array.isArray(norm.male) ? norm.male : null;
    const female = Array.isArray(norm.female) ? norm.female : null;
    if (sex === '男') return male;
    if (sex === '女') return female;
    if (!male || !female || male.length !== female.length) return null;
    return male.map((point, index) => [(point[0] + female[index][0]) / 2, (point[1] + female[index][1]) / 2]);
  }
  /* 动作名 → 自重家族（L3）：关键词命中 BW_COEF（跪姿先于俯卧撑，避免误档）；未命中 → null */
  function bodyweightFamilyOf(actionName) {
    const name = String(actionName || '');
    const family = ENDURANCE_CONFIG.BW_COEF.find((entry) => entry.keywords.some((keyword) => name.includes(keyword)));
    return family ? { coef: family.coef, curveKey: family.curveKey } : null;
  }
  /* L4 通用宽档：50 分 ≈ 普通成人单组 15 次的宽档中心；大重量低次数组得低分是正确语义（§3.4） */
  function genericRepsScore(reps) {
    const value = typeof reps === 'number' && Number.isFinite(reps) ? reps : 0;
    return round(clamp(scoreFromAnchors(ENDURANCE_CONFIG.GENERIC_REPS_CURVE, value), 0, 100), 0);
  }
  /* 单组计分主入口（§8.1）：L1 锚点相对负荷 → L3 自重家族 → L4 次数宽档（L2 常模在动作级裁决——
     家族匹配需要动作名上下文，见 scoreEnduranceAction）。
     L1 受理条件：负重、≤RATIO_REP_MAX 次（>30 次 Epley 反解失真，§12）、pct ∈ [L1_PCT_MIN, L1_PCT_MAX]；
     锚点组自身在受理域内时同样参与（§3.5）。weightKg>0 但无锚/pct 出域 → 直接 L4，不冒充 L1。
     set 可带 actionName 供 L3 家族匹配；reps 非正数 → null；
     返回 { score, path: 'L1'|'L3'|'L4', pct?, ratio? } */
  function scoreEnduranceSet(set, anchorE1rmKg, profile) {
    if (!set || typeof set.reps !== 'number' || !Number.isFinite(set.reps) || set.reps <= 0) return null;
    const weightKg = typeof set.weightKg === 'number' && Number.isFinite(set.weightKg) && set.weightKg > 0 ? set.weightKg : null;
    if (weightKg !== null && set.reps <= ENDURANCE_CONFIG.RATIO_REP_MAX
      && typeof anchorE1rmKg === 'number' && Number.isFinite(anchorE1rmKg) && anchorE1rmKg > 0) {
      const pct = weightKg / anchorE1rmKg;
      const predictedReps = pct >= ENDURANCE_CONFIG.L1_PCT_MIN && pct <= ENDURANCE_CONFIG.L1_PCT_MAX
        ? estimateEnduranceReps(pct)
        : null;
      if (predictedReps !== null && predictedReps > 0) {
        const ratio = set.reps / predictedReps;
        return { score: enduranceScoreFromRatio(ratio), path: 'L1', pct: round(pct, 3), ratio: round(ratio, 3) };
      }
    }
    if (weightKg === null) {
      const family = bodyweightFamilyOf(set.actionName);
      if (family) {
        return { score: round(clamp(scoreFromAnchors(ENDURANCE_CONFIG.FAMILY_CURVES[family.curveKey], set.reps), 0, 100), 0), path: 'L3' };
      }
    }
    return { score: genericRepsScore(set.reps), path: 'L4' };
  }
  /* 动作计分（本窗，§4.1/§8.1）：候选组由首遍暂存（逐组原样 / 汇总文本逐组序列 / 均值组标 degraded）。
     动作分 = 最佳单组得分（峰值原则：top-2 均值会拉低峰值，单组偶然性由窗口聚合与置信度吸收）；
     路径裁决 §3.5：① L1（有锚点且有受理组）→ ② L2 常模（该性别有表）→ ③ L3 家族 → ④ L4 宽档；
     无任何已知次数 → null。L2/L3/L4 为动作级裁决：该路径曲线对全部候选组按次数计分
     （负重变式在无锚点时附加重量不可折算，如实按次数档处理）。
     actionStats 另含 actionName（家族匹配用）与 degraded 标记来源 */
  function scoreEnduranceAction(actionStats, anchorE1rmKg, profile) {
    const candidates = (actionStats && Array.isArray(actionStats.candidates) ? actionStats.candidates : [])
      .filter((set) => set && typeof set.reps === 'number' && Number.isFinite(set.reps) && set.reps > 0);
    if (!candidates.length) return null;
    const actionName = String(actionStats.actionName || '');
    const sex = profile && typeof profile.sex === 'string' ? profile.sex : '';
    let best = null;
    const consider = (score, path, candidate) => {
      if (!Number.isFinite(score)) return;
      const rounded = round(clamp(score, 0, 100), 0);
      if (!best || rounded > best.score) {
        best = {
          score: rounded, path, degraded: !!candidate.degraded,
          bestSet: { weightKg: candidate.weightKg === undefined ? null : candidate.weightKg, reps: candidate.reps }
        };
      }
    };
    if (typeof anchorE1rmKg === 'number' && Number.isFinite(anchorE1rmKg) && anchorE1rmKg > 0) {
      let bestL1 = null;
      for (const candidate of candidates) {
        const scored = scoreEnduranceSet(candidate, anchorE1rmKg, profile);
        if (scored && scored.path === 'L1' && (!bestL1 || scored.score > bestL1.score)) {
          bestL1 = { score: scored.score, candidate };
        }
      }
      if (bestL1) {
        return {
          score: bestL1.score, path: 'L1', degraded: !!bestL1.candidate.degraded,
          bestSet: { weightKg: bestL1.candidate.weightKg === undefined ? null : bestL1.candidate.weightKg, reps: bestL1.candidate.reps }
        };
      }
    }
    const normKey = Object.keys(ENDURANCE_CONFIG.REP_NORMS).find((key) => actionName.includes(key));
    if (normKey) {
      const curve = normCurveFor(ENDURANCE_CONFIG.REP_NORMS[normKey], sex);
      if (curve) {
        for (const candidate of candidates) consider(scoreFromAnchors(curve, candidate.reps), 'L2', candidate);
        if (best) return best;
      }
    }
    const family = bodyweightFamilyOf(actionName);
    if (family) {
      for (const candidate of candidates) {
        consider(scoreFromAnchors(ENDURANCE_CONFIG.FAMILY_CURVES[family.curveKey], candidate.reps), 'L3', candidate);
      }
      if (best) return best;
    }
    for (const candidate of candidates) consider(genericRepsScore(candidate.reps), 'L4', candidate);
    return best;
  }
  /* 逐组记录 → 已完成组的 {weightKg, reps} 序列；汇总记录 → null（观测耐力字段，§6.3） */
  function doneSetLoads(action) {
    if (!Array.isArray(action.sets)) return null;
    return action.sets.filter((s) => s && s.done)
      .map((s) => ({ weightKg: typeof s.weightKg === 'number' ? s.weightKg : null, reps: s.reps }));
  }
  /* 从训练日快照构造观测数据（跳过已跳过的日子；只统计有实际数据的动作） */
  function collectObservations(state, asOfDate) {
    const observations = [];
    for (const date of Object.keys(state.days)) {
      if (asOfDate && date > asOfDate) continue;
      const day = state.days[date];
      if (day.status === 'skipped') continue;
      for (const a of day.actions || []) {
        /* 逐组记录存在时以「已完成组」为准（产品口径：保存逐组后统计改用已完成组）；
           只有汇总缺失而逐组已完成的旧数据不再被静默丢弃 */
        const perSet = Array.isArray(a.sets) ? a.sets.filter((s) => s && s.done).length : null;
        const sets = perSet !== null ? perSet : (a.setsDone === null || a.setsDone === undefined ? 0 : a.setsDone);
        /* 只填了负重、既没组数也没次数的行不算一次观测（留空按自重记后，0 不再能证明「记过」） */
        if (sets <= 0 && !a.repsText) continue;
        observations.push({
          businessDate: date,
          dayLabel: day.name || '',
          actionName: a.name,
          sets: sets > 0 ? sets : 0,
          repsText: a.repsText || '',
          weightText: weightLabelKg(a.weightKg), exactMetrics:actionMetrics(a),
          setLoads: doneSetLoads(a)   /* 逐组记录 → 已完成组序列；汇总记录 → null（耐力观测用） */
        });
      }
    }
    return observations;
  }
  /* 耐力二遍处理（设计文档 §6.5）：锚点地图要等窗口循环结束才完整，而比值/落带判据依赖锚点，
     首循环只暂存原始组，循环结束后按「各窗自己的锚点」二次计算（近窗用近窗锚点、前窗用前窗锚点） */
  function enduranceRatioByAction(windowStats, anchors) {
    const out = new Map();
    for (const [action, rec] of windowStats.enduranceByAction) {
      const anchor = anchors.get(action);
      const anchorKg = anchor && typeof anchor.value === 'number' && anchor.value > 0 ? anchor.value : null;
      for (const entry of rec.ratios) {
        const ratio = enduranceRatioForSet(entry.weightKg, entry.reps, anchorKg);
        if (ratio !== null) recordBest(out, action, ratio.ratio, entry.muscleWeight);
      }
    }
    return out;
  }
  /* 耐力带占比（因子 D）：Σ落带组×肌群权重 / Σ已知次数组×肌群权重；无已知次数组 → null */
  function enduranceZoneShareForWindow(windowStats, anchors) {
    let knownWeight = 0, hitWeight = 0;
    for (const [action, rec] of windowStats.enduranceByAction) {
      const anchor = anchors.get(action);
      const anchorKg = anchor && typeof anchor.value === 'number' && anchor.value > 0 ? anchor.value : null;
      for (const entry of rec.zones) {
        knownWeight += entry.count * entry.muscleWeight;
        if (setInEnduranceZone(entry.weightKg, entry.reps, anchorKg)) hitWeight += entry.count * entry.muscleWeight;
      }
    }
    return knownWeight > 0 ? hitWeight / knownWeight : null;
  }
  /* 综合评分：增肌刺激 0.6×组数完成 + 0.25×容量趋势 + 0.15×频率；
     力量趋势 0.7×e1RM变化 + 0.2×重量变化 + 0.1×频率；
     耐力（v2）：逐动作绝对常模分（L1 锚点相对负荷 → L2 常模表 → L3 家族档 → L4 宽档），
     肌群分 = 各动作分最高值（峰值，§5）；趋势为独立 chip（enduranceChangePercent），不进分数；
     综合 = 0.35 力量/0.35 增肌/0.2 耐力/0.1 频率（双数据）；
     0.45/0.45/0.1（仅力量，现实上罕见）；0.5 增肌/0.3 耐力/0.2 频率（仅耐力）；0.85/0.15（双 null）。
     第三可选参 profile = { sex, age }（来自 bmiProfile，§8.1）：缺省/缺字段 → 合并宽松档 + 20-29；
     体重/身高不参与耐力评分（§2.4）。
     出处分层：组数带 10–20 与次数刺激折算取自文献（Schoenfeld 2017 / Baz-Valle 2022）；
     各项合成权重为设计取值（文献不提供唯一合成比），溯源总表见 docs/scoring-parameters.md */
  function buildMuscleProgress(observations, asOfDate, profile) {
    const prof = profile && typeof profile === 'object'
      ? { sex: typeof profile.sex === 'string' ? profile.sex : '', age: Number.isFinite(profile.age) ? profile.age : null }
      : { sex: '', age: null };
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
      const summary = observation.exactMetrics || summarizeTrainingSet(observation.sets, observation.repsText, observation.weightText);
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
        /* 耐力：容量（展示统计）与保持率样本不依赖锚点，首循环直接累计；
           11–30 次组与全部已知次数组暂存，等锚点齐备后按本窗锚点二次算比值/落带（两遍处理） */
        stats.repVolume += (summary.totalReps || 0) * muscleWeight;
        let endurance = stats.enduranceByAction.get(observation.actionName);
        if (!endurance) {
          /* v2：candidates 为动作绝对分候选组（逐组原样 / 逐组序列 / 均值组），actionName 供家族匹配 */
          endurance = { actionName: observation.actionName, ratios: [], zones: [], candidates: [] };
          stats.enduranceByAction.set(observation.actionName, endurance);
        }
        if (Array.isArray(observation.setLoads)) {
          /* 逐组记录：每组即一条（已完成组） */
          for (const set of observation.setLoads) {
            endurance.zones.push({ weightKg: set.weightKg, reps: set.reps, muscleWeight, count: 1 });
            if (set.reps > 0) endurance.candidates.push({ weightKg: set.weightKg, reps: set.reps, degraded: false });
            if (set.reps >= ENDURANCE_CONFIG.RATIO_REP_MIN && set.reps <= ENDURANCE_CONFIG.RATIO_REP_MAX
              && typeof set.weightKg === 'number' && set.weightKg > 0) {
              /* 比值腿只对真实负重成立：自重（0）走 L3/L4 的自重路径，不拿 0%1RM 去查常模 */
              endurance.ratios.push({ weightKg: set.weightKg, reps: set.reps, muscleWeight });
            }
          }
          if (observation.setLoads.length >= ENDURANCE_CONFIG.FATIGUE_MIN_SETS) {
            const retention = fatigueRetention(observation.setLoads.map((set) => set.reps));
            if (retention !== null) stats.fatigueSamples.push(retention);
          }
        } else if (summary.averageReps !== null && summary.averageReps !== undefined) {
          /* 汇总记录：趋势 chip 只贡献一个「均值对」（averageWeightKg × averageReps，已知精度损失）；
             落带按均值组近似；逐组列表可解析时保持率照常取样，连字符区间从保守不计 */
          endurance.zones.push({ weightKg: summary.averageWeightKg, reps: summary.averageReps, muscleWeight, count: observation.sets });
          if (summary.averageReps >= ENDURANCE_CONFIG.RATIO_REP_MIN && summary.averageReps <= ENDURANCE_CONFIG.RATIO_REP_MAX
            && typeof summary.averageWeightKg === 'number' && summary.averageWeightKg > 0) {
            endurance.ratios.push({ weightKg: summary.averageWeightKg, reps: summary.averageReps, muscleWeight });
          }
          const seq = perSetRepsFromText(observation.repsText, observation.sets);
          if (seq.length) {
            const retention = fatigueRetention(seq);
            if (retention !== null) stats.fatigueSamples.push(retention);
            /* v2 候选：文本可解析出逐组序列 → 按序列逐组（真实最佳组，不降级） */
            for (const reps of seq) {
              if (reps > 0) endurance.candidates.push({ weightKg: summary.averageWeightKg, reps, degraded: false });
            }
          } else if (summary.averageReps > 0) {
            /* v2 候选：均值组（均值不可能超过真实最佳组，系统性低估如实标注，§4.1） */
            endurance.candidates.push({ weightKg: summary.averageWeightKg, reps: summary.averageReps, degraded: true });
          }
        }
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
      /* —— v2 耐力：逐动作绝对计分 → 肌群取 max（峰值原则，docs/muscle-endurance-design.md §5）——
         近/前窗锚点各自独立；比值链路（11–30 次负重组）只服务趋势 chip 与配对统计，不进分数 */
      const recentRatios = collapseTop2(enduranceRatioByAction(recent, recentE1rm));
      const previousRatios = collapseTop2(enduranceRatioByAction(previous, previousE1rm));
      const repVolumeChange = previous.repVolume > 0 ? clamp(recent.repVolume / previous.repVolume - 1, -0.5, 0.5) : null;
      const fatigueValue = recent.fatigueSamples.length
        ? recent.fatigueSamples.reduce((total, value) => total + value, 0) / recent.fatigueSamples.length
        : null;
      const zoneShare = enduranceZoneShareForWindow(recent, recentE1rm);
      const scoreWindow = (windowStats, anchors) => {
        const scores = new Map();
        for (const [action, rec] of windowStats.enduranceByAction) {
          const anchor = anchors.get(action);
          const anchorKg = anchor && typeof anchor.value === 'number' && anchor.value > 0 ? anchor.value : null;
          const scored = scoreEnduranceAction(rec, anchorKg, prof);
          if (scored) scores.set(action, scored);
        }
        return scores;
      };
      const recentScores = scoreWindow(recent, recentE1rm);
      const previousScores = scoreWindow(previous, previousE1rm);
      /* 峰值动作 = 分数最高者；同分依次按路径信息量（L1>L2>L3>L4）→ 最佳组次数多者 → 动作名升序（§5.2） */
      const PATH_RANK = { L1: 3, L2: 2, L3: 1, L4: 0 };
      const pickPeak = (scores) => {
        let winner = null;
        for (const [action, scored] of scores) {
          if (!winner) { winner = { action, scored }; continue; }
          const cur = winner.scored;
          if (scored.score > cur.score
            || (scored.score === cur.score && PATH_RANK[scored.path] > PATH_RANK[cur.path])
            || (scored.score === cur.score && PATH_RANK[scored.path] === PATH_RANK[cur.path]
              && (scored.bestSet.reps > cur.bestSet.reps
                || (scored.bestSet.reps === cur.bestSet.reps && action.localeCompare(winner.action, 'zh-CN') < 0)))) {
            winner = { action, scored };
          }
        }
        return winner;
      };
      const peak = pickPeak(recentScores);
      /* null 语义与 v1 对齐：enduranceScore null ⟺ 近窗 repVolume = 0（无任何已知次数组，§8.3） */
      const enduranceScore = peak && recent.repVolume > 0 ? peak.scored.score : null;
      const enduranceBestAction = enduranceScore === null ? null : peak.action;
      const endurancePath = enduranceScore === null ? null : peak.scored.path;
      /* 趋势 chip（§6）：峰值动作近/前窗都有比值配对 → 比值跨窗变化率（公式偏差跨窗抵消，最干净）；
        回退：两窗都有动作分且同路径 → 绝对分差；都没有 → null（首窗必 null） */
      let enduranceChange = null;
      if (peak) {
        const recentPoint = recentRatios.get(peak.action);
        const previousPoint = previousRatios.get(peak.action);
        if (recentPoint && previousPoint && previousPoint.value > 0) {
          enduranceChange = clamp(recentPoint.value / previousPoint.value - 1, -0.5, 0.5);
        } else {
          const previousScored = previousScores.get(peak.action);
          if (previousScored && previousScored.path === peak.scored.path && previousScored.score > 0) {
            enduranceChange = clamp(peak.scored.score / previousScored.score - 1, -0.5, 0.5);
          }
        }
      }
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
      /* 四分支显式枚举（设计文档 §4，不做通用归一）：无耐力数据的肌群分数一个都不动。
         仅力量分支现实上几乎不可达（锚点必有 ≤10 次重组 → repVolume > 0），按规格保留 */
      const overallScore = strengthScore !== null && enduranceScore !== null
        ? round(0.35 * strengthScore + 0.35 * hypertrophyScore + 0.2 * enduranceScore + 0.1 * frequencyScore, 0)
        : strengthScore !== null
          ? round(0.45 * strengthScore + 0.45 * hypertrophyScore + 0.1 * frequencyScore, 0)
          : enduranceScore !== null
            ? round(0.5 * hypertrophyScore + 0.3 * enduranceScore + 0.2 * frequencyScore, 0)
            : round(0.85 * hypertrophyScore + 0.15 * frequencyScore, 0);
      const bestE1rm = [...recentE1rm.entries()].sort((a, b) => b[1].best - a[1].best)[0] ?? null;
      const actions = [...new Set([...recent.actions, ...previous.actions])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const lastTrainedAt = [recent.lastTrainedAt, previous.lastTrainedAt].filter((v) => v !== null).sort().at(-1) ?? null;
      /* 配对动作数取两类趋势指标的最大值（§3.6）：只升不降，纯耐力肌群可凭耐力配对提升置信度 */
      const pairedActions = Math.max(
        [...recentE1rm.keys()].filter((action) => previousE1rm.has(action)).length,
        [...recentRatios.keys()].filter((action) => previousRatios.has(action)).length
      );
      let confidence = recent.sets <= 0
        ? 'none'
        : recent.dates.size >= 4 && previous.dates.size >= 2 && pairedActions > 0
          ? 'good'
          : 'limited';
      /* v2 唯一下调（§5.3）：峰值动作走性别合并宽松档（sex 未填且峰值路径为 L2/L3）→ 封顶 limited。
         缺省假设必须可见；L1（个体锚点）与 L4（性别无关宽档）不受影响 */
      if (confidence === 'good' && peak && (peak.scored.path === 'L2' || peak.scored.path === 'L3')
        && prof.sex !== '男' && prof.sex !== '女') {
        confidence = 'limited';
      }
      return {
        key: definition.key, label: definition.label, view: definition.view,
        recentSets: round(recent.sets), previousSets: round(previous.sets),
        recentSessions: recent.dates.size,
        recentLoadVolumeKg: recent.loadVolumeKg > 0 ? round(recent.loadVolumeKg) : null,
        bestE1rmKg: bestE1rm ? bestE1rm[1].best : null,
        bestE1rmAction: bestE1rm ? bestE1rm[0] : null,
        strengthChangePercent: e1rmChange === null ? null : round(e1rmChange * 100),
        loadChangePercent: loadChange === null ? null : round(loadChange * 100),
        enduranceScore,
        enduranceChangePercent: enduranceChange === null ? null : round(enduranceChange * 100),
        enduranceBestAction,
        endurancePath,
        repVolumeChangePercent: repVolumeChange === null ? null : round(repVolumeChange * 100),
        fatigueRetentionPercent: fatigueValue === null ? null : round(fatigueValue * 100),
        enduranceZoneSharePercent: zoneShare === null ? null : round(zoneShare * 100),
        strengthScore, hypertrophyScore, overallScore,
        frequencyScore: round(frequencyScore, 0), confidence, lastTrainedAt, actions,
        weeklyStimSets: round(recent.stimSets / 4, 1)
      };
    });
  }
  /* v2 耐力常模分档消费 bmiProfile 的性别/年龄（docs/muscle-endurance-design.md §8.1）：
     缺档案/缺字段时降级缺省（性别合并宽松档 + 20-29）；身高体重不参与耐力评分（§2.4） */
  function enduranceProfileOf(state) {
    const bp = state && state.bmiProfile ? state.bmiProfile : {};
    return {
      sex: typeof bp.sex === 'string' ? bp.sex : '',
      age: Number.isFinite(bp.age) ? bp.age : null
    };
  }
  function muscleProgress(state, asOfDate) {
    return buildMuscleProgress(collectObservations(state, asOfDate), asOfDate, enduranceProfileOf(state));
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
  /* "12, 10, 8" 逐组相加；单个数且组数>1 视为每组次数（"10"×3组=30）；「3x8」按组×次数取 8 */
  function parseRepsText(repsText, sets) {
    const numbers = (repsSpecText(repsText).match(/\d+/gu) ?? []).map(Number).filter((value) => value > 0 && value <= 100);
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
        const perSet = Array.isArray(a.sets) ? a.sets.filter((s) => s && s.done).length : null;
        const actualSets = perSet !== null ? perSet : (a.setsDone === null || a.setsDone === undefined ? 0 : a.setsDone);
        if (actualSets <= 0 && !a.repsText) continue; // 同上：只有负重没有次数/组数 → 不是观测
        const metrics = actionMetrics(a);
        const actionReps = perSet !== null ? (metrics.totalReps || 0) : parseRepsText(a.repsText, actualSets);
        sets += actualSets;
        reps += actionReps;
        if (metrics.loadVolumeKg !== null) { loadVolumeKg += metrics.loadVolumeKg; hasLoadVolume = true; }
        if (metrics.bestE1rmKg !== null) bestE1rmKg = bestE1rmKg === null ? metrics.bestE1rmKg : Math.max(bestE1rmKg, metrics.bestE1rmKg);
        actionSummary.push({ name: a.name, sets: actualSets, reps: actionReps, weightKg: metrics.averageWeightKg, loadVolumeKg: metrics.loadVolumeKg, e1rmKg: metrics.bestE1rmKg });
        observations.push({ businessDate: date, dayLabel: `${day.bodyPart || ''} ${day.name || ''}`, actionName: a.name, sets: actualSets, repsText: a.repsText || '', weightText: weightLabelKg(a.weightKg), exactMetrics:actionMetrics(a), setLoads: doneSetLoads(a) });
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
    return { today: asOfDate, weeks, series, recentSessions: sessions.slice(0, 10), currentStreakWeeks, muscleProgress: buildMuscleProgress(observations, asOfDate, enduranceProfileOf(state)) };
  }

  /* ---------- 身体基础指标（BMI 按中国成人标准 WS/T 428；BMR 用 Mifflin-St Jeor 公式） ---------- */
  function bmi(heightCm, weightKg) {
    if (!(heightCm > 80 && heightCm <= 250) || !(weightKg > 20 && weightKg <= 400)) return null;
    return Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
  }
  function bmiCategoryCN(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '';
    if (v < 18.5) return '偏低';
    if (v < 24) return '正常';
    if (v < 28) return '超重';
    return '肥胖';
  }
  function healthyWeightRange(heightCm) {
    if (!(heightCm > 80 && heightCm <= 250)) return null;
    const m2 = (heightCm / 100) ** 2;
    return { min: Math.round(18.5 * m2), max: Math.round(23.9 * m2) };
  }
  function bmrMifflin(sex, weightKg, heightCm, age) {
    if (!(weightKg > 20 && weightKg <= 400) || !(heightCm > 80 && heightCm <= 250)) return null;
    if (!Number.isInteger(age) || age < 10 || age > 100) return null;
    return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + (sex === '女' ? -161 : 5));
  }
  const ACTIVITY_FACTORS = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
  function tdee(bmr, activity) {
    const f = ACTIVITY_FACTORS[activity];
    if (!bmr || !f) return null;
    return Math.round(bmr * f);
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
      : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_WEIGHT_KG ? v : false;
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
    /* 身体档案随导出/导入 round-trip 保留（导出文案承诺「粘回恢复」；Bug 猎手 #6） */
    if (payload.bmiProfile && typeof payload.bmiProfile === 'object' && !Array.isArray(payload.bmiProfile)) {
      cleaned.bmiProfile = payload.bmiProfile;
    }
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
          if(a.sets!==undefined && (!Array.isArray(a.sets)||a.sets.length>100||a.sets.some(x=>!Number.isInteger(x.reps)||x.reps<0||x.reps>999||!validateWeightKg(x.weightKg))))return fail('逐组导入数据无效');
          actions.push({ sets:a.sets===undefined?undefined:JSON.parse(JSON.stringify(a.sets)),actualSource:a.actualSource, actionKey: ak, name: an, plannedSets: ps, plannedRepsText: pprt, plannedWeightText: ppwt, targetText: ptt, setsDone: sd, repsText: prt, weightKg: wk, durationMinutes: dm, note: ant });
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
    if(payload.adjustments!==undefined){
      if(!Array.isArray(payload.adjustments)||payload.adjustments.length>50000)return fail('变化记录无效或数量过多');
      const validSnapshot=x=>x&&typeof x==='object'&&(x.setsDone==null||isBoundedInt(x.setsDone,10000))&&typeof x.repsText==='string'&&x.repsText.length<=4000&&validateWeightKg(x.weightKg)&&(!x.sets||Array.isArray(x.sets)&&x.sets.length<=100&&x.sets.every(s=>s&&isBoundedInt(s.reps,999)&&validateWeightKg(s.weightKg)&&typeof s.done==='boolean'));
      for(const x of payload.adjustments)if(!x||!importStr(x.id,1,128)||!isBusinessDate(x.date)||!importStr(x.name,1,200)||!importStr(x.actionKey,1,128)||!importStr(x.savedAt,1,40)||!Number.isFinite(Date.parse(x.savedAt))||!validSnapshot(x.before)||!validSnapshot(x.after))return fail('变化记录字段无效');
      cleaned.adjustments=JSON.parse(JSON.stringify(payload.adjustments));
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
    state.adjustments||=[];state.baselines||={};
    for(const x of cleaned.adjustments||[]){
      if(!state.adjustments.some(v=>v.id===x.id))state.adjustments.push(x);
      const key=actionNameKey(x.name),previous=state.baselines[key];
      if(!previous||previous.savedAt<x.savedAt)state.baselines[key]={...x.after,date:x.date,savedAt:x.savedAt};
    }
    if (cleaned.bmiProfile) state.bmiProfile = cleaned.bmiProfile; // 身体档案随导入恢复
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

  /* ---------- 渐进超负荷：下次训练建议 ----------
     决策表、证据与产品启发式的分界见 docs/progression-design.md。
     输入只有已记录的完成组数、次数、负重，以及调用方可选传入的睡眠恢复上下文。
     不读训练时长。要点：
     - 只在同一负重上比较次数。重量不同、或有一次没记下重量，不能据此判下滑或加重。
     - 组数没做满、次数缺失或对不齐、同一次训练里负重不一致：巩固，不加重。
     - 现行依据是 ACSM 2026 立场文件（PMID 41843416）：渐进可以加重量、加组数、加频率或换动作；
       增肌与更高的每周组数相关（≥10 组/肌群是人群剂量反应，不是个人定额）；最合适的组数无法确定，
       约 18–20 组/周后收益递减来自该文件引用的荟萃回归，不是硬上限。力量上更重的负荷更好。
     - 2009 年的「超目标 1–2 次后加重 2–10%」只作历史边界：新版没有重申每次加百分之几。
       器械最小步长若使实际增幅高于这个历史上限，先巩固或加次数。连续两次同重量达标才加重，是产品保守规则。
     - 自重到顶后不自动加组，先看已记录的周刺激估算。约 10% 减载是产品启发式，不是被验证过的比例。 */
  const PROG_LOAD_RULES = [
    { pattern: /深蹲|腿举|硬拉|臀推|臀桥|箭步|弓步|squat|deadlift|leg\s*press|hip\s*thrust|lunge/iu, pct: 0.1, label: '下肢复合' },
    { pattern: /卧推|推胸|推举|肩推|上举|划船|下拉|引体|chest\s*press|bench\s*press|overhead\s*press|shoulder\s*press|\brow\b|pull.?up|lat/iu, pct: 0.05, label: '上肢复合' },
    { pattern: /弯举|飞鸟|夹胸|侧平举|前平举|下压|臂屈伸|屈伸|提踵|卷腹|腹轮|面拉|face\s*pull|curl|raise|fly|extension|pushdown|crunch/iu, pct: 0.025, label: '孤立' }
  ];
  function loadProgressRule(actionName) {
    return PROG_LOAD_RULES.find((r) => r.pattern.test(String(actionName || '')))
      || { pattern: PROG_LOAD_RULES[1].pattern, pct: PROG_LOAD_RULES[1].pct, label: PROG_LOAD_RULES[1].label };
  }
  function parseRepRange(repsText) {
    /* 「3x8」「3×8-12」是 组数×次数 写法：次数取 x 后面的部分（与实际数据解析共用 repsSpecText），
       避免把组数 3 误读成次数下限（区间 3–8 会触发荒谬的「低于下限」建议） */
    const nums = (repsSpecText(repsText).match(/\d+(?:\.\d+)?/g) || [])
      .map(Number).filter((n) => n >= 1 && n <= 100).map(Math.round);
    if (!nums.length) return null;
    if (nums.length === 1) return { lo: nums[0], hi: nums[0] + 2 };
    const lo = Math.min(nums[0], nums[1]);
    const hi = Math.max(nums[0], nums[1]);
    return { lo, hi: Math.max(hi, lo + 1) };
  }
  function roundLoadHalf(v) { return Math.round(v * 2) / 2; }
  function nextLoadKg(actionName, weightKg) {
    const rule = loadProgressRule(actionName);
    const delta = Math.min(5, Math.max(0.5, roundLoadHalf(weightKg * rule.pct)));
    return { pct: rule.pct, label: rule.label, delta, next: roundLoadHalf(weightKg + delta) };
  }
  /* 器械真实步长：杠铃按最小常用片 2.5kg（1.25kg/侧）取档；哑铃/绳索等按 0.5kg 微调 */
  function equipmentStepKg(actionName) {
    return /杠铃|barbell/iu.test(String(actionName || '')) ? 2.5 : 0.5;
  }
  /* 增量与百分比按「建议重量 − 当前重量」实算；器械步长 / 0.5kg 下限 / 5kg 封顶生效时如实标注。
     标注并入同一层括号（理由文案：加重 Xkg（实际 +Y%…；ACSM…））。
     杠铃取档：先按理想增量向上取到 2.5kg 的倍数；若超出 ACSM 10% 上限且向下一档仍 ≥ 一片，则向下一档。 */
  function progLoadStep(actionName, baseWeight) {
    const rule = loadProgressRule(actionName);
    const step = equipmentStepKg(actionName);
    const ideal = baseWeight * rule.pct;
    let delta;
    if (step <= 0.5) {
      delta = Math.min(5, Math.max(0.5, roundLoadHalf(ideal)));
    } else {
      const ceilStep = Math.min(5, Math.max(step, Math.ceil(ideal / step - 1e-9) * step));
      const floorStep = Math.floor(ideal / step + 1e-9) * step;
      delta = (ceilStep / baseWeight > 0.10 && floorStep >= step) ? floorStep : ceilStep;
    }
    const next = roundLoadHalf(baseWeight + delta);
    const actualDelta = Math.round((next - baseWeight) * 10) / 10;
    /* jumpPct 不取整，供「是否超过 2009 年历史 10%」判断。actualPct 只用于展示。 */
    const jumpPct = baseWeight > 0 ? actualDelta / baseWeight * 100 : 0;
    const actualPct = Math.round(jumpPct);
    const notes = [];
    if (step > 0.5) notes.push(`杠铃按 ${step}kg 片取档`);
    if (step <= 0.5 && roundLoadHalf(ideal) < 0.5) notes.push('受 0.5kg 最小步长限制，实际增幅高于类别建议');
    else if (ideal > 5) notes.push('已按单次 5kg 封顶');
    return { pct: rule.pct, label: rule.label, delta: actualDelta, actualDelta, actualPct, jumpPct, next, note: notes, };
  }
  /* 同名动作最近 n 次有数据的记录（跨模板全库，含 onOrBeforeDate 当天，供收尾后的建议引用本次数据；
     预览日/未开始的日子因实际字段全空自动被跳过，落到更早的记录）。 */
  function recentActuals(state, actionName, onOrBeforeDate, n) {
    const key = actionNameKey(actionName);
    if (!key) return [];
    const out = [];
    const dates = Object.keys(state.days)
      .filter((d) => d <= onOrBeforeDate)
      .sort().reverse();
    for (const d of dates) {
      const day = state.days[d];
      if (day.status === 'skipped') continue;
      const act = (day.actions || []).find((a) => actionNameKey(a.name) === key);
      if (act && ((act.setsDone !== null && act.setsDone !== undefined)
        || (act.weightKg !== null && act.weightKg !== undefined) || act.repsText
        || (Array.isArray(act.sets) && act.sets.some((s) => s && s.done)))) {
        out.push({ date: d, action: act });
        if (out.length >= n) break;
      }
    }
    return out;
  }
  /* 同一负重才可比次数。0.25kg 只吸收记数舍入，10kg 和 10.5kg 仍是不同负重。 */
  const PROG_SAME_LOAD_KG = 0.25;
  /* ACSM 2009 历史建议的单次加重上限。2026 新版没有重申这个百分比。 */
  const PROG_HISTORICAL_JUMP_PCT = 10;
  /* ACSM 2026：每周 ≥10 组与更大增肌相关，但是人群剂量反应，不是个人定额。 */
  const PROG_VOLUME_CONTEXT_SETS = 10;

  function progFmt(n) {
    return String(Math.round(Number(n) * 10) / 10);
  }
  function progRepTokens(text) {
    return (repsSpecText(text).match(/\d+(?:\.\d+)?/g) || [])
      .map(Number)
      .filter((n) => n >= 1 && n <= 100);
  }
  function progSessionMetrics(entry) {
    if (!entry) return null;
    const a = entry.action || {};
    const planned = a.plannedSets > 0 ? a.plannedSets : 0;
    let sets = 0;
    let avg = null;
    let explicitWeight = false;
    let mixedLoad = false;
    let weightValue = null;
    let weightHint = null;
    let repsDetail = 'missing';
    let repsEach = null;

    if (Array.isArray(a.sets)) {
      const done = a.sets.filter((s) => s && s.done);
      sets = done.length;
      const reps = done.map((s) => (Number.isFinite(s.reps) ? s.reps : 0));
      const knownReps = reps.filter((n) => n >= 1).length;
      if (done.length > 0 && knownReps === done.length) {
        repsDetail = 'ok';
        repsEach = reps.slice();
        avg = Math.round((reps.reduce((n, v) => n + v, 0) / reps.length) * 10) / 10;
      } else if (knownReps > 0) repsDetail = 'partial';
      const knownW = [];
      let missingW = 0;
      for (const s of done) {
        if (typeof s.weightKg === 'number' && Number.isFinite(s.weightKg)) knownW.push(s.weightKg);
        else missingW += 1;
      }
      if (knownW.length && missingW) mixedLoad = true;
      else if (knownW.length) {
        explicitWeight = true;
        const rounded = knownW.map((w) => (w <= 0 ? 0 : Math.round(w * 10) / 10));
        weightHint = Math.min(...rounded);
        if (Math.max(...rounded) - weightHint > PROG_SAME_LOAD_KG) mixedLoad = true;
        else weightValue = weightHint <= 0 ? 0 : Math.round((rounded.reduce((n, v) => n + v, 0) / rounded.length) * 10) / 10;
      }
    } else {
      sets = typeof a.setsDone === 'number' && a.setsDone > 0 ? a.setsDone : 0;
      const tokens = progRepTokens(a.repsText);
      /* 一个数字是「每组都是这个次数」的简写；数字个数对不齐组数时，不能把补出来的次数当真。 */
      if (sets > 0 && (tokens.length === 1 || tokens.length >= sets)) {
        repsDetail = 'ok';
        repsEach = tokens.length === 1
          ? Array.from({ length: sets }, () => tokens[0])
          : tokens.slice(0, sets);
        avg = actionMetrics(a).averageReps;
      } else if (tokens.length > 0) repsDetail = 'partial';
      if (typeof a.weightKg === 'number' && Number.isFinite(a.weightKg)) {
        explicitWeight = true;
        weightValue = a.weightKg <= 0 ? 0 : Math.round(a.weightKg * 10) / 10;
        weightHint = weightValue;
      }
    }

    let load;
    if (mixedLoad) load = 'unknown';
    else if (explicitWeight) load = weightValue <= 0 ? 'bw' : weightValue;
    else load = 'unknown'; // 只有旧口径的空记录会落到这里；新记录留空已在输入层按自重（0）记
    return {
      date: entry.date,
      sets,
      planned,
      avg,
      repsEach,
      load,
      mixedLoad,
      repsDetail,
      explicitWeight,
      weightHint,
      setsComplete: planned > 0 ? sets >= planned : sets > 0
    };
  }
  function progSameLoad(a, b) {
    if (!a || !b || a.mixedLoad || b.mixedLoad) return false;
    if (a.load === 'unknown' || b.load === 'unknown') return false;
    if (a.load === 'bw' && b.load === 'bw') return true;
    return typeof a.load === 'number' && typeof b.load === 'number'
      && Math.abs(a.load - b.load) <= PROG_SAME_LOAD_KG;
  }
  function progRepDecline(newer, older) {
    if (!progSameLoad(newer, older)) return false;
    if (!newer || !older) return false;
    if (newer.repsDetail !== 'ok' || older.repsDetail !== 'ok') return false;
    if (!newer.setsComplete || !older.setsComplete) return false;
    if (newer.avg === null || older.avg === null) return false;
    return older.avg - newer.avg >= 1;
  }
  /* 近 28 天刺激组 / 4。这是日志估算，不是 ACSM 清点的「每周直接组数」。 */
  function progWeeklyVolume(muscleMap, action) {
    const weights = inferMuscleWeights(action.name, '');
    const primary = Object.entries(weights).sort((a, b) => b[1] - a[1])[0];
    if (!primary || !muscleMap) return null;
    const m = muscleMap.get(primary[0]);
    if (!m || typeof m.weeklyStimSets !== 'number' || !Number.isFinite(m.weeklyStimSets)) return null;
    return { label: m.label || primary[0], weekly: m.weeklyStimSets };
  }
  function progAdviceWeight(session, planWeightNum) {
    if (session && typeof session.load === 'number') return session.load;
    if (session && session.mixedLoad && typeof session.weightHint === 'number' && session.weightHint > 0) return session.weightHint;
    if (session && session.load === 'bw') return null;
    return planWeightNum;
  }
  function progDeloadTarget(actionName, weight) {
    const step = equipmentStepKg(actionName);
    const raw = weight * 0.9;
    let next = step > 0.5 ? Math.floor((raw + 1e-9) / step) * step : roundLoadHalf(raw);
    if (!(next < weight - 1e-9)) next = roundLoadHalf(weight - step);
    if (next < step) next = step;
    next = roundLoadHalf(next);
    return { next, delta: Math.round((next - weight) * 10) / 10 };
  }
  function progJumpPct1(delta, base) {
    return Math.round(delta / base * 1000) / 10;
  }
  /* 用实际公斤增幅除以当前重量，不先四舍五入成整数百分比。10.4% 不能因为显示成 10% 就放行。 */
  function progJumpTooBig(delta, base) {
    return base > 0 && delta / base > 0.1 + 1e-9;
  }
  /* 有逐组或列表时，每一组都要达到 bar。一个数字的简写表示每组都是这个次数。看不清则不能确认。 */
  function allSetsAt(session, bar) {
    if (!session || !Array.isArray(session.repsEach) || session.sets <= 0) return false;
    if (session.repsEach.length < session.sets) return false;
    return session.repsEach.slice(0, session.sets).every((n) => n + 1e-9 >= bar);
  }
  /* 负重已连续两次做到目标上限。步长过大时改加次数；否则才加重。2–10% 只作 2009 年的历史上限。 */
  function progLoadedTop(item, action, last, plan, plannedSets, ref, rangeTxt, okTwice, inc) {
    const tooBig = progJumpTooBig(inc.actualDelta, last.load);
    const pct1 = progJumpPct1(inc.actualDelta, last.load);
    const notes = inc.note.length ? inc.note.join('；') : '';
    item.sets = plannedSets || last.sets;
    item.weightKg = last.load;
    if (!okTwice) {
      item.repsText = action.plannedRepsText || String(plan.hi);
      const over = last.avg >= plan.hi + 2 ? '，并且超出区间上限 2 次以上' : '';
      const plate = tooBig
        ? `即便再做到一次，最小可加也是 ${inc.actualDelta}kg（约 +${pct1}%${notes ? '，' + notes : ''}），高于 ACSM 2009 历史建议的 10% 上限，到时候仍然先加次数而不是跳重量。2026 新版没有重申这个百分比。`
        : `再做到一次，才会考虑加重约 ${inc.actualDelta}kg（实际约 +${inc.actualPct}%）。2–10% 只是 2009 年的历史范围，ACSM 2026 没有规定每次加百分之几，也没有要求必须练到力竭。`;
      item.reason = `${ref}在 ${progFmt(last.load)}kg 平均 ${progFmt(last.avg)} 次，到了目标上限 ${rangeTxt}${over}。这个重量下还没有连续两次达标，先用同一重量再完成一次，避免把单次记录当成该加重。${plate}`;
      return item;
    }
    if (tooBig) {
      if (last.avg >= 30) {
        item.repsText = action.plannedRepsText || progFmt(last.avg);
        item.reason = `${ref}已连续两次在 ${progFmt(last.load)}kg 做到目标。下一次最小可加 ${inc.actualDelta}kg（约 +${pct1}%${notes ? '，' + notes : ''}），高于 2009 年历史建议的 10% 上限，而次数已经很高。先巩固，不跳重量。ACSM 2026 没有确认这个百分比。`;
        return item;
      }
      item.mode = 'add-reps'; item.modeLabel = '加次数';
      item.repsText = String(Math.min(100, Math.round(last.avg) + 1));
      item.reason = `${ref}已连续两次在 ${progFmt(last.load)}kg 做到目标上限 ${rangeTxt}。下一次最小可加 ${inc.actualDelta}kg（约 +${pct1}%${notes ? '，' + notes : ''}），高于 ACSM 2009 历史建议的 10% 上限。2026 新版没有重申每次加百分之几；固定重量增加次数同样能带来适应（Plotkin 等 2022）。先不跳重量，同重量每次多 1 次。`;
      return item;
    }
    item.mode = 'add-weight'; item.modeLabel = '加重量';
    item.weightKg = inc.next;
    item.deltaKg = inc.actualDelta;
    item.deltaPct = inc.actualPct;
    item.repsText = plan.hi > plan.lo ? `${plan.lo}-${Math.min(plan.hi, plan.lo + 2)}` : String(plan.lo);
    item.reason = `${ref}连续两次在 ${progFmt(last.load)}kg 都做到目标上限 ${rangeTxt}${last.avg >= plan.hi + 2 ? '（超出区间上限 2 次以上）' : ''}。${inc.label}按产品取档加重 ${inc.actualDelta}kg（实际 +${inc.actualPct}%${notes ? '；' + notes : ''}），次数回到区间下限。ACSM 2026 支持用加重来渐进，但没有规定每次加百分之几；2–10% 只是 2009 年的历史范围，用来避免一次加得太猛。动作分类、0.5kg 取整和 5kg 封顶是产品规则。`;
    return item;
  }
  /* 自重次数到顶。只有记录到的周刺激估算明显低于 10 组时，才建议加 1 组。 */
  function progBodyweightTop(item, action, last, plan, plannedSets, muscleMap, ref, rangeTxt, okTwice) {
    const cap = (plannedSets || last.sets) + 2;
    item.weightKg = null;
    item.sets = plannedSets || last.sets;
    item.repsText = action.plannedRepsText || String(plan.hi);
    if (!okTwice) {
      item.reason = `${ref}自重平均 ${progFmt(last.avg)} 次，到了 ${rangeTxt}。还没有连续两次做到，先不加组，用同样的组数再完成一次。`;
      return item;
    }
    const vol = progWeeklyVolume(muscleMap, action);
    if (!vol) {
      item.reason = `${ref}自重已连续两次做到 ${rangeTxt}，但看不清这个肌群最近的周训练量，先不加组。`;
      return item;
    }
    const w = progFmt(vol.weekly);
    if (vol.weekly < PROG_VOLUME_CONTEXT_SETS) {
      if (last.sets >= cap) {
        item.reason = `${ref}自重已经连续两次做到 ${rangeTxt}，组数也到了产品的临时上限（计划组数 +2）。先不加组。`;
        return item;
      }
      item.mode = 'add-sets'; item.modeLabel = '加组数';
      item.sets = last.sets + 1;
      item.reason = `${ref}自重平均 ${progFmt(last.avg)} 次，连续两次都到了 ${rangeTxt}。${vol.label}按近 28 天记录估算大约每周 ${w} 组刺激，低于 ACSM 2026 里与更大增肌相关的每周 10 组这一档。这一档是人群剂量反应，不是必须达到的个人指标；最合适的组数新版写明无法确定。记录量偏低时，产品建议加 1 组。`;
      return item;
    }
    item.reason = `${ref}自重已经连续两次做到 ${rangeTxt}，但不自动加组。${vol.label}近 28 天估算大约每周 ${w} 组。ACSM 2026：每周 ≥10 组与更大的增肌相关，这是剂量反应不是个人定额；最合适的组数无法确定，大约 18–20 组/周后收益递减也不是硬上限。所以到了这一档就不自动再加组。`;
    return item;
  }
  function progAdviceForAction(state, day, action, muscleMap) {
    const hist = recentActuals(state, action.name, day.date, 3).map(progSessionMetrics);
    const last = hist[0] || null;
    const prev = hist[1] || null;
    const prev2 = hist[2] || null;
    const ref = last && last.date === day.date ? '本次' : '上次';
    const plannedSets = action.plannedSets > 0 ? action.plannedSets : (last ? last.sets : 0);
    const planWeightNum = firstNumber(action.plannedWeightText);
    const plan = parseRepRange(action.plannedRepsText);
    const item = {
      actionKey: action.actionKey, name: action.name, ref,
      hasLast: !!(last && (last.sets > 0 || last.avg !== null || last.explicitWeight)),
      lastDate: last ? last.date : null,
      mode: 'hold', modeLabel: '巩固',
      weightKg: null, weightUnknown: !!(last && last.load === 'unknown'),
      /* 上次记的是明确自重（0 / 「自重」）：建议与模板写回都按自重处理，不回填计划里的器械重量 */
      bodyweight: !!(last && last.load === 'bw'),
      sets: plannedSets || null, repsText: action.plannedRepsText || '',
      deltaKg: null, deltaPct: null, reason: ''
    };
    const rangeTxt = plan ? `${plan.lo}–${plan.hi}` : '';
    const keep = () => {
      item.weightKg = progAdviceWeight(last, planWeightNum);
      item.sets = plannedSets || last.sets;
      item.repsText = action.plannedRepsText || (last.avg !== null ? progFmt(last.avg) : item.repsText);
    };
    /* 两次都要做满「这次建议所依据的目标组数」，不能只用上一课自己的计划组数。 */
    const setsOk = (session, need) => session && session.repsDetail === 'ok' && !session.mixedLoad
      && session.avg !== null && (need > 0 ? session.sets >= need : session.setsComplete);
    const confirmed = (bar) => !!prev && progSameLoad(last, prev)
      && setsOk(last, plannedSets) && setsOk(prev, plannedSets)
      && last.avg + 1e-9 >= bar && prev.avg + 1e-9 >= bar
      && allSetsAt(last, bar) && allSetsAt(prev, bar);

    /* 0) 还没有完成数据：先按计划记录 */
    if (!item.hasLast) {
      item.mode = 'start'; item.modeLabel = '按计划开始';
      item.weightKg = planWeightNum;
      item.reason = plan
        ? '首次记录：按计划完成并填写实际组数/次数/负重，之后每次练完会自动给出递进建议'
        : '首次记录：建议把目标写成次数区间（如 8-12）并固定重量，记录后即可自动递进';
      return item;
    }

    if (plannedSets > 0 && last.sets < plannedSets) {
      keep();
      item.sets = plannedSets;
      item.reason = `${ref}完成 ${last.sets}/${plannedSets} 组。组数没做满时先补满，不加重、不加次数。`;
      return item;
    }
    if (last.repsDetail !== 'ok' || last.avg === null) {
      keep();
      item.reason = last.repsDetail === 'partial'
        ? `${ref}完成 ${last.sets} 组，但次数没有逐组记全。对不齐的次数不能用来加重或判断退步，先补全，这次不加重。`
        : `${ref}没有记下次数。缺次数不会建议加重，补记后再判断。`;
      return item;
    }
    if (last.mixedLoad) {
      keep();
      item.reason = `${ref}同一次训练里各组成的负重不一样，不能拿一个平均次数去加重或判断下滑。先按同一负重做完整记录，这次不加重。`;
      return item;
    }
    if (progRepDecline(last, prev) && progRepDecline(prev, prev2) && progSameLoad(last, prev2)) {
      item.mode = 'deload'; item.modeLabel = '减载';
      item.repsText = action.plannedRepsText || progFmt(last.avg);
      item.sets = plannedSets || last.sets;
      if (typeof last.load === 'number') {
        const cut = progDeloadTarget(action.name, last.load);
        item.weightKg = cut.next;
        item.deltaKg = cut.delta;
        item.reason = `${ref}在同一负重 ${progFmt(last.load)}kg 上连续两次下滑（均次 ${progFmt(prev2.avg)} → ${progFmt(prev.avg)} → ${progFmt(last.avg)}）。不同负重的次数没有拿来比较。建议先放到 ${cut.next}kg（大约少一成）练 1–2 次。减一成是产品启发式，ACSM 2026 没有规定这个比例。`;
      } else if (last.sets > 1) {
        item.weightKg = null;
        item.sets = last.sets - 1;
        item.reason = `${ref}自重均次连续两次下滑（${progFmt(prev2.avg)} → ${progFmt(prev.avg)} → ${progFmt(last.avg)}）。先少做 1 组。少一组是产品启发式，不是被验证过的固定比例。`;
      } else {
        keep();
        item.reason = `${ref}自重均次连续两次下滑，但只做了 1 组，不再减到 0 组。先用同一安排再完成一次。`;
      }
      return item;
    }
    if (last.load === 'unknown') {
      keep();
      item.reason = `${ref}次数有了，负重没记（这是旧口径留空的记录，现在留空会按自重记）。不会按计划重量去加重。若这次是自重，在负重里写「自重」或填 0；若用了器械，补上实际重量后再判断。`;
      return item;
    }

    const atTop = plan && last.avg + 1e-9 >= plan.hi && setsOk(last, plannedSets);
    if (atTop && !allSetsAt(last, plan.hi)) {
      keep();
      const short = Array.isArray(last.repsEach) ? last.repsEach.filter((n) => n + 1e-9 < plan.hi).length : 0;
      item.reason = short > 0
        ? `${ref}平均 ${progFmt(last.avg)} 次到了上限 ${rangeTxt}，但有 ${short} 组没到 ${plan.hi} 次。平均次数不能代替每一组，先把每组都做到上限，这次不加重。`
        : `${ref}平均 ${progFmt(last.avg)} 次到了上限 ${rangeTxt}，但看不清每一组是不是都到了。无法确认时先巩固，不加重。`;
      return item;
    }
    if (atTop && last.load === 'bw') {
      return progBodyweightTop(item, action, last, plan, plannedSets, muscleMap, ref, rangeTxt, confirmed(plan.hi));
    }
    if (atTop && typeof last.load === 'number') {
      return progLoadedTop(item, action, last, plan, plannedSets, ref, rangeTxt, confirmed(plan.hi), progLoadStep(action.name, last.load));
    }
    if (plan && last.avg + 1e-9 >= plan.lo && setsOk(last, plannedSets)) {
      item.mode = 'add-reps'; item.modeLabel = '加次数';
      item.weightKg = progAdviceWeight(last, planWeightNum);
      item.sets = plannedSets || last.sets;
      const nxt = Math.min(plan.hi, Math.round(last.avg) + 1);
      item.repsText = nxt >= plan.hi ? String(plan.hi) : `${nxt}-${plan.hi}`;
      const where = last.load === 'bw' ? '自重' : `${progFmt(last.load)}kg`;
      item.reason = `双递进：${ref} ${where} 平均 ${progFmt(last.avg)} 次，还在 ${rangeTxt} 里。负荷不变，每组争取多 1 次。ACSM 2026 把加重和加组数都当作提高刺激的办法；Plotkin 等 2022 的试验里，固定重量增加次数和增加重量，8 周里都能带来肌肉适应。`;
      return item;
    }
    if (plan && setsOk(last, plannedSets)) {
      const far = (session) => session && session.repsDetail === 'ok' && session.setsComplete
        && !session.mixedLoad && session.avg !== null && session.avg <= plan.lo - 2;
      const again = far(last) && far(prev) && progSameLoad(last, prev);
      if (again && typeof last.load === 'number') {
        const cut = progDeloadTarget(action.name, last.load);
        item.mode = 'deload'; item.modeLabel = '减载';
        item.weightKg = cut.next;
        item.deltaKg = cut.delta;
        item.sets = plannedSets || last.sets;
        item.repsText = action.plannedRepsText || item.repsText;
        item.reason = `${ref}在 ${progFmt(last.load)}kg 连续两次都明显低于下限 ${plan.lo}（${progFmt(prev.avg)} 次、${progFmt(last.avg)} 次）。建议先放到 ${cut.next}kg（大约少一成）。这个比例是产品启发式，ACSM 2026 没有把它定成减载定律。`;
        return item;
      }
      if (again && last.load === 'bw' && last.sets > 1) {
        item.mode = 'deload'; item.modeLabel = '减载';
        item.weightKg = null;
        item.sets = last.sets - 1;
        item.repsText = action.plannedRepsText || item.repsText;
        item.reason = `${ref}自重连续两次都明显低于下限 ${plan.lo}。先少做 1 组。少一组是产品启发式，不是固定比例。`;
        return item;
      }
      keep();
      item.reason = last.avg <= plan.lo - 2
        ? `${ref}平均 ${progFmt(last.avg)} 次，比下限 ${plan.lo} 少了 2 次以上。先用同一安排再做一次；一次偏低不直接减重。`
        : `${ref}平均 ${progFmt(last.avg)} 次，还没到下限 ${plan.lo}。同重量先稳定做到 ${plan.lo} 次，不加重。`;
      return item;
    }
    if (!setsOk(last, plannedSets)) {
      keep();
      item.reason = `${ref}记录还不完整，先补全组数和次数。不完整的记录不会建议加重。`;
      return item;
    }
    /* 没写次数区间。15 次、20 次只是产品上的「次数已经偏高」切点，不是 ACSM 的数字。 */
    if (last.load === 'bw' && last.avg + 1e-9 >= 20) {
      return progBodyweightTop(item, action, last, { lo: 15, hi: 20 }, plannedSets, muscleMap, ref, '高次数', confirmed(20));
    }
    if (typeof last.load === 'number' && last.avg + 1e-9 >= 15 && confirmed(15)) {
      const inc = progLoadStep(action.name, last.load);
      item.sets = plannedSets || last.sets;
      if (progJumpTooBig(inc.actualDelta, last.load)) {
        item.mode = 'add-reps'; item.modeLabel = '加次数';
        item.weightKg = last.load;
        item.repsText = String(Math.min(100, Math.round(last.avg) + 1));
        item.reason = `${ref}平均 ${progFmt(last.avg)} 次，连续两次都偏高，但下一次最小可加 ${inc.actualDelta}kg（约 +${progJumpPct1(inc.actualDelta, last.load)}%），高于 ACSM 2009 历史建议的 10% 上限。2026 新版没有重申这个百分比。先不跳重量，同重量多 1 次，并把目标写成区间（如 8-12）。`;
        return item;
      }
      item.mode = 'add-weight'; item.modeLabel = '加重量';
      item.weightKg = inc.next;
      item.deltaKg = inc.actualDelta;
      item.deltaPct = inc.actualPct;
      item.repsText = '8-12';
      item.reason = `${ref}平均 ${progFmt(last.avg)} 次，连续两次在 ${progFmt(last.load)}kg 都偏高。加重 ${inc.actualDelta}kg（实际 +${inc.actualPct}%）。建议把目标写成 8-12。单次 2–10% 只是 2009 年的历史范围，ACSM 2026 没有规定每次加百分之几。`;
      return item;
    }
    item.mode = 'add-reps'; item.modeLabel = '加次数';
    item.weightKg = progAdviceWeight(last, planWeightNum);
    item.sets = plannedSets || last.sets;
    const nxt = Math.min(100, Math.round(last.avg) + 1);
    item.repsText = String(nxt);
    item.reason = `${ref}平均 ${progFmt(last.avg)} 次。同重量先多 1 次，不凭一次偏高的次数加重。建议把目标写成区间（如 ${nxt}-${nxt + 2}）。`;
    return item;
  }
  /* 汇总一个训练日所有动作的下次建议。cutoff 取 day.date：收尾后传当天记录可引用本次数据，
     预览/轮转回来的新一天则自动取更早的最近一次记录。 */
  function nextSessionAdvice(state, day, options) {
    if (!day || !Array.isArray(day.actions) || !day.actions.length) return null;
    const muscleMap = new Map(muscleProgress(state, day.date).map((m) => [m.key, m]));
    const items = day.actions.map((a) => progAdviceForAction(state, day, a, muscleMap));
    /* 恢复上下文（2026-09-22 审计补充）：昨晚睡眠不足或连续两晚不足时，
       「加重量/加次数/加组数」类进取建议降级为 hold 巩固——睡眠剥夺下最大力量、
       下肢爆发力与训练耐力均下降、RPE 升高（Fullagar 2015 系统综述），此时推进负荷
       依赖动作变形代偿；deload/hold 本身是恢复方向，不再叠加降级。降级不丢数据：
       原建议的原因文案保留在 adviceReason，恢复后建议自动回到进取方向。 */
    const rec = (options && options.recovery) || null;
    let recovery = null;
    if (rec && Number.isFinite(rec.sleepMinutesLastNight)) {
      const lastNight = rec.sleepMinutesLastNight;
      const twoShort = Number.isFinite(rec.consecutiveShortNights) && rec.consecutiveShortNights >= 2;
      if (lastNight < 360 || twoShort) {
        recovery = {
          active: true,
          reason: lastNight < 360
            ? `昨晚约 ${Math.round(lastNight / 6) / 10} 小时睡眠（不足 6 小时）`
            : '连续两晚睡眠不足 6.5 小时',
          degraded: items.filter((i) => ['add-weight', 'add-reps', 'add-sets'].includes(i.mode)).length
        };
        for (const item of items) {
          if (!['add-weight', 'add-reps', 'add-sets'].includes(item.mode)) continue;
          const action = day.actions.find((a) => a.actionKey === item.actionKey) || {};
          const last = recentActuals(state, action.name || item.name, day.date, 1).map(progSessionMetrics)[0] || null;
          item.prevMode = item.mode; item.prevModeLabel = item.modeLabel;
          item.mode = 'hold'; item.modeLabel = '恢复优先';
          item.deltaKg = 0; item.deltaPct = null;
          if (last && last.load === 'bw') {
            item.weightKg = null; item.bodyweight = true;
            item.sets = action.plannedSets || last.sets;
          } else if (last && typeof last.load === 'number') {
            item.weightKg = last.load;
            item.sets = action.plannedSets || last.sets;
          }
          if (last) item.repsText = action.plannedRepsText || (last.avg != null ? progFmt(last.avg) : item.repsText);
          item.reason = `【恢复优先】${recovery.reason}——睡眠剥夺下力量表现下降、主观疲劳感升高（Fullagar 2015），今天按计划重量巩固动作质量、不推进负荷；睡好再来，进步更稳。原建议：${item.reason}`;
        }
      }
    }
    return {
      date: day.date, dayName: day.name, items,
      hasAnyData: items.some((i) => i.hasLast),
      recovery
    };
  }

  /* ---------- 餐后锻炼时机（饮食 × 训练时间窗，2026-09-26 新增） ----------
   * 输入 rhythm 的进餐记录（local/kind/mealType），输出所选日期最后一餐之后的训练编排：
   * 何时能散步、何时能练、今晚最晚几点结束、明天的高表现窗。阈值全部取自
   * rhythm-evidence.rules（postMealWorkout / eveningWorkout / performanceWindow），依据：
   * - 餐后 10–15 分钟可低强度步行、30 分钟内开始餐后血糖削减收益最大（DiPietro 2013 Diabetes Care）；
   *   晚餐后步行收益最强（Reynolds 2016 Diabetologia：餐后血糖约 −12%，晚餐后约 −22%）；
   * - 中高强度距正餐 ≥2 小时（Mayo Clinic 口径正餐 2–3 小时、大餐 3–4 小时；Cleveland Clinic：
   *   剧烈运动至少等 2 小时）、距加餐 ≥30–60 分钟；岔气在餐后状态更易诱发（Morton & Callister 2015）；
   * - 剧烈运动默认就寝前 ≥2 小时结束、中等强度 ≥1 小时：睡前 ≤1 小时结束的剧烈运动损害入睡
   *   （Stutz 2019 Sports Medicine meta），睡前 ≥4 小时结束与睡眠指标无关联（Leota 2025 Nature
   *   Communications，观察性），默认 2 小时为折中；就寝锚点优先由视图层传今晚入睡建议，缺省 23:00
   *   （Nikbakhtian 2021 EHJ-DH：22:00–22:59 入睡人群心血管事件最低，观察性）；
   * - 高表现窗 14:00–19:00（Knaier 2022 MSSE meta：无氧功率/跳跃峰值 13:00–20:00、握力 14:00–21:00），
   *   只作排序参考——任何时段的锻炼都优于不练。
   * 只读展示与编排，不做血糖/睡眠预测，不构成运动处方。 */
  function postMealTimingAdvice(meals, now, options) {
    const PM = E.rules.postMealWorkout, EW = E.rules.eveningWorkout, PW = E.rules.performanceWindow;
    const opts = options || {};
    const date = opts.date;
    if (!isBusinessDate(date)) return null;
    const nowD = now instanceof Date ? now : new Date(now || Date.now());
    const isToday = date === businessDate(nowD);
    const bedMinutes = Number.isFinite(opts.bedMinutes) && opts.bedMinutes >= 0 && opts.bedMinutes < 1440
      ? opts.bedMinutes : EW.defaultBedMinutes;
    const valid = (Array.isArray(meals) ? meals : [])
      .filter((m) => m && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(m.local || ''))
      .sort((a, b) => a.local.localeCompare(b.local));
    const onDate = valid.filter((m) => m.local.slice(0, 10) === date);
    let last = onDate.length ? onDate[onDate.length - 1] : null;
    /* 今天还没记餐时，用上一次进食（可以是昨天）。历史日期只回放当天，不把别的日子拉进来。 */
    if (!last && isToday) {
      const stamp = RE.localNow(nowD);
      const prior = valid.filter((m) => m.local <= stamp);
      last = prior.length ? prior[prior.length - 1] : null;
    }
    const out = {
      date, isToday, bedMinutes, bedtime: RE.clockText(bedMinutes),
      hasMeal: !!last, lastMeal: null,
      performanceWindow: { start: RE.clockText(PW.startMinutes), end: RE.clockText(PW.endMinutes) },
      cutoffs: {}, items: [], sources: [].concat(PM.sources, EW.sources, PW.sources),
      disclaimer: '锻炼时机为习惯编排参考，不是运动处方；孕期、疾病或用药（如胰岛素）请遵医嘱；不预测个人血糖或睡眠表现。'
    };
    if (!last) {
      out.items.push({ key: 'no-meal', level: 'info', title: '还没有进餐记录',
        text: `记下吃完的时间后，这里会按上一次进食推算力量训练最早几点开始。人群高表现窗一般为 ${out.performanceWindow.start}–${out.performanceWindow.end}（Knaier 2022）——任何时段的锻炼都好于不练。` });
      return out;
    }
    const snackType = last.mealType === 'morning-snack' || last.mealType === 'afternoon-snack' || last.mealType === 'evening-snack';
    const isSnack = last.kind === 'snack' || snackType;
    const mealMinutes = Number(last.local.slice(11, 13)) * 60 + Number(last.local.slice(14, 16));
    const mealAt = new Date(last.local);
    const priorDay = last.local.slice(0, 10) !== date;
    const minutesAgo = isToday && Number.isFinite(+mealAt) ? Math.max(0, Math.round((nowD.getTime() - mealAt.getTime()) / 60000)) : null;
    out.lastMeal = {
      local: last.local, time: RE.clockText(mealMinutes), kind: isSnack ? 'snack' : (last.kind || 'meal'),
      isSnack, minutesAgo, priorDay,
      typeLabel: RE.mealTypeLabel(last.mealType) || RE.mealTypeLabel(RE.classifyMealType(last.local)) || (isSnack ? '加餐' : '正餐')
    };
    const gapM = isSnack ? PM.moderateGapSnackMinutes : PM.moderateGapMealMinutes;
    const gapV = isSnack ? PM.vigorousGapSnackMinutes : PM.vigorousGapMealMinutes;
    const gapText = (n) => n % 60 === 0 ? `${n / 60} 小时` : `${n} 分钟`;
    const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    let walk, moderate, vigorous;
    if (isToday && Number.isFinite(+mealAt)) {
      /* 用真实时刻，而不是「当天钟点相减」。昨天的晚餐不会被当成今天 19:00 还没到。 */
      const bedDeadline = (before) => {
        const d = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), 0, 0, 0, 0);
        const axis = bedMinutes < 360 ? bedMinutes + 1440 : bedMinutes;
        d.setMinutes(axis - before);
        return d;
      };
      const planAbs = (gap, before) => {
        const startAt = new Date(mealAt.getTime() + gap * 60000);
        const capAt = bedDeadline(before);
        const windowMinutes = Math.max(0, Math.round((capAt.getTime() - startAt.getTime()) / 60000));
        return {
          atText: hhmm(startAt), capText: hhmm(capAt), windowMinutes,
          feasible: startAt.getTime() + 30 * 60000 <= capAt.getTime() && nowD.getTime() < capAt.getTime(),
          ready: nowD.getTime() >= startAt.getTime() && nowD.getTime() < capAt.getTime(),
          waitMinutes: nowD.getTime() < startAt.getTime() ? Math.max(0, Math.round((startAt.getTime() - nowD.getTime()) / 60000)) : 0
        };
      };
      const walkAt = new Date(mealAt.getTime() + PM.walkStartMinutes * 60000);
      walk = { atText: hhmm(walkAt), ready: nowD.getTime() >= walkAt.getTime() };
      moderate = planAbs(gapM, EW.moderateBeforeBedMinutes);
      vigorous = planAbs(gapV, EW.vigorousBeforeBedMinutes);
    } else {
      const bedAxis = bedMinutes < 360 ? bedMinutes + 1440 : bedMinutes;
      const plan = (at, cap) => ({
        atText: RE.clockText(at), capText: RE.clockText(cap),
        windowMinutes: Math.max(0, cap - at),
        feasible: at <= cap - 30,
        ready: false,
        waitMinutes: null
      });
      walk = { atText: RE.clockText(mealMinutes + PM.walkStartMinutes), ready: false };
      moderate = plan(mealMinutes + gapM, bedAxis - EW.moderateBeforeBedMinutes);
      vigorous = plan(mealMinutes + gapV, bedAxis - EW.vigorousBeforeBedMinutes);
    }
    out.walk = walk; out.moderate = moderate; out.vigorous = vigorous;
    out.cutoffs = { moderateEnd: moderate.capText, vigorousEnd: vigorous.capText };
    const mealWord = isSnack ? '加餐' : '正餐';
    out.items.push({ key: 'walk', level: walk.ready ? 'now' : 'later',
      title: `低强度（散步 / 拉伸）${walk.ready ? '· 现在就可以' : `· ${walk.atText} 起`}`,
      text: `${isSnack ? '加餐后即可活动' : '正餐后 10–15 分钟即可开始'}，散步 10–15 分钟；餐后 30 分钟内开始对餐后血糖的削减收益最大（DiPietro 2013），晚餐后步行收益最强（Reynolds 2016：约 −22%）。` });
    out.items.push({ key: 'moderate', level: moderate.feasible ? (moderate.ready ? 'now' : 'later') : 'off',
      title: `中等强度（快走 / 慢跑）${moderate.feasible ? (moderate.ready ? '· 现在可以进行' : `· 最早 ${moderate.atText}`) : '· 今晚时间窗不足'}`,
      text: moderate.feasible
        ? `距${mealWord} ≥ ${gapText(gapM)}（指南口径 2–3 小时取保守下限）；今晚须在 ${moderate.capText} 前结束（就寝前 ≥1 小时，Stutz 2019）。`
        : `今晚距就寝的时间窗不足——中等强度也建议在 ${moderate.capText} 前结束（就寝前 ≥1 小时），可改到明天 ${out.performanceWindow.start}–${out.performanceWindow.end}。` });
    out.items.push({ key: 'vigorous', level: vigorous.feasible ? (vigorous.ready ? 'now' : 'later') : 'off',
      title: `力量训练${vigorous.feasible ? (vigorous.ready ? '· 现在可以开始' : `· 最早 ${vigorous.atText}`) : '· 今晚建议改期'}`,
      text: vigorous.feasible
        ? `距${mealWord} ≥ ${gapText(gapV)}（Mayo Clinic：普通正餐 2–3 小时、大餐 3–4 小时、加餐约 1 小时；这里正餐取 2 小时、加餐取 1 小时）。今晚最晚 ${vigorous.capText} 前结束（就寝前 ≥2 小时，Stutz 2019；Leota 2025）${vigorous.windowMinutes < 60 ? `——窗口约 ${vigorous.windowMinutes} 分钟，建议压缩为 30–45 分钟短课` : ''}。`
        : `今晚就寝前时间窗不足：力量训练须在 ${vigorous.capText} 前结束（就寝前 ≥2 小时），建议改为散步或拉伸，力量训练安排到明天 ${out.performanceWindow.start}–${out.performanceWindow.end} 高表现窗。` });
    if (!isSnack) out.items.push({ key: 'large-meal', level: 'note', title: '大餐提示',
      text: '若是高脂大餐（火锅、烤肉、酒局），胃排空更慢，建议在上面的时间下限上再多等约 1 小时。' });
    out.items.push({ key: 'bed-anchor', level: 'note', title: `就寝锚点 ${out.bedtime}`,
      text: `今晚按 ${out.bedtime} 就寝计算${opts.bedSource === 'advice' ? '（来自「今晚入睡建议」）' : '（默认锚点：22:00–23:00 入睡与较低心血管事件率相关，Nikbakhtian 2021，观察性）'}；睡前 1 小时内的剧烈运动可能损害入睡（Stutz 2019），低强度拉伸可保留到睡前。` });
    return out;
  }

  const api = {
    DAY_STATUSES, STATUS_LABELS,
    isBusinessDate, businessDate, addDays,
    normalize, emptyState, validateTemplateInput,
    parseWeightInput, resolveWeightInput, weightLabelKg,
    templateById, currentVersion, versionOf,
    replaceTemplate, selectCycleDay, assignTrainingDay,
    startTraining, pauseTraining, resumeTraining, saveTraining,
    finishAndAdvance, skipAndAdvance, resolveDay, reopenDay,
    recordProgressDecision,
    todayPlan, dayRecord, lastActual, trainingBaseline, actionNameKey, progressDelta, volumeOf, statsSummary,
    DEFAULT_WEEKLY_SET_TARGET, MUSCLE_DEFINITIONS,
    estimateE1rmKg, summarizeTrainingSet, inferMuscleWeights,
    ENDURANCE_CONFIG, estimateEnduranceReps, perSetRepsFromText, fatigueRetention,
    enduranceRatioForSet, enduranceZoneSetCount,
    enduranceScoreFromRatio, scoreFromAnchors, normCurveFor, bodyweightFamilyOf,
    genericRepsScore, scoreEnduranceSet, scoreEnduranceAction,
    setCompletionScore, repStimMultiplier,
    collectObservations, buildMuscleProgress, muscleProgress,
    timerShouldRun, advanceDaySeconds,
    PROG_LOAD_RULES, loadProgressRule, parseRepRange, roundLoadHalf, nextLoadKg,
    repsSpecText, equipmentStepKg, progLoadStep,
    recentActuals, progSessionMetrics, progAdviceForAction, nextSessionAdvice,
    postMealTimingAdvice,
    validateImportPayload, applyImportPayload, importFrom, convertLegacyRows,
    historyEntries, weekDates, calendarRecords, templateHistory, effectiveTemplate,
    VOLUME_SET_WEIGHT, VOLUME_REP_WEIGHT, RECOMMENDED_WEEKLY_SETS, ACTIVITY_FACTORS,
    parseRepsText, computeVolume, mondayOf, shiftWeek, normalizeBodyPart, trendsSnapshot,
    bmi, bmiCategoryCN, healthyWeightRange, bmrMifflin, tdee
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StrengthCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
