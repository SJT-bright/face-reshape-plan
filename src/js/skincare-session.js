(function (root) {
  'use strict';

  const session = {
    mode: 'idle',
    stream: null,
    recorder: null,
    file: null,
    startedAt: null,
    startedMs: 0,
    clock: 0,
    el: null,
    queue: Promise.resolve(),
    fileWait: null,
    openFile: null,
    appendFailed: false,
    appendError: null,
    starting: false,
    stopping: false,
    stopRequested: false,
    notice: '',
    askSettings: false,
    listGen: 0,
    early: [],
    arming: false
  };

  const SkincareSession = {
    mount(el) {
      if (!el) return;
      session.el = el;
      if (session.mode === 'recording' && session.stream) {
        paintRecording();
        attachPreview();
        if (session.startedMs) ensureClock();
        return;
      }
      session.askSettings = false;
      showIdle();
    }
  };

  function q(scope, sel) {
    if (typeof $ === 'function') return $(sel, scope || document);
    return (scope || document).querySelector(sel);
  }

  function h(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function phaseKey(hour) {
    if (hour <= 10) return 'morning';
    if (hour <= 16) return 'day';
    return 'evening';
  }

  function clockText(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function baseName(file) {
    const text = String(file || '');
    const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
    return cut >= 0 ? text.slice(cut + 1) : text;
  }

  function videoId() {
    if (typeof uid === 'function') return uid('skv');
    return 'skv-' + Date.now();
  }

  function referenceSteps() {
    let steps = [];
    try {
      const cycle = typeof Store !== 'undefined' && Store.activeCycle ? Store.activeCycle() : null;
      const list = cycle && cycle.steps ? cycle.steps[phaseKey(new Date().getHours())] : null;
      if (Array.isArray(list)) steps = list;
    } catch { steps = []; }
    return steps;
  }

  function stepsHtml() {
    const steps = referenceSteps();
    if (!steps.length) {
      return '<div class="sk-ref"><h3>流程参考</h3><p class="hint">这一时段还没有步骤。步骤只是参考，不用打勾，可以直接录。</p></div>';
    }
    const items = steps.map(step => {
      const name = h(step && step.name || '');
      const detail = step && step.detail ? `<div class="sk-detail">${h(step.detail)}</div>` : '';
      return `<li><div class="sk-name">${name}</div>${detail}</li>`;
    }).join('');
    return `<div class="sk-ref"><h3>流程参考</h3><ol class="sk-ref-list">${items}</ol></div>`;
  }

  function paintIdle() {
    const el = session.el;
    if (!el) return;
    const note = session.notice ? `<p class="hint" id="sk-session-note" role="status">${h(session.notice)}</p>` : '';
    const label = session.askSettings ? '打开摄像头权限' : '开始护肤';
    el.innerHTML = `<div class="card">
      <h3>开始护肤</h3>
      <p class="hint">对着电脑。点下去就打开摄像头，并自动开始录。录像写进「护肤视频」文件夹。</p>
      ${note}
      <button type="button" id="sk-start-record" class="btn primary sk-start">${label}</button>
      ${stepsHtml()}
      <h3>护肤录像</h3>
      <div id="sk-video-list" class="sk-video-list"></div>
      <button type="button" class="btn" id="sk-open-video-folder">打开护肤视频文件夹</button>
    </div>`;
    const button = q(el, '#sk-start-record');
    if (button) button.onclick = () => { startRecording(); };
    const folder = q(el, '#sk-open-video-folder');
    if (folder) folder.onclick = () => {
      if (typeof native !== 'undefined' && typeof native.skincareVideoOpenFolder === 'function') native.skincareVideoOpenFolder();
    };
  }

  async function showIdle() {
    paintIdle();
    await refreshList();
  }

  function paintRecording() {
    const el = session.el;
    if (!el) return;
    const shown = session.startedMs ? clockText(Date.now() - session.startedMs) : '00:00';
    el.innerHTML = `<div class="card">
      <video id="sk-record-preview" class="sk-record-preview" autoplay muted playsinline></video>
      <p class="sk-record-status"><span class="sk-rec-dot" aria-hidden="true"></span><span>录制中</span><span id="sk-record-clock" class="sk-record-clock">${shown}</span></p>
      <button type="button" id="sk-stop-record" class="btn sk-stop">结束视频</button>
      ${stepsHtml()}
    </div>`;
    const button = q(el, '#sk-stop-record');
    if (button) button.onclick = () => { endRecording(); };
  }

  function attachPreview() {
    const video = session.el && q(session.el, '#sk-record-preview');
    if (!video || !session.stream) return Promise.resolve();
    if (video.srcObject !== session.stream) video.srcObject = session.stream;
    const playing = video.play();
    if (playing && typeof playing.catch === 'function') return playing.catch(() => {});
    return Promise.resolve();
  }

  function ensureClock() {
    if (session.clock) return;
    const draw = () => {
      const node = session.el && q(session.el, '#sk-record-clock');
      if (!node || !session.startedMs) return;
      node.textContent = clockText(Date.now() - session.startedMs);
    };
    draw();
    session.clock = setInterval(draw, 1000);
  }

  function clearClock() {
    if (session.clock) clearInterval(session.clock);
    session.clock = 0;
  }

  function releaseStream() {
    const stream = session.stream;
    session.stream = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    const video = session.el && q(session.el, '#sk-record-preview');
    if (video) video.srcObject = null;
  }

  function settleFile() {
    const resolve = session.openFile;
    session.openFile = null;
    session.fileWait = null;
    if (resolve) resolve();
  }

  function cameraNotice(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return '摄像头权限未开启';
    if (name === 'NotFoundError') return '没有找到摄像头';
    return '镜头没能打开';
  }

  async function bytesOf(chunk) {
    const data = chunk && Object.prototype.hasOwnProperty.call(chunk, 'data') ? chunk.data : chunk;
    if (!data) return new ArrayBuffer(0);
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (typeof data.arrayBuffer === 'function') return data.arrayBuffer();
    session.appendFailed = true;
    throw Error('chunk');
  }

  function rememberAppendError(err) {
    session.appendFailed = true;
    session.appendError = session.appendError || err;
  }

  function onChunk(chunk) {
    if (session.arming) {
      session.early.push(chunk);
      return Promise.resolve();
    }
    const job = session.queue.then(() => writeChunk(chunk));
    session.queue = job.then(() => {}, rememberAppendError);
    return job;
  }

  async function writeChunk(chunk) {
    const buf = await bytesOf(chunk);
    if (!buf || !buf.byteLength) return;
    if (session.fileWait) await session.fileWait;
    if (!session.file) {
      session.appendFailed = true;
      return;
    }
    const written = await native.skincareVideoAppend(session.file, buf);
    if (written == null) session.appendFailed = true;
  }

  async function teardown(notice, keepSettings) {
    settleFile();
    const recorder = session.recorder;
    session.recorder = null;
    if (recorder && typeof recorder.stop === 'function') {
      try { await recorder.stop(); } catch (err) { session.appendError = session.appendError || err; }
    }
    try { await session.queue; } catch (err) { session.appendError = session.appendError || err; }
    releaseStream();
    clearClock();
    session.mode = 'idle';
    session.file = null;
    session.startedAt = null;
    session.startedMs = 0;
    session.stopRequested = false;
    session.appendFailed = false;
    session.appendError = null;
    session.early = [];
    session.arming = false;
    session.askSettings = !!keepSettings;
    session.notice = notice || '';
    if (session.el) await showIdle();
  }

  function rememberVideo(row) {
    if (typeof Store === 'undefined' || !Store.db || !Store.db.skin) return;
    if (!Array.isArray(Store.db.skin.videos)) Store.db.skin.videos = [];
    Store.db.skin.videos.unshift({
      id: videoId(),
      file: row.file,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      ms: row.ms
    });
    Store.save(true);
  }

  async function loadItems() {
    if (typeof native !== 'undefined' && typeof native.skincareVideoList === 'function') {
      const rows = await native.skincareVideoList();
      return Array.isArray(rows) ? rows.filter(row => row && row.file) : [];
    }
    const saved = typeof Store !== 'undefined' && Store.db && Store.db.skin && Array.isArray(Store.db.skin.videos) ? Store.db.skin.videos : [];
    return saved.filter(row => row && row.file).map(row => ({ file: row.file }));
  }

  async function attachUrl(box, item, index, gen) {
    const video = q(box, `video[data-i="${index}"]`);
    if (!video) return;
    let url = null;
    try {
      if (typeof native !== 'undefined' && typeof native.skincareVideoURL === 'function') url = await native.skincareVideoURL(item.file);
    } catch { url = null; }
    if (gen !== session.listGen || !video.isConnected) return;
    if (!url) video.remove();
    else video.src = url;
  }

  async function refreshList() {
    const gen = ++session.listGen;
    const box = session.el && q(session.el, '#sk-video-list');
    if (!box) return;
    let items = [];
    try { items = await loadItems(); } catch { items = []; }
    if (gen !== session.listGen) return;
    const live = session.el && q(session.el, '#sk-video-list');
    if (!live) return;
    if (!items.length) {
      live.innerHTML = '<p class="hint sk-video-empty">还没有护肤录像。点开始护肤，对着电脑做完，再点结束视频。</p>';
      return;
    }
    live.innerHTML = items.map((item, index) => `<div class="sk-video-row"><video controls playsinline preload="metadata" data-i="${index}"></video><p class="hint">${h(baseName(item.file))}</p></div>`).join('');
    await Promise.all(items.map((item, index) => attachUrl(live, item, index, gen)));
  }

  async function openCamera() {
    if (typeof native !== 'undefined' && typeof native.cameraPermission === 'function') {
      const permission = await native.cameraPermission();
      if (!permission || permission.granted !== true) {
        session.askSettings = true;
        session.notice = '摄像头权限未开启';
        await showIdle();
        return null;
      }
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
  }

  function queueEarly() {
    const pending = session.early.splice(0);
    pending.forEach(chunk => onChunk(chunk));
  }

  async function startRecording() {
    if (session.starting || session.stopping || session.mode === 'recording') return;
    if (session.askSettings) {
      if (typeof native !== 'undefined' && typeof native.openCameraSettings === 'function') {
        try { await native.openCameraSettings(); } catch { session.notice = session.notice || '摄像头权限未开启'; }
      }
      return;
    }
    session.starting = true;
    session.notice = '';
    session.appendFailed = false;
    session.appendError = null;
    session.file = null;
    session.queue = Promise.resolve();
    session.stopRequested = false;
    try {
      const stream = await openCamera();
      if (!stream) return;
      if (session.mode === 'recording' && session.stream) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      session.stream = stream;
      session.mode = 'recording';
      paintRecording();
      await attachPreview();
      if (typeof SkincareRecorder === 'undefined' || typeof SkincareRecorder.createRecorder !== 'function') {
        await teardown('录制组件没装上');
        return;
      }
      session.early = [];
      session.arming = true;
      session.fileWait = new Promise(resolve => { session.openFile = resolve; });
      session.recorder = SkincareRecorder.createRecorder(stream, { onChunk, timeslice: 1000 });
      try { await session.recorder.start(); }
      finally { session.arming = false; }
      const startedAt = new Date().toISOString();
      session.startedAt = startedAt;
      session.startedMs = Date.parse(startedAt) || Date.now();
      ensureClock();
      let begun = null;
      if (typeof native !== 'undefined' && typeof native.skincareVideoBegin === 'function') {
        try { begun = await native.skincareVideoBegin({ startedAt }); }
        catch { begun = null; }
      }
      if (!begun || !begun.file) {
        await teardown('视频文件夹没能建好');
        return;
      }
      session.file = begun.file;
      settleFile();
      queueEarly();
      if (session.stopRequested) {
        session.stopRequested = false;
        await endRecording();
      }
    } catch (err) {
      const notice = cameraNotice(err);
      const ask = notice === '摄像头权限未开启';
      if (session.stream || session.recorder || session.mode === 'recording') await teardown(notice, ask);
      else {
        session.askSettings = ask;
        session.notice = notice;
        if (session.el) await showIdle();
      }
    } finally {
      session.starting = false;
    }
  }

  async function endRecording() {
    if (session.stopping) return;
    if (session.mode !== 'recording') return;
    if (!session.file) {
      session.stopRequested = true;
      return;
    }
    session.stopping = true;
    const file = session.file;
    const startedAt = session.startedAt;
    const startedMs = session.startedMs || Date.now();
    const button = session.el && q(session.el, '#sk-stop-record');
    if (button) button.disabled = true;
    let closed = false;
    try {
      if (session.recorder && typeof session.recorder.stop === 'function') {
        const recorder = session.recorder;
        session.recorder = null;
        await recorder.stop();
      }
      await session.queue;
      if (session.appendError) throw session.appendError;
      const failed = session.appendFailed;
      await native.skincareVideoFinish(file);
      closed = true;
      releaseStream();
      clearClock();
      session.mode = 'idle';
      session.file = null;
      session.startedAt = null;
      session.startedMs = 0;
      session.stopRequested = false;
      if (failed) session.notice = '录像没能保存';
      else {
        const endedAt = new Date().toISOString();
        rememberVideo({ file, startedAt, endedAt, ms: Math.max(0, Date.now() - startedMs) });
        session.notice = '';
        if (typeof toast === 'function') toast('护肤视频已保存', 'green');
      }
      session.appendFailed = false;
      session.appendError = null;
      session.askSettings = false;
      if (session.el) await showIdle();
    } catch (err) {
      session.appendError = session.appendError || err;
      if (!closed && file && typeof native !== 'undefined' && typeof native.skincareVideoFinish === 'function') {
        try { await native.skincareVideoFinish(file); } catch (finishErr) { session.appendError = finishErr; }
      }
      releaseStream();
      clearClock();
      session.mode = 'idle';
      session.file = null;
      session.recorder = null;
      session.startedAt = null;
      session.startedMs = 0;
      session.appendFailed = false;
      session.appendError = null;
      session.notice = '录像没能保存';
      if (session.el) await showIdle();
    } finally {
      session.stopping = false;
    }
  }

  root.SkincareSession = SkincareSession;
})(typeof window !== 'undefined' ? window : globalThis);
