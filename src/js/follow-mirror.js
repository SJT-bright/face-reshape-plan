/* 跟练动作对照：只预览摄像头，不拍照、不录制，不参与训练计时。 */
const FollowMirror = {
  enabled: false, stream: null, opening: null, epoch: 0, position: null, drag: null,
  eligible() { return App.currentView === 'follow' && Store.currentMode() === 'face'; },
  sync() {
    if (!this.eligible()) { this.stop(); return; }
    const wrap = document.querySelector('#stage-wrap');
    if (!wrap) return;
    if (!document.querySelector('#follow-mirror-toggle')) {
      const bar = document.createElement('div');
      bar.className = 'follow-mirror-toolbar';
      bar.innerHTML = '<button type="button" class="btn small" id="follow-mirror-toggle" aria-pressed="false">开启动作对照</button><span>打开镜头，边看视频边对照自己的动作</span>';
      wrap.before(bar);
      bar.querySelector('button').onclick = () => this.enabled ? this.stop() : this.start();
      document.querySelector('#t-stop')?.addEventListener('click', () => this.stop());
    }
    const button = document.querySelector('#follow-mirror-toggle');
    button.textContent = this.enabled ? '关闭动作对照' : '开启动作对照';
    button.setAttribute('aria-pressed', String(this.enabled));
    if (this.enabled) this.attach();
  },
  mount() {
    if (document.querySelector('#follow-mirror')) return;
    const box = document.createElement('aside');
    box.id = 'follow-mirror'; box.setAttribute('aria-label', '跟练动作对照小窗');
    box.innerHTML = '<header><b tabindex="0" id="follow-mirror-handle" aria-label="拖动动作对照小窗，可用方向键移动">动作对照 <span>拖动移位</span></b><button type="button" class="btn small ghost" id="follow-mirror-close" aria-label="关闭动作对照摄像头">关闭</button></header><video id="follow-mirror-preview" data-camera-preview autoplay muted playsinline></video><p id="follow-mirror-status" role="status">正在开启镜头…</p><button type="button" class="btn small" id="follow-mirror-retry" hidden>重试开启</button>';
    document.body.appendChild(box);
    box.querySelector('#follow-mirror-close').onclick = () => this.stop();
    const handle = box.querySelector('#follow-mirror-handle');
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); this.clamp();
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ...this.position };
      handle.setPointerCapture(event.pointerId); box.classList.add('dragging');
    });
    handle.addEventListener('pointermove', event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.id) return;
      this.position = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
      this.clamp();
    });
    const end = () => { this.drag = null; box.classList.remove('dragging'); };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
    handle.addEventListener('keydown', event => {
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!steps[event.key]) return;
      event.preventDefault(); this.clamp();
      const [x, y] = steps[event.key], size = event.shiftKey ? 32 : 16;
      this.position.left += x * size; this.position.top += y * size; this.clamp();
    });
  },
  attach() {
    this.mount();
    const box = document.querySelector('#follow-mirror');
    const full = document.fullscreenElement;
    const parent = full && full.id === 'stage-wrap' ? full : document.body;
    if (box.parentElement !== parent) parent.appendChild(box);
    this.clamp();
    const preview = box.querySelector('video');
    if (this.stream && preview.paused) preview.play().catch(() => {});
  },
  clamp() {
    const box = document.querySelector('#follow-mirror'); if (!box) return;
    const width = box.offsetWidth, height = box.offsetHeight;
    const stageTop = document.querySelector('#stage-wrap')?.getBoundingClientRect().top;
    const initial = { left: innerWidth - width - 20, top: document.fullscreenElement ? 20 : Math.max(88, (stageTop ?? 92) + 12) };
    this.position ||= initial;
    const margin = 8;
    this.position.left = Math.max(margin, Math.min(Math.max(margin, innerWidth - width - margin), this.position.left));
    this.position.top = Math.max(margin, Math.min(Math.max(margin, innerHeight - height - margin), this.position.top));
    box.style.left = this.position.left + 'px'; box.style.top = this.position.top + 'px';
  },
  status(text, settings = false) {
    const box = document.querySelector('#follow-mirror'); if (!box) return;
    box.querySelector('p').textContent = text;
    const retry = box.querySelector('#follow-mirror-retry');
    retry.hidden = !!this.stream;
    retry.textContent = settings ? '打开摄像头权限' : '重试开启';
    retry.onclick = settings ? () => native.openCameraSettings() : () => this.start();
    this.clamp();
  },
  start() {
    if (!this.eligible()) return Promise.resolve(false);
    if (this.stream) return Promise.resolve(true);
    if (this.opening) return this.opening;
    this.enabled = true; this.sync();
    const epoch = ++this.epoch;
    const current = () => this.enabled && epoch === this.epoch && this.eligible();
    const opening = (async () => {
      let stream;
      try {
        this.status('正在开启镜头…'); document.querySelector('#follow-mirror-retry').hidden = true;
        const permission = await native.cameraPermission();
        if (!current()) return false;
        if (!permission.granted) { this.status('请先允许摄像头访问，再重新开启动作对照', true); return false; }
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
        if (!current()) { stream.getTracks().forEach(track => track.stop()); return false; }
        this.stream = stream;
        const preview = document.querySelector('#follow-mirror-preview'); preview.srcObject = stream;
        stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
          if (this.stream !== stream) return;
          stream.getTracks().forEach(item => item.stop()); this.stream = null; preview.srcObject = null;
          this.status('镜头已断开，连接摄像头后重试');
        }, { once: true }));
        await preview.play();
        if (!current()) return false;
        this.status('实时镜像 · 仅预览，不录制'); return true;
      } catch (error) {
        stream?.getTracks().forEach(track => track.stop());
        if (!current()) return false;
        this.stream = null;
        const denied = ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
        this.status(denied ? '请在系统设置中允许摄像头访问' : error.name === 'NotFoundError' ? '没有找到摄像头，连接后重试' : '镜头未能开启，请重试', denied);
        return false;
      } finally { if (this.opening === opening) this.opening = null; }
    })();
    this.opening = opening; return opening;
  },
  stop() {
    ++this.epoch; this.enabled = false; this.opening = null; this.drag = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    document.querySelector('#follow-mirror')?.remove();
    const button = document.querySelector('#follow-mirror-toggle');
    if (button) { button.textContent = '开启动作对照'; button.setAttribute('aria-pressed', 'false'); }
  }
};

const mirrorRender = App.render;
App.render = function(...args) {
  // 重绘前把镜头从旧全屏节点移出，保持同一视频流，不重复申请摄像头。
  const box = document.querySelector('#follow-mirror'); if (box) document.body.appendChild(box);
  const result = mirrorRender.apply(this, args); FollowMirror.sync(); return result;
};
const mirrorGo = App.go;
App.go = function(view, ...args) {
  if (view !== 'follow' || Store.currentMode() !== 'face') FollowMirror.stop();
  return mirrorGo.call(this, view, ...args);
};
document.addEventListener('fullscreenchange', () => { if (FollowMirror.enabled) FollowMirror.attach(); });
window.addEventListener('resize', () => FollowMirror.clamp());
window.addEventListener('beforeunload', () => FollowMirror.stop());
