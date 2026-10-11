/* 实际 .app 二进制的隔离 UI 冒烟测试，不修改正式资料或安装包。
   用法：node tests/test-installed-life-ui.cjs [appBin] [evidenceDir]
   CDP fd3/fd4：真实鼠标点击、真实本地视频播放与观看日志；不验证在线视频。
   自动创建 life-installed-ui-* 临时 profile，退出时仅结束自己启动的 child。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const appBin = path.resolve(process.argv[2] || '/Applications/人生重塑计划.app/Contents/MacOS/人生重塑计划');
const evidenceDir = path.resolve(process.argv[3] || '.impeccable/review/installed-life-ui');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'life-installed-ui-'));
if (!path.basename(profile).startsWith('life-installed-ui-')) throw Error('Unexpected temporary profile');
if (fs.existsSync(path.join(profile, 'face-reshape-data.json'))) throw Error('A new isolated profile is required');
fs.mkdirSync(evidenceDir, { recursive: true });
const clip = path.join(profile, 'synthetic-local.webm');
const evidenceFile = path.join(evidenceDir, 'installed-life-ui.json');
const report = {
  startedAt: new Date().toISOString(), appBin, profile,
  evidenceScope: {
    installedBinary: appBin,
    launchedActualBinary: true,
    location: appBin.startsWith('/Applications/') ? 'installed' : 'candidate',
    isolatedSyntheticLocal: true,
    noOnlineProof: true
  },
  screenshots: [], shutdown: [], stages: []
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* 消息使用 UTF-8 JSON + NUL。每条成功/失败响应都清除请求定时器。 */
class PipeCDP {
  constructor(child) {
    this.child = child; this.nextId = 0; this.pending = new Map(); this.buffer = Buffer.alloc(0);
    this.exited = false;
    this.exit = new Promise(resolve => {
      child.once('exit', (code, signal) => { this.exited = true; this.rejectPending(Error('Own app child exited')); resolve({ code, signal }); });
      child.once('error', error => { this.exited = true; this.rejectPending(error); resolve({ error: error.message }); });
    });
    child.stdio[3].on('error', error => this.rejectPending(error));
    child.stdio[4].on('error', error => this.rejectPending(error));
    child.stdio[4].on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      let index;
      while ((index = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, index).toString('utf8');
        this.buffer = this.buffer.subarray(index + 1);
        let message;
        try { message = JSON.parse(raw); } catch { continue; }
        const request = this.pending.get(message.id);
        if (!request) continue;
        this.pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.reject(Error(request.method + ': ' + message.error.message));
        else request.resolve(message.result || {});
      }
    });
  }
  send(method, params = {}, sessionId, timeoutMs = 8000) {
    if (this.exited) return Promise.reject(Error('Own app child is no longer running'));
    const id = ++this.nextId;
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('CDP timeout: ' + method + (params.expression ? ' ' + params.expression.slice(0, 180) : '')));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdio[3].write(JSON.stringify(message) + '\0', error => {
        if (!error || !this.pending.has(id)) return;
        clearTimeout(timer); this.pending.delete(id); reject(error);
      });
    });
  }
  rejectPending(error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
}

async function waitForExit(connection, timeoutMs) {
  if (connection.exited) return true;
  let timer;
  try {
    return await Promise.race([connection.exit.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

async function stopOwnChild(connection) {
  if (!connection) return;
  let method = 'already-exited';
  if (!connection.exited) {
    method = 'Browser.close';
    try { await connection.send('Browser.close', {}, undefined, 1500); } catch {}
    if (!await waitForExit(connection, 1800)) {
      method = 'SIGTERM'; connection.child.kill('SIGTERM');
      if (!await waitForExit(connection, 3500)) {
        method = 'SIGKILL'; connection.child.kill('SIGKILL');
        if (!await waitForExit(connection, 3500)) throw Error('Own child could not be stopped: ' + connection.child.pid);
      }
    }
  }
  connection.rejectPending(Error('CDP connection closed after own child shutdown'));
  report.shutdown.push({ pid: connection.child.pid, method, result: await connection.exit });
}

async function launch() {
  const env = { ...process.env, FACE_RESHAPE_PROFILE: profile, FACE_UX20_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const stdout = fs.openSync(path.join(evidenceDir, 'app-stdout.log'), 'a');
  const stderr = fs.openSync(path.join(evidenceDir, 'app-stderr.log'), 'a');
  let child;
  try { child = spawn(appBin, ['--remote-debugging-pipe', '--disable-backgrounding-occluded-windows'], { env, stdio: ['ignore', stdout, stderr, 'pipe', 'pipe'] }); }
  finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  const connection = new PipeCDP(child);
  try {
    let target;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && !connection.exited) {
      try {
        const result = await connection.send('Target.getTargets', {}, undefined, 3500);
        target = (result.targetInfos || []).find(item => item.type === 'page' && /src\/index\.html/.test(item.url));
      } catch (error) { if (connection.exited) throw error; }
      if (target) break;
      await sleep(150);
    }
    if (!target) throw Error('Actual binary did not expose its app page');
    report.stages.push({ step: 'target', pid: child.pid, url: target.url });
    const attached = await connection.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sid = attached.sessionId;
    await connection.send('Runtime.enable', {}, sid);
    await connection.send('Page.enable', {}, sid);
    await connection.send('Page.bringToFront', {}, sid);
    report.stages.push({ step: 'domains-ready', pid: child.pid });
    const evaluate = async expression => {
      const result = await connection.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const wait = async (expression, label = expression, timeoutMs = 12000) => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (await evaluate(expression)) return;
        await sleep(90);
      }
      throw Error('UI timeout: ' + label);
    };
    const click = async selector => {
      await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);
      // 卡片入场会移动控件：先等完整入场，再采样确认位置稳定。
      await sleep(650);
      const readPoint = () => evaluate(`(() => {
        const element=document.querySelector(${JSON.stringify(selector)});
        if(!element)throw Error('Missing UI element: '+${JSON.stringify(selector)});
        const rect=element.getBoundingClientRect();
        if(!rect.width||!rect.height||getComputedStyle(element).visibility==='hidden')throw Error('Invisible UI element');
        return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
      })()`);
      let point = await readPoint(), stable = false;
      for (let sample = 0; sample < 12; sample++) {
        await sleep(80);
        const next = await readPoint();
        if (Math.abs(next.x-point.x)<0.5 && Math.abs(next.y-point.y)<0.5) { point=next; stable=true; break; }
        point=next;
      }
      if (!stable) throw Error('UI element kept moving: ' + selector);
      await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, sid);
      await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, sid);
    };
    const screenshot = async filename => {
      await sleep(600);
      const result = await connection.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sid);
      const output = path.join(evidenceDir, filename);
      fs.writeFileSync(output, Buffer.from(result.data, 'base64')); report.screenshots.push(output);
    };
    await wait("typeof UX!=='undefined'&&Store.db&&document.querySelector('#video-collections-nav [data-collection-id=\"awakening\"]')", 'installed UI ready');
    report.stages.push({ step: 'ui-ready', pid: child.pid });
    assert.equal(fs.realpathSync(await evaluate('native.userDataPath()')), fs.realpathSync(profile), 'actual binary must honor isolated profile before any mutation');
    report.stages.push({ step: 'profile-verified', pid: child.pid });
    assert.equal(await evaluate('document.title'), '人生重塑计划');
    return { connection, evaluate, wait, click, screenshot, target };
  } catch (error) {
    await stopOwnChild(connection);
    throw error;
  }
}

let active;
(async () => {
  try {
    assert.equal(fs.existsSync(appBin), true, 'Actual app executable exists');
    execFileSync(process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x8174bd:s=320x180:r=10',
      '-t', '30', '-an', '-c:v', 'libvpx', '-b:v', '50k', clip
    ]);
    active = await launch();
    const { evaluate, wait, click, screenshot } = active;
    report.pid = active.connection.child.pid; report.pageUrl = active.target.url;
    const faceIds = Array.from({ length: 5 }, (_, i) => 'smoke-face-' + i);
    const awakeningIds = Array.from({ length: 5 }, (_, i) => 'smoke-awakening-' + i);
    const videos = [
      ...faceIds.map((id, i) => ({ id, collectionId: 'face', title: '瘦脸护理 · 合成 ' + (i + 1), source: 'local', localPath: clip, durationSec: 30 })),
      ...awakeningIds.map((id, i) => ({ id, collectionId: 'awakening', title: '认知唤醒 · 合成 ' + (i + 1), source: 'local', localPath: clip, durationSec: 30 }))
    ];
    await evaluate(`(() => {
      Session.stop();Store.db.videos=${JSON.stringify(videos)};Store.db.sessions=[];
      Store.db.videoCollections=[{id:'face',name:'瘦脸护理',periods:[]},{id:'awakening',name:'认知唤醒',periods:['morning','evening']}];
      Store.db.logs.training={};Store.db.logs.videoWatching={};Store.db.logs.skincare={};
      Store.db.onboarding={done:true};Store.db.freshInstall=false;
      Object.assign(Store.settings(),{videoMode:'face',dailyTargetMinutes:15,autoPauseOnBlur:false,keepInTray:false,remindersEnabled:false,eveningReviewTime:'',skinLogReminderTime:'',sleepLogReminderTime:'',enabledModules:['follow','strength','skincare','nutrition','achievements']});
      Store.save(true);App.goCollection('face');
      return true;
    })()`);
    const library = () => evaluate("({mode:Store.currentMode(),count:document.querySelectorAll('#td-vids .vid-card').length,ids:[...document.querySelectorAll('#td-vids .vid-card')].map(card=>card.dataset.video),quickOptions:[...document.querySelectorAll('#ux-home-video-select option')].map(option=>option.value),title:document.querySelector('#page-title').textContent})");

    await click('.nav-item[data-view="today"]');
    await wait("Store.currentMode()==='face'&&document.querySelectorAll('#td-vids .vid-card').length===5");
    report.faceLibrary = await library();
    assert.deepEqual(report.faceLibrary.ids.sort(), faceIds);
    assert.deepEqual(report.faceLibrary.quickOptions.sort(), faceIds);
    if (await evaluate("document.querySelector('#ux-library-panel')&&!document.querySelector('#ux-library-panel').open")) await click('#ux-library-panel summary');
    await evaluate("document.querySelector('#td-vids').scrollIntoView({block:'center',behavior:'instant'})");
    await screenshot('face-layout.png');
    // 原库的普通卡片入口仍在暂停态，player 选择列表只包含原库。
    await click('#td-vids .vid-card');
    await wait("document.querySelector('#f-video')&&Session.active?.awaitingPlay&&document.querySelector('#stage video')?.readyState>=3");
    report.facePlayerOptions = await evaluate("[...document.querySelectorAll('#f-video option')].map(option=>option.value)");
    assert.deepEqual(report.facePlayerOptions.sort(), faceIds);
    assert.equal(await evaluate("document.querySelector('#stage video').paused"), true);
    await click('#t-stop');
    await wait('!Session.active');

    await click('#video-collections-nav [data-collection-id="awakening"]');
    await wait("Store.currentMode()==='awakening'&&document.querySelectorAll('#td-vids .vid-card').length===5");
    report.awakeningLibrary = await library();
    assert.deepEqual(report.awakeningLibrary.ids.sort(), awakeningIds);
    assert.deepEqual(report.awakeningLibrary.quickOptions.sort(), awakeningIds);
    await screenshot('awakening-layout.png');
    // 唯一的播放操作是用户入口的真实鼠标点击；不注入计时、play 或媒体状态。
    await click('#ux-home-video-play');
    await wait("App.currentView==='follow'&&Session.active?.running&&Session.active.seconds>=1&&document.querySelector('#stage video')?.currentTime>=1&&!document.querySelector('#stage video').paused", 'actual local playback and observed timer', 15000);
    report.actualPlayback = await evaluate("({videoId:Session.active.videoId,mode:Session.active.mode,seconds:Session.active.seconds,mediaCurrentTime:document.querySelector('#stage video').currentTime,readyState:document.querySelector('#stage video').readyState,paused:document.querySelector('#stage video').paused,source:document.querySelector('#stage video').currentSrc})");
    assert.equal(report.actualPlayback.mode, 'awakening');
    assert.ok(awakeningIds.includes(report.actualPlayback.videoId));
    report.awakeningPlayerOptions = await evaluate("[...document.querySelectorAll('#f-video option')].map(option=>option.value)");
    assert.deepEqual(report.awakeningPlayerOptions.sort(), awakeningIds);
    await click('#t-stop');
    await wait('!Session.active');
    report.watching = await evaluate("({date:todayKey(),faceSeconds:Object.values(Store.db.logs.training).reduce((sum,day)=>sum+(day.seconds||0),0),faceEntries:Object.values(Store.db.logs.training).flatMap(day=>day.entries||[]).length,awakening:Store.dayWatching(todayKey(),'awakening'),targetMet:Store.dayTargetMet(todayKey())})");
    assert.equal(report.watching.faceSeconds, 0);
    assert.equal(report.watching.faceEntries, 0);
    assert.equal(report.watching.targetMet, false);
    assert.ok(report.watching.awakening.seconds >= 1);
    assert.equal(report.watching.awakening.entries.length, 1);
    assert.equal(report.watching.awakening.entries[0].collectionId, 'awakening');
    assert.equal(report.watching.awakening.entries[0].source, 'media-observed');

    // 简短地补验安装版编辑，并重新启动同一隔离资料验证持久化。
    await click('#video-collections-nav [data-collection-id="awakening"]');
    await wait("!!document.querySelector('#edit-video-collection')");
    await click('#edit-video-collection');
    await wait("!!document.querySelector('#vc-name')");
    await evaluate("(() => {const input=document.querySelector('#vc-name');input.value='日夜唤醒测试';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelectorAll('input[name=\"vc-period\"]').forEach(input=>{input.checked=input.value==='evening';input.dispatchEvent(new Event('change',{bubbles:true}));});})()");
    await click('#vc-save');
    await wait("Store.currentCollection().name==='日夜唤醒测试'&&document.querySelector('#modal-mask').classList.contains('hidden')");
    assert.deepEqual(await evaluate('Store.currentCollection().periods'), ['evening']);
    await evaluate('Store.flushSync()');
    const persisted = JSON.parse(fs.readFileSync(path.join(profile, 'face-reshape-data.json'), 'utf8'));
    assert.equal(persisted.videos.length, 10);
    assert.ok(persisted.logs.videoWatching.awakening[report.watching.date].seconds >= 1);
    report.persisted = { videos: persisted.videos.length, collection: persisted.videoCollections.find(c => c.id === 'awakening') };
    await stopOwnChild(active.connection); active = null;
    active = await launch();
    report.restartPid = active.connection.child.pid;
    assert.notEqual(report.restartPid, report.pid);
    report.restart = await active.evaluate(`({mode:Store.currentMode(),name:Store.currentCollection().name,periods:Store.currentCollection().periods,faceCount:Store.videosForMode('face').length,awakeningCount:Store.videosForMode('awakening').length,watchingSeconds:Store.dayWatching(${JSON.stringify(report.watching.date)},'awakening').seconds,faceSeconds:Object.values(Store.db.logs.training).reduce((sum,day)=>sum+(day.seconds||0),0),pageTitle:document.title})`);
    assert.equal(report.restart.mode, 'awakening');
    assert.equal(report.restart.name, '日夜唤醒测试');
    assert.deepEqual(report.restart.periods, ['evening']);
    assert.equal(report.restart.faceCount, 5); assert.equal(report.restart.awakeningCount, 5);
    assert.equal(report.restart.faceSeconds, 0); assert.ok(report.restart.watchingSeconds >= 1);
    assert.equal(report.restart.pageTitle, '人生重塑计划');
    await active.evaluate('Store.flushSync()');
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.stack || String(error);
    console.error('INSTALLED_LIFE_UI_FAIL:', report.error);
    if (active) try { await active.screenshot('failure-layout.png'); } catch {}
    process.exitCode = 1;
  } finally {
    try { await stopOwnChild(active?.connection); }
    catch (error) { report.ok = false; report.shutdownError = error.message; process.exitCode = 1; }
    fs.rmSync(profile, { recursive: true, force: true });
    report.profileCleaned = !fs.existsSync(profile); report.finishedAt = new Date().toISOString();
    fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2));
    if (report.ok) console.log('INSTALLED_LIFE_UI_PASS: actual app binary, isolated synthetic local media playback, 5+5 library/player isolation, watching ledger and real restart; no online-media proof.');
    console.log('RESULT_JSON=' + evidenceFile);
  }
})();
