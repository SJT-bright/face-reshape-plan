const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickMime, extForMime, createRecorder } = require('../src/js/skincare-recorder');

function blobFrom(bytes) {
  const data = Uint8Array.from(bytes);
  return {
    size: data.byteLength,
    arrayBuffer() { return Promise.resolve(data.buffer); }
  };
}

function makeRecorder(supported) {
  const instances = [];
  class FakeMediaRecorder {
    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.mimeType = options ? options.mimeType : undefined;
      this.timeslice = undefined;
      this.listeners = new Map();
      instances.push(this);
    }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    emit(type, event) {
      for (const fn of (this.listeners.get(type) || []).slice()) fn.call(this, event);
    }
    start(timeslice) {
      this.timeslice = timeslice;
      this.state = 'recording';
      queueMicrotask(() => {
        this.emit('dataavailable', { data: blobFrom([1, 2, 3]) });
      });
    }
    stop() {
      this.emit('dataavailable', { data: blobFrom([4, 5, 6]) });
      this.state = 'inactive';
      this.emit('stop', {});
    }
    static isTypeSupported(mime) {
      return supported(mime);
    }
  }
  FakeMediaRecorder.instances = instances;
  return FakeMediaRecorder;
}

function bytes(buf) {
  return [...new Uint8Array(buf)];
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('优先 vp9，webm 优于 mp4，都不支持时为空串', () => {
  assert.equal(pickMime(() => true), 'video/webm;codecs=vp9');
  assert.equal(pickMime((mime) => mime === 'video/webm;codecs=vp8' || mime === 'video/mp4'), 'video/webm;codecs=vp8');
  assert.equal(pickMime((mime) => mime === 'video/webm' || mime === 'audio/webm' || mime === 'video/mp4'), 'video/webm');
  assert.equal(pickMime((mime) => mime === 'audio/webm'), '');
  assert.equal(pickMime(() => false), '');
  assert.equal(extForMime('video/webm;codecs=vp9'), 'webm');
  assert.equal(extForMime('video/webm'), 'webm');
  assert.equal(extForMime('video/mp4'), 'mp4');
  assert.equal(extForMime(''), 'webm');
});

test('只有 mp4 时用 mp4', async () => {
  const calls = [];
  const mime = pickMime((type) => {
    calls.push(type);
    return type === 'video/mp4';
  });
  assert.equal(mime, 'video/mp4');
  assert.deepEqual(calls, ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']);
  const Fake = makeRecorder((type) => type === 'video/mp4');
  const rec = createRecorder({}, { MediaRecorder: Fake, timeslice: 250 });
  assert.equal(rec.mime, 'video/mp4');
  assert.equal(extForMime(rec.mime), 'mp4');
  await rec.start();
  assert.equal(Fake.instances.length, 1);
  assert.equal(Fake.instances[0].mimeType, 'video/mp4');
  assert.equal(Fake.instances[0].timeslice, 250);
});

test('onChunk 按顺序收到两段，重复 start 忽略，stop 的 ms >= 0', async () => {
  const Fake = makeRecorder(() => true);
  const seen = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let second = false;
  const rec = createRecorder({ id: 'skin' }, {
    MediaRecorder: Fake,
    async onChunk(buf) {
      assert.ok(buf instanceof ArrayBuffer);
      if (seen.length === 0) {
        seen.push(bytes(buf));
        await gate;
      } else {
        second = true;
        seen.push(bytes(buf));
      }
    }
  });
  assert.equal(rec.mime, 'video/webm;codecs=vp9');
  assert.deepEqual(await rec.stop(), { mime: 'video/webm;codecs=vp9', ms: 0 });
  await rec.start();
  await tick();
  assert.equal(seen.length, 1);
  await rec.start();
  assert.equal(Fake.instances.length, 1);
  assert.equal(Fake.instances[0].mimeType, 'video/webm;codecs=vp9');
  assert.equal(Fake.instances[0].timeslice, 1000);
  const pending = rec.stop();
  await tick();
  assert.equal(second, false);
  release();
  const result = await pending;
  assert.deepEqual(seen, [[1, 2, 3], [4, 5, 6]]);
  assert.equal(result.mime, 'video/webm;codecs=vp9');
  assert.equal(typeof result.ms, 'number');
  assert.ok(result.ms >= 0);
});

test('onChunk 抛错时 stop 抛出，且不拒绝 start', async () => {
  const Fake = makeRecorder((mime) => mime === 'video/webm');
  const rec = createRecorder({}, {
    MediaRecorder: Fake,
    onChunk() { throw new Error('chunk-boom'); }
  });
  await rec.start();
  await assert.rejects(rec.stop(), /chunk-boom/);
});

test('没有 MediaRecorder 时 start 拒绝；构造失败原样抛出', async () => {
  assert.equal(typeof globalThis.MediaRecorder, 'undefined');
  const rec = createRecorder({});
  await assert.rejects(rec.start(), (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /无法录制/);
    return true;
  });
  class Boom {
    constructor() { throw new Error('构造失败'); }
    static isTypeSupported() { return false; }
  }
  const broken = createRecorder({}, { MediaRecorder: Boom });
  assert.equal(broken.mime, '');
  await assert.rejects(broken.start(), /构造失败/);
  assert.equal(extForMime(broken.mime), 'webm');
});
