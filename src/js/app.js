/* 应用入口：路由 / 全局跟练计时器 / 提醒联动 / 时钟 */

const Session = {
  active: null, // { entryId, dateKey, startedAt, seconds, running, videoId, sessionId }
  _saveCounter: 0,

  start(videoId, sessionId) {
    if (!videoId) { toast('请先选择跟练视频', 'red'); return false; }
    if (this.active) {
      // 已有进行中的会话：切换视频归属继续计时
      this.active.videoId = videoId;
      if (sessionId) this.active.sessionId = sessionId;
      toast('已切换到新视频，计时继续');
      return true;
    }
    const entryId = uid('en');
    this.active = {
      entryId, dateKey: todayKey(), startedAt: Date.now(),
      seconds: 0, running: true, videoId, sessionId: sessionId || null
    };
    Store.addTrainingEntry(todayKey(), {
      id: entryId, videoId, sessionId: sessionId || null,
      start: hhmm(), seconds: 0, manual: false
    });
    return true;
  },

  togglePause() {
    if (!this.active) return;
    this.active.running = !this.active.running;
    this._persist();
  },

  stop() {
    if (!this.active) return null;
    const a = this.active;
    this.active = null;
    Store.updateTrainingEntry(a.dateKey, a.entryId, { seconds: a.seconds, end: hhmm() });
    Store.save(true);
    return a.seconds;
  },

  tick() {
    if (!this.active) return;
    if (this.active.running) {
      this.active.seconds++;
      this._saveCounter++;
      if (this._saveCounter % 30 === 0) this._persist(); // 每 30 秒落盘，防崩溃丢数据
      Views.syncTimerUI($('#view-root'));
    }
  },

  _persist() {
    const a = this.active;
    if (a) Store.updateTrainingEntry(a.dateKey, a.entryId, { seconds: a.seconds });
  }
};

const App = {
  currentView: 'today',
  followVideoId: null,

  async boot() {
    await Store.init();
    Strength.boot();
    if (window.native.isMac) document.body.classList.add('is-mac');

    // 导航
    $$('.nav-item').forEach(btn => {
      btn.onclick = () => this.go(btn.dataset.view);
    });

    // 主进程通知点击 → 确认弹窗 → 开始跟练
    window.native.onReminderActivate(({ sessionId }) => this.onReminded(sessionId));

    // 全局计时
    setInterval(() => Session.tick(), 1000);
    setInterval(() => Strength.tick(), 1000);

    // 侧栏不显示时钟；日期读取、训练计时及主进程定时提醒照常运行。
    // 状态胶囊每 30 秒刷新
    setInterval(() => { this.refreshStatusPill(); this.updateMiniBar(); }, 30000);

    // 退出前落盘
    window.addEventListener('beforeunload', () => Store.flushSync());

    this.render();
  },

  go(view) {
    this.currentView = view;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('#page-title').textContent = Views.titles[view] || view;
    this.render();
  },

  render() {
    const root = $('#view-root');
    const v = this.currentView;
    /* 动效分级：切栏目播完整入场（虚化揭示+卡片错峰），页内重绘只播轻量刷新，
       避免打卡/保存/翻页每次都整页模糊 0.5 秒 */
    const viewChanged = this._renderedView !== v;
    this._renderedView = v;
    root.classList.remove('view-enter', 'view-update');
    void root.offsetWidth; // 强制回流，让同类动画也能重播（如 A→B→A 再点回来）
    root.classList.add(viewChanged ? 'view-enter' : 'view-update');
    if (v === 'today') Views.today(root);
    else if (v === 'follow') Views.follow(root);
    else if (v === 'plan') Views.plan(root);
    else if (v === 'strength') Strength.view(root);
    else if (v === 'skincare') Skincare.view(root);
    else if (v === 'nutrition') Rhythm.view(root);
    else if (v === 'achievements') Views.achievements(root);
    this.refreshStatusPill();
    this.updateMiniBar();
  },

  refreshStatusPill() {
    const pill = $('#today-status-pill');
    if (!pill) return;
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
    if (Session.active && this.currentView !== 'follow') {
      bar.classList.remove('hidden');
      document.body.classList.add('has-minibar'); // 内容区让位，避免遮挡底部按钮
      $('#mini-session-time').textContent = fmtSeconds(Session.active.seconds);
      $('#mini-session-label').textContent = Session.active.running ? '跟练计时中' : '计时已暂停';
    } else {
      bar.classList.add('hidden');
      document.body.classList.remove('has-minibar');
    }
  },

  /* 直接进入跟练（选定视频后的一跳） */
  launchFollow(videoId, sessionId) {
    this.followVideoId = videoId;
    this.go('follow');
    setTimeout(() => {
      const stage = $('#stage');
      if (stage) Views.loadStage(stage, Store.videoById(videoId));
      if (!Session.active) Session.start(videoId, sessionId);
      else { Session.active.videoId = videoId; if (sessionId) Session.active.sessionId = sessionId; }
      Views.syncTimerUI($('#view-root'));
    }, 50);
  },

  /* 「今天练什么操」选择界面：点跟练先来这里，选好再进跟练 */
  openPracticeChooser(sess) {
    const videos = Store.db.videos;
    const weekday = new Date().getDay();
    const todays = (Store.db.sessions || []).filter(s => s.enabled && (s.days || []).includes(weekday))
      .sort((a, b) => (minutesOf(a.time) || 0) - (minutesOf(b.time) || 0));
    const bound = sess && sess.videoId ? Store.videoById(sess.videoId) : null;

    const card = openModal(`
      <h3>🎬 今天练什么操？</h3>
      <p class="hint">${sess ? `为「${esc(sess.name)}」选一个跟练视频，选定后自动绑定，以后到点直达。` : '从下面选一个开始，或者先导入新视频。'}</p>
      ${bound ? `
        <div class="row chooser-direct">
          <img class="t-thumb" src="${bound.source === 'bilibili' && bound.pic ? esc(bound.pic) : ''}" referrerpolicy="no-referrer" onerror="this.classList.add('ph')">
          <div style="flex:1"><b>已绑定：${esc(bound.title)}</b><div class="hint">上次为该安排选的视频</div></div>
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
              ${tv ? `<img class="t-thumb" src="${tv.source === 'bilibili' && tv.pic ? esc(tv.pic) : ''}" referrerpolicy="no-referrer" onerror="this.classList.add('ph')">` : `<div class="t-thumb ph">＋</div>`}
            </div>`;
          }).join('')}
        </div>` : ''}
      <div class="hint" style="font-weight:700; margin-bottom:6px">视频库（${videos.length}）</div>
      <div class="ch-grid" id="ch-videos">
        ${videos.length ? videos.map(v => `
          <div class="vid-card ch-vid" data-vid="${v.id}">
            ${v.source === 'bilibili' && v.pic ? `<img class="vid-cover" src="${esc(v.pic)}" referrerpolicy="no-referrer" onerror="this.classList.add('ph')">` : `<div class="vid-cover ph">🎞️</div>`}
            <div class="vid-info"><div class="vid-title">${esc(v.title)}</div>
            <div class="vid-meta"><span>${v.source === 'bilibili' ? 'B站' : '本地'}${v.durationSec ? ' · ' + Math.round(v.durationSec / 60) + '分钟' : ''}</span></div></div>
          </div>`).join('') : '<div class="empty" style="grid-column:1/-1">视频库是空的，先用下面任一方式导入。</div>'}
      </div>
      <hr class="sep">
      <div class="row">
        <input class="input" id="ch-url" style="flex:1; min-width:200px" placeholder="粘贴B站链接 / BV号，导入并开始">
        <button class="btn" id="ch-import">导入</button>
        <button class="btn" id="ch-local">📁 本地视频</button>
        <button class="btn ghost" id="ch-close">关闭</button>
      </div>`);

    const pick = (v) => {
      if (!v) return;
      if (sess && (!sess.videoId || sess.videoId === v.id)) { sess.videoId = v.id; Store.save(true); }
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
      const p = Bilibili.parse(text);
      if (!p) { toast('没识别出视频，检查一下链接', 'red'); return; }
      let v = Store.db.videos.find(x => x.bvid === p.bvid || (p.aid && x.aid === p.aid));
      if (!v) {
        toast('正在获取视频信息…');
        const info = await window.native.fetchBilibiliInfo(p.bvid || ('av' + p.aid));
        v = {
          id: uid('vid'), source: 'bilibili',
          bvid: p.bvid || null, aid: p.aid || null, page: p.page || 1,
          title: (info && info.ok) ? info.title : (p.bvid || 'av' + p.aid),
          pic: (info && info.ok) ? info.pic : '',
          durationSec: (info && info.ok) ? info.durationSec : null,
          addedAt: new Date().toISOString()
        };
        Store.db.videos.push(v);
        Store.save(true);
      }
      pick(v);
    };
    $('#ch-local', card).onclick = async () => {
      const r = await window.native.pickLocalVideo();
      if (!r) return;
      const v = { id: uid('vid'), source: 'local', localPath: r.path, title: r.name, pic: '', durationSec: null, addedAt: new Date().toISOString() };
      Store.db.videos.push(v);
      Store.save(true);
      pick(v);
    };
    $('#ch-close', card).onclick = closeModal;
  },

  /* 兼容旧调用：点击「跟练」→ 打开选择界面 */
  startSessionFor(sess) {
    this.openPracticeChooser(sess);
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
  $('#mini-session-open').onclick = () => App.go('follow');
  App.boot();
});
