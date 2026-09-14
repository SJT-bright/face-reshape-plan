/* Local meal and sleep journal. All user data stays in the existing local store. */
const Rhythm = {
  selectedDay: null, range: 7, busy: false, sleepEditId: undefined, sleepKind: 'main', importBusy: false,
  data() { return Store.db.rhythm; },
  icon(name) { return Icon3D.makeIcon(name).outerHTML; },
  /* ---------- 睡眠质量体系（移植自个人积累库） ---------- */
  sleepDetail(s) {
    if (!s || !s.end) return null;
    const minutes = RhythmEngine.sleepMinutes(s);
    const q = RhythmEngine.sleepQuality({
      durationMinutes: minutes, deepMinutes: s.deepMinutes ?? null, lightMinutes: s.lightMinutes ?? null,
      remMinutes: s.remMinutes ?? null, morningFeeling: s.morningFeeling ?? null,
      awakeEpisodes: s.awakeEpisodes ?? null, qualityScore: s.qualityScore ?? null
    });
    return { minutes, q, date: s.endLocal.slice(0, 10), asleepTime: s.startLocal.slice(11, 16), entry: s };
  },
  mainSleepDetails() {
    return this.data().sleeps.filter(s => s.end && s.kind !== 'nap')
      .map(s => this.sleepDetail(s)).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  },
  sleepQualitySummary() {
    const details = this.mainSleepDetails();
    if (!details.length) return null;
    const last7 = details.slice(-7);
    const avgScore = Math.round(last7.reduce((n, d) => n + (d.q?.score || 0), 0) / last7.length);
    const avgMinutes = Math.round(last7.reduce((n, d) => n + d.minutes, 0) / last7.length);
    const points = RhythmEngine.sleepPoints(details.map(d => ({ date: d.date, minutes: d.minutes, score: d.q?.score ?? 0, asleepTime: d.asleepTime })));
    // 连续记录天数：从今天/昨天往前数
    let streak = 0;
    let cursor = todayKey();
    const dates = new Set(details.map(d => d.date));
    if (!dates.has(cursor)) cursor = addDays(cursor, -1);
    while (dates.has(cursor)) { streak++; cursor = addDays(cursor, -1); if (streak > 3650) break; }
    return { avgScore, avgMinutes, points: points.total, streak, details, last: details[details.length - 1] };
  },
  sleepChartSVG(series) {
    if (!series.length) return '<p class="rhythm-empty">导入或记录几天后，这里会出现折线图。</p>';
    const W = 640, H = 190, P = 30, CW = W - P * 2, CH = H - P * 2;
    const maxMin = Math.max(600, ...series.map(s => s.minutes || 0));
    const x = i => series.length === 1 ? W / 2 : P + i * CW / (series.length - 1);
    const yMin = m => H - P - (m / maxMin) * CH;
    const yScore = v => H - P - (v / 100) * CH;
    const durPts = series.map((s, i) => `${x(i).toFixed(1)},${yMin(s.minutes || 0).toFixed(1)}`);
    const scoreIdx = series.map((s, i) => s.score != null ? i : -1).filter(i => i >= 0);
    const scorePts = scoreIdx.map(i => `${x(i).toFixed(1)},${yScore(series[i].score).toFixed(1)}`);
    const target = yMin(420);
    const area = `${P},${H - P} ${durPts.join(' ')} ${x(series.length - 1).toFixed(1)},${H - P}`;
    const labels = series.map((s, i) =>
      (series.length <= 7 || i % Math.ceil(series.length / 6) === 0 || i === series.length - 1)
        ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="sleep-chart-label">${s.date.slice(5)}</text>` : '').join('');
    const dots = series.map((s, i) => `<circle cx="${x(i).toFixed(1)}" cy="${yMin(s.minutes || 0).toFixed(1)}" r="2.6" fill="#5b8def"/>`).join('');
    const scoreDots = scoreIdx.map(i => `<circle cx="${x(i).toFixed(1)}" cy="${yScore(series[i].score).toFixed(1)}" r="2.6" fill="#e5975a"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="sleep-chart" role="img" aria-label="近 14 天睡眠时长与评分折线图">
      <line x1="${P}" y1="${target}" x2="${W - P}" y2="${target}" stroke="#9db6cc" stroke-width="1" stroke-dasharray="4 4"/>
      <text x="${P}" y="${target - 5}" class="sleep-chart-label">目标 7h</text>
      <polygon points="${area}" fill="rgba(91,141,239,.10)"/>
      <polyline points="${durPts.join(' ')}" fill="none" stroke="#5b8def" stroke-width="2"/>
      ${scorePts.length > 1 ? `<polyline points="${scorePts.join(' ')}" fill="none" stroke="#e5975a" stroke-width="1.6" stroke-dasharray="3 3"/>` : ''}
      ${dots}${scoreDots}${labels}
    </svg>`;
  },
  async importLifepivot() {
    if (this.importBusy) return;
    this.importBusy = true;
    const btn = $('#rh-import-sleep');
    if (btn) { btn.disabled = true; btn.textContent = '导入中…'; }
    try {
      const res = await window.native.importLifepivotSleep();
      if (!res || !res.ok) { toast((res && res.error) || '导入失败', 'red'); return; }
      let imported = 0, skipped = 0;
      await this.commit(d => {
        for (const r of res.rows || []) {
          const id = 'lp-' + r.record_date;
          const asleep = r.asleep_time || '', wake = r.wake_time || '';
          if (d.sleeps.some(s => s.id === id) || !/^\d{2}:\d{2}$/.test(asleep) || !/^\d{2}:\d{2}$/.test(wake)) { skipped++; continue; }
          const cross = asleep > wake;
          const startLocal = `${RhythmEngine.addDay(r.record_date, cross ? -1 : 0)}T${asleep}`;
          const endLocal = `${r.record_date}T${wake}`;
          const s0 = RhythmEngine.parse(startLocal), e0 = RhythmEngine.parse(endLocal);
          if (!s0 || !e0) { skipped++; continue; }
          // 同一时段已有本机记录则跳过，避免同晚两条
          if (d.sleeps.some(x => x.end && Date.parse(x.start) < Date.parse(e0.iso) && Date.parse(x.end) > Date.parse(s0.iso))) { skipped++; continue; }
          d.sleeps.push({
            id, kind: 'main', start: s0.iso, startLocal: s0.local, startOffset: s0.offset,
            end: e0.iso, endLocal: e0.local, endOffset: e0.offset,
            recordedMinutes: Number.isInteger(r.calculated_duration_minutes) ? r.calculated_duration_minutes : null,
            deepMinutes: Number.isInteger(r.deep_sleep_minutes) ? r.deep_sleep_minutes : null,
            lightMinutes: Number.isInteger(r.light_sleep_minutes) ? r.light_sleep_minutes : null,
            remMinutes: Number.isInteger(r.rem_sleep_minutes) ? r.rem_sleep_minutes : null,
            morningFeeling: Number.isInteger(r.morning_feeling) ? r.morning_feeling : null,
            qualityScore: Number.isInteger(r.manual_quality_score) ? r.manual_quality_score : null,
            awakeEpisodes: Number.isInteger(r.awake_episodes) ? r.awake_episodes : null,
            qualityText: r.quality_text || '', source: 'lifepivot'
          });
          imported++;
        }
      }, imported ? `已导入 ${imported} 条${skipped ? ` · 跳过 ${skipped} 条（重复/无效）` : ''}` : '没有新记录可导入');
      this.refresh();
    } finally {
      this.importBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '从个人积累库导入'; }
    }
  },
  duration(n) {
    if (n == null) return '—';
    const minutes = Math.round(n / 5) * 5;
    return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}` : `${minutes} 分钟`;
  },
  async commit(change, success = '已保存') {
    if (this.busy) return false;
    this.busy = true;
    const previous = structuredClone(this.data());
    try {
      change(this.data());
      const ok = await Store.save(true);
      if (!ok) throw new Error('write failed');
      if (success) toast(success);
      return true;
    } catch (error) {
      Store.db.rhythm = previous;
      toast('未能保存，请检查磁盘空间后重试。', 'red');
      return false;
    } finally { this.busy = false; }
  },
  invalidate(data, key, field) {
    if (key) data.completeDays[key] = { ...data.completeDays[key], [field]: false };
  },
  refresh() { if (App.currentView === 'nutrition') this.view($('#view-root')); },
  view(root) {
    this.selectedDay ||= todayKey();
    const d = this.data(), selected = this.selectedDay;
    const report = RhythmEngine.analyze(d, { days: this.range });
    const meals = d.meals.filter(m => m.local.slice(0, 10) === selected).sort((a, b) => a.local.localeCompare(b.local));
    const sleeps = d.sleeps.filter(s => (s.endLocal || s.startLocal).slice(0, 10) === selected).sort((a, b) => a.start.localeCompare(b.start));
    const unfinished = d.sleeps.filter(s => !s.end);
    const states = {
      descriptive: ['先记录，再慢慢看出规律', '选择适用的作息类型后，可开启习惯提醒。其他年龄或轮班作息也可以持续记录和查看趋势。'],
      insufficient: ['再积累几天，趋势会更清楚', '至少积累 5 天记全的记录后再看整体趋势；单项提醒会在相应记录足够时出现。'],
      attention: ['有几处习惯，可以留意一下', '下面的提醒只根据你已记全的时间记录生成。'],
      'no-flags': ['这些记录暂未触发习惯提醒', '继续观察自己的精力和睡眠感受。没有时间提醒不代表已经确认身体健康。']
    };
    const state = states[report.state];
    root.innerHTML = `<div class="rhythm-page">
      <div class="rhythm-intro"><div><div class="rhythm-eyebrow">饮食 · 睡眠 · 日常节律</div><h1>吃饭与睡觉，记个大概就好。</h1><p>记下时间，慢慢了解自己的生活节奏。</p></div>${this.icon('nutrition')}</div>
      <div class="rhythm-actions">
        <button class="btn primary" id="rh-meal">${this.icon('nutrition')}记一餐</button>
        <span class="rhythm-local">大致到分钟即可 · 保存在本机</span>
      </div>
      <section class="rhythm-card rhythm-journal" aria-labelledby="rh-journal-title">
        <div class="rhythm-heading"><h2 id="rh-journal-title">日常记录</h2><div class="rhythm-date"><button class="btn small ghost" id="rh-prev" aria-label="前一天">前一天</button><input id="rh-date" type="date" min="2000-01-01" max="${todayKey()}" value="${selected}" aria-label="查看记录日期"><button class="btn small ghost" id="rh-today">今天</button></div></div>
        <div class="rhythm-log-columns">
          <div><h3>${this.icon('nutrition')}进餐时间</h3><p class="rhythm-caption">记吃完的大致时间，也可以记加餐。</p>
            <div class="rhythm-records">${meals.length ? meals.map(m => `<div class="rhythm-record"><div><strong>${esc(m.local.slice(11))}</strong><span>${m.kind === 'snack' ? '加餐' : '吃了一餐'}</span></div><button class="btn small ghost" data-meal="${esc(m.id)}" aria-label="编辑 ${esc(m.local.slice(11))} 进餐">编辑</button></div>`).join('') : '<p class="rhythm-empty">这一天还没有进餐记录。</p>'}</div>
            <label class="rhythm-check"><input id="rh-complete-meals" type="checkbox" ${d.completeDays[selected]?.meals ? 'checked' : ''}>这一天的进餐已记全</label>
          </div>
          <div class="rhythm-sleep-column"><h3>${this.icon('moon')}手环睡眠记录</h3><p class="rhythm-caption">早上按手环填写，起床日期就是上方所选日期。</p>
            ${this.sleepForm(sleeps)}
            ${sleeps.filter(s => s.end).length ? `<details class="rhythm-sleep-history"><summary>查看这一天的睡眠记录（${sleeps.filter(s => s.end).length}）</summary>${sleeps.filter(s => s.end).map(s => { const qd = this.sleepDetail(s); return `<div class="rhythm-record"><div><strong>${esc(s.startLocal.slice(11))} → ${esc(s.endLocal.slice(11))}</strong><span>${s.kind === 'nap' ? '午睡 / 小睡' : '主要睡眠'} · ${this.duration(RhythmEngine.sleepMinutes(s))}${qd && qd.q ? ` · ${qd.q.score} 分` : ''}${s.source === 'lifepivot' ? ' · 来自个人积累库' : ''}</span></div><button class="btn small ghost" data-sleep="${esc(s.id)}">编辑</button></div>`; }).join('')}</details>` : ''}
            ${unfinished.length ? `<details class="rhythm-sleep-history"><summary>旧版未完成记录（${unfinished.length}）</summary><p class="rhythm-caption">这些旧记录已保留，不参与统计；可填写完整时间或删除。</p>${unfinished.map(s => `<div class="rhythm-record"><span>${esc(s.startLocal.replace('T', ' '))}</span><button class="btn small ghost" data-sleep="${esc(s.id)}">整理记录</button></div>`).join('')}</details>` : ''}
          </div>
        </div><p class="rhythm-caption rhythm-footnote">补记或修改后，请重新确认“已记全”。未记全的日子不用于判断进餐间隔或睡眠偏短。睡眠时长优先采用填写的手环数据，未填时按时间段估算。</p>
      </section>
      <section class="rhythm-card sleep-quality-card" aria-labelledby="rh-sq-title">
        <div class="rhythm-heading"><div><h2 id="rh-sq-title">睡眠质量体系<span class="sleep-badge-src">来自个人积累库</span></h2><p class="rhythm-caption">评分 = 手工分（如有）60% ＋ 时长/深睡/REM/夜醒/晨起感受 40% · 积分随记录累计</p></div><button class="btn small ghost" id="rh-import-sleep">从个人积累库导入</button></div>
        ${(() => {
          const s = this.sleepQualitySummary();
          if (!s) return '<p class="rhythm-empty">还没有睡眠记录。手动记一条，或点右上角从个人积累库导入历史记录。</p>';
          const last14 = s.details.slice(-14);
          return `<div class="sleep-quality-metrics">
            <div><span>近 7 天平均分</span><strong>${s.avgScore}<small>分</small></strong><small>最近一晚 ${s.last.q ? s.last.q.score + ' 分' : '—'}</small></div>
            <div><span>睡眠积分</span><strong>${s.points}<small>分</small></strong><small>记录/达标/早睡都会加分</small></div>
            <div><span>连续记录</span><strong>${s.streak}<small>天</small></strong><small>近 7 天均时长 ${this.duration(s.avgMinutes)}</small></div>
          </div>
          ${this.sleepChartSVG(last14)}
          <div class="sleep-chart-legend"><span><i class="dot dur"></i>睡眠时长</span><span><i class="dot score"></i>质量评分（虚线）</span><span class="sleep-chart-note">虚线横线为 7 小时目标 · 数据全部保存在本机</span></div>`;
        })()}
      </section>
      <section class="rhythm-card" aria-labelledby="rh-trend-title">
        <div class="rhythm-heading"><div><h2 id="rh-trend-title">最近的节奏</h2><p class="rhythm-caption">截至昨天 · ${report.startDay.slice(5)} 至 ${report.endDay.slice(5)}</p></div><select id="rh-range" aria-label="趋势时间范围"><option value="7" ${this.range === 7 ? 'selected' : ''}>近 7 天</option><option value="30" ${this.range === 30 ? 'selected' : ''}>近 30 天</option></select></div>
        <div class="rhythm-metrics">${[
          ['平均睡眠时长', report.metrics.sleep, `${report.counts.sleepDays} 个完整日 · 含午睡`],
          ['进餐到睡前', report.metrics.beforeBed, `${report.counts.beforeBed} 组完整记录`],
          ['起床到首次进食', report.metrics.afterWake, `${report.counts.afterWake} 组完整记录`],
          ['相邻进餐间隔', report.metrics.mealGap, `${report.counts.mealGaps} 个同日间隔`],
          ['每日进食跨度', report.metrics.eatingSpan, `${report.counts.eatingSpans} 个完整日 · 首次到末次`],
          ['首次进食时刻波动', report.metrics.firstVariation, `${report.counts.mealDays} 个完整日`],
          ['餐间隔长短波动', report.metrics.gapVariation, `${report.counts.mealGaps} 个同日间隔`],
          ['睡觉时刻波动', report.metrics.bedVariation, `${report.counts.bedDays} 个完整日`]
        ].map(([label, value, note]) => `<div><span>${label}</span><strong>${this.duration(value)}</strong><small>${note}</small></div>`).join('')}</div>
        <div class="rhythm-assessment ${report.state === 'attention' ? 'attention' : ''}" role="status"><h3>${this.icon(report.state === 'attention' ? 'seed' : 'sparkles')}${state[0]}</h3><p>${state[1]}</p>
          ${report.alerts.map(a => `<div class="rhythm-notice"><strong>${a.title}</strong><p>${a.text}</p></div>`).join('')}
          ${report.counts.conflicts ? '<p class="rhythm-conflict">有进餐出现在睡眠时段内，或睡眠时段重叠。相关睡眠暂不参与统计，可检查并调整记录。</p>' : ''}
        </div>
        <div class="rhythm-profile"><label for="rh-profile">习惯提醒适用范围</label><select id="rh-profile"><option value="unset" ${d.profile === 'unset' ? 'selected' : ''}>请选择</option><option value="adult" ${d.profile === 'adult' ? 'selected' : ''}>18–60 岁 · 日间作息</option><option value="other" ${d.profile === 'other' ? 'selected' : ''}>其他年龄 / 轮班等 · 仅看趋势</option></select></div>
        <p class="rhythm-caption">时间记录只用于生活习惯提示，不能确认健康状况，也不能估算体脂、面部肌肉或皮肤变化。孕期、疾病管理或特殊饮食安排请按专业指导。</p>
        <details class="rhythm-history"><summary>查看逐日变化</summary><div class="rhythm-table-wrap"><table><thead><tr><th>日期</th><th>首次 / 末次进食</th><th>睡眠时长合计</th><th>记录</th></tr></thead><tbody>${report.rows.slice().reverse().map(r => `<tr><td>${r.date.slice(5)}</td><td>${r.first ? r.first.local.slice(11) + ' / ' + r.last.local.slice(11) : '—'}</td><td>${this.duration(r.sleepMinutes)}</td><td><button class="btn small ghost" data-day="${r.date}">查看 / 补记</button></td></tr>`).join('')}</tbody></table></div></details>
      </section>
    </div>`;
    $('#rh-meal', root).onclick = () => this.mealModal();
    this.bindSleepForm(root);
    const importBtn = $('#rh-import-sleep', root);
    if (importBtn) importBtn.onclick = () => this.importLifepivot();
    $('#rh-date', root).onchange = e => { if (e.target.validity.valid && e.target.value) { this.selectedDay = e.target.value; this.sleepEditId = undefined; this.refresh(); } };
    $('#rh-prev', root).onclick = () => { if (selected > '2000-01-01') { this.selectedDay = addDays(selected, -1); this.sleepEditId = undefined; this.refresh(); } };
    $('#rh-today', root).onclick = () => { this.selectedDay = todayKey(); this.sleepEditId = undefined; this.refresh(); };
    $('#rh-range', root).onchange = e => { this.range = Number(e.target.value); this.refresh(); };
    $('#rh-profile', root).onchange = async e => { const value = e.target.value; await this.commit(data => { data.profile = value; }); this.refresh(); };
    ['meals'].forEach(field => {
      $(`#rh-complete-${field}`, root).onchange = async e => {
        const checked = e.target.checked;
        await this.commit(data => { data.completeDays[selected] = { ...data.completeDays[selected], [field]: checked }; }, checked ? (selected === todayKey() ? '已确认；今天的记录会从明天计入趋势' : '已确认，趋势已更新') : '已取消确认');
        this.refresh();
      };
    });
    $$('[data-meal]', root).forEach(b => { b.onclick = () => this.mealModal(b.dataset.meal); });
    $$('[data-sleep]', root).forEach(b => { b.onclick = () => { const entry = d.sleeps.find(s => s.id === b.dataset.sleep); this.selectedDay = (entry.endLocal || entry.startLocal).slice(0, 10); this.sleepEditId = entry.id; this.refresh(); $('#rh-sleep-form [name=bed]').focus(); }; });
    $$('[data-day]', root).forEach(b => { b.onclick = () => { this.selectedDay = b.dataset.day; this.sleepEditId = undefined; this.refresh(); root.scrollTop = 0; }; });
  },
  modalFooter(existing) {
    return `<p id="rh-error" class="rhythm-error" role="alert"></p><div class="rhythm-modal-actions">${existing ? '<button type="button" class="btn danger" id="rh-delete">删除记录</button>' : ''}<button type="button" class="btn ghost" id="rh-cancel">取消</button><button type="submit" class="btn primary" id="rh-save">保存记录</button></div>`;
  },
  bindModal(card, old, field) {
    $('#rh-cancel', card).onclick = closeModal;
    card.addEventListener('keydown', e => { if (e.key === 'Escape' && !this.busy) closeModal(); });
    if (old) $('#rh-delete', card).onclick = async () => {
      const button = $('#rh-delete', card);
      if (button.dataset.armed !== 'true') { button.dataset.armed = 'true'; button.textContent = '确认删除'; return; }
      const ok = await this.commit(d => {
        d[field] = d[field].filter(x => x.id !== old.id);
        this.invalidate(d, (old.local || old.endLocal || old.startLocal).slice(0, 10), field === 'meals' ? 'meals' : 'sleep');
      }, '记录已删除');
      if (ok) { closeModal(); this.refresh(); }
    };
    card.querySelector('input')?.focus();
  },
  mealModal(id) {
    const old = this.data().meals.find(m => m.id === id);
    const defaultTime = `${this.selectedDay || todayKey()}T${hhmm()}`;
    const card = openModal(`<form id="rh-form" class="rhythm-form"><h3>${old ? '编辑进餐' : '记一餐'}</h3><p class="rhythm-caption">不用记食物或热量，记下吃完的大致时间。</p><label>进餐时间<input name="time" type="datetime-local" value="${esc(old?.local || defaultTime)}" max="${RhythmEngine.localNow()}" min="2000-01-01T00:00" required></label><label>记录类型<select name="kind"><option value="meal">吃了一餐</option><option value="snack" ${old?.kind === 'snack' ? 'selected' : ''}>加餐</option></select></label>${this.modalFooter(old)}</form>`);
    this.bindModal(card, old, 'meals');
    $('#rh-form', card).onsubmit = async e => {
      e.preventDefault();
      const f = e.target, local = f.elements.time.value;
      const input = { id: old?.id, local };
      const error = RhythmEngine.validateMeal(input, this.data());
      if (error) { $('#rh-error', card).textContent = error; return; }
      const p = RhythmEngine.parse(local);
      $('#rh-save', card).disabled = true;
      const ok = await this.commit(d => {
        const record = { ...old, id: old?.id || uid('meal'), at: p.iso, local, offset: p.offset, kind: f.elements.kind.value };
        if (old) d.meals[d.meals.findIndex(m => m.id === old.id)] = record; else d.meals.push(record);
        this.invalidate(d, old?.local.slice(0, 10), 'meals');
        this.invalidate(d, local.slice(0, 10), 'meals');
      }, '进餐时间已记下');
      if (ok) { this.selectedDay = local.slice(0, 10); closeModal(); this.refresh(); }
      else $('#rh-save', card).disabled = false;
    };
  },
  sleepForm(sleeps) {
    const old = this.sleepEditId ? this.data().sleeps.find(s => s.id === this.sleepEditId) : sleeps.find(s => s.end && s.kind === this.sleepKind);
    this.formSleepId = old?.id || null;
    const recent = this.data().sleeps.filter(s => s.end && s.kind === this.sleepKind && s.endLocal.slice(0, 10) < this.selectedDay).sort((a, b) => b.end.localeCompare(a.end))[0];
    const bed = (old?.startLocal || recent?.startLocal)?.slice(11) || (this.sleepKind === 'nap' ? '13:00' : '23:00');
    const wake = old && !old.end ? '' : (old?.endLocal || recent?.endLocal)?.slice(11) || (this.sleepKind === 'nap' ? '14:00' : '07:00');
    const measured = old?.recordedMinutes;
    const detail = this.sleepDetail(old);
    const num = v => v == null ? '' : v;
    return `<form id="rh-sleep-form" class="rhythm-sleep-form">
      <div class="rhythm-sleep-times"><label>入睡时间<input name="bed" type="time" value="${esc(bed)}" required></label><label>起床时间<input name="wake" type="time" value="${esc(wake)}" required></label></div>
      <p id="rh-sleep-dates" class="rhythm-caption"></p>
      <details class="rhythm-sleep-extra" ${measured != null ? 'open' : ''}><summary>手环实际睡眠时长（选填）</summary><div class="rhythm-sleep-times"><label>小时<input name="hours" type="number" min="0" max="24" step="1" value="${measured == null ? '' : Math.floor(measured / 60)}" placeholder="如 7"></label><label>分钟<input name="minutes" type="number" min="0" max="59" step="1" value="${measured == null ? '' : measured % 60}" placeholder="如 30"></label></div><p class="rhythm-caption">可直接抄手环的睡眠时长，统计时优先使用。</p></details>
      <details class="rhythm-sleep-extra" ${old && (old.deepMinutes != null || old.morningFeeling != null || old.qualityScore != null) ? 'open' : ''}><summary>睡眠分期与感受（选填 · 计入质量评分）</summary>
        <div class="rhythm-sleep-times sleep-stages"><label>深睡(分)<input name="deepMin" type="number" min="0" max="720" step="1" value="${num(old?.deepMinutes)}" placeholder="如 94"></label><label>浅睡(分)<input name="lightMin" type="number" min="0" max="720" step="1" value="${num(old?.lightMinutes)}" placeholder="如 216"></label><label>REM(分)<input name="remMin" type="number" min="0" max="720" step="1" value="${num(old?.remMinutes)}" placeholder="如 38"></label></div>
        <div class="rhythm-sleep-times sleep-stages"><label>夜醒次数<input name="awakeEp" type="number" min="0" max="50" step="1" value="${num(old?.awakeEpisodes)}" placeholder="如 2"></label><label>晨起感受(1-5)<input name="feeling" type="number" min="1" max="5" step="1" value="${num(old?.morningFeeling)}" placeholder="3"></label><label>主观质量分(60-100)<input name="qScore" type="number" min="60" max="100" step="1" value="${num(old?.qualityScore)}" placeholder="如 85"></label></div>
        <p class="rhythm-caption">来自手环分期的填写越全，综合评分越准；主观质量分占比 60%。</p>
      </details>
      <div class="rhythm-sleep-kind"><label for="rh-sleep-kind">类型</label><select id="rh-sleep-kind" name="kind"><option value="main" ${(old?.kind || this.sleepKind) === 'main' ? 'selected' : ''}>主要睡眠</option><option value="nap" ${(old?.kind || this.sleepKind) === 'nap' ? 'selected' : ''}>午睡 / 小睡</option></select></div>
      <label class="rhythm-check"><input name="complete" type="checkbox" ${!old || this.data().completeDays[this.selectedDay]?.sleep ? 'checked' : ''}>这一天结束的睡眠已录全（含午睡）</label>
      <p id="rh-sleep-error" class="rhythm-error" role="alert"></p>
      <div class="rhythm-sleep-buttons"><button class="btn primary small" type="submit" id="rh-sleep-save">${old ? '更新睡眠记录' : '保存睡眠记录'}</button>${old ? '<button class="btn small ghost" type="button" id="rh-sleep-delete">删除记录</button>' : ''}</div>
    </form>`;
  },
  bindSleepForm(root) {
    const form = $('#rh-sleep-form', root), old = this.data().sleeps.find(s => s.id === this.formSleepId);
    const dateNote = () => {
      const input = RhythmEngine.sleepInput(this.selectedDay, form.elements.bed.value, form.elements.wake.value);
      $('#rh-sleep-dates', form).textContent = input ? `${input.startLocal.slice(5, 10)} 入睡 → ${input.endLocal.slice(5, 10)} 起床 · 跨夜日期自动处理` : '填写两个时间后，会自动显示对应日期。';
    };
    form.elements.bed.oninput = dateNote; form.elements.wake.oninput = dateNote; dateNote();
    form.elements.kind.onchange = e => { this.sleepKind = e.target.value; this.sleepEditId = undefined; this.refresh(); };
    if (old) $('#rh-sleep-delete', form).onclick = async e => {
      const button = e.currentTarget;
      if (button.dataset.armed !== 'true') { button.dataset.armed = 'true'; button.textContent = '确认删除'; return; }
      button.disabled = true;
      const ok = await this.commit(d => {
        d.sleeps = d.sleeps.filter(s => s.id !== old.id);
        this.invalidate(d, (old.endLocal || old.startLocal).slice(0, 10), 'sleep');
      }, '睡眠记录已删除');
      if (ok) { this.sleepEditId = undefined; this.refresh(); } else button.disabled = false;
    };
    form.onsubmit = async e => {
      e.preventDefault();
      const hours = form.elements.hours.value, minutes = form.elements.minutes.value;
      const recordedMinutes = hours === '' && minutes === '' ? null : Number(hours || 0) * 60 + Number(minutes || 0);
      const optInt = name => { const v = form.elements[name].value; return v === '' ? null : Number(v); };
      const input = RhythmEngine.sleepInput(this.selectedDay, form.elements.bed.value, form.elements.wake.value, recordedMinutes, old?.id);
      const error = !input ? '请填写不同的入睡和起床时间。' : RhythmEngine.validateSleep(input, this.data());
      if (error) { $('#rh-sleep-error', form).textContent = error; return; }
      const a = RhythmEngine.parse(input.startLocal), b = RhythmEngine.parse(input.endLocal);
      $('#rh-sleep-save', form).disabled = true;
      const ok = await this.commit(d => {
        const record = { ...old, id: old?.id || uid('sleep'), kind: form.elements.kind.value, start: a.iso, startLocal: a.local, startOffset: a.offset, end: b.iso, endLocal: b.local, endOffset: b.offset, recordedMinutes, source: old?.source === 'lifepivot' ? 'lifepivot' : 'manual-band',
          deepMinutes: optInt('deepMin'), lightMinutes: optInt('lightMin'), remMinutes: optInt('remMin'),
          awakeEpisodes: optInt('awakeEp'), morningFeeling: optInt('feeling'), qualityScore: optInt('qScore') };
        if (old) d.sleeps[d.sleeps.findIndex(s => s.id === old.id)] = record; else d.sleeps.push(record);
        this.invalidate(d, (old?.endLocal || old?.startLocal)?.slice(0, 10), 'sleep');
        d.completeDays[this.selectedDay] = { ...d.completeDays[this.selectedDay], sleep: form.elements.complete.checked };
      }, '睡眠记录已保存');
      if (ok) { this.sleepEditId = undefined; this.sleepKind = form.elements.kind.value; this.refresh(); }
      else $('#rh-sleep-save', form).disabled = false;
    };
  }
};
