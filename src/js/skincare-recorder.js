/* 护肤镜头录制。调用方传入 stream；这里不申请麦克风，也不碰 DOM。 */
(function (root) {
  'use strict';

  const WEBM_TYPES = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];

  function pickMime(isTypeSupported) {
    const ok = typeof isTypeSupported === 'function' ? isTypeSupported : () => false;
    for (const mime of WEBM_TYPES) {
      if (ok(mime)) return mime;
    }
    /* mp4 只在 webm 全不可用时兜底；否则交给浏览器默认。 */
    if (ok('video/mp4')) return 'video/mp4';
    return '';
  }

  function extForMime(mime) {
    const value = String(mime || '').toLowerCase();
    if (value.includes('mp4')) return 'mp4';
    return 'webm';
  }

  function createRecorder(stream, options) {
    const opts = options || {};
    const onChunk = typeof opts.onChunk === 'function' ? opts.onChunk : null;
    const timeslice = opts.timeslice == null ? 1000 : opts.timeslice;
    const injected = Object.prototype.hasOwnProperty.call(opts, 'MediaRecorder');

    function resolveCtor() {
      if (injected) return opts.MediaRecorder;
      if (typeof MediaRecorder === 'function') return MediaRecorder;
      if (typeof root.MediaRecorder === 'function') return root.MediaRecorder;
      return undefined;
    }

    const mime = pickMime((type) => {
      const Ctor = resolveCtor();
      return typeof Ctor === 'function' && typeof Ctor.isTypeSupported === 'function' && !!Ctor.isTypeSupported(type);
    });

    let recorder = null;
    let recording = false;
    let startedAt = 0;
    let tail = Promise.resolve();
    let chunkError = null;

    /* onChunk 串行排队。失败先记下，由 stop() 抛出，避免吞掉 start() 自己的异常。 */
    function pushChunk(blob) {
      if (!blob || !(blob.size > 0) || !onChunk) return;
      tail = tail.then(() => Promise.resolve(blob.arrayBuffer()).then((buf) => onChunk(buf))).catch((err) => {
        if (chunkError == null) chunkError = err;
      });
    }

    function onData(event) {
      pushChunk(event && event.data);
    }

    async function start() {
      if (recording) return;
      const Ctor = resolveCtor();
      if (typeof Ctor !== 'function') throw new Error('无法录制');
      const rec = new Ctor(stream, mime ? { mimeType: mime } : undefined);
      if (typeof rec.addEventListener === 'function') rec.addEventListener('dataavailable', onData);
      else rec.ondataavailable = onData;
      startedAt = Date.now();
      recording = true;
      recorder = rec;
      try {
        rec.start(timeslice);
      } catch (err) {
        recording = false;
        recorder = null;
        throw err;
      }
    }

    async function stop() {
      if (!recording) return { mime, ms: 0 };
      recording = false;
      const rec = recorder;
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const fail = (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        };
        if (typeof rec.addEventListener === 'function') rec.addEventListener('stop', finish);
        else {
          const prev = rec.onstop;
          rec.onstop = (event) => {
            if (typeof prev === 'function') prev(event);
            finish();
          };
        }
        try {
          rec.stop();
        } catch (err) {
          fail(err);
        }
      });
      await tail;
      const err = chunkError;
      chunkError = null;
      if (err) throw err;
      return { mime, ms: Math.max(0, Date.now() - startedAt) };
    }

    return {
      start,
      stop,
      get mime() { return mime; }
    };
  }

  const api = { pickMime, extForMime, createRecorder };
  root.SkincareRecorder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
