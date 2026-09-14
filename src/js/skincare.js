/* 护肤模块：AI 计划文本自适应解析 / 周期管理 / 每日打卡 */

const Skincare = {
  ui: { skinPhotoKind: 'skin' }, /* 照片档案当前类别：skin 皮肤 / body 体型 */

  /* ============ 文本解析 ============ */
  // 把从任意 AI 处复制来的护肤计划文本，解析成周期结构（尽力而为，解析后可手动修改）
  parsePlanText(text) {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return [];

    const cycles = [];
    let cur = null;
    let phase = 'evening'; // 默认归入晚间
    // 早/午/晚关键词严格分组（三时段：晨间 / 日间 / 晚间）
    const MORN_WORDS = '晨间|早晨|早上|早间|清晨|清早';
    const DAY_WORDS = '日间|白天|中午|午间|午后|下午|日間';
    const EVEN_WORDS = '晚间|晚上|夜间|夜里|夜晚|睡前|晚間|傍晚';
    const PHASE_MORNING = new RegExp(`(${MORN_WORDS}|am\\b|morning)`, 'i');
    const PHASE_DAY = new RegExp(`(${DAY_WORDS}|noon|afternoon|midday)`, 'i');
    const PHASE_EVENING = new RegExp(`(${EVEN_WORDS}|pm\\b|evening|night)`, 'i');
    const CYCLE_HEAD = /(周期|階段|阶段|第\s*[一二三四五六七八九十百0-9]+\s*(周|期|阶段)|week\s*\d+|round\s*\d+)/i;
    const DATE = /(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/;
    const JUNK = /^(好的|以下是|这是|为你|希望|坚持|加油|祝你|温馨提示|注意安全|请|最后|另外|记得|如果|别忘|说明|备注)/;
    const TITLE_ONLY = /^(护肤|美容|面部|脸部|每日|日常)?(方案|计划|流程|安排|日程|routine|plan|steps|步骤)s?$/i;
    const isBullet = (l) => /^([-•*・·]|>\s*\d+[.、)]|\d{1,2}[.、)]|[①②③④⑤⑥⑦⑧⑨⑩])/.test(l);

    // 括号感知分割：不会把 （…） 里的顿号当成分隔符
    const splitItems = (line) => {
      const segs = [];
      let buf = '', depth = 0;
      for (const ch of line) {
        if ('（('.includes(ch)) depth++;
        if ('）)'.includes(ch)) depth = Math.max(0, depth - 1);
        if (depth === 0 && '、，,;；→⇒➜|｜'.includes(ch)) { segs.push(buf); buf = ''; continue; }
        buf += ch;
      }
      segs.push(buf);
      return segs.map(s => s.trim()).filter(Boolean);
    };

    const pushItem = (rawLine) => {
      if (!cur) {
        cur = this._newCycle('我的护肤计划');
        cycles.push(cur);
      }
      let line = rawLine.replace(/^([-•*・·]|\d{1,2}[.、)]|[①②③④⑤⑥⑦⑧⑨⑩]|>\s*\d+[.、)])\s*/, '').trim();
      if (!line) return;
      // 括号感知拆分；仅当各段都像短产品名时才拆
      const segs = splitItems(line);
      let parts = [line];
      if (segs.length > 1 && segs.every(s => s.length <= 16 && !/[：:]/.test(s))) parts = segs;
      for (const p of parts) {
        // 名称/用法拆分
        const m = p.match(/^(.{1,20}?)\s*[（(：:—–]\s*(.+?)[）)]*$/);
        const name = (m ? m[1] : p).trim().replace(/[：:]+$/, '').slice(0, 30);
        const detail = (m ? m[2] : '').trim().replace(/[）)]+$/, '').slice(0, 60);
        if (!name) continue;
        cur.steps[phase].push({ id: uid('st'), name, detail });
      }
    };

    // 判断一行是否"空标题"（以冒号结尾且无实际内容）
    const isEmptyHeader = (l) => /^[^：:]*[：:]\s*$/.test(l) && l.length <= 30;

    for (const raw of lines) {
      // 去 markdown 符号：# 标题、** 粗体、首尾空白
      const line = raw.replace(/^\s*#+\s*/, '').replace(/\*+/g, '').trim();
      if (!line) continue;

      // 日期行 → 设置当前周期起止
      const dm = line.match(DATE);
      if (dm && line.length < 60 && (CYCLE_HEAD.test(line) || /开始|结束|至|到|~|～|—/.test(line))) {
        if (!cur) { cur = this._newCycle('周期 ' + (cycles.length + 1)); cycles.push(cur); }
        const start = `${dm[1]}-${pad2(+dm[2])}-${pad2(+dm[3])}`;
        if (!cur.startDate) { cur.startDate = start; cur.name = cur.name === '未命名周期' ? line.slice(0, 24) : cur.name; }
        else cur.endDate = start;
        continue;
      }

      // 空标题（如 AI 开场白「好的，这是为你定制的护肤计划：」）→ 跳过
      if (isEmptyHeader(line)) { continue; }

      // 周期标题行
      if (CYCLE_HEAD.test(line) && line.length < 40 && !isBullet(line)) {
        cur = this._newCycle(line.replace(/[（(【\[].*?[）)\]】]/g, '').slice(0, 24) || ('周期 ' + (cycles.length + 1)));
        cycles.push(cur);
        const pd = line.match(/(\d+)\s*天/);
        if (pd && cur.startDate) cur.endDate = addDays(cur.startDate, Math.max(0, +pd[1] - 1));
        continue;
      }

      // 早/午/晚分段行（含实际内容时一并录入，如「早上用清水洗脸后涂保湿霜」）
      const phaseHit = PHASE_MORNING.test(line) ? 'morning'
        : PHASE_DAY.test(line) ? 'day'
        : PHASE_EVENING.test(line) ? 'evening' : null;
      if (phaseHit && line.length < 16) {
        phase = phaseHit;
        const words = phaseHit === 'morning' ? MORN_WORDS : phaseHit === 'day' ? DAY_WORDS : EVEN_WORDS;
        const rest = line.replace(new RegExp(words, 'gi'), '').replace(/^[-•*・·\s]+|[：:、,，\s]+$/g, '').trim();
        if (rest.length >= 3 && !/^[：:，、\s]*$/.test(rest)) pushItem(rest);
        continue;
      }

      // 行内出现时段关键词的标题（如“晨间：洁面、爽肤水”“中午：补涂防晒”）
      const inMorning = PHASE_MORNING.test(line), inDay = PHASE_DAY.test(line), inEvening = PHASE_EVENING.test(line);
      const phaseHits = [inMorning, inDay, inEvening].filter(Boolean).length;
      if (phaseHits === 1 && /[：:]/.test(line) && line.length < 60) {
        phase = inMorning ? 'morning' : inDay ? 'day' : 'evening';
        const body = line.replace(/^[^：:]*[：:]\s*/, '');
        if (body.trim()) pushItem(body);
        continue;
      }

      // 散文/客套话过滤：无条目符号的较长句子或寒暄开头直接跳过
      if (TITLE_ONLY.test(line.replace(/\s/g, ''))) continue;
      if (!isBullet(line) && (JUNK.test(line) || (line.length > 24 && !/[：:（(]/.test(line)))) continue;

      // 其余按条目处理
      pushItem(line);
    }

    // 兜底：没有解析出周期 → 全文作为单周期
    if (!cycles.length) return [];
    // 若全程无 cur（理论上不会）——过滤空周期
    return cycles.filter(c => c.steps.morning.length || c.steps.evening.length || c.name);
  },

  _newCycle(name) {
    return {
      id: uid('cyc'),
      name: name || '未命名周期',
      startDate: '',
      endDate: '',
      steps: { morning: [], day: [], evening: [] }
    };
  },

  /* 解析结果 → 可编辑的预览（每个周期转成三段文本，一行一个产品） */
  cyclesToEditable(cycles) {
    const toText = arr => (arr || []).map(s => s.detail ? `${s.name}：${s.detail}` : s.name).join('\n');
    return cycles.map(c => ({
      id: c.id,
      name: c.name,
      startDate: c.startDate || '',
      endDate: c.endDate || '',
      morningText: toText(c.steps.morning),
      dayText: toText(c.steps.day),
      eveningText: toText(c.steps.evening)
    }));
  },

  editableToCycles(edits) {
    const mk = (txt) => String(txt || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const m = line.match(/^(.{1,30}?)\s*[：:]\s*(.+)$/);
      return { id: uid('st'), name: m ? m[1].trim() : line.trim(), detail: m ? m[2].trim() : '' };
    });
    return edits.map((e, i) => ({
      id: e.id || uid('cyc'),
      name: e.name || ('周期 ' + (i + 1)),
      startDate: e.startDate || '',
      endDate: e.endDate || '',
      steps: { morning: mk(e.morningText), day: mk(e.dayText), evening: mk(e.eveningText) }
    }));
  },

  /* 导入：追加还是替换由调用方决定 */
  addCycles(cycles, replace) {
    if (replace) this.db.skincare.cycles = cycles;
    else this.db.skincare.cycles.push(...cycles);
    Store.save(true);
  },

  allProductNames() {
    const names = new Set();
    for (const c of Store.db.skincare.cycles || []) {
      for (const key of ['morning', 'day', 'evening']) {
        for (const s of c.steps[key] || []) names.add(s.name);
      }
    }
    return Array.from(names);
  },

  /* 快速添加一个护肤品步骤到当前周期（无周期则自动建一个长期周期） */
  quickAddModal(phase, onDone) {
    const labels = { morning: '☀️ 晨间', day: '🌤️ 日间', evening: '🌙 晚间' };
    const card = openModal(`
      <h3>＋ 添加护肤品 · ${labels[phase]}</h3>
      <label class="field">产品名称（必填）</label>
      <input class="input" id="qa-name" placeholder="如：防晒 SPF50 / 保湿面霜">
      <label class="field">用法说明（可选）</label>
      <input class="input" id="qa-detail" placeholder="如：出门前30分钟 / 隔天晚上用">
      <div class="row" style="justify-content:flex-end; margin-top:16px">
        <button class="btn ghost" id="qa-cancel">取消</button>
        <button class="btn primary" id="qa-ok">添加</button>
      </div>`);
    $('#qa-name', card).focus();
    $('#qa-cancel', card).onclick = closeModal;
    const save = () => {
      const name = $('#qa-name', card).value.trim();
      if (!name) { toast('先填产品名称', 'red'); return; }
      let cyc = Store.activeCycle();
      if (!cyc) {
        cyc = this._newCycle('我的护肤流程');
        cyc.startDate = todayKey();
        Store.db.skincare.cycles.push(cyc);
      }
      cyc.steps[phase] = cyc.steps[phase] || [];
      cyc.steps[phase].push({ id: uid('st'), name, detail: $('#qa-detail', card).value.trim() });
      Store.save(true);
      closeModal();
      toast(`已添加：${name} ✓`, 'green');
      if (onDone) onDone();
    };
    $('#qa-ok', card).onclick = save;
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  },

  /* 时段分界设置行 */
  _timesRow() {
    const t = Store.settings().skincareTimes || { morning: '09:00', noon: '12:00', evening: '20:00' };
    return `
      <div class="row" id="sk-times" style="align-items:flex-end">
        <div><label class="field">☀️ 晨间开始</label><input class="input sk-time" data-k="morning" type="time" value="${t.morning}" style="width:118px"></div>
        <div><label class="field">🌤️ 日间开始</label><input class="input sk-time" data-k="noon" type="time" value="${t.noon}" style="width:118px"></div>
        <div><label class="field">🌙 晚间开始</label><input class="input sk-time" data-k="evening" type="time" value="${t.evening}" style="width:118px"></div>
        <button class="btn small" id="sk-times-save">保存时段</button>
        <span class="hint">到点会提醒你做对应时段的护肤（该时段有步骤且未完成时）</span>
      </div>`;
  },

  bindTimesRow(root) {
    const box = $('#sk-times', root);
    if (!box) return;
    $('#sk-times-save', box).onclick = () => {
      const t = Store.settings().skincareTimes = Store.settings().skincareTimes || {};
      $$('.sk-time', box).forEach(inp => { t[inp.dataset.k] = inp.value || '00:00'; });
      Store.save(true);
      toast('护肤时段已保存 ✓', 'green');
    };
  },

  /* ---------- AI 识图（GLM-4V）：今日照片 → 结构化参数 → 预填表单 ---------- */
  async _shrinkForAI(file) {
    const b64 = await native.readSkinPhoto(file);
    if (!b64) throw new Error('照片读取失败');
    const url = `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${b64}`;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => reject(new Error('照片解码失败'));
      img.src = url;
    });
  },

  async _aiAnalyze() {
    if (this._aiBusy) return; /* in-flight 防双击：避免重复上传同一张照片 */
    this._aiBusy = true;
    const btn = $('#sk-ai-fill');
    if (btn) btn.disabled = true; /* 立即禁用防双击；「分析中」文案等确认与密钥检查过了再显示 */
    try {
      const t = todayKey();
      const photos = Store.db.skin.photos.filter((p) => p.kind === 'skin');
      const target = photos.find((p) => p.date === t) || photos[photos.length - 1];
      if (!target) { toast('先拍/传一张照片，AI 才有东西可看', 'red'); return; }
      /* 非今日照片必须用户显式确认：旧脸填今天会污染数据 */
      if (target.date !== t) {
        const ok = await confirmModal('使用历史照片？', `今天还没有照片，最近一张是 ${target.date}。用它填入今日记录可能不准确。`, '仍要使用');
        if (!ok) { toast('已取消，先在照片档案里添加今天的照片再识图'); return; }
      }
      const set = Store.settings();
      if (!set.aiApiKey) { this._aiSettingsModal(); return; }
      if (btn) btn.textContent = '🤖 分析中…'; /* 确认与密钥都过了，才真正进入上传阶段 */
      toast(`AI 正在分析 ${target.date === t ? '今日' : target.date} 的照片…`);
      const b64 = await this._shrinkForAI(target.file);
      const r = await native.analyzeSkinPhoto(b64, 'image/jpeg', set.aiApiKey, set.aiModel);
      if (!r.ok) { toast('AI 识图失败：' + r.error, 'red'); return; }
      this._applyAiResult(r.data);
    } catch (e) { toast('AI 识图失败：' + e.message, 'red'); }
    finally {
      this._aiBusy = false;
      const btn2 = $('#sk-ai-fill');
      if (btn2) { btn2.disabled = false; btn2.textContent = '🤖 AI 识图'; }
    }
  },

  _applyAiResult(d) {
    const root = $('#view-root');
    const fillSeg = (key, val) => {
      const seg = $(`.sk-seg[data-param="${key}"]`, root);
      if (!seg) return;
      $$('button', seg).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === val));
    };
    /* 9 个可自动填充字段：7 参数 + 整体 + 痘痘总数。严格校验：不合法项计数并提示 */
    const fields = [...SkinEngine.PARAMS.map((p) => [p.key, 0, 3, 'seg']), ['overall', 1, 10, 'seg'], ['acneTotal', 0, 99, 'num']];
    let filled = 0, invalid = 0;
    for (const [key, min, max, kind] of fields) {
      const raw = d[key];
      if (raw === undefined || raw === null || raw === '') continue;
      const n = SkinEngine.normAiInt(raw, min, max);
      if (n === null) { invalid++; continue; }
      if (kind === 'seg') fillSeg(key, n);
      else $(`#sk-${key === 'acneTotal' ? 'acne-total' : key}`, root).value = n;
      filled++;
    }
    const note = $('#sk-skin-note', root);
    if (note && !note.value.trim() && d.summary) note.value = `[AI识图] ${d.summary}`;
    toast(`AI 已填入 ${filled}/9 项${invalid ? `，${invalid} 项无效已跳过` : ''}${d.advice ? '。AI 建议：' + String(d.advice).slice(0, 60) : ''}`, invalid ? '' : 'green');
  },

  _aiSettingsModal() {
    const s = Store.settings();
    const card = openModal(`
      <h3>⚙️ AI 识图设置</h3>
      <p class="hint">使用智谱 GLM-4V 视觉模型识别面部照片（glm-4v-flash 免费）。密钥只保存在本机数据文件里；<b>只有你点「AI 识图」时才会把当次照片发给接口</b>，其余时间不出本机。密钥在 open.bigmodel.cn 申请。</p>
      <label class="field">API Key</label>
      <input class="input" id="ai-key" type="password" placeholder="粘贴智谱 API Key" value="${esc(s.aiApiKey || '')}">
      <label class="field">模型</label>
      <select class="input" id="ai-model">
        <option value="glm-4v-flash" ${s.aiModel !== 'glm-4v-plus' ? 'selected' : ''}>glm-4v-flash（免费）</option>
        <option value="glm-4v-plus" ${s.aiModel === 'glm-4v-plus' ? 'selected' : ''}>glm-4v-plus（更强，收费）</option>
      </select>
      <div class="row" style="justify-content:flex-end; margin-top:14px">
        <button class="btn ghost" id="ai-cancel">取消</button>
        <button class="btn primary" id="ai-save">保存</button>
      </div>`);
    $('#ai-cancel', card).onclick = closeModal;
    $('#ai-save', card).onclick = () => {
      Store.settings().aiApiKey = $('#ai-key', card).value.trim();
      Store.settings().aiModel = $('#ai-model', card).value;
      Store.save(true);
      closeModal();
      toast('AI 识图设置已保存 ✓', 'green');
    };
  },

  /* ============ 皮肤状态系统（SkinEngine 驱动：预测 → 记录 → 对账 → 洞察） ============ */

  _skinContext() {
    const db = Store.db;
    return {
      dateKey: todayKey(),
      nowMs: Date.now(),
      sleeps: db.rhythm && Array.isArray(db.rhythm.sleeps) ? db.rhythm.sleeps : [],
      meals: db.rhythm && Array.isArray(db.rhythm.meals) ? db.rhythm.meals : [],
      strengthDays: db.strength && db.strength.days ? db.strength.days : {},
      logs: db.skin.logs
    };
  },

  /* 每天首次打开护肤页时固化当日预测（先预测后记录，才能对账） */
  _ensureTodayPrediction() {
    const state = Store.db.skin;
    const t = todayKey();
    if (state.logs[t] || state.predictions[t]) return;
    const p = SkinEngine.predictForDate(this._skinContext());
    state.predictions[t] = { overallDir: p.overallDir, items: p.items, madeAt: new Date().toISOString() };
    Store.save();
  },

  _dirIcon(dir) { return dir === 'down' ? '📉' : dir === 'up' ? '📈' : '➖'; },
  _levelClass(level) { return level === 'warn' ? 'sk-pred-warn' : level === 'good' ? 'sk-pred-good' : 'sk-pred-info'; },

  _skinTodayCard() {
    const t = todayKey();
    const log = Store.db.skin.logs[t];
    const pred = Store.db.skin.predictions[t];
    const score = log ? SkinEngine.scoreSkin(log) : null;
    const base = SkinEngine.baseline(Store.db.skin.logs, addDays(t, 1), 28);
    const lvl = (v) => (v === 0 ? 0 : v === 1 ? 1 : v === 2 ? 2 : 3);
    /* 基线对比章（已记录时展示） */
    let deltaChips = '';
    if (log && base && base.n >= 3) {
      const chips = [];
      if (score && base.score !== null) {
        const d = score.score - Math.round(base.score);
        chips.push(`<span class="badge ${d > 0 ? 'green' : d < 0 ? '' : ''}" style="${d < 0 ? 'background:rgba(224,120,90,.14);color:#b4552e' : ''}">评分较基线 ${d > 0 ? '+' : ''}${d}</span>`);
      }
      for (const p of SkinEngine.PARAMS) {
        const b = base.params[p.key];
        if (b === null || b === undefined || !Number.isInteger(log[p.key])) continue;
        const d = log[p.key] - Math.round(b);
        if (d === 0) continue;
        chips.push(`<span class="badge" ${d > 0 ? 'style="background:rgba(224,120,90,.14);color:#b4552e"' : 'style="background:rgba(72,170,130,.14);color:#1d6e4f"'}>${p.label} ${d > 0 ? '+' : ''}${d} 级</span>`);
      }
      if (chips.length) deltaChips = `<div class="row" style="gap:6px; flex-wrap:wrap; margin-top:8px">${chips.join('')}</div>`;
    }
    return `
      <div class="card">
        <h3>🔬 今日皮肤状态
          <span class="h-extra">${log && score ? `已记录 · 评分 ${score.score}/100` : '还没记录'}</span>
        </h3>
        <p class="hint" style="margin:0 0 10px">评分为<b>自评加权参考，非医学诊断</b>：<details style="display:inline"><summary style="cursor:pointer; display:inline; color:#7b74e2">查看权重口径</summary>
          <span>痘痘 ${Math.round(SkinEngine.ACNE_WEIGHT * 100)}% · ${SkinEngine.PARAMS.map((p) => `${p.label} ${Math.round(p.weight * 100)}%`).join(' · ')}（主客观 7:3 融合）</span></details></p>
        ${pred && !log ? `
        <div style="display:grid; gap:8px; margin-bottom:14px">
          <div class="row" style="gap:6px; align-items:center">
            <b style="font-size:13.5px">🩺 今日预测（基于睡眠·训练·近期皮肤）</b>
            <span class="badge">${this._dirIcon(pred.overallDir)} ${pred.overallDir === 'down' ? '预计下滑' : pred.overallDir === 'up' ? '预计向好' : '预计平稳'}</span>
          </div>
          ${pred.items.map((p) => `
            <div class="sk-pred-item ${this._levelClass(p.level)}">
              <b style="font-size:13px">${esc(p.title)}</b>
              <span style="font-size:12.5px; color:#4c5b70">${esc(p.detail)}</span>
              ${p.advice ? `<span style="font-size:12.5px; color:#5f55bd">建议：${esc(p.advice)}</span>` : ''}
              ${p.refs && p.refs.length ? `<details><summary style="font-size:11px; cursor:pointer; color:#7a8798">依据（${p.refs.length} 条）</summary>
                <div style="display:grid; gap:4px; margin-top:4px">${p.refs.map((r) => `<span style="font-size:11px; color:#7a8798">· ${esc(SkinEngine.REFS[r] || r)}</span>`).join('')}</div></details>` : ''}
            </div>`).join('')}
        </div>` : ''}
        <div class="sk-param-row"><span class="sk-param-label">痘痘总数</span>
          <input class="input sk-num" id="sk-acne-total" type="number" min="0" max="99" style="width:76px" value="${log && Number.isInteger(log.acneTotal) ? log.acneTotal : ''}" placeholder="0">
          <span class="hint">颗（面部分肉眼可见的痘）</span></div>
        <div class="sk-param-row"><span class="sk-param-label">今日新增</span>
          <input class="input sk-num" id="sk-acne-new" type="number" min="0" max="99" style="width:76px" value="${log && Number.isInteger(log.acneNew) ? log.acneNew : ''}" placeholder="0">
          <span class="hint">颗新痘——引擎据此判断炎症趋势</span></div>
        ${SkinEngine.PARAMS.map((p) => `
          <div class="sk-param-row"><span class="sk-param-label">${p.label}</span>
            <div class="sk-seg" data-param="${p.key}">
              ${p.levels.map((name, v) => `<button data-v="${v}" class="${log && Number.isInteger(log[p.key]) && lvl(log[p.key]) === v ? 'on' : ''}">${name}</button>`).join('')}
            </div></div>`).join('')}
        <div class="sk-param-row"><span class="sk-param-label">整体感受</span>
          <div class="sk-seg" data-param="overall">
            ${Array.from({ length: 10 }, (_, i) => i + 1).map((v) => `<button data-v="${v}" class="${log && Number.isInteger(log.overall) && log.overall === v ? 'on' : ''}">${v}</button>`).join('')}
          </div><span class="hint">1 很差 · 10 很好</span></div>
        <div class="sk-param-row" style="border-bottom:0"><span class="sk-param-label">生理期</span>
          <label class="row" style="gap:6px; font-size:12.5px; color:#566176"><input type="checkbox" id="sk-period" ${log && log.period ? 'checked' : ''}> 今天是生理期第一天（引擎会学习你的痘痘周期模式）</label></div>
        <div class="sk-param-row" style="border-bottom:0"><span class="sk-param-label">备注</span>
          <input class="input" id="sk-skin-note" style="flex:1; min-width:200px" maxlength="300" placeholder="选填：换了什么产品、吃了什么特别的东西" value="${log ? esc(log.note || '') : ''}"></div>
        ${deltaChips}
        <div class="row" style="margin-top:12px; flex-wrap:wrap; gap:8px">
          <button class="btn primary" id="sk-skin-save">${log ? '更新今日记录' : '保存今日记录'}</button>
          <button class="btn" id="sk-copy-prev" data-no-icon="true">⧉ 沿用上次</button>
          <button class="btn" id="sk-ai-fill" data-no-icon="true">🤖 AI 识图</button>
          <button class="btn ghost" id="sk-ai-settings" data-no-icon="true">⚙️</button>
          <span class="hint">保存后自动与预测对账；AI 识图会把今日照片发给视觉大模型自动填参</span>
        </div>
      </div>`;
  },

  _skinPhotosCard() {
    const kind = this.ui.skinPhotoKind || 'skin';
    const photos = Store.db.skin.photos.filter((p) => p.kind === kind).slice(-30).reverse();
    const weight = Store.db.strength && Store.db.strength.bmiProfile ? Store.db.strength.bmiProfile.weightKg : '';
    return `
      <div class="card">
        <h3>📸 照片档案 <span class="h-extra">同一角度光线，变化才可比</span></h3>
        <div class="row" style="align-items:center; flex-wrap:wrap; gap:8px">
          <button class="btn small ${kind === 'skin' ? 'primary' : ''}" data-skin-kind="skin">🧑 皮肤状态</button>
          <button class="btn small ${kind === 'body' ? 'primary' : ''}" data-skin-kind="body">💪 健身体型</button>
          <span style="flex:1"></span>
          <label class="row" style="gap:6px; font-size:12.5px; color:#566176">体重kg
            <input class="input sk-num" id="sk-photo-weight" type="number" min="25" max="400" step="0.1" style="width:80px" value="${esc(String(weight || ''))}" placeholder="选填"></label>
          <button class="btn" id="sk-photo-add">＋ 添加照片</button>
          <button class="btn ghost" id="sk-photo-paste" data-no-icon="true">📋 粘贴截图</button>
          <input type="file" id="sk-photo-file" accept="image/*" multiple style="display:none">
        </div>
        <p class="hint" style="margin:8px 0 10px">支持选文件 / 拖图片进来 / Cmd+V 粘贴截图（手机照片用 AirDrop 传到桌面再拖入）。${kind === 'skin' ? '建议每天同一位置、自然光下拍一面。' : '体型照配体重，和力量训练的进步对照看。'}</p>
        <div class="sk-drop" id="sk-photo-drop">
          ${photos.length ? `<div class="sk-photo-grid">
            ${photos.map((p, i) => `
              <figure class="sk-photo-thumb" data-idx="${i}" title="${esc(p.date)}${p.weightKg ? ' · ' + p.weightKg + 'kg' : ''}">
                <img data-photo-file="${esc(p.file)}" alt="${esc(p.date)}">
                <figcaption>${esc(p.date.slice(5))}${p.weightKg ? ' · ' + p.weightKg + 'kg' : ''}</figcaption>
              </figure>`).join('')}
          </div>` : '<div class="empty" style="padding:18px 0">还没有照片，拖一张进来试试。</div>'}
        </div>
      </div>`;
  },

  _skinInsightCard() {
    const db = Store.db;
    const dates = Object.keys(db.skin.logs).sort().slice(-14);
    if (!dates.length) {
      return `<div class="card"><h3>🧠 互通洞察 <span class="h-extra">皮肤 × 睡眠 × 训练</span></h3>
        <div class="empty">记录几天皮肤状态后，这里会开始分析它与昨晚睡眠、前一天训练的关联，并追踪预测命中率。</div></div>`;
    }
    const series = dates.map((d) => {
      const sl = SkinEngine.sleepForDate(db.rhythm && db.rhythm.sleeps, d, Date.now());
      const sd = db.strength && db.strength.days && db.strength.days[d];
      const follow = Store.dayTraining ? (Store.dayTraining(d) || { seconds: 0 }) : { seconds: 0 };
      return {
        date: d,
        score: SkinEngine.scoreSkin(db.skin.logs[d]).score,
        sleepMinutes: sl ? sl.minutes : null,
        trained: (sd && (sd.status === 'completed' || sd.status === 'partial')) || (follow.seconds || 0) > 0
      };
    });
    const corr = SkinEngine.correlate(series);
    const lag = SkinEngine.bestLagCorrelation(series, 2);
    const pp = SkinEngine.periodPattern(Store.db.skin.logs, todayKey());
    const sent = (c, name, positive) => {
      if (c.r === null) return `<span class="hint">${name}：记录满 10 天后给出关联强度（当前 n=${c.n}）。</span>`;
      const dir = c.r > 0 === positive ? '同向' : '反向';
      return `<span>· <b>${name}</b>：r=${c.r}（n=${c.n}，${c.strength}）——${dir === '同向' ? '趋势与预期一致' : '与人群预期相反，可能是个体特异性'}</span>`;
    };
    const scores = series.map((s) => s.score);
    const W = 300, H = 56, min = Math.min(...scores) - 4, max = Math.max(...scores) + 4;
    const pts = scores.map((v, i) => `${(i / Math.max(1, scores.length - 1)) * W},${H - ((v - min) / Math.max(1, max - min)) * H}`).join(' ');
    const verified = Object.entries(db.skin.predictions)
      .filter(([, p]) => p.verified && !p.verified.skipped).sort((a, b) => a[0].localeCompare(b[0])).slice(-5).reverse();
    const st = db.skin.stats;
    return `
      <div class="card">
        <h3>🧠 互通洞察 <span class="h-extra">皮肤 × 睡眠 × 训练 · 最近 ${series.length} 天</span></h3>
        <div class="row" style="align-items:center; gap:14px; flex-wrap:wrap">
          <svg viewBox="0 0 ${W} ${H}" style="width:min(300px,100%); height:56px" role="img" aria-label="皮肤评分走势">
            <polyline points="${pts}" fill="none" stroke="#7b74e2" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            ${scores.map((v, i) => `<circle cx="${(i / Math.max(1, scores.length - 1)) * W}" cy="${H - ((v - min) / Math.max(1, max - min)) * H}" r="2.6" fill="#7b74e2"/>`).join('')}
          </svg>
          <div style="display:grid; gap:4px; font-size:12.5px; color:#4c5b70">
            ${sent(corr.sleep, '睡眠时长 ↔ 皮肤评分', true)}
            ${sent(corr.training, '训练日 ↔ 皮肤评分', true)}
            ${lag && lag.lag > 0 ? `<span>· <b>睡眠滞后关联</b>：与 <b>${lag.lag} 天前</b>睡眠的关联最强（r=${lag.r}，n=${lag.n}）——系 0/1/2 天三个滞后中选最大，小样本会偏高，仅为个体趋势参考</span>` : ''}
            ${pp && pp.pmsAvg !== null && pp.otherAvg !== null ? `<span>· <b>生理期模式</b>：经期前窗口新痘 ${pp.pmsAvg} 颗/天 vs 平时 ${pp.otherAvg} 颗/天（周期约 ${pp.cycleLen} 天）</span>` : ''}
            ${st.seen ? `<span>· <b>预测命中</b>：${st.hit}/${st.seen}（${Math.round(st.hit / st.seen * 100)}%）——方向性预测，随记录积累校准</span>` : '<span class="hint">· 预测对账：保存今日记录后开始累计命中率</span>'}
          </div>
        </div>
        ${verified.length ? `<details style="margin-top:10px"><summary style="cursor:pointer; font-size:12.5px; color:#566176">最近预测对账（${verified.length}）</summary>
          <div style="display:grid; gap:5px; margin-top:8px">
            ${verified.map(([d, p]) => `<span style="font-size:12px; color:#4c5b70">${d.slice(5)} ${this._dirIcon(p.overallDir)} 预测${p.overallDir === 'down' ? '下滑' : p.overallDir === 'up' ? '向好' : '平稳'} → 实际 ${p.verified.delta > 0 ? '+' : ''}${p.verified.delta} 分 ${p.verified.hit ? '<b style="color:#1d6e4f">✓ 命中</b>' : '<b style="color:#b4552e">✗ 未中</b>'}</span>`).join('')}
          </div></details>` : ''}
        <p class="hint" style="margin:10px 0 0">相关性是个体趋势参考，不构成医学结论；r 的解释随记录增多会更稳定。</p>
      </div>`;
  },

  _bindSkin(root) {
    /* 分段选择：单选切换 */
    $$('.sk-seg', root).forEach((seg) => {
      $$('button', seg).forEach((btn) => {
        btn.onclick = () => {
          const on = btn.classList.contains('on');
          $$('button', seg).forEach((b) => b.classList.remove('on'));
          if (!on) btn.classList.add('on'); /* 再点一次取消选择 = 未记 */
        };
      });
    });
    const save = $('#sk-skin-save', root);
    if (save) save.onclick = () => this._saveSkinLog();
    /* 沿用上次：把最近一天的记录填进表单，只改有变化的项 */
    const copyBtn = $('#sk-copy-prev', root);
    if (copyBtn) copyBtn.onclick = () => {
      const t = todayKey();
      const dates = Object.keys(Store.db.skin.logs).filter((d) => d < t).sort();
      const prev = dates.length ? Store.db.skin.logs[dates[dates.length - 1]] : null;
      if (!prev) { toast('还没有上一次记录', 'red'); return; }
      const fillSeg = (key, val) => {
        const seg = $(`.sk-seg[data-param="${key}"]`, root);
        if (!seg) return;
        $$('button', seg).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === val));
      };
      for (const p of SkinEngine.PARAMS) if (Number.isInteger(prev[p.key])) fillSeg(p.key, prev[p.key]);
      if (Number.isInteger(prev.overall)) fillSeg('overall', prev.overall);
      if (Number.isInteger(prev.acneTotal)) $('#sk-acne-total', root).value = prev.acneTotal;
      if (Number.isInteger(prev.acneNew)) $('#sk-acne-new', root).value = prev.acneNew;
      toast(`已填入 ${dates[dates.length - 1].slice(5)} 的记录，改完记得保存`);
    };
    const aiBtn = $('#sk-ai-fill', root);
    if (aiBtn) aiBtn.onclick = () => this._aiAnalyze();
    const aiCfg = $('#sk-ai-settings', root);
    if (aiCfg) aiCfg.onclick = () => this._aiSettingsModal();
    /* 照片类别切换 */
    $$('[data-skin-kind]', root).forEach((btn) => {
      btn.onclick = () => { this.ui = this.ui || {}; this.ui.skinPhotoKind = btn.dataset.skinKind; App.render(); };
    });
    const fileBtn = $('#sk-photo-add', root);
    const fileInput = $('#sk-photo-file', root);
    if (fileBtn && fileInput) {
      fileBtn.onclick = () => fileInput.click();
      fileInput.onchange = () => { this._addPhotoFiles(fileInput.files); fileInput.value = ''; };
    }
    const pasteBtn = $('#sk-photo-paste', root);
    if (pasteBtn) pasteBtn.onclick = async () => {
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find((x) => x.startsWith('image/'));
          if (type) {
            const blob = await it.getType(type);
            await this._addPhotoFiles([blob]);
            return;
          }
        }
        toast('剪贴板里没有图片', 'red');
      } catch { toast('读取剪贴板失败，试试直接 Cmd+V', 'red'); }
    };
    const drop = $('#sk-photo-drop', root);
    if (drop) {
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => {
        e.preventDefault(); drop.classList.remove('over');
        this._addPhotoFiles(e.dataTransfer.files);
      };
    }
    this._loadPhotoImgs(root);
    /* 缩略图点击 → 查看器 */
    $$('.sk-photo-thumb', root).forEach((el) => {
      el.onclick = () => this._photoViewer(Number(el.dataset.idx));
    });
  },

  async _saveSkinLog() {
    const t = todayKey();
    const log = { date: t, createdAt: new Date().toISOString() };
    let any = false;
    $$('.sk-seg', $('#view-root')).forEach((seg) => {
      const on = $('button.on', seg);
      if (!on) return;
      const v = Number(on.dataset.v);
      any = true;
      if (seg.dataset.param === 'overall') log.overall = v;
      else log[seg.dataset.param] = v;
    });
    const total = $('#sk-acne-total').value.trim(), fresh = $('#sk-acne-new').value.trim();
    if (total !== '') { log.acneTotal = Math.max(0, Math.min(99, Math.round(Number(total)))); any = true; }
    if (fresh !== '') { log.acneNew = Math.max(0, Math.min(99, Math.round(Number(fresh)))); any = true; }
    if (!any) { toast('至少记一项：痘痘计数、任一参数或整体感受', 'red'); return; }
    log.note = $('#sk-skin-note').value.trim();
    const periodEl = $('#sk-period');
    if (periodEl && periodEl.checked) log.period = true;
    Store.db.skin.logs[t] = log;
    const score = SkinEngine.scoreSkin(log).score;
    const v = SkinEngine.verifyPrediction(Store.db.skin, t, score);
    Store.save(true);
    if (v && v.skipped) toast(`已记录（${score} 分）· 与上次记录间隔 ${v.gapDays} 天，本次不计入预测对账`);
    else if (v) toast(v.hit ? `已记录（${score} 分）· 预测命中 ✓（${v.delta > 0 ? '+' : ''}${v.delta}）` : `已记录（${score} 分）· 预测未中 ✗（${v.delta > 0 ? '+' : ''}${v.delta}）`, v.hit ? 'green' : '');
    else toast(`已记录，今日评分 ${score} 分`, 'green');
    App.render();
  },

  async _addPhotoFiles(files) {
    if (!files || !files.length) return;
    const t = todayKey();
    const kind = this.ui.skinPhotoKind || 'skin';
    const weightRaw = $('#sk-photo-weight') ? $('#sk-photo-weight').value.trim() : '';
    const weight = weightRaw !== '' && Number.isFinite(Number(weightRaw)) ? Number(weightRaw) : undefined;
    let ok = 0;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const ext = f.type.includes('png') ? 'png' : 'jpg';
        const name = await native.saveSkinPhoto(buf, ext);
        if (!name) { toast('图片过大（限 20MB）', 'red'); continue; }
        Store.db.skin.photos.push({ id: uid('ph'), date: t, kind, file: name, weightKg: kind === 'body' ? weight : undefined, note: '', createdAt: new Date().toISOString() });
        ok++;
      } catch { toast('有一张读取失败', 'red'); }
    }
    if (ok) {
      Store.save(true);
      toast(`已添加 ${ok} 张${kind === 'skin' ? '皮肤' : '体型'}照片 ✓`, 'green');
      App.render();
    }
  },

  _bindPasteOnce() {
    if (this._pasteBound) return;
    this._pasteBound = true;
    window.addEventListener('paste', (e) => {
      if (App.currentView !== 'skincare') return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const imgs = [];
      for (const it of items) {
        if (it.type.startsWith('image/')) imgs.push(it.getAsFile());
      }
      if (imgs.length) { e.preventDefault(); this._addPhotoFiles(imgs); }
    });
  },

  _loadPhotoImgs(scope) {
    /* 返回缺失/无法读取的张数；文件缺失与读取异常同文案（无法区分根因，不臆断已删除）。
       对比视图会复用同一 img 切换 dataset.photoFile，因此：
       - 发起读取前清旧 src 并清缺失标记（旧图不得冒充新文件，新旧状态互不残留）；
       - 快照文件名与原 alt，响应回来先校验文件身份——慢的旧响应直接作废。 */
    const jobs = $$('img[data-photo-file]', scope).map(async (img) => {
      const file = img.dataset.photoFile;
      img.removeAttribute('src');
      delete img.dataset.missing;
      img.removeAttribute('title'); /* 失败原因挂 title：成功即移除，不会像改写 alt 那样残留污染 */
      let b64 = null;
      try {
        b64 = await native.readSkinPhoto(file);
      } catch {
        b64 = null;
      }
      if (img.dataset.photoFile !== file) return 0; /* 已切到别的文件：本次响应作废 */
      if (b64) {
        img.src = `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${b64}`;
        return 0;
      }
      img.title = '照片无法读取，可能缺失或权限异常';
      img.dataset.missing = '1';
      return 1;
    });
    return Promise.all(jobs).then((rs) => rs.reduce((n, x) => n + x, 0));
  },

  _photoViewer(idx) {
    const kind = this.ui.skinPhotoKind || 'skin';
    const list = Store.db.skin.photos.filter((p) => p.kind === kind).slice(-30).reverse();
    const p = list[idx];
    if (!p) return;
    const card = openModal(`
      <h3>🖼️ ${p.date}${p.kind === 'body' ? ' · 体型' : ' · 皮肤'}${p.weightKg ? ` · ${p.weightKg}kg` : ''}</h3>
      <div class="sk-viewer-img"><img data-photo-file="${esc(p.file)}" alt="${esc(p.date)}"></div>
      <div class="row" style="margin-top:10px; justify-content:space-between">
        <button class="btn" id="pv-prev" data-no-icon="true" ${idx <= 0 ? 'disabled' : ''}>‹ 上一张</button>
        <button class="btn" id="pv-compare" data-no-icon="true">🔀 对比</button>
        <button class="btn danger" id="pv-del">删除</button>
        <button class="btn" id="pv-next" data-no-icon="true" ${idx >= list.length - 1 ? 'disabled' : ''}>下一张 ›</button>
      </div>`);
    this._loadPhotoImgs(card).then((missing) => {
      if (missing) toast('有照片无法读取，可能缺失或权限异常，可删除该条记录', 'red');
    });
    const go = (i) => { if (i >= 0 && i < list.length) { closeModal(); this._photoViewer(i); } };
    $('#pv-prev', card).onclick = () => go(idx - 1);
    $('#pv-next', card).onclick = () => go(idx + 1);
    $('#pv-del', card).onclick = async () => {
      if (!await confirmModal('删除照片', '仅删除这张照片记录，皮肤日志不受影响。', '删除')) return;
      await native.deleteSkinPhoto(p.file);
      Store.db.skin.photos = Store.db.skin.photos.filter((x) => x.id !== p.id);
      Store.save(true);
      closeModal();
      toast('已删除');
      App.render();
    };
    $('#pv-compare', card).onclick = () => {
      const others = list.filter((x) => x.id !== p.id);
      if (!others.length) { toast('只有一张照片，再拍几张就能对比', 'red'); return; }
      closeModal();
      const card2 = openModal(`
        <h3>🔀 对比</h3>
        <div class="row" style="margin-bottom:8px">
          <select class="input" id="pv-a" style="flex:1">${list.map((x, i) => `<option value="${i}" ${x.id === p.id ? 'selected' : ''}>${x.date}${x.weightKg ? ' · ' + x.weightKg + 'kg' : ''}</option>`).join('')}</select>
          <select class="input" id="pv-b" style="flex:1">${others.map((x) => `<option value="${list.indexOf(x)}">${x.date}${x.weightKg ? ' · ' + x.weightKg + 'kg' : ''}</option>`).join('')}</select>
        </div>
        <div class="row" style="align-items:stretch; gap:8px">
          <div class="sk-viewer-img" style="flex:1"><img data-photo-file="${esc(p.file)}" alt=""></div>
          <div class="sk-viewer-img" style="flex:1"><img data-photo-file="${esc(others[0].file)}" alt=""></div>
        </div>
        <div class="row" style="justify-content:flex-end; margin-top:10px"><button class="btn ghost" id="pv-close">关闭</button></div>`);
      this._loadPhotoImgs(card2);
      $('#pv-close', card2).onclick = closeModal;
      $('#pv-a', card2).onchange = $('#pv-b', card2).onchange = () => {
        const a = list[Number($('#pv-a', card2).value)], b = list[Number($('#pv-b', card2).value)];
        const imgs = $$('img[data-photo-file]', card2);
        if (imgs[0]) imgs[0].dataset.photoFile = a.file;
        if (imgs[1]) imgs[1].dataset.photoFile = b.file;
        this._loadPhotoImgs(card2);
      };
    };
  },

  /* ============ 视图 ============ */
  view(root) {
    SkinEngine.normalize(Store.db); /* 皮肤引擎状态（logs/photos/predictions/stats） */
    this._ensureTodayPrediction();
    this._bindPasteOnce();
    const cycles = Store.db.skincare.cycles || [];
    const active = Store.activeCycle();
    root.innerHTML = `
      <div class="view">
        <div id="sk-skin-today">${this._skinTodayCard()}</div>
        <div id="sk-skin-photos">${this._skinPhotosCard()}</div>
        <div id="sk-skin-insight">${this._skinInsightCard()}</div>
        <div class="card">
          <h3>🧴 护肤周期 <span class="h-extra">当前：${active ? esc(active.name) + (active.endDate ? `（至 ${active.endDate}）` : '（长期）') : '未设定'}</span></h3>
          <div class="row">
            <button class="btn primary" id="sk-import">📥 导入 AI 护肤计划</button>
            <button class="btn" id="sk-add-cycle">＋ 手动新建周期</button>
          </div>
          ${this._timesRow()}
          <p class="hint" style="margin-top:10px">
            把你和其它 AI 聊好的护肤计划整段复制粘贴进来，自动识别「周期 / 晨间 / 日间 / 晚间 / 产品」；
            解析结果可修改后再保存。产品暂时不用填，日常在「今日」页随时「＋添加护肤品」。
          </p>
        </div>
        <div id="sk-cycle-list">
          ${cycles.length ? '' : `<div class="empty">还没有护肤周期。<br>点上方「导入 AI 护肤计划」，或直接去「今日」页按时段添加护肤品。</div>`}
        </div>
        <div class="card">
          <h3>🧺 产品清单 <span class="h-extra">从所有周期中自动汇总</span></h3>
          <div class="row" id="sk-products">
            ${this.allProductNames().map(n => `<span class="badge green">${esc(n)}</span>`).join('') ||
              '<span class="hint">暂无产品，导入或添加后自动汇总。</span>'}
          </div>
        </div>
      </div>`;

    const list = $('#sk-cycle-list', root);
    for (const c of cycles) list.appendChild(this.cycleCard(c));

    $('#sk-import', root).onclick = () => this.importModal();
    $('#sk-add-cycle', root).onclick = () => this.editCycleModal(null);
    this.bindTimesRow(root);
    this._bindSkin(root);
  },

  cycleCard(c) {
    const active = Store.activeCycle();
    const isActive = active && active.id === c.id;
    const el = document.createElement('div');
    el.className = 'cycle-card' + (isActive ? ' active-cycle' : '');
    const stepRow = (s, phase) => `
      <div class="sk-step ${phase}" data-sid="${s.id}" data-phase="${phase}">
        <div class="chk">✓</div>
        <div><div class="sk-name">${esc(s.name)}</div>${s.detail ? `<div class="sk-detail">${esc(s.detail)}</div>` : ''}</div>
      </div>`;
    const col = (key, ico, label) => `
      <div class="sk-col"><h4>${ico} ${label}（${(c.steps[key] || []).length} 步）
        <button class="btn small ghost sk-add" data-phase="${key}">＋添加</button></h4>
        ${(c.steps[key] || []).map(s => stepRow(s, key)).join('') || '<div class="hint">还没填，点右上「＋添加」</div>'}
      </div>`;
    el.innerHTML = `
      <div class="cycle-head">
        <b>${esc(c.name)}</b>
        ${isActive ? '<span class="badge">当前周期</span>' : ''}
        ${c.startDate ? `<span class="hint">${esc(c.startDate)}${c.endDate ? ' ~ ' + esc(c.endDate) : ''}</span>` : ''}
        <span class="h-extra row" style="gap:6px">
          <button class="btn small edit">编辑</button>
          <button class="btn small danger del">删除</button>
        </span>
      </div>
      <div class="sk-cols3">
        ${col('morning', '☀️', '晨间')}
        ${col('day', '🌤️', '日间')}
        ${col('evening', '🌙', '晚间')}
      </div>`;
    // 列表里的勾选 = 打今天的卡
    const todayDone = Store.daySkincare(todayKey());
    $$('.sk-step', el).forEach(rowEl => {
      const sid = rowEl.dataset.sid, ph = rowEl.dataset.phase;
      if ((todayDone[ph] || []).includes(sid)) rowEl.classList.add('done');
      rowEl.onclick = () => {
        const checked = Store.toggleSkincareStep(todayKey(), ph, sid);
        rowEl.classList.toggle('done', checked);
        App.refreshStatusPill();
        toast(checked ? '已打卡 ✓' : '已取消', 'green');
      };
    });
    $$('.sk-add', el).forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); this.quickAddModal(btn.dataset.phase, () => this.view($('#view-root'))); };
    });
    $('.edit', el).onclick = () => this.editCycleModal(c);
    $('.del', el).onclick = async () => {
      const ok = await confirmModal('删除周期', `确定删除「${c.name}」吗？相关打卡记录保留。`, '删除');
      if (!ok) return;
      Store.db.skincare.cycles = Store.db.skincare.cycles.filter(x => x.id !== c.id);
      Store.save(true); this.view($('#view-root'));
    };
    return el;
  },

  /* 导入弹窗：粘贴 → 解析 → 预览编辑 → 保存 */
  importModal() {
    const card = openModal(`
      <h3>📥 导入 AI 护肤计划</h3>
      <p class="hint">粘贴你与其它 AI 沟通好的护肤计划全文（支持任意格式，会自动识别周期、早晚流程与产品）。</p>
      <textarea class="textarea" id="im-text" style="min-height:160px; margin-top:10px" placeholder="例如：&#10;周期一（第1-7天）&#10;晨间：洁面、爽肤水、维C精华、防晒&#10;晚间：卸妆、洁面、视黄醇精华（隔天用）、面霜&#10;周期二（第8-14天）&#10;……"></textarea>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="im-parse">🔍 智能解析</button>
        <label class="row" style="gap:6px; font-size:12.5px; color:var(--muted)">
          <input type="checkbox" id="im-replace" checked> 替换现有周期（取消则追加）
        </label>
      </div>
      <hr class="sep">
      <div id="im-preview"></div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn ghost" id="im-cancel">关闭</button>
        <button class="btn green" id="im-save" disabled>💾 保存到我的护肤计划</button>
      </div>`);

    let parsed = [];
    const preview = $('#im-preview', card);
    $('#im-parse', card).onclick = () => {
      const text = $('#im-text', card).value;
      if (!text.trim()) { toast('先粘贴内容再解析哦', 'red'); return; }
      parsed = this.parsePlanText(text);
      if (!parsed.length) { preview.innerHTML = '<div class="hint">没有识别出有效内容，试试在产品间用「、」或每行一个产品。</div>'; $('#im-save', card).disabled = true; return; }
      this._renderParsePreview(preview, parsed);
      $('#im-save', card).disabled = false;
      toast(`识别出 ${parsed.length} 个周期，检查并修改后保存`, 'green');
    };
    $('#im-cancel', card).onclick = closeModal;
    $('#im-save', card).onclick = () => {
      const edits = this._collectPreviewEdits(preview);
      const cycles = this.editableToCycles(edits);
      // 未设日期的周期按顺序自动接续（从今天开始，每周期默认 7 天）
      let cursor = todayKey();
      for (const c of cycles) {
        if (!c.startDate) c.startDate = cursor;
        if (!c.endDate) c.endDate = addDays(c.startDate, 6);
        cursor = addDays(c.endDate, 1);
      }
      this.addCycles(cycles, $('#im-replace', card).checked);
      closeModal();
      toast('护肤计划已保存 ✓', 'green');
      App.render();
    };
  },

  _renderParsePreview(preview, cycles) {
    const ed = this.cyclesToEditable(cycles);
    preview.innerHTML = ed.map((c, i) => `
      <div class="cycle-card" data-i="${i}">
        <div class="row">
          <input class="input p-name" style="flex:1" value="${esc(c.name)}" placeholder="周期名称">
          <input class="input p-start" style="width:130px" type="date" value="${c.startDate}">
          <span class="hint">至</span>
          <input class="input p-end" style="width:130px" type="date" value="${c.endDate}">
        </div>
        <div class="sk-cols3" style="margin-top:10px">
          <div class="sk-col"><h4>☀️ 晨间（一行一个）</h4>
            <textarea class="textarea p-morning" style="min-height:80px">${esc(c.morningText)}</textarea></div>
          <div class="sk-col"><h4>🌤️ 日间（一行一个）</h4>
            <textarea class="textarea p-day" style="min-height:80px">${esc(c.dayText)}</textarea></div>
          <div class="sk-col"><h4>🌙 晚间（一行一个）</h4>
            <textarea class="textarea p-evening" style="min-height:80px">${esc(c.eveningText)}</textarea></div>
        </div>
      </div>`).join('');
  },

  _collectPreviewEdits(preview) {
    return $$('.cycle-card', preview).map(el => ({
      name: $('.p-name', el).value.trim(),
      startDate: $('.p-start', el).value,
      endDate: $('.p-end', el).value,
      morningText: $('.p-morning', el).value,
      dayText: $('.p-day', el).value,
      eveningText: $('.p-evening', el).value
    }));
  },

  /* 手动新建 / 编辑周期 */
  editCycleModal(cyc) {
    const c = cyc || { id: null, name: '', startDate: todayKey(), endDate: '', steps: { morning: [], day: [], evening: [] } };
    const toText = arr => (arr || []).map(s => s.detail ? `${s.name}：${s.detail}` : s.name).join('\n');
    const card = openModal(`
      <h3>${cyc ? '✏️ 编辑周期' : '＋ 新建周期'}</h3>
      <label class="field">周期名称</label>
      <input class="input" id="ec-name" value="${esc(c.name)}" placeholder="如：周期一 · 建立耐受期">
      <div class="row" style="margin-top:10px">
        <div style="flex:1"><label class="field">开始日期</label><input class="input" id="ec-start" type="date" value="${c.startDate}"></div>
        <div style="flex:1"><label class="field">结束日期（留空=长期）</label><input class="input" id="ec-end" type="date" value="${c.endDate || ''}"></div>
      </div>
      <div class="sk-cols3" style="margin-top:10px">
        <div class="sk-col"><label class="field">☀️ 晨间（名称：用法）</label>
          <textarea class="textarea" id="ec-morning" placeholder="洁面&#10;爽肤水：保湿型&#10;防晒：SPF50">${esc(toText(c.steps.morning))}</textarea></div>
        <div class="sk-col"><label class="field">🌤️ 日间（补涂/加强）</label>
          <textarea class="textarea" id="ec-day" placeholder="补水喷雾&#10;防晒补涂：SPF50">${esc(toText(c.steps.day))}</textarea></div>
        <div class="sk-col"><label class="field">🌙 晚间</label>
          <textarea class="textarea" id="ec-evening" placeholder="卸妆膏&#10;洁面&#10;视黄醇精华：隔天用&#10;面霜">${esc(toText(c.steps.evening))}</textarea></div>
      </div>
      <div class="row" style="justify-content:flex-end; margin-top:16px">
        <button class="btn ghost" id="ec-cancel">取消</button>
        <button class="btn primary" id="ec-save">保存</button>
      </div>`);
    $('#ec-cancel', card).onclick = closeModal;
    $('#ec-save', card).onclick = () => {
      const mk = txt => String(txt || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
        const m = line.match(/^(.{1,30}?)\s*[：:]\s*(.+)$/);
        return { id: uid('st'), name: m ? m[1].trim() : line.trim(), detail: m ? m[2].trim() : '' };
      });
      const obj = {
        id: c.id || uid('cyc'),
        name: $('#ec-name', card).value.trim() || '未命名周期',
        startDate: $('#ec-start', card).value,
        endDate: $('#ec-end', card).value,
        steps: {
          morning: mk($('#ec-morning', card).value),
          day: mk($('#ec-day', card).value),
          evening: mk($('#ec-evening', card).value)
        }
      };
      if (c.id) {
        const i = Store.db.skincare.cycles.findIndex(x => x.id === c.id);
        if (i >= 0) Store.db.skincare.cycles[i] = obj;
      } else {
        Store.db.skincare.cycles.push(obj);
      }
      Store.save(true); closeModal(); this.view($('#view-root'));
      toast('已保存 ✓', 'green');
    };
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = Skincare;
