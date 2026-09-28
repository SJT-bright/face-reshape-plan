/* 各页面视图：今日 / 跟练 / 视频库 / 跟练计划 / 成就 */

const Views = {
  titles: { membership: '成长计划', nutrition: '饮食与睡眠', today: '今日', follow: '沉浸式跟练', settings:'设置', plan: '跟练计划', strength: '力量训练', skincare: '护肤', achievements: '成就地图' },

  /* ================= 今日（打开即练） ================= */
  today(root) {
    const day = Store.dayTraining(todayKey());
    const target = Store.settings().dailyTargetMinutes || 15;
    const min = Math.floor(day.seconds / 60);
    const met = day.seconds >= target * 60;
    const weekday = new Date().getDay();
    const sessions = (Store.db.sessions || []).filter(s => s.enabled && (s.days || []).includes(weekday))
      .sort((a, b) => (minutesOf(a.time) || 0) - (minutesOf(b.time) || 0));
    const curMin = nowMinutes();
    const videos = Store.db.videos;

    /* 今晚入睡建议：计算一次，简报与下方建议卡共用（同帧重复计算合并） */
    let sleepTip = null;
    try {
      const ow = (Store.db.rhythm || {}).tomorrowWake;
      const use = ow && ow.date === todayKey() && /^\d{2}:\d{2}$/.test(ow.time || '') ? ow.time : '';
      const opts = use ? { wakeOverrideMinutes: Number(use.slice(0, 2)) * 60 + Number(use.slice(3, 5)) } : {};
      sleepTip = RhythmEngine.sleepAdvice(Store.db.rhythm || {}, new Date(), opts);
    } catch { sleepTip = null; }

    /* 今日简报：各模块现成数据的早/晚两态拼装（util.dayBrief 纯函数；缺数据自动降级，渲染时快照） */
    let brief = null;
    try {
      const t = todayKey();
      /* 凌晨 0–6 点：昨晚的睡眠条目 endLocal 是「昨天」，此时查今天会误报「还没记」且无法补记（尚未起床） */
      const briefDay = curMin < 6 * 60 ? addDays(t, -1) : t;
      const sleeps = (Store.db.rhythm || {}).sleeps || [];
      const lastSleep = sleeps.filter(s => s.end && s.kind !== 'nap' && String(s.endLocal || '').slice(0, 10) === briefDay)
        .sort((a, b) => (Date.parse(b.end) - Date.parse(b.start)) - (Date.parse(a.end) - Date.parse(a.start)))[0] || null;
      const sleepMinutes = lastSleep ? RhythmEngine.sleepMinutes(lastSleep) : null;
      const sleepQ = lastSleep ? RhythmEngine.sleepQuality({ durationMinutes: sleepMinutes, deepMinutes: lastSleep.deepMinutes ?? null, remMinutes: lastSleep.remMinutes ?? null, awakeEpisodes: lastSleep.awakeEpisodes ?? null, morningFeeling: lastSleep.morningFeeling ?? null, qualityScore: lastSleep.qualityScore ?? null }) : null;
      const skinData = Store.db.skin || {};
      SkinEngine.normalize(Store.db); Skincare._ensureTodayPrediction();
      const pred = (Store.db.skin.predictions || {})[t];
      const focusList = (Store.dayTraining(t).entries || [])
        .filter(e => e.source === 'media-observed' && Number.isInteger(e.interruptions))
        .map(e => focusScore(e.interruptions || 0, Math.max(1, Math.round((e.seconds || 0) / 60))))
        .filter(f => f !== null);
      brief = dayBrief({
        nowMinutes: curMin,
        targetMinutes: target,
        trainingSeconds: day.seconds || 0,
        sleepMinutes,
        sleepScore: sleepQ ? sleepQ.score : null,
        skinLogged: !!((skinData.logs || {})[t]),
        skinDir: pred ? pred.overallDir : null,
        bedtime: sleepTip ? sleepTip.bedtime : null,
        sweetLogged: Number.isInteger(((Store.db.rhythm || {}).sugarLog || {})[t]),
        focusScore: focusList.length ? Math.round(focusList.reduce((s, f) => s + f, 0) / focusList.length) : null
      });
    } catch { brief = null; }

    // 当前护肤时段
    const stT = Store.settings().skincareTimes || { morning: '09:00', noon: '12:00', evening: '20:00' };
    const curPhase = curMin >= (minutesOf(stT.evening) ?? 1200) ? 'evening'
      : curMin >= (minutesOf(stT.noon) ?? 720) ? 'day' : 'morning';
    const PH = {
      morning: { ico: '☀️', label: '早上' },
      day: { ico: '🌤️', label: '日间' },
      evening: { ico: '🌙', label: '晚上' }
    };

    root.innerHTML = `
      <div class="view">
        ${brief ? `
        <div class="card" id="td-brief" style="padding:12px 16px">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
            <b style="font-size:13px">${brief.form === 'evening' ? '🌙 今晚小结' : '☀️ 今日简报'}</b>
            ${brief.lines.map(l => `<button class="btn small ghost" data-go="${l.go}" data-no-icon="true" style="border:none; background:rgba(91,141,239,.08); font-size:12.5px">${l.icon} ${esc(l.text)}</button>`).join('')}
          </div>
        </div>` : ''}
        <!-- 顶行：大开练 + 角落方形时长记录 -->
        <div class="today-top">
          <div class="today-top-main">
            <div class="today-copy">
              <h1 class="today-title">今天，让轮廓<br>醒过来。</h1>
              <div class="today-top-hint">选择今天的课程，进入一段专注、安静的跟练。</div>
            </div>
            <button class="btn-go" id="td-go">▶ <span>开始今天的训练</span></button>
          </div>
          <div class="mini-stat ${met ? 'ok' : ''}" title="今日训练时长">
            <b>${min}</b>
            <span>${met ? '已达标 ✓' : '/ ' + target + ' 分钟'}</span>
            <i>${met ? '今天练够了' : '今日累计'}</i>
          </div>
        </div>

        ${sleepTip ? `
        <div class="card" id="td-sleep-tip" style="display:flex; align-items:center; gap:12px; padding:12px 16px">
          <span style="font-size:22px">🌙</span>
          <div style="flex:1; font-size:13px; min-width:0">
            今晚建议 <b>${esc(sleepTip.bedtime)}</b> 入睡
            <span class="hint">· 按明早 ${esc(sleepTip.wake)} 起床 · 卧床约 ${Math.round(sleepTip.opportunityMinutes / 6) / 10} 小时</span>
          </div>
          <button class="btn small ghost" id="td-sleep-go" data-no-icon="true">看依据 →</button>
        </div>` : ''}

        <!-- 今天能练的课 -->
        <div class="card">
          <h3>🎬 今天可以练 <span class="h-extra">${sessions.length} 个安排 · 去点时间在「跟练计划」里调</span></h3>
          <div class="course-grid" id="td-courses"></div>
        </div>

        <!-- 护肤：三时段，当前高亮 -->
        <div class="card">
          <h3>🧴 今日护肤
            <span class="h-extra">☀️${esc(stT.morning)} · 🌤️${esc(stT.noon)} · 🌙${esc(stT.evening)}（到点自动提醒）</span>
          </h3>
          <div class="sk-cols3" id="td-sk"></div>
        </div>

        <!-- 视频库 -->
        <div class="card">
          <h3>📺 视频库 <span class="h-extra">${videos.length} 个视频 · 点封面直接练</span>
            <button class="btn small primary" id="td-import" style="margin-left:auto">＋ 导入视频</button></h3>
          <div class="vid-grid" id="td-vids"></div>
        </div>
      </div>`;

    // 课程卡
    const courses = $('#td-courses', root);
    const sleepGo = $('#td-sleep-go', root);
    if (sleepGo) sleepGo.onclick = () => App.go('nutrition');
    $$('#td-brief [data-go]', root).forEach(b => { b.onclick = () => App.go(b.dataset.go); });
    if (!sessions.length) {
      courses.innerHTML = `<div class="empty">今天还没有安排课程。<br><button class="btn small primary" id="td-goplan">去跟练计划安排一下</button>　或点上方「开练」自由跟练</div>`;
      const g = $('#td-goplan', courses); if (g) g.onclick = () => App.go('plan');
    }
    for (const s of sessions) {
      const v = Store.videoById(s.videoId);
      const m = minutesOf(s.time);
      const isNow = m != null && curMin >= m && curMin <= m + 45;
      const el = document.createElement('div');
      el.className = 'course-card' + (isNow ? ' now' : '');
      el.innerHTML = `
        ${v && v.pic ? `<img class="course-thumb" src="${esc(v.pic)}" referrerpolicy="no-referrer">` : `<div class="course-thumb ph">🎞️</div>`}
        <div class="course-info">
          <b>${esc(s.name)}${isNow ? '<span class="tag now" style="margin-left:8px">就是现在</span>' : ''}</b>
          <span class="hint">${esc(s.time)} · ${v ? esc(v.title) : '未绑定视频 · 开练时选'} · ${s.targetMinutes || 10} 分钟</span>
        </div>
        <button class="btn small primary">跟练</button>`;
      $('.btn', el).onclick = () => App.openPracticeChooser(s);
      el.querySelector('.course-info').onclick = () => App.openPracticeChooser(s);
      courses.appendChild(el);
    }

    // 护肤三时段
    const skBox = $('#td-sk', root);
    const done = Store.daySkincare(todayKey());
    for (const key of ['morning', 'day', 'evening']) {
      const cyc = Store.activeCycle();
      const steps = (cyc && cyc.steps[key]) || [];
      const doneIds = done[key] || [];
      const allDone = steps.length > 0 && steps.every(x => doneIds.includes(x.id));
      const colEl = document.createElement('div');
      colEl.className = 'sk-col' + (key === curPhase ? ' cur' : '');
      colEl.innerHTML = `
        <h4>${PH[key].ico} ${PH[key].label}
          ${key === curPhase ? '<span class="tag now">当前时段</span>' : allDone ? '<span class="tag done">已完成</span>' : ''}
          <button class="btn small ghost sk-quick" data-phase="${key}">＋添加护肤品</button>
        </h4>
        <div class="sk-col-body"></div>`;
      const body = $('.sk-col-body', colEl);
      if (!steps.length) {
        body.innerHTML = `<div class="hint" style="padding:6px 2px">这个时段还没填护肤品。<br>可以现在留空，之后随时加。</div>`;
      }
      for (const step of steps) {
        const el = document.createElement('div');
        el.className = 'sk-step' + (doneIds.includes(step.id) ? ' done' : '');
        el.innerHTML = `<div class="chk">✓</div><div><div class="sk-name">${esc(step.name)}</div>${step.detail ? `<div class="sk-detail">${esc(step.detail)}</div>` : ''}</div>`;
        el.onclick = () => {
          const checked = Store.toggleSkincareStep(todayKey(), key, step.id);
          el.classList.toggle('done', checked);
          toast(checked ? '已打卡 ✓' : '已取消打卡');
          /* 列头「已完成」标签随勾选即时更新，不整页重绘 */
          const stepsNow = (Store.activeCycle() && Store.activeCycle().steps[key]) || [];
          const doneNow = (Store.daySkincare(todayKey())[key]) || [];
          const colAllDone = stepsNow.length > 0 && stepsNow.every(x => doneNow.includes(x.id));
          const h4 = $('h4', colEl);
          if (h4) {
            const tag = h4.querySelector('.tag.done');
            if (colAllDone && !tag && key !== curPhase) h4.insertAdjacentHTML('beforeend', '<span class="tag done">已完成</span>');
            else if (!colAllDone && tag) tag.remove();
          }
          App.refreshStatusPill();
        };
        body.appendChild(el);
      }
      $('.sk-quick', colEl).onclick = () => Skincare.quickAddModal(key, () => App.render());
      skBox.appendChild(colEl);
    }

    // 视频库
    const vids = $('#td-vids', root);
    if (!videos.length) vids.innerHTML = `<div class="empty" style="grid-column:1/-1">还没有视频。点右上「＋导入视频」，粘贴B站链接即可。</div>`;
    for (const v of videos) {
      const card = document.createElement('div');
      card.className = 'vid-card';
      const stats = Store.videoStats(v.id);
      const statLine = stats.total
        ? ` · ✅ 完整跟练 ${stats.completed} 次${stats.days ? ` · 坚持 ${stats.days} 天` : ''}`
        : '';
      card.innerHTML = `
        ${v.source === 'bilibili' && v.pic ? `<img class="vid-cover" src="${esc(v.pic)}" referrerpolicy="no-referrer">` : `<div class="vid-cover ph">🎞️</div>`}
        <div class="vid-info">
          <div class="vid-title">${esc(v.title)}</div>
          <div class="vid-meta"><span>${v.source === 'bilibili' ? 'B站' : '本地'}${v.durationSec ? ' · ' + Math.round(v.durationSec / 60) + '分钟' : ''}${statLine}</span></div>
        </div>
        <button class="vid-del" title="删除该视频">✕</button>`;
      card.onclick = () => App.launchFollow(v.id, null);
      $('.vid-del', card).onclick = async (e) => {
        e.stopPropagation();
        const ok = await confirmModal('删除视频', `确定从视频库删除「${v.title}」吗？\n跟练计划中对该视频的引用会一并清空。`, '删除');
        if (!ok) return;
        Store.db.videos = Store.db.videos.filter(x => x.id !== v.id);
        for (const s of Store.db.sessions) if (s.videoId === v.id) s.videoId = null;
        if (App.followVideoId === v.id) App.followVideoId = null;
        Store.save(true); App.render();
        toast('视频已删除', 'green');
      };
      vids.appendChild(card);
    }
    $('#td-import', root).onclick = () => Views.importModal();
    $('#td-go', root).onclick = () => App.openPracticeChooser(null);
  },

  /* 导入视频弹窗（原视频库导入功能） */
  importModal() {
    const card = openModal(`
      <h3>📺 导入视频</h3>
      <p class="hint">粘贴 B 站链接 / BV 号（可多行批量），或导入本地视频文件。</p>
      <textarea class="textarea" id="imv-text" style="min-height:110px; margin-top:10px"
        placeholder="https://www.bilibili.com/video/BVxxxxxx&#10;BV1xxxxxxxxxx（每行一个）"></textarea>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="imv-add">🔍 获取信息并导入</button>
        <button class="btn" id="imv-local">📁 本地视频文件</button>
      </div>`);
    $('#imv-add', card).onclick = async () => {
      const lines = $('#imv-text', card).value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.length) { toast('先粘贴链接或 BV 号', 'red'); return; }
      let okN = 0;
      for (const line of lines) {
        const p = Bilibili.parse(line);
        if (!p) { toast(`无法识别：${line.slice(0, 30)}`, 'red'); continue; }
        if (Store.db.videos.find(v => v.bvid === p.bvid || (p.aid && v.aid === p.aid))) continue;
        const info = await window.native.fetchBilibiliInfo(p.bvid || ('av' + p.aid));
        Store.db.videos.push({
          id: uid('vid'), source: 'bilibili',
          bvid: p.bvid || null, aid: p.aid || null, page: p.page || 1,
          cid: (info && info.ok) ? (info.cid || null) : null,
          title: (info && info.ok) ? info.title : (p.bvid || 'av' + p.aid),
          pic: (info && info.ok) ? info.pic : '',
          durationSec: (info && info.ok) ? info.durationSec : null,
          addedAt: new Date().toISOString()
        });
        okN++;
      }
      if (okN) {
        Store.save(true); closeModal(); App.render();
        toast(`成功导入 ${okN} 个视频 ✓`, 'green');
      } else toast('没有新增视频（可能都已存在）');
    };
    $('#imv-local', card).onclick = async () => {
      const r = await window.native.pickLocalVideo();
      if (!r) return;
      Store.db.videos.push({ id: uid('vid'), source: 'local', localPath: r.path, title: r.name, pic: '', durationSec: null, addedAt: new Date().toISOString() });
      Store.save(true); closeModal(); App.render();
      toast(r.copied ? '本地视频已复制到「跟练视频」文件夹 ✓' : '本地视频已导入 ✓', 'green');
    };
  },

  manualLogModal(selectedDate = todayKey()) {
    const card = openModal(`
      <h3>✍️ 手动补记训练时长</h3>
      <p class="hint">跟练了但没在应用里计时？在这里补记，一样计入成就地图。</p>
      <div class="row" style="margin-top:12px">
        <div style="flex:1"><label class="field">日期</label><input class="input" id="ml-date" type="date" min="2000-01-01" max="${todayKey()}" value="${esc(selectedDate)}" required></div>
        <div style="flex:1"><label class="field">时长（分钟）</label><input class="input" id="ml-min" type="number" min="1" max="600" value="15"></div>
      </div>
      <label class="field">备注（可选）</label>
      <input class="input" id="ml-note" placeholder="如：跟练了B站某个课程">
      <div class="row" style="justify-content:flex-end; margin-top:16px">
        <button class="btn ghost" id="ml-cancel">取消</button>
        <button class="btn primary" id="ml-ok">记录</button>
      </div>`);
    $('#ml-cancel', card).onclick = closeModal;
    $('#ml-ok', card).onclick = () => {
      const dateInput = $('#ml-date', card), date = dateInput.value;
      const min = +$('#ml-min', card).value;
      if (!dateInput.reportValidity()) return;
      if (!Number.isFinite(min) || min < 1 || min > 600) { toast('请填写 1–600 分钟的有效时长', 'red'); return; }
      Store.addTrainingEntry(date, { id: uid('en'), manual: true, note: $('#ml-note', card).value.trim(), start: hhmm(), end: hhmm(), seconds: min * 60 });
      if (App.currentView === 'achievements') AchievementCalendar.select(date);
      closeModal(); toast(`已记录 ${min} 分钟 ✓`, 'green');
      App.render();
    };
  },

  /* ================= 跟练 ================= */
  follow(root) {
    const autoplay = App.followAutoplay === true;
    App.followAutoplay = false;
    root.innerHTML = `
      <div class="view" style="max-width:1200px">
        <div id="stage-wrap">
          <night-sky aria-hidden="true"></night-sky>
          <div class="follow-stage" id="stage"></div>
          <div class="timer-hud" id="hud">
            <div class="timer-big" id="t-big">00:00</div>
            <div class="timer-meta" id="t-meta">选择视频后点击「开始跟练」</div>
            <div class="t-complete" id="t-complete" hidden><div class="t-complete-track"><i id="t-complete-fill"></i></div><span id="t-complete-text"></span></div>
            <div class="row">
              <button class="btn primary" id="t-toggle">▶ 开始跟练</button>
              <button class="btn green" id="t-stop" disabled>✓ 结束并记录</button>
              <button class="btn" id="t-imm">⛶ 沉浸全屏</button>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:14px">
          <h3>🎬 跟练视频 <span class="h-extra">B站视频通过官方内嵌播放器播放，支持全屏</span></h3>
          <div class="row">
            <select class="select" id="f-video" style="flex:1"></select>
            <button class="btn" id="f-load">载入播放器</button>
            <button class="btn" id="f-golib">＋ 导入新视频</button>
          </div>
          <p class="hint" style="margin-top:8px">视频暂停/继续会自动同步计时，暂停按钮同时控制视频；切到后台自动暂停（设置 → 目标与外观里可关）。结束后时长自动计入今日目标与成就地图。</p>
        </div>
      </div>`;

    const sel = $('#f-video', root);
    const vids = Store.db.videos;
    if (!vids.length) {
      sel.innerHTML = '<option value="">（视频库为空）</option>';
    } else {
      sel.innerHTML = vids.map(v => `<option value="${v.id}">${esc(v.title)}</option>`).join('');
      if (App.followVideoId) sel.value = App.followVideoId;
      else if (Session.active) sel.value = Session.active.videoId;
    }
    $('#f-golib', root).onclick = () => Views.importModal();
    $('#f-load', root).onclick = () => {
      const id = sel.value;
      if (!id) { toast('视频库为空，先去导入视频', 'red'); return; }
      App.followVideoId = id;
      Views.loadStage($('#stage', root), Store.videoById(id));
      toast('播放器已暂停，点击视频播放后自动计时');
    };
    $('#t-toggle', root).onclick = () => {
      const id = sel.value || App.followVideoId;
      if (!id) { toast('请先选择跟练视频', 'red'); return; }
      if (!Session.active) Views.loadStage($('#stage', root), Store.videoById(id));
      App._mediaEpoch = (App._mediaEpoch || 0) + 1;
      if (Session.active?.running) {
        Session.autoPause('user');
        Bilibili.MediaSync.pauseAll();
      } else {
        // Do not start the timer until playback really succeeds.
        Bilibili.MediaSync.playAll();
      }
      Views.syncTimerUI(root);
    };
    $('#t-stop', root).onclick = async () => {
      const sec = Session.stop();
      try { Bilibili.MediaSync.pauseAll(); } catch (e) {} // 结束跟练后视频不再自动播
      Views.syncTimerUI(root);
      if (sec != null) {
        App.refreshStatusPill();
        const met = Store.dayTargetMet(todayKey());
        if (met) await confirmModal('🎉 今日目标达成！', `本次跟练 ${fmtDuration(sec)}，今日累计已达标！成就地图已点亮今天的绿色格子。`, '太棒了');
        else toast(`本次跟练 ${fmtDuration(sec)}，继续加油～记多了或记错了？成就日历里点「改」可修正`, 'green');
      } else {
        toast('还没开始计时，本次未记录（等待播放时点「结束」不会留下空记录）');
      }
    };
    $('#t-imm', root).onclick = () => {
      const wrap = $('#stage-wrap', root);
      if (document.fullscreenElement) document.exitFullscreen();
      else wrap.requestFullscreen && wrap.requestFullscreen();
    };

    // 恢复现场：若有进行中的会话，载入其视频并恢复到跟练进度（切换视图不丢进度）
    const stage = $('#stage', root);
    if (Session.active) {
      const resumeSec = Session.active.mediaPosition || 0;
      const vid = Session.active.videoId || App.followVideoId;
      const video = vid ? Store.videoById(vid) : null;
      if (video) {
        Views.loadStage(stage, video, resumeSec, { autoplay });
        if (resumeSec >= 30) toast(`已恢复视频到约 ${fmtSeconds(resumeSec)}${autoplay?'':'，点击视频继续'}（按实际播放位置）`, 'green');
        /* 存量视频懒补 cid：t 进度定位强烈依赖 cid，缺失时后台补齐并重载一次 */
        if (video.bvid && !video.cid && resumeSec > 0 && window.native.fetchBilibiliInfo) {
          window.native.fetchBilibiliInfo(video.bvid).then((info) => {
            if (info && info.ok && info.cid) {
              const v2 = Store.videoById(vid);
              if (v2) {
                v2.cid = info.cid;
                Store.save();
                // Save the metadata for the next load; never reload a video the user may already be playing.
              }
            }
          }).catch(() => {});
        }
      }
    } else if (App.followVideoId && Store.videoById(App.followVideoId)) {
      Views.loadStage(stage, Store.videoById(App.followVideoId), 0, { autoplay });
    }
    Views.syncTimerUI(root);
  },

  loadStage(stage, video, startSec, opts) {
    stage.innerHTML = '';
    if (!video) {
      stage.innerHTML = `<div class="stage-empty"><div style="font-size:44px">🎬</div>
        <div>还没有载入视频</div><div class="hint">从下方选择，或去视频库导入 B 站瘦脸操课程</div></div>`;
      return;
    }
    App._mediaEpoch = (App._mediaEpoch || 0) + 1;
    if (Session.active && Session.active.videoId !== video.id) Session.stop();
    if (!Session.active) Session.start(video.id, null, { awaitPlay: true });
    else { Session.active.running = false; Session.active.autoPausedBy = 'media'; }
    const node = Bilibili.playerNode(video, startSec, opts?.autoplay === true);
    if (node) {
      if (video.source === 'local') {
        node.addEventListener('error',()=>{
          if(typeof UX==='undefined'||!node.isConnected)return;
          const info=document.createElement('div');info.className='card';info.innerHTML='<p>视频无法读取，可能已移动或格式不支持。</p><button class="btn">重新定位本地文件</button>';node.after(info);
          info.querySelector('button').onclick=async()=>{const picked=await native.pickLocalVideo();if(!picked)return;if(!/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(picked.path)){toast('请选择视频文件','red');return;}video.localPath=picked.path;video.playbackVerified=false;Store.save(true);Views.loadStage(stage,video,Session.active?.mediaPosition||0);};
        },{once:true});
        const sync = () => {
          if (!node.isConnected || Session.active?.videoId !== video.id) return;
          App.applyMediaState(!node.paused && !node.ended && !node.seeking && node.readyState >= 3);
        };
        for (const name of ['playing','pause','waiting','seeking','seeked','ended','error','emptied']) node.addEventListener(name, sync);
      }
      stage.appendChild(node);
    } else stage.innerHTML = '<div class="stage-empty">视频无法播放</div>';
  },

  syncTimerUI(root) {
    const big = $('#t-big', root), toggle = $('#t-toggle', root), stop = $('#t-stop', root), meta = $('#t-meta', root);
    if (!big) return;
    const comp = $('#t-complete', root);
    if (Session.active) {
      big.textContent = fmtSeconds(Session.active.seconds);
      if (Session.active.awaitingPlay) {
        toggle.textContent = '▶ 播放视频';
        stop.disabled = false;
        meta.innerHTML = '点击视频或「播放视频」开始，计时将跟随实际播放；加载、暂停和缓冲时不计时';
      } else {
        toggle.textContent = Session.active.running ? '⏸ 暂停视频' : '▶ 继续播放';
        const day = Store.dayTraining(todayKey());
        const target = Store.settings().dailyTargetMinutes || 15;
        const autoNote = Session.active.autoPausedBy === 'background'
          ? '<br>🛌 窗口切到后台，已自动暂停计时与视频；回到应用自动继续'
          : Session.active.autoPausedBy === 'media'
            ? '<br>⏸ 检测到视频暂停，计时已同步暂停；视频继续后计时自动恢复'
            : '';
        meta.innerHTML = `本次跟练中 · 今日累计 <b>${Math.round(day.seconds / 60)}</b> / ${target} 分钟${autoNote}<br>目标达成后成就地图会点亮今天 🟩`;
      }
      if (comp) comp.hidden = Session.active.awaitingPlay;
      /* 完播进度条：实时显示距「完整跟练」还差多少 */
      if (comp && !Session.active.awaitingPlay) {
        const video = Session.active.videoId ? Store.videoById(Session.active.videoId) : null;
        if (video && video.durationSec) {
          const { threshold } = followCompletion(Session.active.seconds, video.durationSec);
          const pct = Math.min(100, Math.round(Session.active.seconds / threshold * 100));
          const left = Math.max(0, Math.ceil((threshold - Session.active.seconds) / 60));
          comp.hidden = false;
          const fill = $('#t-complete-fill', root), text = $('#t-complete-text', root);
          if (fill) fill.style.width = pct + '%';
          if (text) text.textContent = pct >= 100 ? '✅ 已达完整跟练门槛' : `完整进度 ${pct}% · 还差 ${left} 分钟`;
        } else comp.hidden = true;
      }
    } else {
      toggle.textContent = '▶ 开始跟练';
      stop.disabled = true;
      meta.textContent = '选择视频后点击「开始跟练」';
      if (comp) comp.hidden = true;
    }
    App.updateMiniBar();
  },

  /* ================= 跟练计划 ================= */
  plan(root) {
    const s = Store.settings();
    root.innerHTML = `
      <div class="view">
        <details class="pl-quick-fold" id="pl-quick-fold">
          <summary class="pl-quick-fold-btn">⚡ 快捷导入</summary>
          <div class="pl-quick-fold-panel">
            <p class="pl-quick-fold-lead">一行一条。有 B 站链接或 BV 号会自动绑到该条；不写时间默认 21:30，不写星期默认每天。</p>
            <textarea class="textarea" id="pl-quick" rows="4" aria-label="跟练计划文本"
              placeholder="瘦脸操10分钟 21:30 每天 https://www.bilibili.com/video/BVxxxxxx&#10;晨间面部唤醒3分钟 07:40 工作日 BVxxxxxxxxxx"></textarea>
            <div class="row">
              <button class="btn primary" id="pl-quick-go">解析并导入</button>
            </div>
          </div>
        </details>

        <div class="card">
          <h3>🎯 每日目标与提醒</h3>
          <div class="row" style="align-items:flex-end">
            <div><label class="field">每日瘦脸目标（分钟）</label>
              <input class="input" id="pl-target" type="number" min="1" max="300" value="${s.dailyTargetMinutes}" style="width:120px"></div>
            <div><label class="field">晚间复盘提醒时间</label>
              <input class="input" id="pl-review" type="time" value="${s.eveningReviewTime}" style="width:130px"></div>
            <div><label class="field">记睡眠提醒时间（留空关闭）</label>
              <input class="input" id="pl-sleep-remind" type="time" value="${esc(s.sleepLogReminderTime || '')}" placeholder="12:00" style="width:130px"></div>
            <label class="row" style="gap:7px; padding-bottom:9px">
              <input type="checkbox" id="pl-autopause" ${s.autoPauseOnBlur !== false ? 'checked' : ''}> 切到后台自动暂停跟练（推荐）
            </label>
            <label class="row" style="gap:7px; padding-bottom:9px">
              <input type="checkbox" id="pl-tray" ${s.keepInTray ? 'checked' : ''}> 关闭窗口最小化到托盘（保持提醒）
            </label>
            <button class="btn primary" id="pl-save">保存设置</button>
          </div>
          <hr class="sep">
          <div class="row" style="align-items:flex-end">
            <div><label class="field">每天固定练 · 时间</label>
              <input class="input" id="pl-fixed-time" type="time" value="${(() => { const fx = Store.db.sessions.find(x => x.fixedDaily); return fx ? fx.time : '21:30'; })()}" style="width:130px"></div>
            <div><label class="field">每天固定练 · 时长（分钟）</label>
              <input class="input" id="pl-fixed-min" type="number" min="1" max="300" value="${(() => { const fx = Store.db.sessions.find(x => x.fixedDaily); return fx ? fx.targetMinutes : s.dailyTargetMinutes; })()}" style="width:110px"></div>
            <button class="btn green" id="pl-fixed-apply">⏱️ 应用为每日固定安排</button>
          </div>
          <p class="hint" style="margin-top:8px">模板用法：比如你想「每天都练 20 分钟」——时间填 21:30、时长填 20，点一下按钮，就生成一个每天都进行的固定安排（已存在则原地更新），每日目标也同步成 20 分钟，成就日历按它点亮。其它安排不受影响。</p>
          <p class="hint" style="margin-top:6px">提醒方式：到点后系统通知 + 应用内确认弹窗，点击即可进入沉浸式跟练。保持应用在托盘运行即可收到提醒。</p>
        </div>

        <div class="card">
          <h3>🗓️ 每日训练安排 <span class="h-extra">点视频小窗直接开始跟练</span>
            <button class="btn small primary" id="pl-add" style="margin-left:auto">＋ 新增安排</button></h3>
          <div id="pl-sessions"></div>
        </div>

        <div class="card">
          <h3>🔔 提醒中枢 <span class="h-extra">今天会响哪几次，一眼看全</span>
            <label class="row" style="gap:6px; margin-left:auto; font-size:12.5px; color:#4c5b70">
              <input type="checkbox" id="pl-dark" ${document.documentElement.classList.contains('dark') ? 'checked' : ''}> 🌙 夜间模式</label></h3>
        <div id="pl-hub" style="display:grid; gap:8px">
          ${(() => {
            const ss = Store.db.sessions.filter(x => x.enabled);
            const st2 = Store.settings();
            const st3 = Store.settings().skincareTimes || {};
            const rows = [];
            rows.push(`<div class="st-history-row"><div class="t-name"><b>⏰ 训练会话提醒</b><span>${ss.length ? ss.map(x => `${x.name} ${x.time}`).join(' · ') : '未设置训练安排'}</span></div><span class="tag">每日</span></div>`);
            rows.push(`<div class="st-history-row"><div class="t-name"><b>🧴 护肤三时段</b><span>晨间 ${st3.morning || '09:00'} · 日间 ${st3.noon || '12:00'} · 晚间 ${st3.evening || '20:00'}（该时段有步骤且未完成才提醒）</span></div><span class="tag">每日</span></div>`);
            rows.push(`<div class="st-history-row"><div class="t-name"><b>📝 皮肤状态记录</b><span>${st2.skinLogReminderTime ? `每晚 ${st2.skinLogReminderTime}（当天已记录则不打扰）` : '已关闭——可在护肤页重新开启'}</span></div><button class="btn small ghost" id="hub-skin" data-no-icon="true">去护肤页调整</button></div>`);
            rows.push(`<div class="st-history-row"><div class="t-name"><b>😴 睡眠记录提醒</b><span>${st2.sleepLogReminderTime ? `每天 ${st2.sleepLogReminderTime}（昨晚已记则不打扰）` : '已关闭'} · 在「设置 → 提醒」里调时间</span></div><span class="tag">每日</span></div>`);
            return rows.join('');
          })()}
        </div>
        </div>
      </div>`;

    // 快捷导入：收起是芯片，展开后才露出表单；打开时把焦点放进输入框
    const fold = $('#pl-quick-fold', root);
    const quick = $('#pl-quick', root);
    if (fold && quick) {
      fold.addEventListener('toggle', () => { if (fold.open) quick.focus(); });
    }
    $('#pl-quick-go', root).onclick = async () => {
      const text = $('#pl-quick', root).value;
      if (!text.trim()) { toast('先粘贴或输入计划内容', 'red'); return; }
      const btn = $('#pl-quick-go', root);
      btn.disabled = true;
      try {
        const r = await PlanImporter.importLines(text, (i, n, msg) => { toast(`(${i}/${n}) ${msg}`); });
        if (!r.sessions && !r.videos) {
          toast(r.skipped ? `没有新增内容：${r.skipped} 个安排已存在，视频也已在库中` : '没有识别到可导入的新内容');
          return;
        }
        $('#pl-quick', root).value = '';
        App.render();
        toast(`导入完成：${r.sessions} 个安排、${r.videos} 个新视频 ✓`, 'green');
      } catch (error) {
        toast(`导入失败：${error.message || error}`, 'red');
      } finally {
        btn.disabled = false;
      }
    };

    $('#pl-save', root).onclick = () => {
      UXCore.changeTarget(Store.db,Math.max(1, Math.min(300, +$('#pl-target', root).value || 15)),todayKey());
      Store.db.settings.eveningReviewTime = $('#pl-review', root).value; // 与记睡眠提醒同口径：留空即关闭
      Store.db.settings.sleepLogReminderTime = $('#pl-sleep-remind', root).value; // 留空即关闭
      Store.db.settings.autoPauseOnBlur = $('#pl-autopause', root).checked;
      Store.db.settings.keepInTray = $('#pl-tray', root).checked;
      Store.save(true);
      App.refreshStatusPill();
      toast('设置已保存 ✓', 'green');
      App.render();
    };

    // 每日固定时长模板：一键生成/更新每天固定时长的安排
    $('#pl-fixed-apply', root).onclick = () => {
      const time = $('#pl-fixed-time', root).value || '21:30';
      const min = Math.max(1, Math.min(300, +$('#pl-fixed-min', root).value || 20));
      let fx = Store.db.sessions.find(x => x.fixedDaily);
      if (fx) {
        fx.time = time; fx.targetMinutes = min;
        fx.days = [0, 1, 2, 3, 4, 5, 6]; fx.enabled = true;
        if (!fx.name) fx.name = '每日瘦脸跟练';
      } else {
        Store.db.sessions.push({
          id: uid('sess'), fixedDaily: true, name: '每日瘦脸跟练',
          time, days: [0, 1, 2, 3, 4, 5, 6], videoId: null,
          targetMinutes: min, enabled: true
        });
      }
      UXCore.changeTarget(Store.db,min,todayKey());
      Store.save(true);
      App.render();
      App.refreshStatusPill();
      toast(`已固定：每天 ${time} 练 ${min} 分钟 ✓`, 'green');
    };
    $('#pl-add', root).onclick = () => Views.sessionModal(null);
    /* 提醒中枢：夜间模式开关＋跳转护肤页 */
    const darkToggle = $('#pl-dark', root);
    if (darkToggle) darkToggle.onchange = () => {
      document.documentElement.classList.toggle('dark', darkToggle.checked);
      Store.db.settings.darkMode = darkToggle.checked;
      Store.save(true);
      toast(darkToggle.checked ? '夜间模式已开启 🌙' : '已切回日间模式 ☀️', 'green');
    };
    const hubSkin = $('#hub-skin', root);
    if (hubSkin) hubSkin.onclick = () => App.go('skincare');

    const box = $('#pl-sessions', root);
    if (!Store.db.sessions.length) box.innerHTML = '<div class="empty">还没有安排：用上方「快捷导入」最快，或点「新增安排」。</div>';
    const WD = ['日', '一', '二', '三', '四', '五', '六'];
    for (const sess of Store.db.sessions.slice().sort((a, b) => (minutesOf(a.time) || 0) - (minutesOf(b.time) || 0))) {
      const v = Store.videoById(sess.videoId);
      const el = document.createElement('div');
      el.className = 'session-item' + (sess.enabled ? '' : ' off');
      el.innerHTML = `
        <div class="t-time" style="width:58px; font-weight:700">${esc(sess.time)}</div>
        ${v
          ? `<img class="s-thumb" src="${v.source === 'bilibili' && v.pic ? esc(v.pic) : ''}" referrerpolicy="no-referrer" title="点击开始跟练：${esc(v.title)}">`
          : `<div class="s-thumb ph" title="点击绑定视频">＋</div>`}
        <div class="t-name" style="flex:1">
          <b>${esc(sess.name)} ${sess.fixedDaily ? '<span class="badge green">每日固定</span>' : ''}</b>
          <span class="hint" style="display:block">${v ? '▶ ' + esc(v.title) : '未绑定视频 · 点左侧＋绑定'} · 目标 ${sess.targetMinutes || 10} 分钟</span>
        </div>
        <div class="wd">${WD.map((w, i) => `<span class="${(sess.days || []).includes(i) ? 'on' : ''}">${w}</span>`).join('')}</div>
        <label class="switch"><input type="checkbox" ${sess.enabled ? 'checked' : ''}><i></i></label>
        <button class="btn small edit">编辑</button>
        <button class="btn small danger del">删除</button>`;
      $('input', el).onchange = (e) => { sess.enabled = e.target.checked; Store.save(true); el.classList.toggle('off', !sess.enabled); };
      // 视频小窗：有视频 → 点击直达跟练；没视频 → 打开选择界面
      const th = $('.s-thumb', el);
      th.onclick = () => v ? App.launchFollow(v.id, sess.id) : App.openPracticeChooser(sess);
      $('.edit', el).onclick = () => Views.sessionModal(sess);
      $('.del', el).onclick = async () => {
        const ok = await confirmModal('删除安排', `确定删除「${sess.name}」吗？`, '删除');
        if (!ok) return;
        Store.db.sessions = Store.db.sessions.filter(x => x.id !== sess.id);
        Store.save(true); App.render();
      };
      box.appendChild(el);
    }
  },

  sessionModal(sess) {
    const s = sess || { id: null, name: '瘦脸操跟练', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], videoId: null, targetMinutes: 15, enabled: true };
    const WD = ['日', '一', '二', '三', '四', '五', '六'];
    const card = openModal(`
      <h3>${sess ? '✏️ 编辑安排' : '＋ 新增安排'}</h3>
      <label class="field">名称</label>
      <input class="input" id="sm-name" value="${esc(s.name)}">
      <div class="row" style="margin-top:8px">
        <div style="flex:1"><label class="field">提醒时间</label><input class="input" id="sm-time" type="time" value="${esc(s.time)}"></div>
        <div style="flex:1"><label class="field">目标时长（分钟）</label><input class="input" id="sm-min" type="number" min="1" max="180" value="${s.targetMinutes || 15}"></div>
      </div>
      <label class="field">重复（每周几天）</label>
      <div class="wd" id="sm-days" style="gap:6px">
        ${WD.map((w, i) => `<span data-d="${i}" class="${(s.days || []).includes(i) ? 'on' : ''}" style="cursor:pointer; width:34px; height:30px; font-size:13px">${w}</span>`).join('')}
      </div>
      <label class="field">跟练视频（与该安排绑定，到点提醒直达）</label>
      <div class="row">
        <select class="select" id="sm-video" style="flex:1">
          <option value="">（不绑定，跟练时自选）</option>
          ${Store.db.videos.map(v => `<option value="${v.id}" ${s.videoId === v.id ? 'selected' : ''}>${esc(v.title)}</option>`).join('')}
        </select>
        <div class="sm-preview" id="sm-preview"></div>
      </div>
      <div class="row" style="justify-content:flex-end; margin-top:18px">
        <button class="btn ghost" id="sm-cancel">取消</button>
        <button class="btn primary" id="sm-ok">保存</button>
      </div>`);
    card.dataset.draftObject=s.id||'new-session';
    const renderPreview = () => {
      const vid = $('#sm-video', card).value;
      const v = Store.videoById(vid);
      const pv = $('#sm-preview', card);
      pv.innerHTML = v
        ? `<img src="${v.source === 'bilibili' && v.pic ? esc(v.pic) : ''}" referrerpolicy="no-referrer"><span>✓ 已绑定</span>`
        : `<div class="ph-txt">未绑定</div>`;
      pv.classList.toggle('bound', !!v);
      const image=$('img',pv);if(image)image.onerror=()=>image.classList.add('ph');
    };
    renderPreview();
    $('#sm-video', card).onchange = renderPreview;
    const days = new Set(s.days || []);
    $$('#sm-days span', card).forEach(el => {
      el.onclick = () => {
        const d = +el.dataset.d;
        el.classList.toggle('on');
      };
    });
    $('#sm-cancel', card).onclick = closeModal;
    $('#sm-ok', card).onclick = () => {
      const obj = {
        id: s.id || uid('sess'),
        name: $('#sm-name', card).value.trim() || '瘦脸操跟练',
        time: $('#sm-time', card).value || '21:30',
        days: $$('#sm-days .on',card).map(x=>Number(x.dataset.d)).sort(),
        videoId: $('#sm-video', card).value || null,
        targetMinutes: Math.max(1, +$('#sm-min', card).value || 15),
        enabled: s.enabled !== false, // 编辑已停用的安排不得悄悄复活提醒
        ...(s.fixedDaily ? { fixedDaily: true } : {})
      };
      if (!obj.days.length) { toast('至少选择一周中的一天', 'red'); return; }
      if (s.id) {
        const i = Store.db.sessions.findIndex(x => x.id === s.id);
        if (i >= 0) Store.db.sessions[i] = obj;
      } else Store.db.sessions.push(obj);
      Store.save(true); closeModal(); App.render(); toast('已保存 ✓，到点会自动提醒', 'green');
    };
  },

  /* 修改/删除一条跟练记录：时长记错（比如切后台多记了）在这里弥补。
     保存时按视频时长重算完播标记；删除有确认。 */
  editTrainingEntryModal(dateKey, entryId) {
    const day = Store.dayTraining(dateKey);
    const en = (day.entries || []).find(e => e.id === entryId);
    if (!en) { toast('记录不存在', 'red'); return; }
    const video = Store.videoById(en.videoId);
    const name = en.note || (en.manual ? '手动记录' : video ? video.title : '跟练记录');
    const card = openModal(`
      <h3>✏️ 修改跟练记录</h3>
      <p class="hint">${esc(dateKey)} · ${esc(name)}${en.completed ? ' · ✅ 完整' : ''}</p>
      <div class="row" style="margin-top:10px">
        <label class="field" style="flex:1">时长（分钟）<input class="input" id="te-min" type="number" min="0" max="600" step="0.1" inputmode="decimal" value="${Math.round((en.seconds || 0) / 6) / 10}"></label>
        <label class="field" style="flex:1">开始<input class="input" id="te-start" type="time" value="${esc(en.start || '')}"></label>
        <label class="field" style="flex:1">结束<input class="input" id="te-end" type="time" value="${esc(en.end || '')}"></label>
      </div>
      <p class="hint" style="margin-top:8px">${video && video.durationSec ? `该视频完整门槛：${Math.round(followCompletion(0, video.durationSec).threshold / 60 * 10) / 10} 分钟（80% 时长）。` : '该视频无时长数据，完整门槛 3 分钟。'}</p>
      <div class="row" style="justify-content:space-between; margin-top:14px">
        <button class="btn danger" id="te-del">删除这条记录</button>
        <span style="flex:1"></span>
        <button class="btn ghost" id="te-cancel">取消</button>
        <button class="btn primary" id="te-save">保存修改</button>
      </div>`);
    $('#te-cancel', card).onclick = closeModal;
    $('#te-del', card).onclick = async () => {
      if (!await confirmModal('删除这条跟练记录？', `${esc(name)} · ${Math.round((en.seconds || 0) / 6) / 10} 分钟将被移除，当日累计同步扣减。`, '删除')) return;
      Store.removeTrainingEntry(dateKey, entryId);
      Store.save(true);
      closeModal();
      toast('已删除该条记录');
      App.render();
    };
    $('#te-save', card).onclick = () => {
      const min = Number($('#te-min', card).value);
      if (!Number.isFinite(min) || min < 0 || min > 600) { toast('时长需在 0–600 分钟之间', 'red'); return; }
      const seconds = Math.round(min * 60);
      const { completed } = followCompletion(seconds, video ? video.durationSec : null);
      Store.updateTrainingEntry(dateKey, entryId, {
        seconds,
        completed,
        start: $('#te-start', card).value || en.start || '',
        end: $('#te-end', card).value || en.end || ''
      });
      Store.save(true);
      closeModal();
      toast(`已修改：${min} 分钟${completed ? '（✅ 计完整）' : '（不足完整门槛，不计完整）'}`, 'green');
      App.render();
    };
  },

  /* ================= 成就 ================= */
  /* 徽章全集（key 固定，用于解锁检测去重）。data 可由任意时点调用计算。 */
  /* 等级化成就体系：可累计指标 → 系列 × 档位（Lv）。value 由既有统计派生，无需新存储。 */
  badgeSeries() {
    const st = Store.stats();
    const follow = Store.followTotals();
    const t = Store.db.logs.training;
    let maxDayMin = 0;
    for (const d of Object.keys(t)) maxDayMin = Math.max(maxDayMin, Math.round((t[d].seconds || 0) / 60));
    return [
      { key: 'follow', group: 'follow', ico: '🎬', name: '完整跟练', desc: '有效计时 ≥ 视频时长 80% 才计入（点开不算）',
        unit: '次', value: follow.completed,
        tiers: [
          { lv: 1, need: 1, name: '首映礼' },
          { lv: 2, need: 10, name: '完整十练' },
          { lv: 3, need: 30, name: '完整三十练' },
          { lv: 4, need: 100, name: '完整百练传奇' }
        ] },
      { key: 'hours', group: 'follow', ico: '⏱️', name: '累计训练时长', desc: '所有训练时长的积累',
        unit: '小时', value: Math.floor(st.totalSec / 3600),
        tiers: [
          { lv: 1, need: 1, name: '第一小时' },
          { lv: 2, need: 10, name: '十小时战士' },
          { lv: 3, need: 50, name: '五十小时传奇' }
        ] },
      { key: 'streak', group: 'follow', ico: '🔥', name: '连续达标', desc: '每日目标达标的连续天数（历史最长）',
        unit: '天', value: st.bestStreak,
        tiers: [
          { lv: 1, need: 3, name: '三日之约' },
          { lv: 2, need: 7, name: '七日焕颜' },
          { lv: 3, need: 14, name: '半月坚持' },
          { lv: 4, need: 30, name: '月度重塑' }
        ] },
      { key: 'skincare', group: 'skin', ico: '🧴', name: '晚间护肤连击', desc: '晚间护肤连续打卡天数',
        unit: '天', value: st.skStreak,
        tiers: [
          { lv: 1, need: 7, name: '护肤七连' },
          { lv: 2, need: 21, name: '廿一养成' },
          { lv: 3, need: 66, name: '六十六习惯' }
        ] },
      { key: 'day30', group: 'follow', ico: '✨', name: '单日冲量', desc: '单日跟练练满 30 分钟',
        unit: '分钟', value: maxDayMin,
        tiers: [ { lv: 1, need: 30, name: '超额完成' } ] },
      { key: 'first', group: 'follow', ico: '🌱', name: '初次打卡', desc: '完成第一次训练',
        unit: '次', value: st.totalSec > 0 ? 1 : 0,
        tiers: [ { lv: 1, need: 1, name: '初次打卡' } ] }
    ].concat(typeof AchievementCatalog !== 'undefined' ? AchievementCatalog.series(Store) : []);
  },

  /* 单一系列的等级解析：当前等级（满足的最高档）、下一级与进度 */
  seriesProgress(s) {
    let lv = 0, curName = '';
    for (const t of s.tiers) if (s.value >= t.need) { lv = t.lv; curName = t.name; }
    const next = s.tiers.find(t => t.need > s.value) || null;
    const pct = next ? Math.min(100, Math.round(s.value / next.need * 100)) : 100;
    return { lv, curName, next, pct };
  },

  /* 成就解锁即时庆祝：档位 key（系列_lv）与已见标记对比；silent=true 只登记不通知（启动迁移用） */
  checkBadgeUnlocks(opts) {
    const silent = !!(opts && opts.silent);
    const series = this.badgeSeries();
    const seen = Store.db.achievementsSeen || {};
    const fresh = [];
    for (const s of series) {
      for (const t of s.tiers) {
        const key = `${s.key}_lv${t.lv}`;
        if (s.value >= t.need && !seen[key]) {
          seen[key] = true;
          if (!silent) fresh.push(`Lv.${t.lv} ${t.name}（${s.name}）`);
        }
      }
    }
    Store.db.achievementsSeen = seen;
    if (!fresh.length || silent) { Store.save(); return; }
    const last = fresh[fresh.length - 1];
    if (typeof native !== 'undefined' && native.notify) native.notify(`🏅 解锁新成就：${last}`, fresh.length > 1 ? `一次解锁 ${fresh.length} 项！打开成就地图看看。` : '新的里程碑达成');
    toast(`🏅 解锁新成就：${last}${fresh.length > 1 ? ` 等 ${fresh.length} 项` : ''}`, 'green');
  },

  achievements(root) {
    const st = Store.stats();
    const follow = Store.followTotals();
    const series = this.badgeSeries().map(s => Object.assign({ prog: this.seriesProgress(s) }, s));
    const totalLv = series.reduce((n, s) => n + s.tiers.length, 0);
    const gotLv = series.reduce((n, s) => n + s.prog.lv, 0);
    const cardOf = (s) => {
      const maxed = !s.prog.next;
      const curTier = s.prog.lv > 0 ? s.tiers[s.prog.lv - 1] : null;
      return `
        <div class="ab-card ${s.prog.lv > 0 ? 'on' : ''}">
          ${s.iconSrc ? `<div class="ab-card-ico"><img class="ab-card-image" src="assets/${esc(s.iconSrc)}" alt="" draggable="false"></div>` : s.ico ? `<div class="ab-card-ico">${s.ico}</div>` : ''}
          <div class="ab-card-name">${esc(s.name)}</div>
          <div class="ab-card-lv">${s.prog.lv > 0 ? `Lv.${s.prog.lv}` : '未起步'}${s.prog.curName ? ` · ${esc(s.prog.curName)}` : ''}</div>
          <div class="ab-card-tiers">
            ${s.tiers.map((t2) => {
              const got = s.value >= t2.need;
              const isCur = curTier && curTier.lv === t2.lv;
              return `<div class="ab-tier-cell ${got ? 'got' : ''} ${isCur ? 'cur' : ''}">
                <b>Lv.${t2.lv}</b>
                <span>${esc(t2.name)}</span>
                <small>累计 ${t2.need} ${s.unit}${got ? ' · ✓' : ''}</small>
              </div>`;
            }).join('')}
          </div>
          <div class="ab-card-progress">
            <div class="ab-progress-track"><i style="width:${s.prog.pct}%"></i></div>
            <span class="hint">${maxed
              ? `已满级 · 当前 ${s.value} ${s.unit}`
              : `还差 ${s.prog.next.need - s.value} ${s.unit} 升 Lv.${s.prog.next.lv}`}</span>
          </div>
          <div class="ab-card-desc hint" title="${esc(s.desc)}">${esc(s.desc)}</div>
        </div>`;
    };
    const groups = [['follow', '跟练与达标'], ['strength', '力量训练'], ['rhythm', '饮食与睡眠'], ['skin', '护肤']];
    const grouped = groups.map(([id, title]) => {
      const items = series.filter((s) => (s.group || 'follow') === id);
      if (!items.length) return '';
      return `<h3 style="margin:16px 0 0">${title} <span class="h-extra">${items.length} 个系列</span></h3><div class="ab-grid">${items.map(cardOf).join('')}</div>`;
    }).join('');

    root.innerHTML = `
      <div class="view">
        <div class="stat-grid" style="grid-template-columns:repeat(3, 1fr)">
          <div class="stat-box ac-stat">${Icon3D.makeIcon('clock').outerHTML}<div><b style="color:var(--accent)">${fmtDuration(st.totalSec)}</b><span>累计训练</span></div></div>
          <div class="stat-box ac-stat">${Icon3D.makeIcon('target').outerHTML}<div><b style="color:var(--green)">${st.metDays}</b><span>达标天数</span></div></div>
          <div class="stat-box ac-stat">${Icon3D.makeIcon('fire').outerHTML}<div><b style="color:var(--amber)">${st.streak}</b><span>连续达标（天）</span></div></div>
          <div class="stat-box ac-stat">${Icon3D.makeIcon('star').outerHTML}<div><b>${st.bestStreak}</b><span>历史最长连续</span></div></div>
          <div class="stat-box ac-stat">${Icon3D.makeIcon('video').outerHTML}<div><b style="color:#7b74e2">${follow.completed}</b><span>完整跟练（次）</span></div></div>
          <div class="stat-box ac-stat">${Icon3D.makeIcon('medal').outerHTML}<div><b style="color:#7b74e2">${gotLv}</b><span>成就等级（共 ${totalLv} 级）</span></div></div>
        </div>

        <div class="card ac-calendar" id="achievement-calendar"></div>

        <div class="card">
          <h3>🏅 成就等级 <span class="h-extra">系列随累计次数升等级 · 已达成 ${gotLv} / ${totalLv} 级</span></h3>
          ${grouped}
          <p class="hint" style="margin:10px 0 0">「完整跟练」按有效计时 ≥ 视频时长 80% 判定（点开不算）；等级只增不减，「连续达标」取历史最长连续。数字都从已有记录里算。</p>
        </div>
      </div>`;

    AchievementCalendar.render($('#achievement-calendar', root));
  }
};
