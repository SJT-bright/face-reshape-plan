/* Local meal and sleep journal. All user data stays in the existing local store. */
const Rhythm = {
  selectedDay: null, range: 7, busy: false, sleepEditId: undefined, sleepKind: 'main', importBusy: false,
  data() { return Store.db.rhythm; },
  icon(name) { return Icon3D.makeIcon(name).outerHTML; },
  mealPhotosHtml(day) {
    const photos=(this.data().mealPhotos || []).filter(p=>p.date===day).sort((a,b)=>a.local.localeCompare(b.local));
    const labels=['早餐','午餐','晚餐'];
    const missing=labels.filter(label=>!photos.some(p=>p.mealLabel===label));
    const status=`<p class="rhythm-caption">${photos.length} 张原图 · ${missing.length?'尚未记录 '+missing.join('、'):'三餐照片已记录'}（仅提示，不补造照片；加餐、多图均可）。</p>`;
    const media=typeof MediaActions!=='undefined' ? MediaActions.videosHtml('meal',day)+MediaActions.trashHtml('meal',day) : '';
    if(!photos.length)return status+'<p class="rhythm-caption">微信说用餐时间与餐别，再发照片或视频；不知道用餐时间时先待确认。</p>'+media;
    return status+`<div class="rhythm-photo-heading"><h4>餐食照片 · ${photos.length} 张</h4><small>点开查看原图</small></div><div class="life-photo-grid">${photos.map(p=>{
      const meal=this.data().meals.find(m=>m.sourceKey===p.mealSourceKey);
      return `<button type="button" class="life-photo-thumb" data-meal-photo="${esc(p.id)}"><img data-photo-file="${esc(p.file)}" data-photo-kind="meal" alt="${esc(p.date)} ${esc(p.mealLabel || '餐食照片')}"><span>${esc(p.mealLabel || '餐别待确认')} · ${esc(p.local.slice(11))}${p.timeKind==='sent'?' · 发送时间':''}</span><small>${meal?'关联 '+esc(meal.local.slice(11))+' '+esc(meal.foodText || '餐食'):'餐食时间待补充'}</small></button>`;
    }).join('')}</div>`+media;
  },
  mealPhotoViewer(id) {
    const p=(this.data().mealPhotos || []).find(p=>p.id===id);
    if(!p)return;
    const card=openModal(`<h3>${esc(p.mealLabel || '餐食照片')} · ${esc(p.date)}</h3><p class="hint">${p.timeKind==='occurred'?'记录时间':'照片发送时间'}：${esc(p.local.replace('T',' '))} · 北京时间</p><p class="hint">原始发送：${esc(p.sentAt || '')}${p.note ? ' · '+esc(p.note) : ''}</p>${p.archiveRelativePath?`<p class="hint">本地归档：${esc(p.archiveRelativePath)}</p>`:''}<div class="life-photo-viewer"><img data-photo-file="${esc(p.file)}" data-photo-kind="meal" alt="餐食原图"></div><button class="btn" id="rh-photo-close">关闭</button>`);
    $('#rh-photo-close',card).onclick=closeModal;
    const remove=document.createElement('button');remove.className='btn danger';remove.textContent='删除照片';remove.onclick=()=>MediaActions.change(p.id,'photo','delete');card.append(remove);
    Skincare._loadPhotoImgs(card).then(missing=>{if(missing)toast('原图暂时无法读取，请检查照片文件','red');});
  },
  /* ---------- 睡眠质量体系（移植自个人积累库） ---------- */
  sleepDetail(s) {
    if (!RhythmEngine.hasSleep(s)) return null;
    const minutes = RhythmEngine.sleepMinutes(s);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    const q = s.durationOnly ? {score:s.qualityScore,source:'manual'} : RhythmEngine.sleepQuality({
      durationMinutes: minutes, deepMinutes: s.deepMinutes ?? null, lightMinutes: s.lightMinutes ?? null,
      remMinutes: s.remMinutes ?? null, morningFeeling: s.morningFeeling ?? null,
      awakeEpisodes: s.awakeEpisodes ?? null, qualityScore: s.qualityScore ?? null
    });
    return { minutes, q, score: RhythmEngine.sleepDurationScore(minutes), date: s.endLocal.slice(0, 10), asleepTime: (s.startLocal || '').slice(11, 16), entry: s };
  },
  mainSleepDetails() {
    return this.data().sleeps.filter(s => RhythmEngine.hasSleep(s) && s.kind !== 'nap')
      .map(s => this.sleepDetail(s)).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  },
  sleepQualitySummary() {
    const details = this.mainSleepDetails();
    if (!details.length) return null;
    const last7 = details.slice(-7);
    const avgScore = Math.round(last7.reduce((n, d) => n + d.score, 0) / last7.length);
    const avgMinutes = Math.round(last7.reduce((n, d) => n + d.minutes, 0) / last7.length);
    const points = RhythmEngine.sleepPoints(details.map(d => ({ date: d.date, minutes: d.minutes, score: d.score, asleepTime: d.asleepTime })));
    // 连续记录天数：从今天/昨天往前数
    let streak = 0;
    let cursor = todayKey();
    const dates = new Set(details.map(d => d.date));
    if (!dates.has(cursor)) cursor = addDays(cursor, -1);
    while (dates.has(cursor)) { streak++; cursor = addDays(cursor, -1); if (streak > 3650) break; }
    return { avgScore, avgMinutes, points: points.total, streak, details, last: details[details.length - 1] };
  },
  sleepChartSVG(series) {
    series = series.filter(s => Number.isFinite(s.minutes) && s.minutes > 0);
    if (!series.length) return '<p class="rhythm-empty">还没有可绘制的睡眠记录。先记录一晚，或导入历史记录。</p>';
    const W = Math.max(760, series.length * 70 + 112), H = 512, L = 68, R = W - 46;
    const top = 42, bottom = 278, scoreTop = 344, scoreBottom = 464;
    const targetMinutes = RhythmEngine.SLEEP_TARGET_MINUTES;
    // 聚焦已记录的小时范围，每格始终 1 小时；不以截断的基线填充面积。
    const minHour = Math.max(0, Math.floor(Math.min(targetMinutes, ...series.map(s => s.minutes)) / 60) - 1);
    const maxHour = Math.max(minHour + 4, Math.ceil(Math.max(targetMinutes, ...series.map(s => s.minutes)) / 60) + 1);
    const x = i => series.length === 1 ? (L + R) / 2 : L + i * (R - L) / (series.length - 1);
    const yMin = m => bottom - (m / 60 - minHour) / (maxHour - minHour) * (bottom - top);
    const yScore = v => scoreBottom - v / 100 * (scoreBottom - scoreTop);
    const scores = series.map(s => RhythmEngine.sleepDurationScore(s.minutes));
    const durPts = series.map((s, i) => `${x(i).toFixed(2)},${yMin(s.minutes).toFixed(2)}`);
    const scorePts = scores.map((v, i) => `${x(i).toFixed(2)},${yScore(v).toFixed(2)}`);
    let grid = '';
    for (let hour = minHour; hour <= maxHour; hour++) {
      const y = yMin(hour * 60), target = hour * 60 === targetMinutes;
      grid += `<line data-hour="${hour}" x1="${L}" y1="${y}" x2="${R}" y2="${y}" class="${target ? 'sleep-target-line' : 'sleep-grid-line'}"/>
        <text x="${L - 12}" y="${y + 4}" text-anchor="end" class="sleep-chart-label${target ? ' sleep-target-label' : ''}">${hour} 小时</text>`;
    }
    const scoreGrid = [0, 25, 50, 75, 100].map(v => `<line x1="${L}" y1="${yScore(v)}" x2="${R}" y2="${yScore(v)}" class="sleep-grid-line"/><text x="${L - 12}" y="${yScore(v) + 4}" text-anchor="end" class="sleep-chart-label">${v}</text>`).join('');
    const points = series.map((s, i) => {
      const minute = Math.round(s.minutes);
      const short = `${Math.floor(minute / 60)}h${String(minute % 60).padStart(2, '0')}`;
      const reading = this.sleepChartReading(series, i);
      return `<g class="sleep-chart-point${i === series.length - 1 ? ' is-active' : ''}" data-sleep-point="${i}" data-reading="${esc(reading)}" tabindex="0" role="button" aria-label="${esc(reading)}" aria-pressed="${i === series.length - 1}">
        <title>${esc(reading)}</title><line x1="${x(i)}" y1="${top}" x2="${x(i)}" y2="${scoreBottom}" class="sleep-point-guide"/>
        <circle cx="${x(i)}" cy="${yMin(s.minutes)}" r="5" class="sleep-duration-dot"/>
        <text x="${x(i)}" y="${yMin(s.minutes) - 13}" text-anchor="middle" class="sleep-chart-value sleep-duration-value">${short}</text>
        <circle cx="${x(i)}" cy="${yScore(scores[i])}" r="4.5" class="sleep-score-dot"/>
        <text x="${x(i)}" y="${yScore(scores[i]) - 12}" text-anchor="middle" class="sleep-chart-value sleep-score-value">${scores[i]} 分</text>
        <text x="${x(i)}" y="${H - 20}" text-anchor="middle" class="sleep-chart-label">${esc(s.date.slice(5))}</text>
      </g>`;
    }).join('');
    return `<div class="sleep-chart-scroll" tabindex="0" aria-label="最近 ${series.length} 次睡眠趋势，窄窗口可横向滚动"><svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.max(620, series.length * 48 + 108)}px" class="sleep-chart" role="group" aria-label="睡眠时长每格 1 小时，时长评分为 0 至 100 分">
      <text x="${L}" y="18" class="sleep-chart-heading">睡眠时长 · 每格 1 小时</text>${grid}
      <text x="${R}" y="${yMin(targetMinutes) - 8}" text-anchor="end" class="sleep-target-label">7 小时目标</text>
      <polyline class="sleep-duration-line" points="${durPts.join(' ')}"/>
      <text x="${L}" y="320" class="sleep-chart-heading">时长评分 · 达到 7 小时为 100 分</text>${scoreGrid}
      <polyline class="sleep-score-line" points="${scorePts.join(' ')}"/>${points}
    </svg></div><p class="sleep-chart-reading" id="rh-sleep-reading" aria-live="polite">${esc(this.sleepChartReading(series, series.length - 1))}</p>
      <p class="rhythm-caption sleep-chart-scale">最近 ${series.length} 次主要睡眠，按记录等距排列；小时纵轴显示 ${minHour}–${maxHour} 小时。点击、悬停或用方向键查看具体数值。</p>`;
  },
  sleepChartReading(series, i) {
    const s = series[i], score = RhythmEngine.sleepDurationScore(s.minutes);
    const gap = RhythmEngine.SLEEP_TARGET_MINUTES - s.minutes;
    let text = `${s.date} · ${this.sleepDurationText(s.minutes)} · 时长评分 ${score} 分 · ${gap > 0 ? '距 7 小时还差 ' + this.sleepDurationText(gap) : '已达到 7 小时目标'}`;
    if (i > 0) {
      const prev = series[i - 1], delta = s.minutes - prev.minutes;
      const scoreDelta = score - RhythmEngine.sleepDurationScore(prev.minutes);
      text += `；比 ${prev.date} ${delta === 0 ? '时长相同' : (delta > 0 ? '多 ' : '少 ') + this.sleepDurationText(Math.abs(delta))}`;
      if (scoreDelta) text += `，评分${scoreDelta > 0 ? '高' : '低'} ${Math.abs(scoreDelta)} 分`;
    }
    if (Number.isInteger(s.entry?.qualityScore)) text += `；原记录自评分 ${s.entry.qualityScore} 分`;
    return text;
  },
  bindSleepChart(root) {
    const points = $$('[data-sleep-point]', root), reading = $('#rh-sleep-reading', root);
    const select = point => {
      points.forEach(p => { const active = p === point; p.classList.toggle('is-active', active); p.setAttribute('aria-pressed', String(active)); });
      if (reading) reading.textContent = point.dataset.reading;
    };
    points.forEach((point, i) => {
      point.onmouseenter = point.onclick = point.onfocus = () => select(point);
      point.onkeydown = e => {
        const next = e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'ArrowRight' ? Math.min(points.length - 1, i + 1) : e.key === 'Home' ? 0 : e.key === 'End' ? points.length - 1 : null;
        if (next != null) { e.preventDefault(); points[next].focus(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(point); }
      };
    });
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
      }, '');
      toast(imported ? `已导入 ${imported} 条${skipped ? ` · 跳过 ${skipped} 条（重复/无效）` : ''}` : '没有新记录可导入');
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
  sleepDurationText(n) {
    if (!Number.isFinite(n)) return '—';
    const minutes = Math.round(n);
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
      toast('未能保存，请检查存储空间或目录权限后重试。', 'red');
      return false;
    } finally { this.busy = false; }
  },
  invalidate(data, key, field) {
    if (key) data.completeDays[key] = { ...data.completeDays[key], [field]: false };
  },
  refresh() { if (App.currentView === 'nutrition') App.render(); },
  /* 今日饮食参考：宏量营养素目标（按身高体重/训练量）+ 今天已记录的餐次时间。
     口径与出处见 docs/nutrition-advice-design.md；应用只记餐次时间，不虚构热量统计。 */
  nutritionCardHtml() {
    const t = todayKey();
    const profile = Store.db.profile || (Store.db.strength && Store.db.strength.bmiProfile) || {};
    let weeklySets = null;
    try {
      if (typeof StrengthCore !== 'undefined' && Store.db.strength) {
        const muscles = StrengthCore.muscleProgress(Store.db.strength, t);
        const max = Math.max(...muscles.map(m => m.weeklyStimSets || 0));
        if (Number.isFinite(max) && max > 0) weeklySets = max;
      }
    } catch { weeklySets = null; }
    const meals = RhythmEngine.summarizeMealsToday(this.data(), t);
    const advice = profile.age && ['男','女'].includes(profile.sex) && profile.activity ? RhythmEngine.nutritionAdvice(profile, { weeklySets, mealCount: meals.count }) : null;
    const sugar = (this.data().sugarLog || {})[t];
    const gly = RhythmEngine.glycemicScore(this.data(), t);
    const tierTxt = advice
      ? (advice.tier === 'high' ? '力量训练量高' : advice.tier === 'training' ? '规律力量训练' : advice.tier === 'light' ? '训练量较少' : '未记录力量训练')
      : '';
    /* 加餐也计入「进食次数」（应用不区分食物构成）；蛋白分餐按进食次数折算 */
    const mealsTxt = meals.count
      ? `今天已记录 <b>${meals.count}</b> 次进食（${esc(meals.first)} → ${esc(meals.last)}${meals.spanMinutes ? ` · 进食跨度约 ${Math.round(meals.spanMinutes / 30) / 2} 小时` : ''}）`
      : '今天还没记录进食时间——在上方「进餐时间」记一下即可（加餐也算）。';
    return `
      <section class="rhythm-card" aria-labelledby="rh-nutrition-title">
        <div class="rhythm-heading"><div><h2 id="rh-nutrition-title">🍚 今日饮食参考</h2>
          <p class="rhythm-caption">按你的身高体重与训练量给「目标」口径；应用只记餐次时间，不统计实际热量。</p></div>
          <span class="rhythm-local">${tierTxt}</span></div>
        <p class="rhythm-caption" style="margin:0 0 10px">${mealsTxt}</p>
        ${advice ? `
        <div class="rhythm-metrics">${[
          ['维持热量参考', `${advice.tdee} kcal`, `基础代谢 ${advice.bmr} kcal${advice.ageAssumed ? '（年龄缺省按 30 岁估算）' : ''}${advice.sexAssumed ? '（性别缺省按男性估算）' : ''}`],
          ['蛋白质', `${advice.proteinG} g`, `${advice.proteinPerKg} g/kg · ${tierTxt}`],
          ['脂肪', `${advice.fatG} g`, `供能约 ${advice.fatPct}%（带 20–30%）`],
          ['碳水化合物', `${advice.carbsG} g`, `约 ${advice.carbsPerKg} g/kg · 供能比约束在 50–65%`],
          ['饮水', `${advice.waterMl} ml`, `30–35 ml/kg${advice.waterClamped ? '（已按 1500–2500ml 截取）' : ''}`]
        ].map(([label, value, note]) => `<div><span>${label}</span><strong>${value}</strong><small>${esc(note)}</small></div>`).join('')}</div>
        <div style="display:grid; gap:4px; margin-top:10px">${advice.notes.map(n => `<span style="font-size:12.5px; color:#53667b">· ${esc(n)}</span>`).join('')}</div>
        <p class="rhythm-caption" style="margin-top:8px">${esc(advice.disclaimer)} 个人资料在「设置 → 个人资料」里填写。</p>`
        : '<p class="hint">请到「设置 → 个人资料」补充身高、体重、年龄、性别与活动水平，再计算营养目标。缺项不自动采用默认值。</p>'}
        <div style="margin-top:14px; padding:10px 12px; border:1px dashed rgba(83,102,123,.3); border-radius:10px">
          <div class="rhythm-sleep-times" style="grid-template-columns:auto 1fr; align-items:center; gap:10px">
            <span style="font-size:12.5px; color:#53667b">今天甜食（估算，选一档）：</span>
            <div style="display:flex; gap:6px; flex-wrap:wrap">
              ${['无甜食', '少量', '适量', '偏多'].map((label, v) => `<button class="btn small ghost" data-sugar="${v}" data-sel="${sugar === v ? 1 : 0}" data-no-icon="true" style="${sugar === v ? 'border-color:#5b8def; color:#2f5fe0; background:rgba(91,141,239,.1)' : ''}">${label}</button>`).join('')}
            </div>
          </div>
          ${gly ? `<div style="margin-top:8px"><b style="font-size:13px; color:#2f4257">🩸 血糖友好习惯参考 ${gly.score}/100</b><span class="rhythm-caption" style="margin-left:6px">${esc(gly.factors.map(f => `${f.label} ${f.factor}`).join(' · '))}</span>
            <div style="display:grid; gap:3px; margin-top:4px">${gly.factors.map(f => `<span style="font-size:11.5px; color:#7a8798">· ${esc(f.note)}</span>`).join('')}</div>
            ${gly.tomorrowActions && gly.tomorrowActions.length ? `<div style="margin-top:6px; padding:8px 10px; border:1px dashed rgba(91,141,239,.4); border-radius:9px; display:grid; gap:3px"><b style="font-size:12px; color:#2f4257">👉 明天可以先做一件事</b>${gly.tomorrowActions.slice(0, 1).map(a => `<span style="font-size:11.5px; color:#53667b">${esc(a)}</span>`).join('')}</div>` : ''}
            <p class="rhythm-caption" style="margin:4px 0 0">${esc(gly.disclaimer)}</p></div>`
          : '<p class="rhythm-caption" style="margin:8px 0 0">选一档甜食后，这里结合进食跨度与晚间进食给出血糖友好习惯参考分（非血糖测量）。</p>'}
        </div>
      </section>`;
  },
  view(root) {
    this.selectedDay ||= todayKey();
    const d = this.data(), selected = this.selectedDay;
    const report = RhythmEngine.analyze(d, { days: this.range });
    const meals = d.meals.filter(m => typeof m.local === 'string' && m.local.slice(0, 10) === selected).sort((a, b) => a.local.localeCompare(b.local));
    const sleeps = d.sleeps.filter(s => typeof (s.endLocal || s.startLocal) === 'string' && (s.endLocal || s.startLocal).slice(0, 10) === selected).sort((a, b) => String(a.start||a.endLocal).localeCompare(String(b.start||b.endLocal)));
    const unfinished = d.sleeps.filter(s => !RhythmEngine.hasSleep(s));
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
        <button class="btn primary" id="rh-diet-entry">饮食 · 三餐照片</button>
        <button class="btn primary" id="rh-meal">${this.icon('nutrition')}记一餐</button>
        <span class="rhythm-local">大致到分钟即可 · 保存在本机</span>
      </div>
      <section class="rhythm-card rhythm-journal" aria-labelledby="rh-journal-title">
        <div class="rhythm-heading"><h2 id="rh-journal-title">日常记录</h2><div class="rhythm-date"><button class="btn small ghost" id="rh-prev" aria-label="前一天">前一天</button><input id="rh-date" type="date" min="2000-01-01" max="${todayKey()}" value="${selected}" aria-label="查看记录日期"><button class="btn small ghost" id="rh-today">今天</button></div></div>
        <div class="rhythm-log-columns">
          <div id="rh-diet-journal"><h3>${this.icon('nutrition')}饮食记录与三餐照片</h3><p class="rhythm-caption">微信原文、实际用餐时间与原图一起积累；餐别可按你明确说的名称记录。</p>
            <div class="rhythm-records">${meals.length ? meals.map(m => { const chip = this.mealChip(m); return `<div class="rhythm-record rhythm-record-meal"><div class="rhythm-record-main"><strong>${esc(m.local.slice(11))}</strong><span class="rhythm-meal-chip" data-kind="${esc(chip.kind)}">${esc(chip.text)}</span>${m.foodText ? `<span>${esc(m.foodText)}</span>` : ''}${m.photoCount ? `<small>📷 ${m.photoCount} 张已归档在生活日报</small>` : ''}${m.source === 'weixin-life-diary' ? '<small>来自微信生活日报</small>' : ''}</div><button class="btn small ghost" data-meal="${esc(m.id)}" aria-label="编辑 ${esc(m.local.slice(11))} 进餐">编辑</button></div>`; }).join('') : '<p class="rhythm-empty">这一天还没有进餐记录。</p>'}</div>
            ${this.mealPhotosHtml(selected)}
            <label class="rhythm-check"><input id="rh-complete-meals" type="checkbox" ${d.completeDays[selected]?.meals ? 'checked' : ''}>这一天的进餐已记全</label>
          </div>
          <div class="rhythm-sleep-column"><h3>${this.icon('moon')}睡眠记录</h3><p class="rhythm-caption">只记录总时长和分数，用上下箭头调整。保存后沿用这次的数值。</p>
            ${this.sleepForm(sleeps)}
            ${this.sleepAdviceHtml()}
            ${sleeps.filter(s => RhythmEngine.hasSleep(s)).length ? `<details class="rhythm-sleep-history"><summary>查看这一天的睡眠记录（${sleeps.filter(s => RhythmEngine.hasSleep(s)).length}）</summary>${sleeps.filter(s => RhythmEngine.hasSleep(s)).map(s => { const qd = this.sleepDetail(s); return `<div class="rhythm-record"><div><strong>${s.durationOnly?'已记录总时长':esc(s.startLocal.slice(11))+' → '+esc(s.endLocal.slice(11))}</strong><span>${s.kind === 'nap' ? '午睡 / 小睡' : '主要睡眠'} · ${this.duration(RhythmEngine.sleepMinutes(s))}${qd && qd.q ? ` · ${qd.q.score} 分` : ''}${s.source === 'lifepivot' ? ' · 来自个人积累库' : ''}</span></div><button class="btn small ghost" data-sleep="${esc(s.id)}">编辑</button></div>`; }).join('')}</details>` : ''}
            ${unfinished.length ? `<details class="rhythm-sleep-history"><summary>旧版未完成记录（${unfinished.length}）</summary><p class="rhythm-caption">这些旧记录已保留，不参与统计；可填写完整时间或删除。</p>${unfinished.map(s => `<div class="rhythm-record"><span>${esc(s.startLocal.replace('T', ' '))}</span><button class="btn small ghost" data-sleep="${esc(s.id)}">整理记录</button></div>`).join('')}</details>` : ''}
          </div>
        </div><p class="rhythm-caption rhythm-footnote">补记或修改后，请重新确认“已记全”。未记全的日子不用于判断进餐间隔或睡眠偏短。原始时长与自评分按保存值保留；下方时长评分按 7 小时目标计算。旧记录保留原来的时间与分期数据。</p>
      </section>
      ${this.nutritionCardHtml()}
      <section class="rhythm-card sleep-quality-card" aria-labelledby="rh-sq-title">
        <div class="rhythm-heading"><div><h2 id="rh-sq-title">睡眠时长与评分<span class="sleep-badge-src">目标 7 小时</span></h2><p class="rhythm-caption">时长评分 = 实际睡眠分钟 ÷ 420 × 100，四舍五入，最高 100 分。5 小时 71 分，6 小时 86 分，7 小时 100 分；原记录自评分保留。</p></div><button class="btn small ghost" id="rh-import-sleep">从个人积累库导入</button></div>
        ${(() => {
          const s = this.sleepQualitySummary();
          if (!s) return '<p class="rhythm-empty">还没有睡眠记录。手动记一条，或点右上角从个人积累库导入历史记录。</p>';
          const last14 = s.details.slice(-14);
          return `<div class="sleep-quality-metrics">
            <div><span>最近 7 次平均时长评分</span><strong>${s.avgScore}<small>分</small></strong><small>最近一条 ${s.last.score} 分</small></div>
            <div><span>睡眠积分</span><strong>${s.points}<small>分</small></strong><small>按记录、时长达标、时长评分和早睡累计</small></div>
            <div><span>连续记录</span><strong>${s.streak}<small>天</small></strong><small>最近 7 次平均时长 ${this.sleepDurationText(s.avgMinutes)}</small></div>
          </div>
          <div class="sleep-latest" data-sleep-latest><div><span>${esc(s.last.date)} · 最近一次睡眠</span><strong>${this.sleepDurationText(s.last.minutes)}<small>${s.last.score} 分</small></strong></div><p>${esc(this.sleepChartReading(s.details.slice(-2), Math.min(1, s.details.length - 1)))}</p></div>
          ${this.sleepChartSVG(last14)}
          <div class="sleep-chart-legend"><span><i class="dot dur"></i>睡眠时长（蓝色实线）</span><span><i class="dot score"></i>时长评分（橙色虚线）</span><span class="sleep-chart-note">上图横向虚线为 7 小时目标 · 数据保存在本机</span></div>`;
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
    const advWake = $('#rh-adv-wake', root);
    if (advWake) advWake.onchange = async e => {
      const v = e.target.value;
      await this.commit(d => { d.tomorrowWake = v ? { date: todayKey(), time: v } : null; }, v ? '已按明早起床时间更新建议' : '已恢复按近期起床时刻计算');
      this.refresh();
    };
    $$('[data-sugar]', root).forEach(b => {
      b.onclick = async () => {
        const tier = Number(b.dataset.sugar);
        await this.commit(d => { d.sugarLog = { ...(d.sugarLog || {}), [todayKey()]: tier }; }, '已记录今天甜食档位');
        this.refresh();
      };
    });
    $('#rh-profile', root).onchange = async e => { const value = e.target.value; await this.commit(data => { data.profile = value; }); this.refresh(); };
    ['meals'].forEach(field => {
      $(`#rh-complete-${field}`, root).onchange = async e => {
        const checked = e.target.checked;
        await this.commit(data => { data.completeDays[selected] = { ...data.completeDays[selected], [field]: checked }; }, checked ? (selected === todayKey() ? '已确认；今天的记录会从明天计入趋势' : '已确认，趋势已更新') : '已取消确认');
        this.refresh();
      };
    });
    $$('[data-meal]', root).forEach(b => { b.onclick = () => this.mealModal(b.dataset.meal); });
    $$('[data-meal-photo]',root).forEach(b=>{b.onclick=()=>this.mealPhotoViewer(b.dataset.mealPhoto);});
    this.bindSleepChart(root);
    $('#rh-diet-entry',root).onclick=()=>{$('#rh-diet-journal',root).scrollIntoView({behavior:'smooth',block:'start'});};
    if(typeof Skincare!=='undefined')void Skincare._loadPhotoImgs(root);
    $$('[data-sleep]', root).forEach(b => { b.onclick = () => { const entry = d.sleeps.find(s => s.id === b.dataset.sleep); this.selectedDay = (entry.endLocal || entry.startLocal).slice(0, 10); this.sleepEditId = entry.id; this.refresh(); $('#rh-sleep-form [name=hours]').focus(); }; });
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
        if (field === 'meals' && old.sourceKey) {
          d.mealImportVersions = d.mealImportVersions || {};
          d.mealImportVersions[old.sourceKey] = {revision:old.sourceRevision || 1,state:'manual-deleted'};
        }
        this.invalidate(d, (old.local || old.endLocal || old.startLocal).slice(0, 10), field === 'meals' ? 'meals' : 'sleep');
      }, '记录已删除');
      if (ok) { closeModal(); this.refresh(); }
    };
    card.querySelector('input')?.focus();
  },
  /* 餐别徽章：优先记录里的餐别，旧记录按时刻即时分类兜底（不回写数据）。
     加餐用灰徽章，夜宵用紫徽章；旧的「正餐 + 加餐」仍显示成「晚餐 · 加餐」。 */
  mealChip(m) {
    const id = (m.mealType && RhythmEngine.mealTypeLabel(m.mealType)) ? m.mealType : RhythmEngine.classifyMealType(m.local);
    const label = RhythmEngine.mealTypeLabel(id);
    const typeKind = RhythmEngine.mealTypeKind(id);
    if (m.kind === 'snack' && typeKind === 'meal') return { kind: 'snack', text: label ? `${label} · 加餐` : '加餐' };
    if (typeKind === 'snack' || m.kind === 'snack') return { kind: id === 'supper' ? 'supper' : 'snack', text: label || '加餐' };
    return { kind: id || 'meal', text: label || '正餐' };
  },
  mealModal(id) {
    const old = this.data().meals.find(m => m.id === id);
    const timeValue = old?.local || `${todayKey()}T${hhmm()}`;
    const selectedType = RhythmEngine.resolveMealSelection(old, timeValue);
    const typeSel = RhythmEngine.MEAL_TYPE_WINDOWS.map(w => `<option value="${w.id}" ${selectedType === w.id ? 'selected' : ''}>${w.label}</option>`).join('');
    const card = openModal(`<form id="rh-form" class="rhythm-form"><h3>${old ? '编辑进餐' : '记一餐'}</h3><p class="rhythm-caption">记录实际进餐时间和吃了什么；不自动推测热量或营养素。餐别按时间预选，也可以手改。</p><label>进餐时间<input name="time" data-draft-value="true" type="datetime-local" value="${esc(timeValue)}" max="${RhythmEngine.localNow()}" min="2000-01-01T00:00" required></label><label>这一餐是<select name="mealType">${typeSel}</select></label><label>吃了什么（可选）<input name="foodText" data-draft-value="true" maxlength="180" value="${esc(old?.foodText || '')}" placeholder="例如鸡蛋和米饭"></label>${this.modalFooter(old)}</form>`);
    card.dataset.draftObject=old?.id||'new-meal';
    this.bindModal(card, old, 'meals');
    const form = $('#rh-form', card), typeSelEl = form.elements.mealType;
    SoftControls.timePicker(form.elements.time,{date:timeValue.slice(0,10),onDate:()=>old?old.local.slice(0,10):todayKey()});
    /* 改时间时自动跟随分类，直到用户手动选过餐别（编辑旧记录视为已手动确认） */
    let typeDirty = Boolean(old?.mealType);
    typeSelEl.onchange = () => { typeDirty = true; };
    form.elements.time.oninput = () => {
      if (typeDirty) return;
      const t = RhythmEngine.classifyMealType(form.elements.time.value);
      if (t) typeSelEl.value = t;
    };
    $('#rh-form', card).onsubmit = async e => {
      e.preventDefault();
      const f = e.target, local = `${old?old.local.slice(0,10):todayKey()}T${f.elements.time.value.slice(-5)}`;
      const mealType = f.elements.mealType.value;
      const foodText = f.elements.foodText.value.trim();
      const input = { id: old?.id, local, mealType };
      const error = RhythmEngine.validateMeal(input, this.data());
      if (error) { $('#rh-error', card).textContent = error; return; }
      const p = RhythmEngine.parse(local);
      const kind = RhythmEngine.mealTypeKind(mealType) === 'snack' ? 'snack' : 'meal';
      $('#rh-save', card).disabled = true;
      const ok = await this.commit(d => {
        const record = { ...old, id: old?.id || uid('meal'), at: p.iso, local, offset: p.offset, kind, mealType, foodText,
          manualOverride:old?.sourceKey ? true : old?.manualOverride };
        if (old) d.meals[d.meals.findIndex(m => m.id === old.id)] = record; else d.meals.push(record);
        this.invalidate(d, old?.local.slice(0, 10), 'meals');
        this.invalidate(d, local.slice(0, 10), 'meals');
      }, '进餐时间已记下 · 力量训练页会按这一餐给出开始时间');
      if (ok) { this.selectedDay = local.slice(0, 10); closeModal(); if(App.currentView==='nutrition')this.refresh();else App.render(); }
      else $('#rh-save', card).disabled = false;
    };
  },
  sleepForm(sleeps) {
    const old=this.sleepEditId?this.data().sleeps.find(s=>s.id===this.sleepEditId):sleeps.find(s=>RhythmEngine.hasSleep(s)&&s.kind!=='nap');
    this.formSleepId=old?.id||null;
    const recent=this.data().sleeps.filter(s=>RhythmEngine.hasSleep(s)&&s.kind!=='nap').sort((a,b)=>String(b.updatedAt||b.endLocal).localeCompare(String(a.updatedAt||a.endLocal)))[0];
    const base=old||recent,minutes=base?RhythmEngine.sleepMinutes(base):480,score=base?this.sleepDetail(base)?.q?.score:80;
    return `<form id="rh-sleep-form" class="rhythm-sleep-form"><div class="soft-sleep-fields"><label>睡眠小时<input class="input" name="hours" data-stepper type="number" min="0" max="23" step="1" value="${Math.floor(minutes/60)}"></label><label>分钟<input class="input" name="minutes" data-stepper type="number" min="0" max="59" step="1" value="${Math.round(minutes%60)}"></label><label>睡眠分数<input class="input" name="qScore" data-stepper type="number" min="0" max="100" step="1" value="${score??80}"></label></div><p class="rhythm-caption">${base?'已带入'+(old?'这一天':'上次保存')+'的数值，点箭头即可调整。':'先按 8 小时、80 分带入，保存后成为你的默认值。'}</p><label class="rhythm-check"><input name="complete" type="checkbox" ${this.data().completeDays[this.selectedDay]?.sleep?'checked':''}>这一天的睡眠已记全</label><p id="rh-sleep-error" class="rhythm-error" role="alert"></p><div class="rhythm-sleep-buttons"><button class="btn primary small" type="submit" id="rh-sleep-save">${old?'更新睡眠记录':'保存睡眠记录'}</button>${old?'<button class="btn small ghost" type="button" id="rh-sleep-delete">删除记录</button>':''}</div></form>`;
  },
  bindSleepForm(root) {
    const form=$('#rh-sleep-form',root),old=this.data().sleeps.find(s=>s.id===this.formSleepId);
    if(!form)return;SoftControls.bind(form);
    if(old)$('#rh-sleep-delete',form).onclick=async e=>{
      const button=e.currentTarget;if(button.dataset.armed!=='true'){button.dataset.armed='true';button.textContent='确认删除';return;}
      button.disabled=true;const ok=await this.commit(d=>{d.sleeps=d.sleeps.filter(s=>s.id!==old.id);this.invalidate(d,old.endLocal?.slice(0,10),'sleep');},'睡眠记录已删除');
      if(ok){this.sleepEditId=undefined;this.refresh();}else button.disabled=false;
    };
    form.onsubmit=async e=>{
      e.preventDefault();const date=this.selectedDay||todayKey(),hours=Number(form.elements.hours.value),minutes=Number(form.elements.minutes.value),qualityScore=Number(form.elements.qScore.value),total=hours*60+minutes;
      if(!Number.isInteger(hours)||hours<0||hours>23||!Number.isInteger(minutes)||minutes<0||minutes>59||total<=0||!Number.isInteger(qualityScore)||qualityScore<0||qualityScore>100){$('#rh-sleep-error',form).textContent='请用箭头选择有效时长（大于 0）和分数（0–100）。';return;}
      if(date>todayKey()){$('#rh-sleep-error',form).textContent='只能记录已发生的睡眠。';return;}
      $('#rh-sleep-save',form).disabled=true;
      const ok=await this.commit(d=>{
        // No invented bedtime/wake time: temporal statistics skip duration-only records.
        const record={...old,id:old?.id||uid('sleep'),kind:old?.kind||'main',date,endLocal:date,durationOnly:true,recordedMinutes:total,qualityScore,source:'manual-duration',updatedAt:new Date().toISOString()};
        if(old&&!old.durationOnly)record.originalTiming=old.originalTiming||{...old};
        record.start=null;record.end=null;record.startLocal=date;record.awakeMinutes=null;
        if(old)d.sleeps[d.sleeps.findIndex(s=>s.id===old.id)]=record;else d.sleeps.push(record);
        this.invalidate(d,(old?.endLocal||old?.startLocal)?.slice(0,10),'sleep');d.completeDays[date]={...d.completeDays[date],sleep:form.elements.complete.checked};
      },'睡眠已保存，下次沿用这次的时长和分数');
      if(ok){this.sleepEditId=undefined;if(App.currentView==='nutrition')this.refresh();else App.render();}else $('#rh-sleep-save',form).disabled=false;
    };
  },
  /* 今晚入睡建议卡：早上记录主睡眠后生成（RhythmEngine.sleepAdvice 纯函数）。
     支持「明早定时起床」覆盖：填了时间就按该起床点重算（仅当天有效，存 db.rhythm.tomorrowWake）。 */
  wakeOverride() {
    const ow = this.data().tomorrowWake;
    return ow && ow.date === todayKey() && /^\d{2}:\d{2}$/.test(ow.time || '') ? ow.time : '';
  },
  sleepAdviceHtml() {
    const overrideTime = this.wakeOverride();
    const options = overrideTime ? { wakeOverrideMinutes: Number(overrideTime.slice(0, 2)) * 60 + Number(overrideTime.slice(3, 5)) } : {};
    /* 昨日训练组数（跨模板全库聚合）：容量偏高时今晚多留恢复窗口 */
    try {
      const st = Store.db.strength || {};
      const yesterday = addDays(todayKey(), -1);
      const day = st.days && st.days[yesterday];
      if (day && day.status !== 'skipped') {
        let sets = 0;
        for (const a of day.actions || []) {
          if (Array.isArray(a.sets)) sets += a.sets.filter((x) => x && x.done).length;
          else if (typeof a.setsDone === 'number') sets += a.setsDone;
        }
        if (sets > 0) options.trainingSetsYesterday = sets;
      }
    } catch { /* 训练数据缺失不影响睡眠建议 */ }
    const advice = RhythmEngine.sleepAdvice(this.data(), new Date(), options);
    if (!advice) return '';
    const hrs = m => `${Math.floor(m / 60)} 小时${m % 60 ? ` ${Math.round(m % 60)} 分` : ''}`;
    return `<div class="rhythm-sleep-advice" role="status" style="margin:12px 0; padding:12px 14px; border:1px solid rgba(91,141,239,.35); background:rgba(91,141,239,.07); border-radius:12px; font-size:12.5px; color:#53667b">
      <strong style="font-size:13.5px; color:#2f4257">🌙 今晚入睡建议：${esc(advice.bedtime)} 上床</strong>
      <p style="margin:4px 0 6px">按明早 <b>${esc(advice.wake)}</b> 起床 · 卧床约 <b>${hrs(advice.opportunityMinutes)}</b>（≈ ${advice.cycles} 个睡眠周期，周期长度因人而异，仅作参考）· 预留 15 分钟入睡</p>
      <ul style="margin:4px 0 6px; padding-left:18px; display:grid; gap:3px">${advice.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <label style="display:inline-flex; align-items:center; gap:6px; margin:2px 0 4px">明早定时起床？
        <input id="rh-adv-wake" type="time" value="${esc(overrideTime)}" style="padding:4px 8px; border:1px solid rgba(83,102,123,.35); border-radius:8px; background:transparent; color:inherit; font:inherit">
      </label><span class="rhythm-caption">（如明天要早起，填写后按该时间重算；清空即恢复）</span>
      <p style="margin:2px 0 0; opacity:.8">${esc(advice.disclaimer)}</p>
    </div>`;
  }
};
