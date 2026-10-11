/* 应用入口：路由 / 全局跟练计时器 / 提醒联动 / 时钟 */

const Session = {
  active: null, // { entryId, dateKey, startedAt, seconds, running, awaitingPlay, videoId, sessionId }
  _saveCounter: 0,

  /* awaitPlay=true：等待真实视频播放状态，本地事件与主进程子框架探测共用。 */
  start(videoId, sessionId, opts) {
    if (!videoId) { toast('请先选择跟练视频', 'red'); return false; }
    const mode = Store.videoMode(Store.videoById(videoId));
    if (this.active && this.active.videoId !== videoId) this.stop();
    if (this.active) {
      if (sessionId) this.active.sessionId = sessionId;
      return true;
    }
    const awaitPlay = !!(opts && opts.awaitPlay);
    const entryId = uid('en');
    this.active = {
      entryId, dateKey: todayKey(), startedAt: Date.now(),
      seconds: 0, running: !awaitPlay, awaitingPlay: awaitPlay, videoId, mode, sessionId: mode === 'face' ? sessionId || null : null,
      autoPausedBy: null,  // 自动暂停来源：'background'（切后台）| 'media'（视频暂停）| null
      interruptions: 0     // 打断次数（手动暂停/视频暂停/切后台），仅后台记录与成就展示，跟练/今日界面零显示
    };
    Store.addWatchingEntry(todayKey(), {
      id: entryId, videoId, collectionId: mode, sessionId: mode === 'face' ? sessionId || null : null,
      start: hhmm(), seconds: 0, manual: false, interruptions: 0, source:'media-observed'
    }, mode);
    return true;
  },

  /* 等待态 → 真正开始计时（仅由实际播放状态触发） */
  beginCounting() {
    const a = this.active;
    if (!a || !a.awaitingPlay) return false;
    a.awaitingPlay = false;
    a.running = true;
    toast('检测到视频播放，计时开始 ✓', 'green');
    return true;
  },

  togglePause() {
    if (!this.active) return;
    if (this.active.running) this.active.interruptions = (this.active.interruptions || 0) + 1; // 暂停计打断，恢复不计
    this.active.running = !this.active.running;
    /* 手动暂停/继续是最高优先级：清掉自动暂停标记，之后回到前台/视频恢复都不得自动续表 */
    this.active.autoPausedBy = null;
    this._persist();
  },

  /* 自动暂停（切后台/视频暂停）：只作用于正在走计时的会话；手动暂停过的不受影响 */
  autoPause(reason) {
    const a = this.active;
    if (!a || !a.running || a.awaitingPlay) return false;
    a.running = false;
    a.autoPausedBy = reason || 'media';
    if (reason === 'user') a.interruptions = (a.interruptions || 0) + 1;
    else a.technicalPauses = (a.technicalPauses || 0) + 1;
    this._persist();
    return true;
  },

  /* 自动恢复：只恢复「由自动暂停」停下的计时，且视频需确实在播（background 恢复时由调用方先确认或先播媒体） */
  autoResume() {
    const a = this.active;
    if (!a || a.running || a.awaitingPlay || !a.autoPausedBy) return false;
    a.running = true;
    a.autoPausedBy = null;
    this._persist();
    return true;
  },

  stop() {
    if (!this.active) return null;
    const a = this.active;
    this.active = null; Store.db.activeFollow = null;
    /* 等待态没计时就结束：移除 0 秒占位条目，不污染记录与视频统计 */
    if (a.awaitingPlay && (a.seconds || 0) === 0) {
      Store.removeWatchingEntry(a.dateKey, a.entryId, a.mode || Store.videoMode(Store.videoById(a.videoId)));
      Store.save(true);
      return null;
    }
    /* 完播判定：有效计时 ≥ 80% 视频时长（且 ≥120s；无时长按 3 分钟）才计入完整跟练次数 */
    const video = a.videoId ? Store.videoById(a.videoId) : null;
    const { completed } = followCompletion(a.seconds, video ? video.durationSec : null);
    const mode = a.mode || Store.videoMode(video);
    Store.updateWatchingEntry(a.dateKey, a.entryId, { seconds: a.seconds, end: hhmm(), completed }, mode);
    Store.save(true);
    if (completed && mode === 'face') Views.checkBadgeUnlocks(); // 自定义板块不计入瘦脸成就
    return a.seconds;
  },

  tick() {
    if (!this.active) return;
    if (this.active.running) {
      this.active.seconds++;
      this._saveCounter++;
      if (this._saveCounter % 30 === 0) this._persist(); // 每 30 秒落盘，防崩溃丢数据
      Views.syncTimerUI($('#view-root'));
      this._warnIfSuspicious();
    }
  },

  /* 防呆：跟练计时是最容易「忘了停」的地方。
     ① 单次会话每满 30 分钟推一条系统通知；
     ② 窗口失焦（切后台/最小化）超过 2 分钟后，每 5 分钟提醒一次——
        视频在应用内播放，切走基本等于没在练，但不停表（避免误伤），只提醒+事后可改。 */
  _warnIfSuspicious() {
    if (typeof native === 'undefined' || !native.notify) return;
    const a = this.active;
    const min = Math.floor(a.seconds / 60);
    const watching = (a.mode || Store.videoMode(Store.videoById(a.videoId))) !== 'face';
    if (a.seconds % 1800 === 0 && min > 0) {
      native.notify(watching ? '⏱ 视频观看进行中' : '⏱ 跟练计时进行中', watching ? `已观看 ${min} 分钟。看完后请点「结束并记录」。` : `已计时 ${min} 分钟。练完后请点「结束并记录」；时长可在成就日历中修改。`);
      return;
    }
    if (App.hiddenSince && Date.now() - App.hiddenSince >= 120000 && a.seconds > 0 && a.seconds % 300 === 0) {
      native.notify('⏱ 不在前台，计时仍在进行', watching ? '如果已看完，请回到应用点「结束并记录」。' : '如果已练完，请回到应用点「结束并记录」。时长可在成就日历中修改。');
    }
  },

  _persist() {
    const a = this.active;
    Store.db.activeFollow = a ? {...a,running:false} : null;
    if (a) Store.updateWatchingEntry(a.dateKey, a.entryId, { seconds: a.seconds, interruptions: a.interruptions || 0, technicalPauses: a.technicalPauses || 0, source:'media-observed' }, a.mode || Store.videoMode(Store.videoById(a.videoId)));
  }
};

const App = {
  currentView: 'today',
  followVideoId: null,

  async boot() {
    await Store.init();
    Strength.boot();
    /* 夜间模式：按上次选择恢复 */
    document.documentElement.classList.toggle('dark', !!Store.db.settings.darkMode);
    /* 启动时把已解锁徽章登记为「已见」，之后新解锁才会触发庆祝 */
    try { Views.checkBadgeUnlocks(); } catch {}
    if (window.native.isMac) document.body.classList.add('is-mac');

    // 导航
    $$('.nav-item').forEach(btn => {
      btn.onclick = () => this.go(btn.dataset.view);
    });

    // 主进程通知点击 → 确认弹窗 → 开始跟练
    window.native.onReminderActivate(({ sessionId }) => sessionId ? this.onReminded(sessionId) : UX.reminders());

    // 跟练计时。力量训练不走秒。
    setInterval(() => Session.tick(), 1000);

    // 侧栏不显示时钟；日期读取、跟练计时及主进程定时提醒照常运行。
    // 状态胶囊每 30 秒刷新
    setInterval(() => {
      this.refreshStatusPill();
      this.updateMiniBar();
      /* 跨午夜自动重渲今日页：简报/日期/预测不残留昨天（有弹窗或进行中会话时跳过，防打断操作） */
      if (this.currentView === 'today' && !Session.active && todayKey() !== this._renderedDay) {
        const mask = document.querySelector('#modal-mask');
        if (!mask || mask.classList.contains('hidden')) this.render();
      }
    }, 30000);

    // 媒体-计时同步：切后台自动暂停 + 视频暂停/恢复联动（详见 pollMediaSync）
    const onHidden = () => this._onHidden();
    const onVisible = () => this._onVisible();
    // Native window blur is used instead: clicking a cross-origin iframe also blurs window.
    document.addEventListener('visibilitychange', () => { document.hidden ? onHidden() : onVisible(); });
    /* 主进程兜底：最小化/隐藏到托盘不触发 DOM blur/visibility 事件 */
    if (window.native && window.native.onAppVisibility) {
      window.native.onAppVisibility(({ hidden }) => { hidden ? onHidden() : onVisible(); });
    }
    setInterval(() => { this.pollMediaSync(); }, 250);

    // 退出前落盘
    window.addEventListener('beforeunload', () => Store.flushSync());
    /* 失焦追踪：供跟练防呆提醒判断「切后台多久了」 */
    window.addEventListener('blur', () => { this.hiddenSince = Date.now(); });
    window.addEventListener('focus', () => { this.hiddenSince = null; });


    if (Store.currentMode() !== 'face') this.currentView = 'awakening';
    this.render();
    Douyin.prepareLibrary();
  },

  goCollection(id) {
    if (!Store.collectionById(id)) return;
    if (Store.currentMode() !== id) {
      Bilibili.MediaSync.pauseAll();
      Session.autoPause('media');
      Store.setMode(id);
      this.followVideoId = null;
    }
    this.go(id === 'face' ? 'today' : 'awakening');
  },

  go(view) {
    if (this.currentView === 'follow' && view !== 'follow') {
      Bilibili.MediaSync.pauseAll(); Session.autoPause('media');
    }
    if (view === 'today' && Store.currentMode() !== 'face') {
      Bilibili.MediaSync.pauseAll(); Session.autoPause('media');
      Store.setMode('face'); this.followVideoId = null;
    }
    if (view === 'awakening' && Store.currentMode() === 'face') {
      const collection = Store.collections().find(c => c.id !== 'face');
      if (!collection) return;
      Store.setMode(collection.id);
    }
    this.currentView = view;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('#page-title').textContent = view === 'awakening' ? Store.currentCollection().name : view === 'today' ? Store.collectionById('face').name : view === 'follow' && Store.currentMode() !== 'face' ? Store.currentCollection().name + ' · 沉浸观看' : Views.titles[view] || view;
    this.render();
  },

  render() {
    const root = $('#view-root');
    if (!root) return;
    const v = this.currentView;
    /* 动效分级：切栏目播完整入场（虚化揭示+卡片错峰），页内重绘只播轻量刷新，
       避免打卡/保存/翻页每次都整页模糊 0.5 秒 */
    const viewKey = v + ':' + Store.currentMode();
    const viewChanged = this._renderedView !== viewKey;
    this._renderedView = viewKey;
    this._renderedDay = todayKey();
    root.classList.remove('view-enter', 'view-update');
    void root.offsetWidth; // 强制回流，让同类动画也能重播（如 A→B→A 再点回来）
    root.classList.add(viewChanged ? 'view-enter' : 'view-update');
    /* 切栏目先清空：任一视图中途抛错时，绝不能把上一领域的界面留在新栏目里 */
    if (viewChanged) {
      root.replaceChildren();
      root.scrollTop = 0;
    }
    try {
      if (v === 'today') Views.today(root);
      else if (v === 'awakening') Views.awakening(root);
      else if (v === 'follow') Views.follow(root);
      else if (v === 'settings') UX.settings(root);
      else if (v === 'membership') Membership.view(root);
      else if (v === 'plan') Views.plan(root);
      else if (v === 'strength') Strength.view(root);
      else if (v === 'skincare') Skincare.view(root);
      else if (v === 'nutrition') Rhythm.view(root);
      else if (v === 'achievements') Views.achievements(root);
    } catch (err) {
      console.error('[render]', v, err);
      root.innerHTML = `<div class="view"><div class="card"><h3>这一页没能打开</h3><p class="hint">再点一次侧栏试试。如果一直如此，告诉我是「${esc(Views.titles[v] || v)}」这一栏。</p></div></div>`;
    }
    this.refreshStatusPill();
    this.updateMiniBar();
  },

  refreshStatusPill() {
    const pill = $('#today-status-pill');
    if (!pill) return;
    if (this.currentView === 'strength') {
      pill.className = 'pill hidden';
      pill.textContent = '';
      return;
    }
    if (['awakening', 'follow'].includes(this.currentView) && Store.currentMode() !== 'face') {
      pill.className = 'pill';
      pill.textContent = `今日观看 ${fmtSeconds(Store.dayWatching(todayKey()).seconds)}`;
      return;
    }
    const day = Store.dayTraining(todayKey());
    const target = Store.settings().dailyTargetMinutes || 15;
    const min = Math.round(day.seconds / 60);
    const skDone = Store.daySkincareDone(todayKey());
    let cls = 'pill', text = `训练 ${min}/${target} 分钟`;
    if (min >= target) { cls += ' ok'; text += ' · 已达标 ✓'; }
    else if (min > 0) cls += ' part';
    else cls += ' none';
    if (skDone) text += ' · 护肤 ✓';
    pill.className = cls;
    pill.textContent = text;
  },

  updateMiniBar() {
    const bar = $('#mini-session-bar');
    if (!bar) return;
    if (Session.active && this.currentView !== 'follow' && this.currentView !== 'strength') {
      bar.classList.remove('hidden');
      document.body.classList.add('has-minibar'); // 内容区让位，避免遮挡底部按钮
      $('#mini-session-time').textContent = fmtSeconds(Session.active.seconds);
      const watching = (Session.active.mode || Store.videoMode(Store.videoById(Session.active.videoId))) !== 'face';
      $('#mini-session-label').textContent = Session.active.awaitingPlay ? '等待视频播放'
        : Session.active.running ? (watching ? '观看中' : '跟练计时中')
        : Session.active.autoPausedBy === 'background' ? '已自动暂停（回到应用继续）'
        : Session.active.autoPausedBy === 'media' ? '已自动暂停（视频暂停）'
        : '计时已暂停';
    } else {
      bar.classList.add('hidden');
      document.body.classList.remove('has-minibar');
    }
  },

  /* 直接进入跟练（选定视频后的一跳） */
  launchFollow(videoId, sessionId, opts) {
    const video=Store.videoById(videoId); if (!video) return;
    Store.setMode(Store.videoMode(video));
    video.lastUsedAt=new Date().toISOString();
    if (Session.active && Session.active.videoId !== videoId) Session.stop();
    this.followVideoId = videoId;
    this.followSessionId = sessionId || null;
    // Only an explicit click on the home video frame requests immediate playback.
    this.followAutoplay = opts?.autoplay === true;
    this.go('follow');
    if (Session.active && sessionId) Session.active.sessionId = sessionId;
    Views.syncTimerUI($('#view-root'));
  },

  /* 「今天练什么操」选择界面：点跟练先来这里，选好再进跟练 */
  openPracticeChooser(sess) {
    const mode = sess ? 'face' : Store.currentMode();
    const watching = mode !== 'face';
    const videos = Store.videosForMode(mode);
    const weekday = new Date().getDay();
    const todays = watching ? [] : (Store.db.sessions || []).filter(s => s.enabled && (s.days || []).includes(weekday))
      .sort((a, b) => (minutesOf(a.time) || 0) - (minutesOf(b.time) || 0));
    const bound = sess && sess.videoId ? Store.videoById(sess.videoId) : null;

    const card = openModal(`
      <h3>🎬 ${watching ? '选择观看视频 · ' + esc(Store.collectionById(mode).name) : '选择跟练视频'}</h3>
      <p class="hint">${sess ? `为「${esc(sess.name)}」选一个跟练视频，选定后自动绑定，以后到点直达。` : '从下面选一个开始，或者先导入新视频。'}</p>
      ${bound ? `
        <div class="row chooser-direct">
          <img class="t-thumb" src="${bound.source === 'bilibili' && bound.pic ? esc(bound.pic) : ''}" referrerpolicy="no-referrer">
          <div style="flex:1"><b>已绑定：${esc(bound.title)}</b><div class="hint">当前绑定到该安排的视频</div></div>
          <button class="btn primary" id="ch-direct">▶ 直接开始</button>
        </div><hr class="sep">` : ''}
      ${todays.length ? `
        <div class="hint" style="font-weight:700; margin-bottom:6px">今天的安排</div>
        <div class="today-list" id="ch-today" style="margin-bottom:14px">
          ${todays.map(t => {
            const tv = Store.videoById(t.videoId);
            return `<div class="today-item ch-session" data-sid="${t.id}" style="cursor:pointer; ${sess && t.id === sess.id ? 'border-color:var(--accent);' : ''}">
              <div class="t-time">${esc(t.time)}</div>
              <div class="t-name"><b>${esc(t.name)}</b><span>${tv ? esc(tv.title) : '未绑定 · 从下方选视频'}</span></div>
              ${tv ? `<img class="t-thumb" src="${tv.source === 'bilibili' && tv.pic ? esc(tv.pic) : ''}" referrerpolicy="no-referrer">` : `<div class="t-thumb ph">＋</div>`}
            </div>`;
          }).join('')}
        </div>` : ''}
      <div class="hint" style="font-weight:700; margin-bottom:6px">视频库（${videos.length}）</div>
      <div class="ch-grid" id="ch-videos">
        ${videos.length ? videos.map(v => `
          <div class="vid-card ch-vid" data-vid="${v.id}">
            ${v.source === 'bilibili' && v.pic ? `<img class="vid-cover" src="${esc(v.pic)}" referrerpolicy="no-referrer">` : `<div class="vid-cover ph">🎞️</div>`}
            <div class="vid-info"><div class="vid-title">${esc(v.title)}</div>
            <div class="vid-meta"><span>${v.source === 'bilibili' ? 'B 站' : '本地'}${v.durationSec ? ' · ' + Math.round(v.durationSec / 60) + ' 分钟' : ''}</span></div></div>
          </div>`).join('') : '<div class="empty" style="grid-column:1/-1">视频库是空的，先用下面任一方式导入。</div>'}
      </div>
      <hr class="sep">
      <div class="row">
        <input class="input" id="ch-url" style="flex:1; min-width:200px" placeholder="粘贴 B 站 / 抖音视频链接或 BV 号">
        <button class="btn" id="ch-import">导入</button>
        <button class="btn" id="ch-local">📁 本地视频</button>
        <button class="btn ghost" id="ch-close">关闭</button>
      </div>`);

    const pick = (v) => {
      if (!v) return;
      /* 显式选定的视频无条件绑定该安排——与弹窗「以后到点直达」的承诺一致 */
      if (sess) { sess.videoId = v.id; Store.save(true); }
      closeModal();
      this.launchFollow(v.id, sess ? sess.id : null);
    };

    if (bound) $('#ch-direct', card).onclick = () => pick(bound);
    $$('.ch-session', card).forEach(el => {
      el.onclick = () => {
        const s = Store.sessionById(el.dataset.sid);
        if (!s) return;
        const tv = Store.videoById(s.videoId);
        if (tv) pick(tv);   // 已绑定 → 直接开始
        else { closeModal(); this.openPracticeChooser(s); } // 未绑定 → 聚焦选择
      };
    });
    $$('.ch-vid', card).forEach(el => {
      el.onclick = () => pick(Store.videoById(el.dataset.vid));
    });
    $('#ch-import', card).onclick = async () => {
      const text = $('#ch-url', card).value.trim();
      if (!text) { toast('先粘贴链接或 BV 号', 'red'); return; }
      const p = VideoLink.parse(text);
      if (!p) { toast('无法识别视频链接或 BV 号，请检查后重试', 'red'); return; }
      if (p.source === 'douyin') {
        const button = $('#ch-import', card);
        button.disabled = true; button.textContent = '正在下载到本地…';
        try {
          const video = await Douyin.importLocal(p, mode, d => {
            button.textContent = d.total ? `下载中 ${Math.floor(d.received / d.total * 100)}%` : `已下载 ${(d.received / 1048576).toFixed(1)} MB`;
          });
          pick(video);
        } catch (error) { toast('抖音下载失败：' + error.message, 'red'); }
        finally { button.disabled = false; button.textContent = '导入并选择'; }
        return;
      }
      let v = Store.videosForMode(mode).find(x => ((p.bvid && x.bvid === p.bvid) || (p.aid && x.aid === p.aid)) && (x.page||1)===p.page);
      if (!v) {
        toast('正在获取视频信息…');
        const info = await window.native.fetchBilibiliInfo(p.bvid || ('av' + p.aid));
        if(!info?.ok){toast('资料获取失败：'+(info?.error||'请重试'),'red');return;}
        const part=info.pages?.find(x=>x.page===p.page);if(p.page>1&&!part){toast('该分 P 不存在','red');return;}
        v = {
          id: uid('vid'), source: 'bilibili', cid:part?.cid||info.cid,playbackVerified:false,
          bvid: p.bvid || null, aid: p.aid || null, page: p.page || 1,
          title: (info && info.ok) ? info.title : (p.bvid || 'av' + p.aid),
          pic: (info && info.ok) ? info.pic : '',
          durationSec: (info && info.ok) ? info.durationSec : null,
          addedAt: new Date().toISOString()
        };
        Store.addVideo(v, mode);
        Store.save(true);
      }
      pick(v);
    };
    $('#ch-local', card).onclick = async () => {
      const r = await window.native.pickLocalVideo();
      if (!r) return;
      const v = { id: uid('vid'), source: 'local', localPath: r.path, title: r.name, pic: '', durationSec: null, addedAt: new Date().toISOString() };
      Store.addVideo(v, mode);
      Store.save(true);
      pick(v);
    };
    $('#ch-close', card).onclick = closeModal;
  },

  /* 兼容旧调用：点击「跟练」→ 打开选择界面 */
  startSessionFor(sess) {
    this.openPracticeChooser(sess);
  },

  /* ---------- 媒体-计时同步 ---------- */

  /* 切后台（blur/隐藏/最小化，可能连环触发，用 _bgHandled 去重）：
     设置开启时（autoPauseOnBlur !== false）暂停计时+视频；关闭时维持旧行为（不停表，仅防呆通知） */
  _onHidden() {
    this.hiddenSince = this.hiddenSince || Date.now();
    if (this._bgHandled) return;
    this._bgHandled = true;
    if (!Session.active || Session.active.awaitingPlay) return;
    if (Store.db.settings.autoPauseOnBlur === false) return; // 用户关闭了自动暂停
    this._autoPausedMedia = true;
    try { Bilibili.MediaSync.pauseAll(); } catch (e) {}
    Session.autoPause('background');
    Views.syncTimerUI($('#view-root'));
  },

  /* 回前台：恢复由切后台自动暂停的计时与视频；手动暂停过的不动 */
  _onVisible() {
    this.hiddenSince = null;
    this._bgHandled = false;
    if (!Session.active || Session.active.awaitingPlay) return;
    if (Session.active.autoPausedBy === 'background') {
      if (this._autoPausedMedia) {
        this._autoPausedMedia = false;
        try { Bilibili.MediaSync.playAll(); } catch (e) {}
      }
      Views.syncTimerUI($('#view-root'));
    }
  },

  /* 每 250 毫秒轮询视频状态（渲染端能感知到的范围内）：
     ① 等待态探测到视频在播 → 自动开始计时（本地视频此前已由 play 事件联动，这里是 B 站兜底）
     ② 计时中视频被暂停（用户在播放器里按了空格等）→ 计时同步暂停
     ③ 计时被自动暂停后视频恢复播放 → 计时同步继续
     状态不可知（null）不计时，也不暂停已经在走的表。 */
  async pollMediaSync() {
    if (this._mediaProbeBusy || !Session.active || this.currentView !== 'follow') return;
    this._mediaProbeBusy = true;
    const active = Session.active, stage = document.querySelector('#stage')?.firstElementChild;
    const epoch = this._mediaEpoch;
    try {
      const playing = await Bilibili.MediaSync.probePlaying();
      if (Session.active !== active || this.currentView !== 'follow' ||
          document.querySelector('#stage')?.firstElementChild !== stage || epoch !== this._mediaEpoch) return;
      const state = Bilibili.MediaSync.lastState;
      if (state?.ended && typeof Routine !== 'undefined' && Routine.active?.stage === 'training' && Routine.active.videoId === active.videoId) { await Routine.finishTraining(); return; }
      if(state && Number.isFinite(state.currentTime)) {active.mediaPosition=state.currentTime;const v=Store.videoById(active.videoId);if(v)v.playbackVerified=true;}
      active.mediaStatus=state?.seeking?'跳转中':state&&state.readyState<3?'缓冲中':playing===true?'计时中':playing===null?'播放器状态不可读取':'暂停';
      this.applyMediaState(playing);
    } finally { this._mediaProbeBusy = false; }
  },

  /* playing：true 开始、false 暂停；null 或其他非布尔表示不可知，不开始也不停表 */
  applyMediaState(playing) {
    const a = Session.active;
    if (!a) return;
    if (playing !== true && playing !== false) {
      Views.syncTimerUI($('#view-root'));
      return;
    }
    if (playing && !(this._bgHandled && Store.db.settings.autoPauseOnBlur !== false)) {
      if (a.awaitingPlay) Session.beginCounting();
      else { a.running = true; a.autoPausedBy = null; }
    } else if (a.running) Session.autoPause('media');
    Views.syncTimerUI($('#view-root'));
  },

  /* 收到提醒（系统通知点击或托盘） */
  async onReminded(sessionId) {
    this.go('today');
    const s = sessionId ? Store.sessionById(sessionId) : null;
    const v = s ? Store.videoById(s.videoId) : null;
    const card = openModal(`
      <div style="text-align:center; padding:8px 0">
        <div style="font-size:52px">⏰</div>
        <h3 style="justify-content:center">${s ? esc(s.name) + '，到点了！' : '该练瘦脸操啦！'}</h3>
        <p class="hint" style="font-size:13.5px">
          现在是 <b>${hhmm()}</b>${s ? ` · 目标 ${s.targetMinutes || 15} 分钟` : ''}${v ? `<br>跟练视频：${esc(v.title)}` : ''}
        </p>
        <div class="row" style="justify-content:center; margin-top:18px">
          <button class="btn ghost" id="rm-later">稍后再说</button>
          <button class="btn primary" id="rm-go">🎬 开始沉浸式跟练</button>
        </div>
      </div>`);
    $('#rm-later', card).onclick = closeModal;
    $('#rm-go', card).onclick = () => {
      closeModal();
      if (s && s.videoId) this.launchFollow(s.videoId, s.id);      // 已绑定视频 → 直达跟练
      else if (s) this.openPracticeChooser(s);                      // 未绑定 → 选择界面
      else this.openPracticeChooser(null);
    };
  }
};

// 迷你会话条「回到跟练」
document.addEventListener('DOMContentLoaded', () => {
  $('#mini-session-open').onclick = () => {
    if (Session.active) App.launchFollow(Session.active.videoId, Session.active.sessionId);
  };
  App.boot();
});
