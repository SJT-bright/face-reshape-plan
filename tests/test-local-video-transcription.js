'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createLocalVideoTranscriber, MODEL_NAMES, ENGINE, runLocalCommand } = require('../src/js/local-video-transcription');

async function fixture(t, overrides = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'life-video-asr-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const media = path.join(temp, '录像 空格.webm');
  await fs.writeFile(media, 'synthetic local-video bytes');
  const dependencies = {};
  for (const name of ['python', 'helper', 'ffmpeg', 'ffprobe']) {
    dependencies[name] = path.join(temp, name);
    await fs.writeFile(dependencies[name], 'test dependency');
  }
  dependencies.models = path.join(temp, 'models');
  for (const model of MODEL_NAMES) {
    const directory = path.join(dependencies.models, 'modelscope', 'models', model, 'snapshots', 'master');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'config.yaml'), 'test model');
    await fs.writeFile(path.join(directory, 'model.pt'), 'test weights');
  }
  const commands = [];
  const command = async (executable, args, options) => {
    commands.push({ executable, args, options });
    if (args.includes('--check')) return JSON.stringify({ available: true, engine: ENGINE });
    if (executable === dependencies.ffprobe) return JSON.stringify({
      streams: [{ codec_type: 'video' }, { codec_type: 'audio', duration: '6' }], format: { duration: '6' },
    });
    if (executable === dependencies.ffmpeg) { await fs.writeFile(args.at(-1), 'test decoded wav'); return ''; }
    await fs.writeFile(args[args.indexOf('--output') + 1], JSON.stringify({
      text: '今天阅读了三十分钟，没有跑步。', duration: 6, engine: ENGINE,
      segments: [{ start: 0.2, end: 5.9, text: '今天阅读了三十分钟，没有跑步。' }],
    }));
    return '';
  };
  const options = { ...dependencies, tempRoot: temp, allowedRoots: [temp], adapters: { command }, ...overrides };
  return { temp, media, dependencies, commands, command, options, transcriber: createLocalVideoTranscriber(options) };
}

test('local worker reports offline availability, cache and explicit dependency failure', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.transcriber.getStatus(), { available: true, engine: ENGINE, offline: true, error: '', code: '' });
  await f.transcriber.getStatus();
  assert.equal(f.commands.length, 1);
  await f.transcriber.getStatus({ force: true });
  assert.equal(f.commands.length, 2);
  const missing = createLocalVideoTranscriber({ ...f.options, python: path.join(f.temp, 'missing-python') });
  assert.equal((await missing.getStatus()).code, 'DEPENDENCY_MISSING');
  const model = path.join(f.dependencies.models, 'modelscope', 'models', MODEL_NAMES[0], 'snapshots', 'master', 'model.pt');
  await fs.unlink(model);
  assert.equal((await f.transcriber.getStatus({ force: true })).code, 'MODEL_MISSING');
});

test('complete transcript, timestamps, cancelled-signal contract, private temp cleanup and source preservation', async t => {
  const f = await fixture(t), original = await fs.readFile(f.media);
  const stages = [];
  const result = await f.transcriber.transcribeVideo(f.media, { onProgress: value => stages.push(value.stage) });
  assert.equal(result.text, '今天阅读了三十分钟，没有跑步。');
  assert.deepEqual(result.segments, [{ start: 0.2, end: 5.9, text: result.text }]);
  assert.equal(result.engine, ENGINE);
  assert.equal(result.duration, 6);
  assert.deepEqual(stages, ['checking', 'extracting', 'transcribing', 'complete']);
  assert.deepEqual(await fs.readFile(f.media), original);
  assert.deepEqual((await fs.readdir(f.temp)).filter(name => name.startsWith('life-reshape-video-asr-')), []);
  const decode = f.commands.find(call => call.executable === f.dependencies.ffmpeg);
  assert.equal(decode.args[decode.args.indexOf('-i') + 1], await fs.realpath(f.media));
  assert.equal(decode.args[decode.args.indexOf('-map') + 1], '0:a:0');
  assert.equal(decode.args[decode.args.indexOf('-protocol_whitelist') + 1], 'file,pipe');
  assert.equal(decode.options.env.HF_HUB_OFFLINE, '1');
  assert.equal(decode.options.env.OPENAI_API_KEY, undefined);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.transcriber.transcribeVideo(f.media, { signal: abort.signal }), { code: 'CANCELLED' });
});

test('old silent recordings fail clearly and never invoke decode or fabricate an empty transcript', async t => {
  const f = await fixture(t);
  const transcriber = createLocalVideoTranscriber({ ...f.options, adapters: { command: async (executable, args, options) =>
    executable === f.dependencies.ffprobe ? JSON.stringify({ streams: [{ codec_type: 'video' }], format: { duration: '6' } }) : f.command(executable, args, options),
  } });
  await assert.rejects(transcriber.transcribeVideo(f.media), error => error.code === 'NO_AUDIO' && /旧录像没有声音/.test(error.message));
  assert.equal(f.commands.length, 0);
  assert.deepEqual((await fs.readdir(f.temp)).filter(name => name.startsWith('life-reshape-video-asr-')), []);
});

test('unsafe and invalid paths, non-video, empty/large files and symlink escapes fail before decode', async t => {
  const f = await fixture(t);
  for (const file of ['https://example.org/video.webm', 'relative.webm', `${f.media}\0`, path.join(f.temp, 'words.txt')]) {
    await assert.rejects(f.transcriber.transcribeVideo(file), { code: 'INVALID_PATH' });
  }
  await assert.rejects(f.transcriber.transcribeVideo(path.join(f.temp, 'gone.webm')), { code: 'FILE_MISSING' });
  const empty = path.join(f.temp, 'empty.webm'); await fs.writeFile(empty, '');
  await assert.rejects(f.transcriber.transcribeVideo(empty), { code: 'INVALID_FILE' });
  await assert.rejects(createLocalVideoTranscriber({ ...f.options, maxBytes: 1 }).transcribeVideo(f.media), { code: 'FILE_TOO_LARGE' });
  const library = path.join(f.temp, 'library'); await fs.mkdir(library);
  const link = path.join(library, 'outside.webm'); await fs.symlink(f.media, link);
  await assert.rejects(createLocalVideoTranscriber({ ...f.options, allowedRoots: [library] }).transcribeVideo(link), { code: 'PATH_OUTSIDE_LIBRARY' });
  const noVideo = createLocalVideoTranscriber({ ...f.options, adapters: { command: async () => JSON.stringify({ streams: [{ codec_type: 'audio' }] }) } });
  await assert.rejects(noVideo.transcribeVideo(f.media), { code: 'NO_VIDEO' });
});

test('rejects long recordings, empty and truncated results without silently shortening the source', async t => {
  const f = await fixture(t);
  const tooLong = createLocalVideoTranscriber({ ...f.options, adapters: { command: async () => JSON.stringify({
    streams: [{ codec_type: 'video' }, { codec_type: 'audio' }], format: { duration: '7201' },
  }) } });
  await assert.rejects(tooLong.transcribeVideo(f.media), { code: 'TOO_LONG' });
  for (const [body, code] of [
    [{ text: '', engine: ENGINE, duration: 6 }, 'INVALID_RESULT'],
    [{ text: '只有开头', engine: ENGINE, duration: 2 }, 'INCOMPLETE_RESULT'],
    [{ text: '正文', engine: 'cloud-asr', duration: 6 }, 'INVALID_RESULT'],
  ]) {
    const transcriber = createLocalVideoTranscriber({ ...f.options, adapters: { command: async (executable, args, options) => {
      if (executable !== f.dependencies.python) return f.command(executable, args, options);
      await fs.writeFile(args[args.indexOf('--output') + 1], JSON.stringify(body)); return '';
    } } });
    await assert.rejects(transcriber.transcribeVideo(f.media), { code });
    assert.deepEqual((await fs.readdir(f.temp)).filter(name => name.startsWith('life-reshape-video-asr-')), []);
  }
});

test('ASR failures clean temporary audio; unusable timestamps retain complete original words', async t => {
  const f = await fixture(t);
  const failure = createLocalVideoTranscriber({ ...f.options, adapters: { command: async (executable, args, options) => {
    if (executable !== f.dependencies.python) return f.command(executable, args, options);
    throw new Error('simulated inference failure');
  } } });
  await assert.rejects(failure.transcribeVideo(f.media), /simulated inference failure/);
  assert.deepEqual((await fs.readdir(f.temp)).filter(name => name.startsWith('life-reshape-video-asr-')), []);
  const invalidTimestamp = createLocalVideoTranscriber({ ...f.options, adapters: { command: async (executable, args, options) => {
    if (executable !== f.dependencies.python) return f.command(executable, args, options);
    await fs.writeFile(args[args.indexOf('--output') + 1], JSON.stringify({ text: '整段文字仍然保留。', duration: 6, engine: ENGINE,
      segments: [{ start: null, end: 4, text: '坏时间戳' }, { start: 0, end: 8, text: '越界' }] })); return '';
  } } });
  assert.deepEqual(await invalidTimestamp.transcribeVideo(f.media), { text: '整段文字仍然保留。', segments: [], engine: ENGINE, duration: 6, language: 'zh' });
});

test('cancelling after extraction removes the temporary WAV before inference begins', async t => {
  const f = await fixture(t), controller = new AbortController();
  const transcriber = createLocalVideoTranscriber({ ...f.options, adapters: { command: async (executable, args, options) => {
    const result = await f.command(executable, args, options);
    if (executable === f.dependencies.ffmpeg) controller.abort();
    return result;
  } } });
  await assert.rejects(transcriber.transcribeVideo(f.media, { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(f.commands.some(call => call.executable === f.dependencies.python), false);
  assert.deepEqual((await fs.readdir(f.temp)).filter(name => name.startsWith('life-reshape-video-asr-')), []);
  assert.ok((await fs.stat(f.media)).isFile());
});

test('real child timeout, cancellation and spawn errors settle without exposing process diagnostics', async () => {
  await assert.rejects(runLocalCommand(process.execPath, ['-e', "process.stderr.write('private speech');setTimeout(()=>{},10000)"],
    { timeout: 20 }), error => error.code === 'TIMEOUT' && !error.message.includes('private speech'));
  const controller = new AbortController();
  const cancelled = runLocalCommand(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(cancelled, { code: 'CANCELLED' });
  await assert.rejects(runLocalCommand(path.join(os.tmpdir(), 'life-asr-definitely-nonexistent-bin'), []), { code: 'DEPENDENCY_MISSING' });
  await assert.rejects(runLocalCommand(process.execPath, ['-e', "process.stderr.write('private speech');process.exit(3)" ]),
    error => error.code === 'PROCESS_FAILED' && !error.message.includes('private speech'));
});
