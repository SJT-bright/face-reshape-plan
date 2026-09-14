/* 各页面视图：今日 / 跟练 / 视频库 / 训练计划 / 成就 */

const Views = {
  titles: { nutrition: '饮食与睡眠', today: '今日', follow: '沉浸式跟练', plan: '训练计划', strength: '力量训练', skincare: '护肤', achievements: '成就地图' },

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

        <!-- 今天能练的课 -->
        <div class="card">
          <h3>🎬 今天可以练 <span class="h-extra">${sessions.length} 个安排 · 去点时间在「训练计划」里调</span></h3>
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
    if (!sessions.length) {
      courses.innerHTML = `<div class="empty">今天还没有安排课程。<br><button class="btn small primary" id="td-goplan">去训练计划安排一下</button>　或点上方「开练」自由跟练</div>`;
      const g = $('#td-goplan', courses); if (g) g.onclick = () => App.go('plan');
    }
    for (const s of sessions) {
      const v = Store.videoById(s.videoId);
      const m = minutesOf(s.time);
      const isNow = m != null && curMin >= m && curMin <= m + 45;
      const el = document.createElement('div');
      el.className = 'course-card' + (isNow ? ' now' : '');
      el.innerHTML = `
        ${v && v.pic ? `<img class="course-thumb" src="${esc(v.pic)}" referrerpolicy="no-referrer" onerror="this.classList.add('ph')">` : `<div class="course-thumb ph">🎞️</div>`}
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
      card.innerHTML = `
        ${v.source === 'bilibili' && v.pic ? `<img class="vid-cover" src="${esc(v.pic)}" referrerpolicy="no-referrer" onerror="this.classList.add('ph')">` : `<div class="vid-cover ph">🎞️</div>`}
        <div class="vid-info">
          <div class="vid-title">${esc(v.title)}</div>
          <div class="vid-meta"><span>${v.source === 'bilibili' ? 'B站' : '本地'}${v.durationSec ? ' · ' + Math.round(v.durationSec / 60) + '分钟' : ''}</span></div>
        </div>
        <button class="vid-del" title="删除该视频">✕</button>`;
      card.onclick = () => App.launchFollow(v.id, null);
      $('.vid-del', card).onclick = async (e) => {
        e.stopPropagation();
        const ok = await confirmModal('删除视频', `确定从视频库删除「${v.title}」吗？\n训练计划中对该视频的引用会一并清空。`, '删除');
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
      toast('本地视频已导入 ✓', 'green');
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
    root.innerHTML = `
      <div class="view" style="max-width:1200px">
        <div id="stage-wrap">
          <div class="follow-stage" id="stage"></div>
          <div class="timer-hud" id="hud">
            <div class="timer-big" id="t-big">00:00</div>
            <div class="timer-meta" id="t-meta">选择视频后点击「开始跟练」</div>
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
          <p class="hint" style="margin-top:8px">暂停按钮只暂停计时；B站视频请在播放器内自行暂停。结束后时长自动计入今日目标与成就地图。</p>
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
      toast('播放器已载入，点击「开始跟练」计时');
    };
    $('#t-toggle', root).onclick = () => {
      if (Session.active) { Session.togglePause(); }
      else {
        const id = sel.value || App.followVideoId;
        if (!id) { toast('请先选择并载入跟练视频', 'red'); return; }
        Session.start(id, null);
        if (!$('#stage', root).firstChild) Views.loadStage($('#stage', root), Store.videoById(id));
      }
      Views.syncTimerUI(root);
    };
    $('#t-stop', root).onclick = async () => {
      const sec = Session.stop();
      Views.syncTimerUI(root);
      if (sec != null) {
        App.refreshStatusPill();
        const met = Store.dayTargetMet(todayKey());
        if (met) await confirmModal('🎉 今日目标达成！', `本次跟练 ${fmtDuration(sec)}，今日累计已达标！成就地图已点亮今天的绿色格子。`, '太棒了');
        else toast(`本次跟练 ${fmtDuration(sec)}，继续加油～`, 'green');
      }
    };
    $('#t-imm', root).onclick = () => {
      const wrap = $('#stage-wrap', root);
      if (document.fullscreenElement) document.exitFullscreen();
      else wrap.requestFullscreen && wrap.requestFullscreen();
    };

    // 恢复现场：若有进行中的会话，载入其视频
    const stage = $('#stage', root);
    if (Session.active) {
      if (Session.active.videoId) Views.loadStage(stage, Store.videoById(Session.active.videoId));
      else if (App.followVideoId) Views.loadStage(stage, Store.videoById(App.followVideoId));
    } else if (App.followVideoId && Store.videoById(App.followVideoId)) {
      Views.loadStage(stage, Store.videoById(App.followVideoId));
    }
    Views.syncTimerUI(root);
  },

  loadStage(stage, video) {
    stage.innerHTML = '';
    if (!video) {
      stage.innerHTML = `<div class="stage-empty"><div style="font-size:44px">🎬</div>
        <div>还没有载入视频</div><div class="hint">从下方选择，或去视频库导入 B 站瘦脸操课程</div></div>`;
      return;
    }
    const node = Bilibili.playerNode(video);
    if (node) stage.appendChild(node);
    else stage.innerHTML = '<div class="stage-empty">视频无法播放</div>';
  },

  syncTimerUI(root) {
    const big = $('#t-big', root), toggle = $('#t-toggle', root), stop = $('#t-stop', root), meta = $('#t-meta', root);
    if (!big) return;
    if (Session.active) {
      big.textContent = fmtSeconds(Session.active.seconds);
      toggle.textContent = Session.active.running ? '⏸ 暂停计时' : '▶ 继续计时';
      stop.disabled = false;
      const day = Store.dayTraining(todayKey());
      const target = Store.settings().dailyTargetMinutes || 15;
      meta.innerHTML = `本次跟练中 · 今日累计 <b>${Math.round(day.seconds / 60)}</b> / ${target} 分钟<br>目标达成后成就地图会点亮今天 🟩`;
    } else {
      toggle.textContent = '▶ 开始跟练';
      stop.disabled = true;
      meta.textContent = '选择视频后点击「开始跟练」';
    }
    App.updateMiniBar();
  },

  /* ================= 训练计划 ================= */
  plan(root) {
    const s = Store.settings();
    root.innerHTML = `
      <div class="view">
        <div class="card">
          <h3>⚡ 快捷导入训练计划 <span class="h-extra">一行一个安排，自动识别时间/时长/星期/视频</span></h3>
          <textarea class="textarea" id="pl-quick" style="min-height:96px"
            placeholder="瘦脸操10分钟 21:30 每天 https://www.bilibili.com/video/BVxxxxxx&#10;晨间面部唤醒3分钟 07:40 工作日 BVxxxxxxxxxx&#10;靠墙站立15分钟 周一/周四 21:00&#10;体态操20分钟 周六 15:00"></textarea>
          <div class="row" style="margin-top:10px">
            <button class="btn primary" id="pl-quick-go">📥 解析并导入</button>
            <span class="hint">写上B站链接或BV号会自动抓取视频并绑定到该安排；不写时间默认 21:30，不写星期默认每天。适合瘦脸操 / 面部瑜伽 / 体态操 / 靠墙站立等外观训练。</span>
          </div>
        </div>

        <div class="card">
          <h3>🎯 每日目标与提醒</h3>
          <div class="row" style="align-items:flex-end">
            <div><label class="field">每日瘦脸目标（分钟）</label>
              <input class="input" id="pl-target" type="number" min="1" max="300" value="${s.dailyTargetMinutes}" style="width:120px"></div>
            <div><label class="field">晚间复盘提醒时间</label>
              <input class="input" id="pl-review" type="time" value="${s.eveningReviewTime}" style="width:130px"></div>
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
      </div>`;

    // 快捷导入
    $('#pl-quick-go', root).onclick = async () => {
      const text = $('#pl-quick', root).value;
      if (!text.trim()) { toast('先粘贴或输入计划内容', 'red'); return; }
      const btn = $('#pl-quick-go', root);
      btn.disabled = true;
      const r = await PlanImporter.importLines(text, (i, n, msg) => { toast(`(${i}/${n}) ${msg}`); });
      btn.disabled = false;
      $('#pl-quick', root).value = '';
      App.render();
      toast(`导入完成：${r.sessions} 个安排、${r.videos} 个新视频 ✓`, 'green');
    };

    $('#pl-save', root).onclick = () => {
      Store.db.settings.dailyTargetMinutes = Math.max(1, Math.min(300, +$('#pl-target', root).value || 15));
      Store.db.settings.eveningReviewTime = $('#pl-review', root).value || '22:00';
      Store.db.settings.keepInTray = $('#pl-tray', root).checked;
      Store.save(true);
      App.refreshStatusPill();
      toast('设置已保存 ✓', 'green');
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
      Store.db.settings.dailyTargetMinutes = min;
      Store.save(true);
      App.render();
      App.refreshStatusPill();
      toast(`已固定：每天 ${time} 练 ${min} 分钟 ✓`, 'green');
    };
    $('#pl-add', root).onclick = () => Views.sessionModal(null);

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
          ? `<img class="s-thumb" src="${v.source === 'bilibili' && v.pic ? esc(v.pic) : ''}" referrerpolicy="no-referrer" onerror="this.classList.add('ph')" title="点击开始跟练：${esc(v.title)}">`
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
    const renderPreview = () => {
      const vid = $('#sm-video', card).value;
      const v = Store.videoById(vid);
      const pv = $('#sm-preview', card);
      pv.innerHTML = v
        ? `<img src="${v.source === 'bilibili' && v.pic ? esc(v.pic) : ''}" referrerpolicy="no-referrer" onerror="this.classList.add('ph')"><span>✓ 已绑定</span>`
        : `<div class="ph-txt">未绑定</div>`;
      pv.classList.toggle('bound', !!v);
    };
    renderPreview();
    $('#sm-video', card).onchange = renderPreview;
    const days = new Set(s.days || []);
    $$('#sm-days span', card).forEach(el => {
      el.onclick = () => {
        const d = +el.dataset.d;
        if (days.has(d)) days.delete(d); else days.add(d);
        el.classList.toggle('on', days.has(d));
      };
    });
    $('#sm-cancel', card).onclick = closeModal;
    $('#sm-ok', card).onclick = () => {
      const obj = {
        id: s.id || uid('sess'),
        name: $('#sm-name', card).value.trim() || '瘦脸操跟练',
        time: $('#sm-time', card).value || '21:30',
        days: Array.from(days).sort(),
        videoId: $('#sm-video', card).value || null,
        targetMinutes: Math.max(1, +$('#sm-min', card).value || 15),
        enabled: true,
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

  /* ================= 成就 ================= */
  achievements(root) {
    const st = Store.stats();
    const t = Store.db.logs.training;
    let maxDay = 0;
    for (const d of Object.keys(t)) maxDay = Math.max(maxDay, t[d].seconds || 0);

    const BADGES = [
      { ico: '🌱', name: '初次打卡', cond: '完成第一次训练', got: st.totalSec > 0 },
      { ico: '🔥', name: '三日之约', cond: '连续 3 天达标', got: st.bestStreak >= 3 },
      { ico: '⚡', name: '七日焕颜', cond: '连续 7 天达标', got: st.bestStreak >= 7 },
      { ico: '🗓️', name: '半月坚持', cond: '连续 14 天达标', got: st.bestStreak >= 14 },
      { ico: '🌟', name: '月度重塑', cond: '连续 30 天达标', got: st.bestStreak >= 30 },
      { ico: '⏱️', name: '第一小时', cond: '累计训练 1 小时', got: st.totalSec >= 3600 },
      { ico: '🚀', name: '十小时战士', cond: '累计训练 10 小时', got: st.totalSec >= 36000 },
      { ico: '👑', name: '五十小时传奇', cond: '累计训练 50 小时', got: st.totalSec >= 180000 },
      { ico: '✨', name: '超额完成', cond: '单日练满 30 分钟', got: maxDay >= 1800 },
      { ico: '🧴', name: '护肤七连', cond: '晚间护肤连续打卡 7 天', got: st.skStreak >= 7 }
    ];

    root.innerHTML = `
      <div class="view">
        <div class="stat-grid">
          <div class="stat-box"><b style="color:var(--accent)">${fmtDuration(st.totalSec)}</b><span>累计训练</span></div>
          <div class="stat-box"><b style="color:var(--green)">${st.metDays}</b><span>达标天数</span></div>
          <div class="stat-box"><b style="color:var(--amber)">${st.streak}</b><span>连续达标（天）</span></div>
          <div class="stat-box"><b>${st.bestStreak}</b><span>历史最长连续</span></div>
        </div>

        <div class="card ac-calendar" id="achievement-calendar"></div>

        <div class="card">
          <h3>🏅 成就徽章 <span class="h-extra">${BADGES.filter(b => b.got).length} / ${BADGES.length} 已解锁</span></h3>
          <div class="badge-row">
            ${BADGES.map(b => `
              <div class="ach ${b.got ? 'got' : ''}" title="${esc(b.cond)}">
                <div class="ach-ico">${b.ico}</div>
                <div class="ach-name">${esc(b.name)}</div>
                <div class="ach-cond">${esc(b.cond)}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>`;

    AchievementCalendar.render($('#achievement-calendar', root));
  }
};
