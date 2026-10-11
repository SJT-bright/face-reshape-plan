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
    if (replace) Store.db.skincare.cycles = cycles;
    else Store.db.skincare.cycles.push(...cycles);
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
      <div class="daily-time-settings"><h4>护肤与认知时间</h4><div class="row" id="sk-times" style="align-items:flex-end">
        <div><label class="field">☀️ 晨间开始</label><input class="input sk-time" data-k="morning" type="time" value="${t.morning}" style="width:118px"></div>
        <div><label class="field">🌤️ 日间开始</label><input class="input sk-time" data-k="noon" type="time" value="${t.noon}" style="width:118px"></div>
        <div><label class="field">🌙 晚间开始</label><input class="input sk-time" data-k="evening" type="time" value="${t.evening}" style="width:118px"></div>
      </div>${typeof UX!=='undefined'?UX.watchingSettingsFields():''}<p class="hint">护肤与认知到点切换各自的时段。观看时长单独累计，早晚开始时间留空则不提醒。</p><button class="btn small" id="sk-times-save">保存时间与时长</button></div>`;
  },

  bindTimesRow(root) {
    const box = $('#sk-times', root);
    if (!box) return;
    $('#sk-times-save', root).onclick = () => {
      try {
      const plans=UX.watchingSettingsValues(box.closest('.daily-time-settings'));
      const t = Store.settings().skincareTimes = Store.settings().skincareTimes || {};
      $$('.sk-time', box).forEach(inp => { t[inp.dataset.k] = inp.value; });
      UX.saveWatchingSettings(plans);
      Store.save(true);
      UX.careManualPhase=null;UX.updateCareNow(true);
      toast('护肤与认知安排已保存 ✓', 'green');
      } catch(error){toast(error.message,'red');}
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
      const t = todayKey(), originView=App.currentView, originEpoch=App._uxRenderEpoch;
      /* 按日期取最近的皮肤照（P9 后添加顺序≠日期顺序，一律走 _photoList） */
      const photos = this._photoList('skin');
      const target = photos.find((p) => p.date === t) || photos[0];
      if (!target) { toast('先拍/传一张照片，AI 才有东西可看', 'red'); return; }
      /* 非今日照片必须用户显式确认：旧脸填今天会污染数据 */
      if (target.date !== t) {
        const ok = await confirmModal('使用历史照片？', `今天还没有照片，最近一张是 ${target.date}。用它填入今日记录可能不准确。`, '仍要使用');
        if (!ok) { toast('已取消，先在照片档案里添加今天的照片再识图'); return; }
      }
      const set = Store.settings();
      if (!set.aiKeyConfigured && !set.aiApiKey) { this._aiSettingsModal(); return; }
      if (btn) btn.textContent = '🤖 分析中…'; /* 确认与密钥都过了，才真正进入上传阶段 */
      toast(`AI 正在分析 ${target.date === t ? '今日' : target.date} 的照片…`);
      const b64 = await this._shrinkForAI(target.file);
      const root=$('#view-root');
      if(root && typeof document.createElement==='function' && typeof root.appendChild==='function') {
        let status=$('#ux-ai-state');if(!status){status=document.createElement('div');status.id='ux-ai-state';root.prepend(status);}
        status.innerHTML=`<img alt="本次发送照片" style="width:70px;height:70px;object-fit:cover" src="data:image/jpeg;base64,${b64}"><span>分析中 · ${esc(target.date)} · 智谱 ${esc(set.aiModel||'glm-4v-flash')}</span>`;
      }
      const r = await native.analyzeSkinPhoto(b64, 'image/jpeg', undefined, set.aiModel);
      if(todayKey()!==t || App.currentView!==originView || App._uxRenderEpoch!==originEpoch){toast('页面已切换，旧识图结果未填入当前表单');return;}
      const status=$('#ux-ai-state');if(status)status.textContent=r.ok?'分析完成，已预填，等待你确认保存':'分析失败：'+r.error;
      if (!r.ok) { toast('AI 识图失败：' + r.error, 'red'); return; }
      this._applyAiResult(r.data, target.date);
    } catch (e) { toast('AI 识图失败：' + e.message, 'red'); }
    finally {
      this._aiBusy = false;
      const btn2 = $('#sk-ai-fill');
      if (btn2) { btn2.disabled = false; btn2.textContent = '🤖 AI 识图'; }
    }
  },

  _applyAiResult(d, dateKey) {
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
    /* 面部状态三字段（fullness/puffiness/definition）：严格校验后单独存档，不参与皮肤评分 */
    const faceSaved = false;
    this.pendingAi={data:d,photoDate:dateKey||todayKey(),forDate:todayKey()};
    this.ui = this.ui || {}; this.ui.faceStateStale = true;
    toast(`AI 已填入 ${filled}/9 项${invalid ? `，${invalid} 项无效已跳过` : ''}${faceSaved ? '，面部状态待确认' : ''}${d.advice ? '。AI 建议：' + String(d.advice).slice(0, 60) : ''}`, invalid ? '' : 'green');
    const faceBox = $('#sk-face-advice', root);
    if (faceBox && faceSaved) faceBox.innerHTML = this._faceAdviceCard();
  },

  /* 面部状态与建议卡：AI 识图的面部三字段（圆润感/水肿感/轮廓清晰度，主观视觉印象）→ 可执行的作息与饮食提示。
     证据口径：面部脂肪随全身体脂变化，局部减脂无证据（Vispute 2011 RCT）；钠/酒精/睡眠不足与晨起浮肿相关（生活习惯参考）。 */
  _faceAdviceCard() {
    const t = todayKey();
    const face = SkinEngine.latestFaceState(Store.db, t, 14);
    const set = Store.settings();
    const stT = set.skincareTimes || { morning: '09:00', noon: '12:00', evening: '20:00' };
    const curMin = minutesOf(hhmm());
    const phase = typeof Routine !== 'undefined' && Routine.active?.period ? Routine.active.period : curMin >= (minutesOf(stT.evening) ?? 1200) ? 'evening'
      : curMin >= (minutesOf(stT.noon) ?? 720) ? 'day' : 'morning';
    const phaseTip = phase === 'morning' ? '早上：温和清洁 + 保湿 + 防晒（SPF 30+，阴天也有紫外线）'
      : phase === 'day' ? '日间：需要时补涂防晒；少用手摸脸' : '晚上：清洁 + 功效成分（如视黄醇类夜间用，从低频开始）+ 保湿修护';
    const lvlName = ['无/清瘦/清晰', '轻微', '明显', '严重/很饱满'];
    let body = '';
    if (!face) {
      body = '<p class="hint">还没有面部状态记录：在「照片档案」添加今天的照片后点 <b>AI 识图</b>，会一并记录面部圆润感/水肿感/轮廓清晰度（主观视觉印象），并在这里给出对应的作息与饮食提示。</p>';
    } else {
      const chips = [
        face.fullness != null ? `圆润感 ${lvlName[face.fullness]}` : null,
        face.puffiness != null ? `水肿感 ${lvlName[face.puffiness]}` : null,
        face.definition != null ? `轮廓清晰度 ${lvlName[face.definition]}` : null
      ].filter(Boolean).map((c) => `<span class="badge">${esc(c)}</span>`).join('');
      const tips = [];
      if (face.puffiness != null && face.puffiness >= 2) tips.push('水肿感明显：晚餐清淡少盐、少酒精，今晚按睡眠建议早睡——钠与酒精摄入和睡眠不足都与晨起面部浮肿相关。');
      if (face.fullness != null && face.fullness >= 2) tips.push('面部圆润感较强：面部脂肪随全身体脂变化，「局部瘦脸」训练/按摩没有可靠证据（对照试验 Vispute 2011 证实局部减脂不成立）——温和的热量缺口 + 全身训练才是可循路径。');
      if (face.fullness != null && face.fullness <= 1) tips.push('面部偏清瘦：别过度节食——保证蛋白质目标与总热量，过快减脂容易显疲态、显老。');
      if (face.definition != null && face.definition <= 1) tips.push('轮廓清晰度一般：随体脂率下降下颌线通常会变清晰（个体差异大，属主观观察）。');
      if (face.puffiness != null && face.puffiness <= 1 && (face.fullness == null || face.fullness <= 1)) tips.push('当前状态清爽，按现有作息与护肤节奏保持即可。');
      body = `
        <div class="row" style="gap:6px; flex-wrap:wrap">${chips}<span class="hint">${face.date === t ? '今天' : face.date} · AI 识图</span></div>
        <div style="display:grid; gap:6px; margin-top:8px">${tips.map((x) => `<span style="font-size:12.5px; color:#4c5b70">· ${esc(x)}</span>`).join('')}</div>`;
    }
    return `
      <div class="card">
        <h3>🧭 面部状态与建议 <span class="h-extra">主观视觉印象 · 非测量、非诊断</span></h3>
        <p class="hint" style="margin:0 0 8px">当前时段建议：${esc(phaseTip)}。</p>
        ${body}
        <p class="hint" style="margin:8px 0 0">面部「肉量」无法从照片测量——以上是视觉印象与生活习惯参考；皮肤疾病或快速变化请就医。</p>
      </div>`;
  },

  _aiSettingsModal() {
    const s = Store.settings();
    const card = openModal(`
      <h3>⚙️ AI 识图设置</h3>
      <p class="hint">使用智谱视觉接口；费用以服务商账户为准。手动模式点击识图时发送选中照片；自动模式由你启用后，进入皮肤记录页时发送当天最新照片。密钥通过系统安全存储加密，不包含在普通备份里。</p>
      <label class="field">API Key</label>
      <input class="input" id="ai-key" type="password" placeholder="已配置时留空保留；填写可替换" value="">
      <label class="field">模型</label>
      <select class="input" id="ai-model">
        <option value="glm-4v-flash" ${s.aiModel !== 'glm-4v-plus' ? 'selected' : ''}>glm-4v-flash</option>
        <option value="glm-4v-plus" ${s.aiModel === 'glm-4v-plus' ? 'selected' : ''}>glm-4v-plus</option>
      </select>
      <label class="row" style="gap:6px; margin-top:12px; font-size:12.5px; color:#4c5b70">
        <input type="checkbox" id="ai-auto" ${s.skinAutoAnalyze ? 'checked' : ''}>
        每天打开护肤页时，自动分析当天最新照片（仍需你确认后保存；会消耗接口额度）
      </label>
      <div class="row" style="justify-content:flex-end; margin-top:14px">
        <button class="btn ghost" id="ai-cancel">取消</button>
        <button class="btn primary" id="ai-save">保存</button>
      </div>`);
    $('#ai-cancel', card).onclick = closeModal;
    $('#ai-save', card).onclick = async () => {
      const key=$('#ai-key',card).value.trim();
      if(key){const result=await native.saveApiKey(key);if(!result.ok){toast(result.error,'red');return;}Store.settings().aiKeyConfigured=true;}
      delete Store.settings().aiApiKey;
      Store.settings().aiModel = $('#ai-model', card).value;
      Store.settings().skinAutoAnalyze = $('#ai-auto', card).checked;
      Store.save(true);
      closeModal();
      toast('AI 识图设置已保存 ✓', 'green');
    };
  },

  /* 每日自动识图（opt-in）：当天有照片、还没记录、今天没自动跑过 → 自动分析一次。
     结果仍只预填表单，保存永远由用户确认。 */
  _maybeAutoAnalyze() {
    const s = Store.settings();
    if (!s.skinAutoAnalyze || (!s.aiKeyConfigured && !s.aiApiKey) || (this.ui.tab || 'care') !== 'record') return;
    const t = todayKey();
    if (Store.db.skin.logs[t]) return;
    const run = Store.db.skin.aiAutoRun;
    if (run && run.date === t) return;
    const target = this._photoList('skin').find((p) => p.date === t);
    if (!target) return;
    Store.db.skin.aiAutoRun = { date: t, file: target.file };
    Store.save();
    this._aiAnalyze();
  },

  /* ============ 皮肤状态系统（SkinEngine 驱动：预测 → 记录 → 对账 → 洞察） ============ */

  _skinContext() {
    const db = Store.db;
    /* 近 7 天周刺激组（跨肌群最大值）：供 R12 判断训练恢复负荷是否超带 */
    let weeklyStim = null;
    try {
      if (typeof StrengthCore !== 'undefined' && db.strength) {
        const mp = StrengthCore.muscleProgress(db.strength, todayKey());
        const top = mp.reduce((m, x) => (typeof x.weeklyStimSets === 'number' ? Math.max(m, x.weeklyStimSets) : m), 0);
        if (top > 0) weeklyStim = top;
      }
    } catch { /* 力量数据缺失不影响护肤预测 */ }
    return {
      dateKey: todayKey(), /* predictForDate 读 dateKey；漏传会在打开护肤页时抛错并留下上一栏目 */
      nowMs: Date.now(),
      sleeps: db.rhythm && Array.isArray(db.rhythm.sleeps) ? db.rhythm.sleeps : [],
      meals: db.rhythm && Array.isArray(db.rhythm.meals) ? db.rhythm.meals : [],
      strengthDays: db.strength && db.strength.days ? db.strength.days : {},
      strengthWeeklyStimSets: weeklyStim,
      logs: db.skin.logs
    };
  },

  /* 每天首次打开护肤页时固化当日预测（先预测后记录，才能对账）。
     例外（P6）：生成时手环睡眠还没同步（hadSleep=false），之后数据到了就重算一次——
     重算仍发生在用户记录皮肤之前，对账公平性不变。
     预测失败不得挡住护肤页本身，否则 #view-root 会停在上一栏目。 */
  _ensureTodayPrediction() {
    try {
      const state = Store.db.skin;
      if (!state || !state.predictions || !state.logs) return;
      const t = todayKey(), ctx = this._skinContext();
      const p = SkinEngine.predictForDate(ctx);
      const old=state.predictions[t];
      if(JSON.stringify(old?.evidence)!==JSON.stringify(p.evidence)||JSON.stringify(old?.items)!==JSON.stringify(p.items)){
        state.predictions[t] = { ...p, madeAt: new Date().toISOString(), hadSleep:!!p.evidence?.sleepDate, verified:old?.verified };
      }
    } catch(err) { console.error('[skincare] predict',err); }
  },

  /* 快速打卡评分上下文：昨晚睡眠、昨日是否晚食（≥21:30，与预测 R9 同口径）、
     28 天个人基线、昨日日志（推导眼周/肤感/泛红/屏障/毛孔/斑/干燥用） */
  _scoreContextFor(dateKey) {
    const db = Store.db;
    const now = Date.now();
    const sleep = SkinEngine.sleepForDate(db.rhythm && db.rhythm.sleeps, dateKey, now);
    const prevDate = SkinEngine.addDays(dateKey, -1);
    const prevLog = db.skin.logs[prevDate] || null;
    const baseline = SkinEngine.baseline(db.skin.logs, dateKey, 28);
    let lateMeal = false;
    const dayMeals = ((db.rhythm && db.rhythm.meals) || []).filter((m) => String(m.local || '').slice(0, 10) === prevDate);
    const lastMeal = dayMeals.map((m) => String(m.local || '')).sort().pop();
    if (lastMeal) {
      const lm = SkinEngine.minutesOf(lastMeal.slice(11, 16));
      lateMeal = lm !== null && lm >= 1290;
    }
    return { sleep, lateMeal, baseline, prevLog };
  },

  _dirIcon(dir) { return dir === 'down' ? '📉' : dir === 'up' ? '📈' : '➖'; },

  /* 皮肤周报：对「昨天结束的最近 7 天」自动生成并留存，可回看与复制。
     周报失败同样不得挡住护肤页。 */
  _ensureWeeklyReport() {
    try {
      const state = Store.db.skin;
      if (!state || !state.weeklyReports) return;
      const weekEnd = SkinEngine.addDays(todayKey(), -1);
      if (state.weeklyReports[weekEnd]) return;
      const rep = SkinEngine.weeklyReport(
        state.logs,
        (Store.db.rhythm && Store.db.rhythm.sleeps) || [],
        (Store.db.rhythm && Store.db.rhythm.meals) || [],
        weekEnd, Date.now()
      );
      if (!rep || rep.daysLogged === 0) return; /* 该周完全没记录，不生成空报告 */
      state.weeklyReports[weekEnd] = rep;
      Store.save();
    } catch (err) {
      console.error('[skincare] weeklyReport', err);
    }
  },

  _weeklyReportText(end) {
    const r = Store.db.skin.weeklyReports[end];
    if (!r) return '';
    const L = [`【皮肤周报】${SkinEngine.addDays(end, -6)} ~ ${end}`];
    L.push(`记录 ${r.daysLogged} 天 · 平均评分 ${r.avgScore ?? '—'}`);
    if (r.best) L.push(`最好：${r.best.date.slice(5)}（${r.best.score} 分）`);
    if (r.worst) L.push(`最差：${r.worst.date.slice(5)}（${r.worst.score} 分）`);
    L.push(`新痘合计 ${r.acneNewTotal} 颗`);
    L.push(r.sleepAvgMin !== null ? `睡眠平均 ${Math.floor(r.sleepAvgMin / 60)}小时${r.sleepAvgMin % 60}分（${r.sleepDays} 晚）` : '睡眠：无记录');
    L.push(`晚于21:30 进食 ${r.lateDays} 天`);
    return L.join('\n');
  },
  _levelClass(level) { return level === 'warn' ? 'sk-pred-warn' : level === 'good' ? 'sk-pred-good' : 'sk-pred-info'; },

  _skinTodayCard() {
    const t = todayKey();
    const log = Store.db.skin.logs[t];
    const pred = Store.db.skin.predictions[t];
    const ctx = this._scoreContextFor(t);
    const scored = log ? SkinEngine.scoreSkinWithDerived(log, ctx) : null;
    const score = scored ? { score: scored.score } : null;
    const base = SkinEngine.baseline(Store.db.skin.logs, addDays(t, 1), 28);
    const lvl = (v) => (v === 0 ? 0 : v === 1 ? 1 : v === 2 ? 2 : 3);
    const detailParams = SkinEngine.PARAMS.filter((p) => p.key !== 'oil');
    const oilParam = SkinEngine.PARAMS.find((p) => p.key === 'oil');
    const derivedKeys = scored ? Object.keys(scored.derived || {}) : [];
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
          <span class="h-extra">${log && score ? `已记录 · 评分 ${score.score}/100（含引擎推导）` : '还没记录'}</span>
          <button class="btn primary small" id="sk-skin-shoot" type="button" data-no-icon="true">📸 拍摄今日皮肤</button>
        </h3>
        <p class="hint" style="margin:0 0 10px">每天 <b>30 秒</b>：记痘痘数量、肤感和大概感受就够——眼周/毛孔/泛红/屏障等由引擎根据<b>昨晚睡眠与你的历史</b>自动推导（显式记录优先于推导）。评分为<b>自评加权参考，非医学诊断</b>：<details style="display:inline"><summary style="cursor:pointer; display:inline; color:#7b74e2">查看权重口径</summary>
          <span>痘痘 ${Math.round(SkinEngine.ACNE_WEIGHT * 100)}% · ${SkinEngine.PARAMS.map((p) => `${p.label} ${Math.round(p.weight * 100)}%`).join(' · ')}（主客观 7:3 融合）。痘痘按病灶计数计分，与痤疮临床试验的病灶计数终点口径一致；各维度权重为设计取值（文献不提供合成权重），非临床分级</span></details></p>
        ${pred && !log && Array.isArray(pred.items) ? `
        <div style="display:grid; gap:8px; margin-bottom:14px">
          <div class="row" style="gap:6px; align-items:center">
            <b style="font-size:13.5px">🩺 今日预测（基于睡眠·训练·近期皮肤）</b>
            <span class="badge">${this._dirIcon(pred.overallDir)} ${pred.overallDir == null ? '暂无足够记录' : pred.overallDir === 'down' ? '预计下滑' : pred.overallDir === 'up' ? '预计向好' : '预计平稳'}</span>
          </div>
          <details><summary>记录依据与缺项</summary><p class="hint">睡眠：${esc(pred.evidence?.sleepDate || '未记录')} · ${pred.evidence?.sleepSamples || 0} 段；近 3 天皮肤：${pred.evidence?.skinSamples || 0} 条。${esc((pred.missing || []).join('、'))}</p></details>
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
        <div class="sk-param-row"><span class="sk-param-label">${oilParam.label}</span>
          <div class="sk-seg" data-param="oil">
            ${oilParam.levels.map((name, v) => `<button data-v="${v}" class="${log && Number.isInteger(log.oil) && lvl(log.oil) === v ? 'on' : ''}">${name}</button>`).join('')}
          </div><span class="hint">干爽 ↔ 出油的大概感觉</span></div>
        <div class="sk-param-row"><span class="sk-param-label">整体感受</span>
          <div class="sk-seg" data-param="overall">
            ${Array.from({ length: 10 }, (_, i) => i + 1).map((v) => `<button data-v="${v}" class="${log && Number.isInteger(log.overall) && log.overall === v ? 'on' : ''}">${v}</button>`).join('')}
          </div><span class="hint">1 很差 · 10 很好</span></div>
        <details style="margin:10px 0 4px"><summary style="cursor:pointer; font-size:12.5px; color:#7b74e2">展开详细参数（眼周/毛孔/斑/泛红/干燥/屏障——选填，不填由引擎根据睡眠与历史自动估算）</summary>
          <div style="margin-top:8px; display:grid; gap:0">
          ${detailParams.map((p) => {
            const isDerived = derivedKeys.includes(p.key) && !(log && Number.isInteger(log[p.key]));
            return `
          <div class="sk-param-row"><span class="sk-param-label">${p.label}</span>
            <div class="sk-seg" data-param="${p.key}">
              ${p.levels.map((name, v) => `<button data-v="${v}" class="${log && Number.isInteger(log[p.key]) && lvl(log[p.key]) === v ? 'on' : ''}">${name}</button>`).join('')}
            </div>${isDerived ? `<span class="hint" style="color:#7b74e2">引擎估算</span>` : ''}</div>`;
          }).join('')}
          </div>
        </details>
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

  /* 照片统一排序：日期倒序（新日期在前），同日按添加先后（P9 支持回填历史日期后，
     添加顺序不再等于日期顺序，列表/AI 取图一律走这里，消除隐式耦合） */
  _photoList(kind) {
    return Store.db.skin.photos
      .filter((p) => p.kind === kind)
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  _skinPhotosCard() {
    const kind = this.ui.skinPhotoKind || 'skin';
    const photos = this._photoList(kind).slice(0, 30);
    const today = todayKey();
    const weight = Store.db.strength && Store.db.strength.bmiProfile ? Store.db.strength.bmiProfile.weightKg : '';
    return `
      <div class="card">
        <h3 class="sk-photo-heading">📸 照片档案 <span class="h-extra">同一角度光线，变化才可比</span><button class="btn primary small" id="sk-photo-shoot" type="button" data-no-icon="true">📸 拍摄</button></h3>
        <details style="margin:4px 0 8px"><summary style="cursor:pointer; font-size:12px; color:#7b74e2">📷 拍摄一致性小贴士（点开）</summary>
          <span style="display:block; font-size:12px; color:#64758a; margin-top:4px">同一时间（建议晨起洗脸后）· 正面平视同一角度 · 自然光、素颜、摘掉眼镜与刘海——照片越一致，AI 对比与评分趋势越可信。</span></details>
        <div class="row" style="align-items:center; flex-wrap:wrap; gap:8px">
          <button class="btn small ${kind === 'skin' ? 'primary' : ''}" data-skin-kind="skin">🧑 皮肤状态</button>
          <button class="btn small ${kind === 'body' ? 'primary' : ''}" data-skin-kind="body">💪 健身体型</button>
          <span style="flex:1"></span>
          <label class="row" style="gap:6px; font-size:12.5px; color:#566176" ${kind==='skin'?'hidden':''}>体重kg
            <input class="input sk-num" id="sk-photo-weight" type="number" min="25" max="400" step="0.1" style="width:80px" value="${esc(String(weight || ''))}" placeholder="选填"></label>
          <label class="row" style="gap:6px; font-size:12.5px; color:#566176">导入日期
            <input class="input" id="sk-photo-date" type="date" max="${today}" value="${today}" style="width:140px"></label>
          <label>角度<select class="input" id="sk-photo-angle"><option value="unknown">未标注</option><option value="front">正面</option><option value="left">左侧</option><option value="right">右侧</option></select></label><button class="btn" id="sk-photo-add">导入已有照片</button>
          <input type="file" id="sk-photo-file" accept="image/*" multiple style="display:none">
        </div>
        <details class="sk-photo-tools"><summary>导入、管理与对比工具</summary><div class="ux-actions">
          <button class="btn" id="sk-photo-folder">打开${kind === 'body' ? '健身照片' : '皮肤照片'}文件夹</button>
          <button class="btn ghost" id="sk-photo-scan" data-no-icon="true">读取文件夹里的新照片</button>
          <button class="btn ghost" id="sk-photo-paste" data-no-icon="true">📋 粘贴截图</button>
          <button class="btn ghost" id="sk-photo-overview" data-no-icon="true">▦ 总览对比</button>
        </div>
        <p class="hint" style="margin:8px 0 10px" id="sk-photo-folder-path">${kind === 'body' ? '健身照保存在工程「健身照片」文件夹。' : '皮肤照保存在工程「皮肤照片」文件夹。'}把 jpg/png 直接放进去，再点「读取文件夹里的新照片」或重新打开本页即可。本地视频在「跟练视频」。${kind === 'skin' ? '建议每天同一位置、自然光下拍一面。' : '体型照配体重，和力量训练的进步对照看。'}</p>
        </details>
        <div class="sk-drop" id="sk-photo-drop">
          ${photos.length ? `<div class="sk-photo-grid">
            ${photos.map((p, i) => `
              <figure class="sk-photo-thumb" data-idx="${i}" title="${esc(p.date)}${p.weightKg ? ' · ' + p.weightKg + 'kg' : ''}">
                <img data-photo-file="${esc(p.file)}" data-photo-kind="${esc(p.kind || kind)}" alt="${esc(p.date)}">
                <figcaption>${esc(p.date.slice(5))}${p.local ? ' '+esc(p.local.slice(11)) : ''}${p.weightKg ? ' · ' + p.weightKg + 'kg' : ''}${p.source==='weixin-life-diary' ? ' · 微信' : ''}</figcaption>
              </figure>`).join('')}
          </div>` : '<div class="empty" style="padding:18px 0">还没有照片。点右上方「拍摄」打开摄像头，或导入已有照片。</div>'}
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
        score: (SkinEngine.scoreSkin(db.skin.logs[d]) || {}).score ?? null,
        sleepMinutes: sl ? sl.minutes : null,
        trained: (sd && (sd.status === 'completed' || sd.status === 'partial')) || (follow.seconds || 0) > 0
      };
    });
    const corr = SkinEngine.correlate(series);
    const lag = SkinEngine.bestLagCorrelation(series, 2);
    const diet = SkinEngine.dietSummary(db.rhythm && db.rhythm.meals, todayKey(), Date.now(), 7);
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
    const reports = Object.entries(db.skin.weeklyReports || {})
      .sort((a, b) => a[0].localeCompare(b[0])).slice(-6).reverse();
    const st = db.skin.stats;
    return `
      <div class="card">
        <h3>🧠 互通洞察 <span class="h-extra">皮肤 × 睡眠 × 训练 · 最近 ${series.length} 天</span>
          <button class="btn small" id="sk-brief" style="margin-left:auto">📋 复制健康简报（给 AI）</button>
          <button class="btn small" id="sk-csv" data-no-icon="true">⬇ 皮肤CSV</button></h3>
        <div class="row" style="align-items:center; gap:14px; flex-wrap:wrap">
          <svg viewBox="0 0 ${W} ${H}" style="width:min(300px,100%); height:56px" role="img" aria-label="皮肤评分走势">
            <polyline points="${pts}" fill="none" stroke="#7b74e2" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            ${scores.map((v, i) => `<circle cx="${(i / Math.max(1, scores.length - 1)) * W}" cy="${H - ((v - min) / Math.max(1, max - min)) * H}" r="2.6" fill="#7b74e2"/>`).join('')}
          </svg>
          <div style="display:grid; gap:4px; font-size:12.5px; color:#4c5b70">
            ${sent(corr.sleep, '睡眠时长 ↔ 皮肤评分', true)}
            ${sent(corr.training, '训练日 ↔ 皮肤评分', true)}
            ${lag && lag.lag > 0 ? `<span>· <b>睡眠滞后关联</b>：与 <b>${lag.lag} 天前</b>睡眠的关联最强（r=${lag.r}，n=${lag.n}）——系 0/1/2 天三个滞后中选最大，小样本会偏高，仅为个体趋势参考</span>` : ''}
            ${diet.days ? `<span>· <b>饮食节律</b>（近7天）：进食窗口平均 ${diet.avgWindowHours ?? '—'} 小时 · 末餐平均 ${diet.avgLastMeal ?? '—'} · 晚于21:30 ${diet.lateDays} 天</span>` : '<span class="hint">· 饮食节律：在「饮食与睡眠」记几餐后，这里会给出进食窗口与末餐统计</span>'}
            ${st.seen ? `<span>· <b>预测命中</b>：${st.hit}/${st.seen}（${Math.round(st.hit / st.seen * 100)}%）——方向性预测，随记录积累校准</span>` : '<span class="hint">· 预测对账：保存今日记录后开始累计命中率</span>'}
          </div>
        </div>
        ${verified.length ? `<details style="margin-top:10px"><summary style="cursor:pointer; font-size:12.5px; color:#566176">最近预测对账（${verified.length}）</summary>
          <div style="display:grid; gap:5px; margin-top:8px">
            ${verified.map(([d, p]) => `<span style="font-size:12px; color:#4c5b70">${d.slice(5)} ${this._dirIcon(p.overallDir)} 预测${p.overallDir === 'down' ? '下滑' : p.overallDir === 'up' ? '向好' : '平稳'} → 实际 ${p.verified.delta > 0 ? '+' : ''}${p.verified.delta} 分 ${p.verified.hit ? '<b style="color:#1d6e4f">✓ 命中</b>' : '<b style="color:#b4552e">✗ 未中</b>'}</span>`).join('')}
          </div></details>` : ''}
        ${reports.length ? `<details style="margin-top:8px"><summary style="cursor:pointer; font-size:12.5px; color:#566176">📋 皮肤周报（${reports.length} 份，每周自动生成）</summary>
          <div style="display:grid; gap:8px; margin-top:8px">
            ${reports.map(([end, r], i) => {
              const prev = reports[i + 1];
              const delta = prev && prev[1].avgScore !== null && r.avgScore !== null ? r.avgScore - prev[1].avgScore : null;
              return `<div style="display:grid; gap:3px; padding:8px 10px; border:1px solid rgba(44,58,71,.08); border-radius:10px; background:rgba(255,255,255,.55)">
                <b style="font-size:12.5px">周（至 ${end}）均分 ${r.avgScore ?? '—'}${delta !== null ? `<span style="color:${delta >= 0 ? '#1d6e4f' : '#b4552e'}">（较上周 ${delta > 0 ? '+' : ''}${delta}）</span>` : ''}</b>
                <span style="font-size:11.5px; color:#566176">记录 ${r.daysLogged} 天 · 新痘 ${r.acneNewTotal} 颗${r.best ? ` · 最好 ${r.best.date.slice(5)}（${r.best.score}）` : ''} · 睡眠均 ${r.sleepAvgMin !== null ? Math.floor(r.sleepAvgMin / 60) + 'h' + (r.sleepAvgMin % 60) + 'm' : '—'} · 晚食 ${r.lateDays} 天</span>
                <button class="btn small ghost" data-copy-week="${esc(end)}" data-no-icon="true" style="justify-self:start">📋 复制本周报</button>
              </div>`;
            }).join('')}
          </div></details>` : ''}
        <p class="hint" style="margin:10px 0 0">相关性是个体趋势参考，不构成医学结论；r 的解释随记录增多会更稳定。</p>
      </div>`;
  },

  /* 健康简报：三系统数据汇总成纯文本，便于复制整理 */
  _buildHealthBrief() {
    const db = Store.db;
    const t = todayKey();
    const L = [];
    L.push(`【皮肤与生活简报】生成于 ${t}（本应用「人生重塑计划」导出，供 AI 参考，非医学诊断）`);
    L.push('');
    L.push('== 皮肤（近14天，评分0-100越高越好）==');
    const dates = Object.keys(db.skin.logs).sort().slice(-14);
    if (!dates.length) L.push('（暂无记录）');
    for (const d of dates) {
      const l = db.skin.logs[d];
      const s = SkinEngine.scoreSkin(l).score;
      L.push(`${d} 评分${s}：痘${l.acneTotal ?? '?'}颗(新${l.acneNew ?? 0}) 毛孔${l.pores ?? '-'} 斑${l.spots ?? '-'} 泛红${l.redness ?? '-'} 油${l.oil ?? '-'} 干${l.dry ?? '-'} 屏障${l.barrier ?? '-'} 眼周${l.eyes ?? '-'}${l.note ? '｜备注:' + l.note : ''}`);
    }
    L.push('');
    L.push('== 睡眠（近14天，按醒来日期）==');
    const sleeps = (db.rhythm && db.rhythm.sleeps) || [];
    let sleepN = 0, sleepSum = 0;
    for (const d of dates) {
      const s = SkinEngine.sleepForDate(sleeps, d, Date.now());
      if (!s) continue;
      sleepN++; sleepSum += s.minutes;
      L.push(`${d} ${Math.floor(s.minutes / 60)}小时${s.minutes % 60}分（${s.bedtime} 入睡）`);
    }
    if (!sleepN) L.push('（近14天无睡眠记录）');
    else L.push(`—— 平均 ${Math.round(sleepSum / sleepN / 6) / 10} 小时`);
    L.push('');
    L.push('== 力量训练与跟练（近14天）==');
    const sd = (db.strength && db.strength.days) || {};
    let hadLine = false;
    for (const d of dates) {
      const day = sd[d];
      const followMin = Store.dayTraining ? Math.round(((Store.dayTraining(d) || { seconds: 0 }).seconds) / 60) : 0;
      const parts = [];
      if (day) {
        const stMap = { completed: '完成', partial: '部分完成', skipped: '跳过', 'in-progress': '进行中' };
        parts.push(`${day.name} ${stMap[day.status] || day.status}${day.totalSeconds ? ` ${Math.round(day.totalSeconds / 60)}分钟` : ''}${day.status === 'skipped' && day.resolution && day.resolution.note ? `（原因:${day.resolution.note}）` : ''}`);
      }
      if (followMin > 0) parts.push(`跟练 ${followMin} 分钟`);
      if (parts.length) { L.push(`${d} ${parts.join(' · ')}`); hadLine = true; }
    }
    if (!hadLine) L.push('（近14天无训练记录）');
    L.push('');
    L.push('== 饮食节律（近7天）==');
    const diet = SkinEngine.dietSummary(db.rhythm && db.rhythm.meals, t, Date.now(), 7);
    L.push(diet.days ? `有进餐记录 ${diet.days} 天 · 进食窗口平均 ${diet.avgWindowHours ?? '—'} 小时 · 末餐平均 ${diet.avgLastMeal ?? '—'} · 晚于21:30 ${diet.lateDays} 天` : '（暂无进餐记录）');
    L.push('');
    L.push('== 身体基础数值 ==');
    const p = (db.strength && db.strength.bmiProfile) || {};
    const core = (typeof StrengthCore !== 'undefined') ? StrengthCore : (typeof require !== 'undefined' ? require('./strength-core') : null);
    const bmiCalc = core ? core.bmi(p.heightCm, p.weightKg) : null;
    const bmr = core ? core.bmrMifflin(p.sex || '男', p.weightKg, p.heightCm, p.age) : null;
    if (bmiCalc !== null) L.push(`BMI ${bmiCalc}（${core.bmiCategoryCN(bmiCalc)}）${p.age ? ` · ${p.age}岁${p.sex || '男'}性` : ''}`);
    if (bmr !== null) L.push(`BMR ≈ ${bmr} kcal/天${p.activity ? ` · 活动水平:${ { sedentary: '久坐', light: '轻度', moderate: '中度', active: '高强度' }[p.activity] || p.activity }` : ''}`);
    if (bmiCalc === null && bmr === null) L.push('（未填写身高体重等）');
    L.push('');
    L.push('== 预测对账 ==');
    const st = db.skin.stats;
    L.push(st.seen ? `方向性预测命中 ${st.hit}/${st.seen}` : '暂无对账数据');
    return L.join('\n');
  },

  async _copyHealthBrief() {
    const text = this._buildHealthBrief();
    try {
      await navigator.clipboard.writeText(text);
      toast('健康简报已复制，可粘贴给 AI 辅助整理健康问题', 'green');
    } catch {
      toast('复制失败，请手动选择文本复制', 'red');
    }
  },

  _bindSkin(root) {
    const shoot=$('#sk-skin-shoot',root);if(shoot)shoot.onclick=()=>CareCamera.shoot({kind:'skin',date:todayKey(),returnTab:'record'});
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
    if (save) save.onclick = () => this._saveSkinLog(root);
    const briefBtn = $('#sk-brief', root);
    if (briefBtn) briefBtn.onclick = () => this._copyHealthBrief();
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
    const csvBtn = $('#sk-csv', root);
    if (csvBtn) csvBtn.onclick = () => this._exportSkinCsv();
    const ovBtn = $('#sk-photo-overview', root);
    if (ovBtn) ovBtn.onclick = () => this._photoOverviewModal();
    $$('[data-copy-week]', root).forEach((b) => {
      b.onclick = async () => {
        const text = this._weeklyReportText(b.dataset.copyWeek);
        try { await navigator.clipboard.writeText(text); toast('周报已复制', 'green'); }
        catch { toast('复制失败', 'red'); }
      };
    });
    this._bindPhotoCard(root);
  },

  /* CSV 导出（带 BOM，Excel 直开） */
  _downloadCsv(name, rows) {
    const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  _exportSkinCsv() {
    const logs = Store.db.skin.logs;
    const dates = Object.keys(logs).sort();
    if (!dates.length) { toast('还没有皮肤记录可导出', 'red'); return; }
    const rows = [['日期', '评分', '痘痘总数', '今日新增', '眼周', '毛孔', '斑/痘印', '泛红', '出油', '干燥', '屏障', '整体感受', '备注']];
    for (const d of dates) {
      const l = logs[d];
      rows.push([d, SkinEngine.scoreSkin(l).score, l.acneTotal ?? '', l.acneNew ?? '', l.eyes ?? '', l.pores ?? '', l.spots ?? '', l.redness ?? '', l.oil ?? '', l.dry ?? '', l.barrier ?? '', l.overall ?? '', l.note || '']);
    }
    this._downloadCsv(`皮肤日志-${todayKey()}.csv`, rows);
  },

  /* 照片九宫格总览：从全部照片中按时间均匀取最多 9 张 */
  _photoOverviewModal() {
    const kind = this.ui.skinPhotoKind || 'skin';
    const list = this._photoList(kind);
    if (list.length < 4) { toast('照片不足 4 张，先攒一攒', 'red'); return; }
    const n = Math.min(9, list.length);
    const idxs = [...new Set(Array.from({ length: n }, (_, i) => Math.round(i * (list.length - 1) / Math.max(1, n - 1))))];
    const card = openModal(`
      <h3>▦ 总览对比 <span class="h-extra">均匀取 ${idxs.length} 张 · ${list[list.length - 1].date} → ${list[0].date}</span></h3>
      <div class="sk-photo-grid">${idxs.map((i) => `
        <figure class="sk-photo-thumb" data-idx="${i}" style="cursor:pointer">
          <img data-photo-file="${esc(list[i].file)}" data-photo-kind="${esc(list[i].kind || kind)}" alt="">
          <figcaption>${esc(list[i].date.slice(5))}${list[i].weightKg ? ' · ' + list[i].weightKg + 'kg' : ''}</figcaption>
        </figure>`).join('')}</div>
      <div class="row" style="justify-content:flex-end; margin-top:10px"><button class="btn ghost" id="ov-close">关闭</button></div>`);
    this._loadPhotoImgs(card);
    $('#ov-close', card).onclick = closeModal;
    $$('.sk-photo-thumb', card).forEach((elClick) => {
      elClick.onclick = () => { closeModal(); this._photoViewer(Number(elClick.dataset.idx)); };
    });
  },

  _bindPhotoCard(root) {
    const shoot=$('#sk-photo-shoot',root);if(shoot)shoot.onclick=()=>CareCamera.shoot({kind:this.ui.skinPhotoKind||'skin',date:todayKey(),angle:$('#sk-photo-angle',root)?.value,returnTab:'photos'});
    /* 照片类别切换 */
    $$('[data-skin-kind]', root).forEach((btn) => {
      btn.onclick = () => { this.ui.skinPhotoKind = btn.dataset.skinKind; App.render(); };
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
    const folderBtn = $('#sk-photo-folder', root);
    if (folderBtn) folderBtn.onclick = () => this._openPhotoFolder();
    const scanBtn = $('#sk-photo-scan', root);
    if (scanBtn) scanBtn.onclick = () => this._syncFolderPhotos(true);
    native.photoFolderInfo?.(this.ui.skinPhotoKind || 'skin').then((info) => {
      const el = $('#sk-photo-folder-path', root);
      if (!el || !info?.path) return;
      const label = info.kind === 'body' ? '健身照片' : '皮肤照片';
      el.textContent = info.visible
        ? `当前在工程子文件夹「${label}」。完整路径：${info.path}。把 jpg/png 放进去后点「读取文件夹里的新照片」，或重新打开本页。本地视频在「跟练视频」。`
        : `当前使用隔离资料，照片在：${info.path}`;
    }).catch(() => {});
    this._syncFolderPhotos(false);
  },

  async _openPhotoFolder() {
    if (!native.openPhotoFolder) { toast('当前版本无法打开文件夹', 'red'); return; }
    const kind = this.ui.skinPhotoKind || 'skin';
    const r = await native.openPhotoFolder(kind);
    const label = kind === 'body' ? '健身照片' : '皮肤照片';
    if (r?.error) toast(`无法自动打开 Finder。请到「面部重塑计划」里打开「${label}」。路径：${r.path || ''}`, 'red');
    else toast(`已打开${label}文件夹`);
  },

  async _syncFolderPhotos(manual) {
    if (!native.listSkinPhotos || this._syncingPhotos) return;
    this._syncingPhotos = true;
    try {
      const kind = this.ui.skinPhotoKind || 'skin';
      const known = (Store.db.skin.photos || []).filter((p) => (p.kind || 'skin') === kind).map((p) => p.file);
      const listed = await native.listSkinPhotos(known, kind, todayKey());
      if (!listed || !listed.length) {
        if (manual) toast('文件夹里没有尚未登记的 jpg/png');
        return;
      }
      const today = todayKey();
      let n = 0;
      for (const item of listed) {
        const date = item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && item.date <= today ? item.date : today;
        Store.db.skin.photos.push({
          id: uid('ph'), date, kind,
          angle: 'unknown', file: item.name, note: '', createdAt: new Date().toISOString()
        });
        n++;
      }
      if (n) {
        Store.save(true);
        toast(`已从文件夹读入 ${n} 张照片 ✓`, 'green');
        App.render();
      }
    } catch {
      if (manual) toast('读取文件夹失败', 'red');
    } finally {
      this._syncingPhotos = false;
    }
  },

  async _saveSkinLog(scope = $('#view-root')) {
    const t = todayKey();
    const log = { date: t, createdAt: new Date().toISOString() };
    let any = false;
    $$('.sk-seg', scope).forEach((seg) => {
      const on = $('button.on', seg);
      if (!on) return;
      const v = Number(on.dataset.v);
      any = true;
      if (seg.dataset.param === 'overall') log.overall = v;
      else log[seg.dataset.param] = v;
    });
    const total = $('#sk-acne-total',scope).value.trim(), fresh = $('#sk-acne-new',scope).value.trim();
    if (total !== '') { log.acneTotal = Math.max(0, Math.min(99, Math.round(Number(total)))); any = true; }
    if (fresh !== '') { log.acneNew = Math.max(0, Math.min(99, Math.round(Number(fresh)))); any = true; }
    if (!any) { toast('至少记一项：痘痘计数、任一参数或整体感受', 'red'); return; }
    log.note = $('#sk-skin-note',scope).value.trim();
    log.source=this.pendingAi?.forDate===t?'ai':'manual';log.ruleVersion=1;
    if(this.pendingAi?.forDate===t)SkinEngine.saveFaceState(Store.db,this.pendingAi.photoDate,this.pendingAi.data);
    Store.db.skin.logs[t] = log;
    /* 评分用推导合成：快速打卡只填 2-3 项也能得到完整评分（与今日卡展示口径一致） */
    const score = SkinEngine.scoreSkinWithDerived(log, this._scoreContextFor(t)).score;
    const v = SkinEngine.verifyPrediction(Store.db.skin, t, score);
    Store.save(true);
    if (v && v.skipped) toast(`已记录（${score} 分）· 与上次记录间隔 ${v.gapDays} 天，本次不计入预测对账`);
    else if (v) toast(v.hit ? `已记录（${score} 分）· 预测命中 ✓（${v.delta > 0 ? '+' : ''}${v.delta}）` : `已记录（${score} 分）· 预测未中 ✗（${v.delta > 0 ? '+' : ''}${v.delta}）`, v.hit ? 'green' : '');
    else toast(`已记录，今日评分 ${score} 分`, 'green');
    this.pendingAi=null;
    App.render();
    return true;
  },

  async _addPhotoFiles(files) {
    if (!files || !files.length) return;
    const today = todayKey();
    /* P9：默认今天，可选历史日期回填（不允许未来日期） */
    const dateInput = $('#sk-photo-date');
    let t = dateInput && dateInput.value ? dateInput.value : today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || t > today) { toast('拍摄日期无效，已按今天记录', 'red'); t = today; }
    const kind = this.ui.skinPhotoKind || 'skin';
    const weightRaw = $('#sk-photo-weight') ? $('#sk-photo-weight').value.trim() : '';
    const weight = weightRaw !== '' && Number.isFinite(Number(weightRaw)) ? Number(weightRaw) : undefined;
    let ok = 0;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const ext = f.type.includes('png') ? 'png' : 'jpg';
        const name = await native.saveSkinPhoto(buf, ext, { date: t, kind, angle: $('#sk-photo-angle')?.value || 'unknown' });
        if (!name) { toast('图片过大（限 20MB）', 'red'); continue; }
        Store.db.skin.photos.push({ id: uid('ph'), date: t, kind, angle:$('#sk-photo-angle')?.value || 'unknown', file: name, weightKg: kind === 'body' ? weight : undefined, note: '', createdAt: new Date().toISOString() });
        ok++;
      } catch { toast('有一张读取失败', 'red'); }
    }
    if (ok) {
      Store.save(true);
      toast(`已添加 ${ok} 张${kind === 'skin' ? '皮肤' : '体型'}照片（${t}）✓`, 'green');
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
      const kind = img.dataset.photoKind || this.ui.skinPhotoKind || 'skin';
      img.removeAttribute('src');
      delete img.dataset.missing;
      img.removeAttribute('title'); /* 失败原因挂 title：成功即移除，不会像改写 alt 那样残留污染 */
      let b64 = null;
      try {
        b64 = await native.readSkinPhoto(file, kind);
      } catch {
        b64 = null;
      }
      if (img.dataset.photoFile !== file) return 0; /* 已切到别的文件：本次响应作废 */
      if (b64) {
        const lower = String(file).toLowerCase();
        img.src = `data:image/${lower.endsWith('.png') ? 'png' : lower.endsWith('.webp') ? 'webp' : 'jpeg'};base64,${b64}`;
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
    const list = this._photoList(kind);
    const p = list[idx];
    if (!p) return;
    const card = openModal(`
      <h3>🖼️ ${p.date}${p.kind === 'body' ? ' · 体型' : ' · 皮肤'}${p.weightKg ? ` · ${p.weightKg}kg` : ''}</h3>
      ${p.local ? `<p class="hint">${p.timeKind==='occurred'?'记录时间':'照片发送时间'}：${esc(p.local.replace('T',' '))} · 北京时间${p.note ? ' · '+esc(p.note) : ''}</p>` : ''}
      <div class="sk-viewer-img"><img data-photo-file="${esc(p.file)}" data-photo-kind="${esc(p.kind || kind)}" alt="${esc(p.date)}"></div>
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
      await native.deleteSkinPhoto(p.file, p.kind || kind);
      Store.db.skin.photos = Store.db.skin.photos.filter((x) => x.id !== p.id);
      if(p.sourceKey){
        Store.db.photoImportVersions=Store.db.photoImportVersions || {};
        Store.db.photoImportVersions[p.sourceKey]={revision:p.sourceRevision || 1,state:'manual-deleted'};
      }
      /* 删的是今天的照片时清掉自动识图标记：否则当天补拍新照会被「已跑过」挡住不再分析（走查 #4） */
      if (Store.db.skin.aiAutoRun && Store.db.skin.aiAutoRun.date === todayKey()) delete Store.db.skin.aiAutoRun;
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
          <div class="sk-viewer-img" style="flex:1"><img data-photo-file="${esc(p.file)}" data-photo-kind="${esc(p.kind || kind)}" alt=""></div>
          <div class="sk-viewer-img" style="flex:1"><img data-photo-file="${esc(others[0].file)}" data-photo-kind="${esc(others[0].kind || kind)}" alt=""></div>
        </div>
        <div class="row" style="justify-content:flex-end; margin-top:10px"><button class="btn ghost" id="pv-close">关闭</button></div>`);
      this._loadPhotoImgs(card2);
      $('#pv-close', card2).onclick = closeModal;
      $('#pv-a', card2).onchange = $('#pv-b', card2).onchange = () => {
        const a = list[Number($('#pv-a', card2).value)], b = list[Number($('#pv-b', card2).value)];
        const imgs = $$('img[data-photo-file]', card2);
        if (imgs[0]) { imgs[0].dataset.photoFile = a.file; imgs[0].dataset.photoKind = a.kind || kind; }
        if (imgs[1]) { imgs[1].dataset.photoFile = b.file; imgs[1].dataset.photoKind = b.kind || kind; }
        this._loadPhotoImgs(card2);
      };
    };
  },

  /* ============ 视图 ============ */
  view(root) {
    SkinEngine.normalize(Store.db); /* 皮肤引擎状态（logs/photos/predictions/stats） */
    this._ensureTodayPrediction();
    this._ensureWeeklyReport();
    this._bindPasteOnce();
    const cycles = Store.db.skincare.cycles || [];
    const active = Store.activeCycle();
    root.innerHTML = `
      <div class="view">
        <div id="sk-skin-today">${this._skinTodayCard()}</div>
        <div id="sk-face-advice">${this._faceAdviceCard()}</div>
        <div id="sk-skin-photos">${this._skinPhotosCard()}</div>
        <div id="sk-skin-insight">${this._skinInsightCard()}</div>
        <div class="card">
          <h3>🧴 护肤周期 <span class="h-extra">当前：${active ? esc(active.name) + (active.endDate ? `（至 ${active.endDate}）` : '（长期）') : '未设定'}</span></h3>
          <div class="row">
            <button class="btn primary" id="sk-import">📥 导入 AI 护肤计划</button>
            <button class="btn" id="sk-add-cycle">＋ 手动新建周期</button>
          </div>
          ${this._timesRow()}
          <div class="row" id="sk-lr" style="margin-top:10px; align-items:center; gap:8px; flex-wrap:wrap">
            <label class="row" style="gap:6px; font-size:12.5px; color:#4c5b70">
              <input type="checkbox" id="sk-lr-on"> 📝 每晚提醒记录皮肤状态</label>
            <input class="input" id="sk-lr-time" type="time" value="${esc(String(Store.settings().skinLogReminderTime || '21:30'))}" style="width:100px">
            <button class="btn small" id="sk-lr-save">保存提醒</button>
            <span class="hint">当天已记录则不打扰</span>
          </div>
          <p class="hint" style="margin-top:10px">
            把你和其它 AI 聊好的护肤计划整段复制粘贴进来，自动识别「周期 / 晨间 / 日间 / 晚间 / 产品」；
            解析结果可修改后再保存。产品暂时不用填，日常在「今日」页随时「＋添加护肤品」。
          </p>
        </div>
        <div id="sk-cycle-list">
          ${cycles.length ? '' : `<div class="empty">还没有护肤周期。<br>点上方「导入 AI 护肤计划」，或直接去「今日」页按时段添加护肤品。</div>`}
        </div>
        ${this.mixCheckCard()}
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
    /* 皮肤记录提醒设置 */
    const lrBox = $('#sk-lr', root);
    if (lrBox) {
      $('#sk-lr-on', lrBox).checked = !!Store.settings().skinLogReminderTime;
      $('#sk-lr-save', lrBox).onclick = () => {
        const on = $('#sk-lr-on', lrBox).checked;
        const v = $('#sk-lr-time', lrBox).value || '21:30';
        Store.settings().skinLogReminderTime = on ? v : '';
        Store.save(true);
        $('#sk-lr-time', lrBox).value = on ? v : (Store.settings().skinLogReminderTime || '21:30'); /* 显示态=存储态 */
        toast(on ? `皮肤记录提醒已开启（每晚 ${v}）✓` : '皮肤记录提醒已关闭 ✓', 'green');
      };
    }
    this._bindSkin(root);
    /* 自动识图放在渲染与绑定之后：分析进行中才能正确禁用按钮、显示「分析中」 */
    this._maybeAutoAnalyze();
  },

  /* 成分混搭检查：分析当前生效周期的晨/日/晚产品组合冲突。
     知识库规则与层级溯源见 docs/ingredient-mix-design.md；纯展示，不参与任何评分。 */
  mixCheckCard() {
    const cycle = Store.activeCycle() || (Store.db.skincare.cycles || [])[0];
    if (!cycle || typeof SkinKnowledge === 'undefined') return '';
    const result = SkinKnowledge.analyzeMix(cycle);
    if (!result || !result.stats || !result.stats.checked) return '';
    const { checked, avoid, caution } = result.stats;
    const summary = avoid + caution ? `${avoid ? avoid + ' 个避免' : ''}${avoid && caution ? ' · ' : ''}${caution ? caution + ' 个谨慎' : ''}` : '未发现冲突';
    const sevBadge = s => s === 'avoid' ? '<span class="badge sk-mix-avoid">避免</span>'
      : s === 'caution' ? '<span class="badge sk-mix-caution">谨慎</span>'
      : '<span class="badge sk-mix-info">提示</span>';
    const phaseName = { morning: '晨间', day: '日间', evening: '晚间' };
    const items = result.findings.map(f => `
      <div class="sk-mix-item">
        <div class="sk-mix-head">${sevBadge(f.severity)}<b>${esc(f.title)}</b><span class="h-extra">${esc((f.phases || []).map(p => phaseName[p] || p).join('+'))}${f.evidence ? ' · 依据 ' + esc(f.evidence) : ''}</span></div>
        ${(f.products || []).length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">${f.products.map(p => `<span class="badge">${esc(p)}</span>`).join('')}</div>` : ''}
        <p class="hint" style="margin:5px 0 0">${esc(f.reason)}</p>
        <p class="sk-mix-advice">→ ${esc(f.advice)}</p>
      </div>`).join('');
    return `
      <div class="card sk-mix-card">
        <h3>🧪 成分混搭检查 <span class="h-extra">${esc(checked)} 个产品 · ${esc(summary)}</span></h3>
        ${result.findings.length ? `<div class="sk-mix-list">${items}</div>`
          : '<p class="hint" style="margin:6px 0 0">按已识别的产品名称和内置规则，暂未发现需要提示的搭配冲突。<span class="h-extra">风险等级：避免 &gt; 谨慎 &gt; 提示</span></p>'}
        <p class="hint" style="margin-top:8px">基于内置成分知识库与产品名称识别，仅供参考、不构成医疗建议；处方药请遵医嘱。规则溯源见 docs/ingredient-mix-design.md。</p>
      </div>`;
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
        if (!isActive) { toast('该周期今日未生效，请编辑周期日期后打卡'); return; }
        const checked = Store.toggleSkincareStep(todayKey(), ph, sid);
        rowEl.classList.toggle('done', checked);
        App.refreshStatusPill();
        toast(checked ? '已打卡 ✓' : '已取消', 'green');
      };
    });
    $$('.sk-add', el).forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); this.quickAddModal(btn.dataset.phase, () => (typeof App !== 'undefined' && typeof App.render === 'function' ? App.render() : this.view($('#view-root')))); };
    });
    $('.edit', el).onclick = () => this.editCycleModal(c);
    $('.del', el).onclick = async () => {
      const ok = await confirmModal('删除周期', `确定删除「${c.name}」吗？相关打卡记录保留。`, '删除');
      if (!ok) return;
      Store.db.skincare.cycles = Store.db.skincare.cycles.filter(x => x.id !== c.id);
      Store.save(true);
      if (typeof App !== 'undefined' && typeof App.render === 'function') App.render();
      else this.view($('#view-root'));
    };
    return el;
  },

  /* DeepSeek 返回值严格校验：结构/长度/逐字段清洗，坏项丢弃；输出与本地解析同构的 cycles。
     上限对齐提示词：30 周期 × 每流程 30 步；日期必须 YYYY-MM-DD；无有效步骤的周期整条丢弃 */
  _validateAICycles(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cycles)) return [];
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    /* 日期须为真实日历日期且 ≥2000-01-01：'0000-00-00' 形式合法但荒谬，落库后周期永不生效（Bug 猎手 #5） */
    const validDate = (s) => typeof s === 'string' && DATE_RE.test(s) && s >= '2000-01-01' && !Number.isNaN(Date.parse(s));
    const out = [];
    for (const c of raw.cycles.slice(0, 30)) {
      if (!c || typeof c !== 'object') continue;
      const cyc = this._newCycle(typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 60) : `周期 ${out.length + 1}`);
      if (validDate(c.startDate)) cyc.startDate = c.startDate;
      if (validDate(c.endDate) && (!cyc.startDate || c.endDate >= cyc.startDate)) cyc.endDate = c.endDate;
      const steps = c.steps && typeof c.steps === 'object' && !Array.isArray(c.steps) ? c.steps : {};
      for (const phase of ['morning', 'day', 'evening']) {
        const arr = Array.isArray(steps[phase]) ? steps[phase].slice(0, 30) : [];
        for (const st of arr) {
          const name = st && typeof st.name === 'string' ? st.name.trim().slice(0, 40) : '';
          if (!name) continue;
          cyc.steps[phase].push({ id: uid('st'), name, detail: st && typeof st.detail === 'string' ? st.detail.trim().slice(0, 80) : '' });
        }
      }
      if (cyc.steps.morning.length + cyc.steps.day.length + cyc.steps.evening.length) out.push(cyc);
    }
    return out;
  },

  /* 智能解析（DeepSeek）设置：密钥只存本机，点「智能解析」才把当次文本发给接口 */
  _planAiSettingsModal() {
    const s = Store.settings();
    const card = openModal(`
      <h3>⚙️ 智能解析设置（DeepSeek）</h3>
      <p class="hint">智能解析默认调用 DeepSeek Chat，把任意格式的计划文本转成结构化周期。密钥只保存在本机数据文件里；<b>只有你点「智能解析」时才会把当次文本发给接口</b>，其余时间不出本机。API Key 在 platform.deepseek.com 申请；未配置 Key 时自动回退本地解析。</p>
      <label class="field">DeepSeek API Key</label>
      <input class="input" id="plan-ai-key" type="password" placeholder="粘贴 DeepSeek API Key" value="${esc(s.planAiApiKey || '')}">
      <label class="field">模型</label>
      <input class="input" id="plan-ai-model" placeholder="deepseek-chat" value="${esc(s.planAiModel || 'deepseek-chat')}">
      <div class="row" style="justify-content:flex-end; margin-top:10px">
        <button class="btn ghost" id="plan-ai-cancel">取消</button>
        <button class="btn primary" id="plan-ai-ok">保存</button>
      </div>`);
    $('#plan-ai-cancel', card).onclick = closeModal;
    $('#plan-ai-ok', card).onclick = () => {
      Store.settings().planAiApiKey = $('#plan-ai-key', card).value.trim();
      Store.settings().planAiModel = $('#plan-ai-model', card).value.trim() || 'deepseek-chat';
      Store.save(true);
      closeModal();
      toast('智能解析设置已保存 ✓', 'green');
    };
  },

  /* 导入弹窗：粘贴 → 解析 → 预览编辑 → 保存。有 DeepSeek Key 时优先大模型解析，失败/未配置回退本地解析 */
  importModal() {
    const card = openModal(`
      <h3>📥 导入 AI 护肤计划</h3>
      <p class="hint">粘贴你与其它 AI 沟通好的护肤计划全文（支持任意格式，会自动识别周期、早晚流程与产品）。<b>配置 DeepSeek Key 后走大模型解析</b>，更懂口语与乱格式；未配置则本地解析，点「⚙️」配置。</p>
      <textarea class="textarea" id="im-text" style="min-height:160px; margin-top:10px" placeholder="例如：&#10;周期一（第1-7天）&#10;晨间：洁面、爽肤水、维C精华、防晒&#10;晚间：卸妆、洁面、视黄醇精华（隔天用）、面霜&#10;周期二（第8-14天）&#10;……"></textarea>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="im-parse">🔍 智能解析</button>
        <button class="btn ghost" id="im-ai-set" data-no-icon="true" title="配置 DeepSeek API Key 与模型">⚙️</button>
        <label class="row" style="gap:6px; font-size:12.5px; color:var(--muted)">
          <input type="checkbox" id="im-replace"> 替换现有周期（默认追加；勾选覆盖全部旧周期，会先确认）
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
    $('#im-ai-set', card).onclick = () => this._planAiSettingsModal();
    $('#im-parse', card).onclick = async () => {
      const text = $('#im-text', card).value;
      if (!text.trim()) { toast('先粘贴内容再解析哦', 'red'); return; }
      const btn = $('#im-parse', card);
      const apply = (cycles, source) => {
        if (!cycles.length) {
          preview.innerHTML = `<div class="hint">${esc(source)}没有识别出有效内容。试试在产品间用「、」或每行一个产品；口语化长文建议点「⚙️」配置 DeepSeek 走大模型解析。</div>`;
          $('#im-save', card).disabled = true;
          return;
        }
        parsed = cycles;
        this._renderParsePreview(preview, parsed);
        $('#im-save', card).disabled = false;
        toast(`${source}识别出 ${parsed.length} 个周期，检查并修改后保存`, 'green');
      };
      const key = Store.settings().planAiApiKey;
      if (key) {
        btn.disabled = true; btn.textContent = '🤖 AI 解析中…';
        let aiFailed = null;
        try {
          const r = await native.parsePlanAI(text.slice(0, 20000), key, Store.settings().planAiModel || 'deepseek-chat');
          if (r && r.ok) {
            const cycles = this._validateAICycles(r.data);
            if (cycles.length) { apply(cycles, 'DeepSeek '); return; }
            aiFailed = 'AI 没有解析出有效护肤内容';
          } else {
            aiFailed = (r && r.error) || '未知错误';
          }
        } catch (e) { aiFailed = e.message; }
        finally { btn.disabled = false; btn.textContent = '🔍 智能解析'; }
        toast(`AI 解析失败（${String(aiFailed).slice(0, 60)}），已回退本地解析`);
      } else {
        toast('未配置 DeepSeek Key：本次使用本地解析（点 ⚙️ 可配置大模型解析）');
      }
      apply(this.parsePlanText(text), '');
    };
    $('#im-cancel', card).onclick = closeModal;
    $('#im-save', card).onclick = async () => {
      const edits = this._collectPreviewEdits(preview);
      const cycles = this.editableToCycles(edits);
      // 未设日期的周期按顺序自动接续（从今天开始，每周期默认 7 天）
      let cursor = todayKey();
      for (const c of cycles) {
        if (!c.startDate) c.startDate = cursor;
        if (!c.endDate) c.endDate = addDays(c.startDate, 6);
        cursor = addDays(c.endDate, 1);
      }
      const replace = $('#im-replace', card).checked;
      const doSave = () => {
        this.addCycles(cycles, replace);
        closeModal();
        toast('护肤计划已保存 ✓', 'green');
        App.render();
      };
      /* 覆盖是破坏性操作（含打卡进度）：已有周期时先确认（UX 走查 #10） */
      if (replace && (Store.db.skincare.cycles || []).length) {
        const ok = await confirmModal('替换现有周期？', `将覆盖全部 ${Store.db.skincare.cycles.length} 个现有周期及其打卡进度，此操作不可撤销。建议先在「导出」里留一份备份。`, '覆盖并保存');
        if (!ok) return;
        doSave();
        return;
      }
      /* 追加模式：新周期与现有周期（endDate 留空视为长期）日期重叠时，读取口按数组序先匹配旧周期——新计划会静默失效（冲突检索 #2），先提示 */
      if (!replace) {
        const existing = Store.db.skincare.cycles || [];
        const overlap = cycles.some(c => existing.some(o => {
          const os = o.startDate || '0000-00-00', oe = o.endDate || '9999-12-31';
          return c.startDate <= oe && c.endDate >= os;
        }));
        if (overlap) {
          const ok = await confirmModal('新旧周期日期重叠', '追加的周期与现有周期日期重叠：重叠期间会优先显示排在前面的旧周期，新计划可能「保存了却不生效」。建议改用「替换现有周期」或调整日期。仍要追加吗？', '仍要追加');
          if (!ok) return;
        }
      }
      doSave();
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
      /* 打卡记在旧步骤 id 上：同时段「名称：用法」没变就复用，已用过的 id 不再发给另一行 */
      const mk = (txt, phase) => {
        const oldSteps = c.id && c.steps && Array.isArray(c.steps[phase]) ? c.steps[phase] : [];
        const usedIds = new Set();
        return String(txt || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
          const m = line.match(/^(.{1,30}?)\s*[：:]\s*(.+)$/);
          const name = m ? m[1].trim() : line.trim();
          const detail = m ? m[2].trim() : '';
          const key = detail ? `${name}：${detail}` : name;
          let id = '';
          if (c.id) {
            const hit = oldSteps.find(s => {
              if (!s || !s.id || usedIds.has(s.id)) return false;
              const oldKey = s.detail ? `${s.name}：${s.detail}` : s.name;
              return oldKey === key;
            });
            if (hit) { usedIds.add(hit.id); id = hit.id; }
          }
          return { id: id || uid('st'), name, detail };
        });
      };
      const obj = {
        id: c.id || uid('cyc'),
        name: $('#ec-name', card).value.trim() || '未命名周期',
        startDate: $('#ec-start', card).value,
        endDate: $('#ec-end', card).value,
        steps: {
          morning: mk($('#ec-morning', card).value, 'morning'),
          day: mk($('#ec-day', card).value, 'day'),
          evening: mk($('#ec-evening', card).value, 'evening')
        }
      };
      if (c.id) {
        const i = Store.db.skincare.cycles.findIndex(x => x.id === c.id);
        if (i >= 0) Store.db.skincare.cycles[i] = obj;
      } else {
        Store.db.skincare.cycles.push(obj);
      }
      Store.save(true); closeModal();
      if (typeof App !== 'undefined' && typeof App.render === 'function') App.render();
      else this.view($('#view-root'));
      toast('已保存 ✓', 'green');
    };
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = Skincare;
