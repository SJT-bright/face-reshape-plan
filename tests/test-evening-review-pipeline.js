'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createEveningReviewPipeline, createOllamaTranscriptCleaner, createLifepivotReviewAppender, mergeReview, fillerCandidates } = require('../src/js/evening-review-pipeline');

const DATE = '2026-10-14';
const RAW = '嗯，今天学习了三十分钟英语。我没有去跑步。呃，晚上做了护肤。';
const CLEAN = '今天学习了三十分钟英语。我没有去跑步。晚上做了护肤。';
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evening-review-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const videoPath = path.join(root, '护肤-20261014-220000.webm');
  fs.writeFileSync(videoPath, 'isolated synthetic video bytes');
  return { root, jobsDir: path.join(root, 'jobs'), video: { file: path.basename(videoPath), videoPath, date: DATE, phase: 'evening' } };
}
const receipt = job => ({ noteId: 'test-personal-note', date: job.source.date, revision: 1, url: `http://127.0.0.1:3216/daily-review?date=${DATE}` });
const deps = () => ({ transcribe: async () => ({ text: RAW, segments: [{ start: 0, end: 3, text: RAW }], engine: 'test-asr' }), cleanup: async () => ({ text: CLEAN, model: 'test-local', deletions: [] }), sync: async job => receipt(job) });

test('only explicit evening recordings can enter the pipeline', async t => {
  const f = fixture(t); let calls = 0;
  const pipeline = createEveningReviewPipeline({ ...f, ...deps(), transcribe: async () => { calls++; } });
  for (const phase of ['morning', 'day', undefined]) await assert.rejects(pipeline.run({ ...f.video, phase }), { code: 'EVENING_ONLY' });
  assert.equal(calls, 0); assert.equal(pipeline.listJobs().length, 0);
  await assert.rejects(pipeline.run({ ...f.video, date: '2026-02-30' }), { code: 'INVALID_VIDEO' });
  await assert.rejects(pipeline.run({ ...f.video, file: 'other.webm' }), { code: 'INVALID_VIDEO' });
});

test('the ASR original and segments remain exact; every stage is durably observable', async t => {
  const f = fixture(t), seen = [], pipeline = createEveningReviewPipeline({ ...f, ...deps() });
  const completed = await pipeline.run(f.video, { onProgress: event => {
    const persisted = pipeline.getJobById(event.id);
    assert.equal(persisted.status, event.stage);
    seen.push(event.stage);
  } });
  assert.equal(completed.status, 'completed'); assert.equal(completed.raw.text, RAW); assert.equal(completed.cleaned.text, CLEAN);
  assert.deepEqual(completed.raw.segments, [{ start: 0, end: 3, text: RAW }]);
  for (const stage of ['queued', 'transcribing', 'transcribed', 'cleaning', 'cleaned', 'syncing', 'completed']) assert.ok(seen.includes(stage), stage);
  assert.deepEqual((await pipeline.getJob(f.video)).receipt, completed.receipt);
  const file = path.join(f.jobsDir, completed.id + '.json');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(f.jobsDir).filter(name => /\.lock$|\.tmp$/.test(name)).length, 0);
});

test('same video content, concurrent clicks, copy paths and process restart do not repeat work', async t => {
  const f = fixture(t), calls = { asr: 0, cleanup: 0, sync: 0 };
  const d = { transcribe: async () => { calls.asr++; await new Promise(resolve => setTimeout(resolve, 15)); return { text: RAW }; },
    cleanup: async () => { calls.cleanup++; return { text: CLEAN }; }, sync: async job => { calls.sync++; return receipt(job); } };
  const pipeline = createEveningReviewPipeline({ ...f, ...d });
  const copy = path.join(f.root, 'copied.webm'); fs.copyFileSync(f.video.videoPath, copy);
  const results = await Promise.all([pipeline.run(f.video), pipeline.run({ ...f.video, file: path.basename(copy), videoPath: copy })]);
  assert.equal(results[0].id, results[1].id);
  const restarted = createEveningReviewPipeline({ ...f, ...d }); await restarted.run(f.video);
  assert.deepEqual(calls, { asr: 1, cleanup: 1, sync: 1 });
  await assert.rejects(restarted.run({ ...f.video, date: '2026-10-15' }), { code: 'SOURCE_DATE_CONFLICT' });
  assert.equal(restarted.listJobs()[0].status, 'completed');
});

test('cleanup failure preserves the original; retry resumes cleanup without repeating ASR', async t => {
  const f = fixture(t); let asr = 0, clean = 0, synced = 0;
  const d = { transcribe: async () => { asr++; return { text: RAW }; }, cleanup: async () => { clean++; if (clean === 1) throw new Error('test model unavailable'); return { text: CLEAN }; }, sync: async job => { synced++; return receipt(job); } };
  const pipeline = createEveningReviewPipeline({ ...f, ...d });
  await assert.rejects(pipeline.run(f.video), /model unavailable/);
  const failed = pipeline.listJobs()[0]; assert.equal(failed.status, 'failed'); assert.equal(failed.raw.text, RAW); assert.equal(failed.cleaned, null); assert.equal(synced, 0);
  const resumed = await createEveningReviewPipeline({ ...f, ...d }).run(f.video);
  assert.equal(resumed.status, 'completed'); assert.equal(resumed.attempts, 2); assert.equal(asr, 1); assert.equal(clean, 2);
});

test('empty speech and partial cleanup never import an empty or partial review', async t => {
  const f = fixture(t); let synced = 0;
  const pipeline = createEveningReviewPipeline({ ...f, ...deps(), transcribe: async () => ({ text: ' ' }), sync: async () => { synced++; } });
  await assert.rejects(pipeline.run(f.video), { code: 'NO_TRANSCRIPT' }); assert.equal(synced, 0);
  const resumed = createEveningReviewPipeline({ ...f, ...deps(), cleanup: async () => ({ text: CLEAN, chunksFailed: 1 }), sync: async () => { synced++; } });
  await assert.rejects(resumed.run(f.video), { code: 'CLEANUP_INCOMPLETE' }); assert.equal(synced, 0); assert.equal(resumed.listJobs()[0].raw.text, RAW);
});

test('cancellation after transcription preserves original and does not sync', async t => {
  const f = fixture(t), controller = new AbortController(); let synced = 0;
  const pipeline = createEveningReviewPipeline({ ...f, ...deps(), transcribe: async () => { controller.abort(); return { text: RAW }; }, sync: async () => { synced++; } });
  await assert.rejects(pipeline.run(f.video, { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(pipeline.listJobs()[0].raw.text, RAW); assert.equal(synced, 0);
});

test('corrupt task storage is not silently replaced by a new transcription', async t => {
  const f = fixture(t), pipeline = createEveningReviewPipeline({ ...f, ...deps() });
  const job = await pipeline.run(f.video), file = path.join(f.jobsDir, job.id + '.json');
  fs.writeFileSync(file, '{invalid-keep-original');
  await assert.rejects(pipeline.run(f.video), { code: 'CORRUPT_JOB' });
  assert.equal(fs.readFileSync(file, 'utf8'), '{invalid-keep-original');
});

test('LLM cleanup only removes matched fillers; facts, negation and numbers cannot be rewritten', async () => {
  const seen = [];
  const clean = createOllamaTranscriptCleaner({ fetch: async (_url, options) => {
    const request = JSON.parse(options.body), input = JSON.parse(request.messages[1].content); seen.push(input);
    return json({ done: true, done_reason: 'stop', message: { content: JSON.stringify({ remove: input.candidates.map(item => item.id) }) } });
  } });
  const result = await clean(RAW);
  assert.equal(result.text, CLEAN); assert.equal(result.model, 'qwen3:14b'); assert.equal(result.coverage.characters, RAW.length);
  assert.deepEqual(result.deletions.map(x => x.quote), ['嗯', '呃']);
  assert.ok(result.text.includes('三十分钟')); assert.ok(result.text.includes('没有去跑步'));
  assert.deepEqual(fillerCandidates('额头上是那个文件的照片，啊Q的记录没有修改。'), []);
  assert.equal(seen.length, 1);
});

test('LLM cannot smuggle replacement prose, unknown deletions or incomplete output into a review', async () => {
  for (const content of [JSON.stringify({ remove: [], rewritten: '我跑步了' }), JSON.stringify({ remove: ['not-in-source'] }), JSON.stringify({ remove: ['f0', 'f0'] }), 'not-json']) {
    const clean = createOllamaTranscriptCleaner({ fetch: async () => json({ done: true, message: { content } }) });
    await assert.rejects(clean(RAW), { code: 'INVALID_CLEANUP' });
  }
  const incomplete = createOllamaTranscriptCleaner({ fetch: async () => json({ done: true, done_reason: 'length', message: { content: '{"remove":[]}' } }) });
  await assert.rejects(incomplete(RAW), { code: 'MODEL_INCOMPLETE' });
  assert.throws(() => createOllamaTranscriptCleaner({ model: 'qwen3.5:cloud' }), { code: 'INVALID_MODEL' });
  assert.throws(() => createOllamaTranscriptCleaner({ endpoint: 'https://cloud.example' }), { code: 'INVALID_ENDPOINT' });
  assert.throws(() => createLifepivotReviewAppender({ endpoint: 'http://192.168.1.2:3216' }), { code: 'INVALID_ENDPOINT' });
});

test('long transcripts are fully covered, retain surrogate pairs, and never use a summary substitute', async () => {
  const original = ('嗯，完成任务😀。我没有删掉事实。\n').repeat(180);
  let totalSource = '', calls = 0;
  const clean = createOllamaTranscriptCleaner({ fetch: async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content); totalSource += input.transcript; calls++;
    assert.ok(!/^[\uDC00-\uDFFF]/.test(input.transcript)); assert.ok(!/[\uD800-\uDBFF]$/.test(input.transcript));
    return json({ done: true, message: { content: JSON.stringify({ remove: input.candidates.map(item => item.id) }) } });
  } });
  const result = await clean(original);
  assert.equal(totalSource, original); assert.ok(calls > 1); assert.equal(result.coverage.chunks, calls);
  assert.equal(result.text, ('完成任务😀。我没有删掉事实。\n').repeat(180));
});

test('merge only appends completed, preserves other fields and all existing legacy text', () => {
  const record = { schemaVersion: 'daily-review-template-v1', completed: '已有事项', effective: '已有经验', tomorrow: '已有计划', futureField: '保留' };
  const merged = JSON.parse(mergeReview(JSON.stringify(record), '新事项'));
  assert.deepEqual(merged, { ...record, completed: '已有事项\n\n新事项' });
  assert.equal(JSON.parse(mergeReview('旧版整段备注', '追加')).completed, '旧版整段备注\n\n追加');
  assert.throws(() => mergeReview('x'.repeat(20000), 'new'), { code: 'REVIEW_TOO_LONG' });
});

async function fakeLibrary(t, handler) {
  const server = http.createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      await handler(req, res, body);
    } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
function send(res, body, status = 200) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }

test('HTTP integration appends through the real personal-notes contract and preserves prior fields', async t => {
  const f = fixture(t); let posts = 0, note = { id: 'existing-note', businessDate: DATE, revision: 4, content: JSON.stringify({ schemaVersion: 'daily-review-template-v1', completed: '上午开会', effective: '有效事项', tomorrow: '明天任务' }) };
  const endpoint = await fakeLibrary(t, (req, res, body) => {
    assert.equal(req.url, req.method === 'GET' ? `/api/v1/personal-notes?date=${DATE}` : '/api/v1/personal-notes');
    if (req.method === 'GET') return send(res, { note });
    posts++; assert.equal(req.headers.origin, endpoint); assert.match(req.headers['idempotency-key'], /^[A-Za-z0-9_-]{16,128}$/);
    const command = JSON.parse(body); assert.equal(command.type, 'save-personal-daily-note'); assert.equal(command.expectedRevision, note.revision); assert.equal(command.noteId, note.id);
    note = { ...note, content: command.content, revision: note.revision + 1 }; send(res, { result: note });
  });
  const pipeline = createEveningReviewPipeline({ ...f, ...deps(), sync: createLifepivotReviewAppender({ endpoint }) });
  const job = await pipeline.run(f.video), parsed = JSON.parse(note.content);
  assert.equal(parsed.effective, '有效事项'); assert.equal(parsed.tomorrow, '明天任务'); assert.ok(parsed.completed.startsWith('上午开会\n\n')); assert.ok(parsed.completed.includes(CLEAN)); assert.ok(parsed.completed.includes(`#${job.id}`));
  assert.equal(job.receipt.url, `${endpoint}/daily-review?date=${DATE}`); assert.equal(posts, 1);
  await pipeline.run(f.video); assert.equal(posts, 1);
});

test('CAS conflict rereads the latest note and does not erase a concurrent edit', async t => {
  const f = fixture(t); let posts = 0, note = { id: 'existing-note', businessDate: DATE, revision: 1, content: '原来文字' };
  const endpoint = await fakeLibrary(t, (req, res, body) => {
    if (req.method === 'GET') return send(res, { note });
    const command = JSON.parse(body); posts++;
    if (posts === 1) { note = { ...note, revision: 2, content: '另一个窗口刚保存的文字' }; return send(res, { message: 'changed' }, 409); }
    assert.equal(command.expectedRevision, 2); assert.ok(JSON.parse(command.content).completed.startsWith('另一个窗口刚保存的文字'));
    note = { ...note, revision: 3, content: command.content }; send(res, { result: note });
  });
  const pipeline = createEveningReviewPipeline({ ...f, ...deps(), sync: createLifepivotReviewAppender({ endpoint }) });
  const result = await pipeline.run(f.video); assert.equal(result.receipt.revision, 3); assert.equal(posts, 2);
});

test('an unknown committed POST replays the frozen request after restart without overwriting later edits', async t => {
  const f = fixture(t); let asr = 0, cleanup = 0, posts = 0, savedReply, laterNote, firstBody, firstKey;
  const endpoint = await fakeLibrary(t, (req, res, body) => {
    if (req.method === 'GET') return send(res, { note: laterNote || null });
    posts++;
    if (posts === 1) {
      firstBody = body; firstKey = req.headers['idempotency-key'];
      const command = JSON.parse(body); savedReply = { id: command.noteId, businessDate: DATE, revision: 1, content: command.content };
      laterNote = { ...savedReply, revision: 2, content: command.content + '有人随后编辑' };
      return res.destroy(); // Already committed, the acknowledgement was lost.
    }
    assert.equal(body, firstBody); assert.equal(req.headers['idempotency-key'], firstKey);
    return send(res, { result: savedReply }); // Server's idempotency receipt, not another write.
  });
  const d = { transcribe: async () => { asr++; return { text: RAW }; }, cleanup: async () => { cleanup++; return { text: CLEAN }; }, sync: createLifepivotReviewAppender({ endpoint }) };
  const pipeline = createEveningReviewPipeline({ ...f, ...d });
  await assert.rejects(pipeline.run(f.video), { code: 'SYNC_UNCERTAIN' });
  const failed = pipeline.listJobs()[0]; assert.equal(failed.raw.text, RAW); assert.equal(failed.cleaned.text, CLEAN); assert.equal(failed.sync.pending.body, firstBody);
  const restarted = createEveningReviewPipeline({ ...f, ...d }); const result = await restarted.run(f.video);
  assert.equal(result.status, 'completed'); assert.equal(asr, 1); assert.equal(cleanup, 1); assert.equal(posts, 2); assert.ok(laterNote.content.endsWith('有人随后编辑'));
});

test('source marker on the target avoids a duplicate even when the local receipt is missing', async t => {
  const f = fixture(t); let posts = 0, note;
  const endpoint = await fakeLibrary(t, (req, res, body) => {
    if (req.method === 'GET') return send(res, { note: note || null });
    posts++; const command = JSON.parse(body); note = { id: command.noteId, businessDate: DATE, revision: 1, content: command.content }; send(res, { result: note });
  });
  const d = { ...deps(), sync: createLifepivotReviewAppender({ endpoint }) };
  const pipeline = createEveningReviewPipeline({ ...f, ...d }); const first = await pipeline.run(f.video);
  const persisted = JSON.parse(fs.readFileSync(path.join(f.jobsDir, first.id + '.json'), 'utf8')); persisted.status = 'failed'; persisted.receipt = null;
  fs.writeFileSync(path.join(f.jobsDir, first.id + '.json'), JSON.stringify(persisted));
  const repeated = await pipeline.run(f.video); assert.equal(repeated.receipt.duplicate, true); assert.equal(posts, 1);
});

test('a malformed success is not called completed, and a changed target cannot replay elsewhere', async t => {
  const f = fixture(t), d = deps();
  const sync = createLifepivotReviewAppender({ fetch: async (_url, init) => init.method === 'GET' ? json({ note: null }) : json({ result: { id: 'wrong', businessDate: DATE, revision: 1, content: 'bad' } }) });
  const pipeline = createEveningReviewPipeline({ ...f, ...d, sync }); await assert.rejects(pipeline.run(f.video), { code: 'SYNC_UNCERTAIN' });
  assert.equal(pipeline.listJobs()[0].status, 'failed'); assert.ok(pipeline.listJobs()[0].sync.pending);
  const other = createEveningReviewPipeline({ ...f, ...d, sync: createLifepivotReviewAppender({ endpoint: 'http://127.0.0.1:9999', fetch: async () => { throw new Error('must not send'); } }) });
  await assert.rejects(other.run(f.video), { code: 'TARGET_CHANGED' });
});
