/* A continuous, local-only training → skin snapshot → skincare flow. */
const CareCamera = {
  stream: null, opening: null, epoch: 0, saving: false, shootContext: null,
  mount() {
    if ($('#care-camera')) return;
    const box = document.createElement('aside');
    box.id = 'care-camera'; box.setAttribute('aria-label', '护肤摄像头');
    box.innerHTML = `<header><b>护肤镜头</b><button type="button" class="btn small ghost" id="camera-close" aria-label="关闭摄像头">关闭</button></header><video id="camera-preview" data-camera-preview autoplay muted playsinline></video><p id="camera-status" role="status">摄像头未开启</p><div class="ux-actions"><button type="button" class="btn small primary" id="camera-capture" disabled>截取皮肤状态</button><button type="button" class="btn small" id="camera-retry">开启镜头</button></div>`;
    document.body.appendChild(box);
    $('#camera-close').onclick = () => this.shootContext ? closeModal(true) : this.stop();
    $('#camera-retry').onclick = () => this.start();
    $('#camera-capture').onclick = async () => {
      const context=this.shootContext;
      if(!await this.capture(context||{}))return;
      if(context&&this.shootContext===context){closeModal(true);Skincare.ui.tab=context.returnTab||'photos';App.render();}
    };
  },
  async shoot(options = {}) {
    if(this.shootContext)return;
    const context={...options,date:todayKey(),afterTraining:false,kind:options.kind==='body'?'body':'skin',angle:['front','left','right'].includes(options.angle)?options.angle:'front'};
    const card=openModal(`<h3>${context.kind==='body'?'拍摄今日体型':'拍摄今日皮肤'}</h3><p class="hint camera-sheet-date">${esc(context.date)} · ${context.kind==='body'?'健身体型':'皮肤状态'}</p><div id="camera-sheet-slot"></div>`);
    card.classList.add('camera-capture-sheet');$('.ux-modal-controls',card)?.remove();
    card._onClose=()=>{card.classList.remove('camera-capture-sheet');this.stop();};
    this.shootContext=context;this.mount();
    const box=$('#care-camera');box.classList.add('camera-inline');$('#camera-sheet-slot',card).appendChild(box);
    $('header b',box).textContent='摄像头预览';$('#camera-capture').textContent='拍照并保存';
    return this.start();
  },
  status(text) { const node = $('#camera-status'); if (node) node.textContent = text; },
  async start() {
    this.mount();
    if (this.stream) { $('#camera-capture').disabled=false; return true; }
    if (this.opening) return this.opening;
    const epoch = ++this.epoch;
    const opening = (async () => {
      try {
        this.status('正在请求摄像头…');
        $('#camera-capture').disabled=true;
        const permission = await native.cameraPermission();
        if (epoch !== this.epoch) return false;
        if (!permission.granted) {
          this.status('摄像头权限未开启，请在系统设置中允许后重启应用');
          $('#camera-retry').textContent = '打开摄像头权限';
          $('#camera-retry').onclick = () => native.openCameraSettings();
          return false;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
        if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); return false; }
        this.stream = stream;
        const preview = $('#camera-preview'); preview.srcObject = stream; await preview.play();
        if(epoch!==this.epoch)return false;
        $('#camera-capture').disabled=false;
        $('#camera-retry').textContent = '镜头已开启'; $('#camera-retry').disabled = true;
        this.status(this.shootContext?'调整好角度后，点「拍照并保存」记录今天的状态':'只在本机预览，截取按钮保存一张照片');
        return true;
      } catch (error) {
        if (epoch === this.epoch) {
          this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
          if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            this.status('摄像头权限未开启，请在系统设置中允许桌面应用访问摄像头');
            $('#camera-retry').textContent = '打开摄像头权限';
            $('#camera-retry').onclick = () => native.openCameraSettings();
          } else this.status(error.name === 'NotFoundError' ? '没有找到摄像头，连接后重试' : '镜头未能开启：' + error.message);
        }
        return false;
      } finally { if (this.opening === opening) this.opening = null; }
    })();
    this.opening = opening;
    return opening;
  },
  async capture(context = {}) {
    if (this.saving) return false;
    const video = $('#camera-preview');
    if (!video?.videoWidth || video.readyState < 2 || !this.stream) { this.status('等待镜头画面出现后再截取'); return false; }
    this.saving = true;
    const button = $('#camera-capture'); if (button) button.disabled = true;
    let file;
    try {
      const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .92));
      if (!blob) throw Error('照片生成失败');
      const date = context.date || todayKey(),kind=context.kind==='body'?'body':'skin',angle=context.angle||'front';
      file = await native.saveSkinPhoto(await blob.arrayBuffer(), 'jpg', { date, kind, angle });
      if (!file) throw Error('照片未能保存');
      SkinEngine.normalize(Store.db);
      const state = Routine.active;
      const afterTraining = context.afterTraining ?? (state?.stage === 'snapshot');
      const photo = { id: uid('ph'), date, kind, angle, file, createdAt: new Date().toISOString(), source: 'camera', stage: afterTraining ? 'after-training-before-care' : context.returnTab ? 'daily-record' : 'skincare', note: afterTraining ? '训练后 · 护肤前' : context.returnTab ? '当日状态拍摄' : '护肤镜头截取', videoId: afterTraining ? state?.videoId || null : null, sessionId: afterTraining ? state?.sessionId || null : null };
      Store.db.skin.photos.push(photo);
      try { if(Store.save(true)!==true)throw Error('照片记录未能保存'); } catch (error) { Store.db.skin.photos=Store.db.skin.photos.filter(p=>p.id!==photo.id);if(Store._failed?.skin?.photos)Store._failed.skin.photos=Store._failed.skin.photos.filter(p=>p.id!==photo.id);await native.deleteSkinPhoto(file,kind);file = null;throw error; }
      this.status('已保存：' + photo.note); toast('今日照片已保存到档案', 'green');
      if (afterTraining&&state?.stage === 'snapshot') { state.snapshotSaved = true; Routine.drawFlow(); }
      return true;
    } catch (error) { this.status('截取失败：' + error.message); return false; }
    finally { this.saving = false; const current = $('#camera-capture'); if (current&&current===button) current.disabled = false; }
  },
  stop() {
    ++this.epoch; this.opening = null;
    this.shootContext=null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    $('#care-camera')?.remove();
  }
};

const Routine = {
  active: null, queue: [], starting: false,
  labels: { morning: '早上', evening: '晚上', day: '日间' },
  config() { return Store.settings().automation || {}; },
  settings(root) {
    const management = $('#ux-collections', root), automation = $('#ux-automation', root);
    if (!management || !automation) return;
    management.innerHTML = `<h3>视频板块</h3><p class="hint">在这里新增、改名和调整适用时段；左侧只保留进入板块的入口。</p><div class="routine-collection-list">${Store.collections().filter(c => c.id !== 'face').map(c => `<div class="routine-collection-row"><div><b>${esc(c.name)}</b><small>${(c.periods || []).map(p => this.labels[p]).join(' · ')}</small></div><button type="button" class="btn small" data-manage-collection="${esc(c.id)}">编辑</button></div>`).join('')}</div><button type="button" class="btn primary" id="add-video-collection">新增视频板块</button>`;
    $('#add-video-collection', management).onclick = () => UX.collectionModal();
    $$('[data-manage-collection]', management).forEach(b => b.onclick = () => UX.collectionModal(b.dataset.manageCollection));
    const config = this.config(), videos = Store.db.videos || [];
    const options = id => `<option value="">未选择</option>${videos.map(v => `<option value="${esc(v.id)}"${v.id === id ? ' selected' : ''}>${esc(Store.collectionById(Store.videoMode(v))?.name || '视频')} · ${esc(v.title)}</option>`).join('')}`;
    automation.innerHTML = `<h3>每日自动流程</h3><p class="hint">到点打开全屏并播放预选视频，结束后截取训练后的皮肤状态，再进入护肤镜头。启用后应用会常驻托盘并开启提醒；完全退出、电脑睡眠或锁屏期间无法保证准时启动。</p><form id="routine-settings"><label class="routine-option"><input type="checkbox" name="enabled"${config.enabled ? ' checked' : ''}>启用到点全屏跟练</label>${['morning', 'evening'].map(period => { const slot = config[period] || {}; return `<fieldset class="routine-slot"><legend>${this.labels[period]}</legend><label>开始时间<input class="input" type="time" name="${period}-time" value="${esc(slot.time || '')}"></label><label>提前选好训练视频<select class="select" name="${period}-video">${options(slot.videoId)}</select></label><div class="routine-weekdays">${['日','一','二','三','四','五','六'].map((day, i) => `<label><input type="checkbox" name="${period}-day" value="${i}"${(slot.days || [0,1,2,3,4,5,6]).includes(i) ? ' checked' : ''}>${day}</label>`).join('')}</div><button type="button" class="btn small" data-preview-routine="${period}">现在开始这一流程</button></fieldset>`; }).join('')}<label class="routine-option"><input type="checkbox" name="camera"${config.camera !== false ? ' checked' : ''}>训练和护肤时显示摄像头小窗</label><label class="routine-option"><input type="checkbox" name="autoCapture"${config.autoCapture ? ' checked' : ''}>训练结束自动截取一张皮肤照片</label><p class="hint">关闭自动截取时，训练结束会显示截取按钮。照片保存在本机；不录制视频、不采集麦克风。</p><label class="routine-option"><input type="checkbox" name="careAutoOpen"${config.careAutoOpen ? ' checked' : ''}>单独的护肤时间到点时也全屏打开护肤步骤</label><p class="hint">护肤时间在「提醒」里设置。已有「跟练计划」也可在每条安排里开启到点全屏；相同时间请选择一个自动入口。</p><p id="routine-settings-error" role="alert"></p><div class="ux-actions"><button type="submit" class="btn primary">保存自动流程</button><button type="button" class="btn" id="routine-camera-test">开启摄像头预览</button><button type="button" class="btn" id="routine-plan">编辑跟练计划</button></div></form>`;
    const form = $('#routine-settings', automation);
    form.onsubmit = event => {
      event.preventDefault();
      try {
        const next = Object.fromEntries(['enabled', 'camera', 'autoCapture', 'careAutoOpen'].map(key => [key, form.elements[key].checked]));
        for (const period of ['morning', 'evening']) next[period] = { time: form.elements[period + '-time'].value, videoId: form.elements[period + '-video'].value, days: $$(`input[name="${period}-day"]:checked`, form).map(x => Number(x.value)) };
        Store.settings().automation = RoutineCore.validate(next, Store.db.videos);
        if(next.enabled){Store.settings().remindersEnabled=true;Store.settings().keepInTray=true;}
        Store.save(true); toast('自动流程已保存', 'green'); $('#routine-settings-error').textContent = '';
      } catch (error) { $('#routine-settings-error').textContent = error.message; }
    };
    $$('[data-preview-routine]', automation).forEach(b => b.onclick = () => {
      const period = b.dataset.previewRoutine, id = form.elements[period + '-video'].value;
      if (!id) return toast('先选择这个时段的视频', 'red');
      this.start({ videoId: id, period, kind: 'routine', camera: form.elements.camera.checked, autoCapture: form.elements.autoCapture.checked });
    });
    $('#routine-camera-test', automation).onclick = () => CareCamera.start();
    $('#routine-plan', automation).onclick = () => App.go('plan');
  },
  selectPeriod(period) {
    UX.collectionPeriod = period;
    const slot = this.config()[period], video = Store.videoById(slot?.videoId);
    if (video) {
      const mode = Store.videoMode(video);
      if (typeof UX.rememberHomeVideo === 'function') UX.rememberHomeVideo(mode, period, video.id);
      else { UX.homeVideoChoices ||= {}; UX.homeVideoChoices[mode] = { date: todayKey(), id: video.id }; UX.homeVideoChoice = UX.homeVideoChoices[mode]; }
      App.goCollection(mode);
      toast(this.labels[period] + '预选视频：' + video.title);
    } else {
      UX.settingsPanel = 'automation'; App.go('settings');
      toast('请在自动流程中预选' + this.labels[period] + '视频和时间');
    }
  },
  async start(payload) {
    const unfinished = Session.active && (!Session.active.awaitingPlay || (Session.active.seconds || 0) > 0);
    if (this.starting || this.active || unfinished) {
      if (payload.kind === 'care' && this.active?.period === payload.period) return false;
      if (!this.queue.some(x => x.id === payload.id && x.kind === payload.kind)) this.queue.push(payload);
      this.drawPending(); return false;
    }
    this.starting = true;
    try {
      if (Session.active?.awaitingPlay && !(Session.active.seconds > 0)) Session.stop();
      const session = payload.sessionId ? Store.sessionById(payload.sessionId) : null;
      const video = Store.videoById(payload.videoId || session?.videoId);
      if (payload.kind !== 'care' && !video) { toast('预选视频已不存在，请重新设置自动流程', 'red'); return false; }
      Drafts.capture($('#view-root'));
      while (!$('#modal-mask').classList.contains('hidden')) closeModal();
      this.active = { stage: payload.kind === 'care' ? 'care' : 'training', period: payload.period || (payload.time && payload.time < '12:00' ? 'morning' : 'evening'), videoId: video?.id || null, sessionId: session?.id || null, camera: payload.camera ?? this.config().camera !== false, autoCapture: payload.autoCapture ?? !!this.config().autoCapture, snapshotSaved: false, wasFullscreen: await native.isFullscreen() };
      if (!await native.enterRoutine()) throw Error('全屏窗口不可用');
      if (payload.kind === 'care') this.showCare();
      else {
        UX.collectionPeriod = 'all';
        App.launchFollow(video.id, session?.id || null, { autoplay: true });
        document.body.classList.add('routine-running'); this.drawFlow();
        if (this.active.camera) CareCamera.start();
      }
      return true;
    } catch (error) { await this.close(); toast('自动流程未能启动：' + error.message, 'red'); return false; }
    finally { this.starting = false; }
  },
  drawPending() {
    if ($('#routine-pending') || !this.queue.length) return;
    const box = document.createElement('aside'); box.id = 'routine-pending';
    box.innerHTML = '<span>下一项定时流程已到点，将在当前流程结束后开始。</span><button type="button" class="btn small" data-run-pending>记录当前训练并开始</button><button type="button" class="btn small" data-skip-pending>今天跳过</button>';
    document.body.appendChild(box);
    $('[data-skip-pending]', box).onclick = () => { this.queue = []; box.remove(); };
    $('[data-run-pending]', box).onclick = async () => {
      if (this.active) { await this.close(); return; }
      Bilibili.MediaSync.pauseAll(); if (Session.active) Session.stop(); this.drain();
    };
  },
  drawFlow() {
    $('#routine-flow')?.remove();
    if (!this.active) return;
    const state = this.active, node = document.createElement('aside'); node.id = 'routine-flow';
    const training = state.stage === 'training', snapshot = state.stage === 'snapshot';
    node.innerHTML = `<div><b>${training ? '1 · 视频训练' : snapshot ? '2 · 训练后皮肤状态' : '3 · 护肤'}</b><small>${training ? '视频结束后会进入截取皮肤状态；也可提前结束训练。' : snapshot ? state.snapshotSaved ? '照片已保存，可以开始护肤。' : '请在护肤前截取当前皮肤状态。' : '视频已停止，镜头帮助你完成护肤步骤。'}</small></div><div class="ux-actions">${training ? '<button type="button" class="btn primary" id="routine-next">结束训练，记录皮肤</button>' : snapshot ? '<button type="button" class="btn primary" id="routine-snapshot">截取皮肤状态</button><button type="button" class="btn" id="routine-next">'+(state.snapshotSaved ? '开始护肤' : '跳过照片，开始护肤')+'</button>' : '<button type="button" class="btn primary" id="routine-next">完成本次流程</button>'}<button type="button" class="btn ghost" id="routine-exit">退出全屏流程</button></div>`;
    document.body.appendChild(node);
    $('#routine-exit').onclick = () => this.close();
    $('#routine-next').onclick = () => training ? this.finishTraining() : snapshot ? this.showCare() : this.close();
    const capture = $('#routine-snapshot'); if (capture) capture.onclick = async () => { if (await CareCamera.start()) await CareCamera.capture({ afterTraining: true }); };
  },
  async finishTraining() {
    if (!this.active || this.active.stage !== 'training') return false;
    this.active.stage = 'snapshot';
    Bilibili.MediaSync.pauseAll(); if (Session.active) Session.stop();
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    Skincare.ui.tab = 'care'; App.go('skincare'); this.drawFlow();
    if (this.active.camera || this.active.autoCapture) {
      if (await CareCamera.start() && this.active?.stage === 'snapshot' && this.active.autoCapture) {
        const preview = $('#camera-preview');
        if (preview && preview.readyState < 2) await new Promise(resolve => { const timeout = setTimeout(resolve, 2500); preview.addEventListener('loadeddata', () => { clearTimeout(timeout); resolve(); }, { once: true }); });
        if (this.active?.stage === 'snapshot' && await CareCamera.capture({ afterTraining: true })) this.showCare();
      }
    }
    return true;
  },
  showCare() {
    if (!this.active) return;
    this.active.stage = 'care'; Bilibili.MediaSync.pauseAll();
    Skincare.ui.tab = 'care'; App.go('skincare'); this.drawFlow();
    document.body.classList.add('routine-running');
    if (this.active.camera) CareCamera.start(); else CareCamera.stop();
  },
  async close() {
    const active = this.active; this.active = null;
    if (active?.stage === 'training' && Session.active?.videoId === active.videoId) { Bilibili.MediaSync.pauseAll(); Session.stop(); }
    CareCamera.stop(); $('#routine-flow')?.remove(); document.body.classList.remove('routine-running');
    if (active && !active.wasFullscreen) await native.setFullscreen(false);
    $('#routine-pending')?.remove();
    if (this.queue.length && !Session.active) { const next = this.queue.shift(); await this.start(next); }
  },
  drain() {
    if (this.queue.length && !this.active && !this.starting && !Session.active) {
      $('#routine-pending')?.remove(); this.start(this.queue.shift());
    }
  },
  boot() {
    native.onRoutineActivate(payload => {
      if (payload.kind === 'care' && this.active && this.active.period === payload.period) return;
      this.start(payload);
    });
    native.routineReady();
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.active && $('#modal-mask').classList.contains('hidden')) { event.preventDefault(); this.close(); }
    });
    window.addEventListener('beforeunload', () => CareCamera.stop());
  }
};
const routineSessionStop = Session.stop.bind(Session);
Session.stop = function() { const result = routineSessionStop(); queueMicrotask(() => Routine.drain()); return result; };
