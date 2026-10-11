/* 真实抖音下载与本地播放验收。仅启动自己的候选应用，使用独立临时资料。
   验证批量导入、旧引用转换、真实媒体解码/播放、重启后禁用解析仍能播放与去重。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const appBin = path.resolve(process.argv[2] || 'dist/douyin-local-1.8.1/人生重塑计划.app/Contents/MacOS/人生重塑计划');
const evidenceDir = path.resolve(process.argv[3] || '.impeccable/review/douyin-local-20261007/native');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'life-installed-ui-'));
if (!path.basename(profile).startsWith('life-installed-ui-')) throw Error('Unexpected temporary profile');
if (fs.existsSync(path.join(profile, 'face-reshape-data.json'))) throw Error('A new isolated profile is required');
fs.mkdirSync(evidenceDir, { recursive: true });
const evidenceFile = path.join(evidenceDir, 'douyin-local.json');
const report = {
  startedAt: new Date().toISOString(), appBin, profile,
  evidenceScope: {
    installedBinary: appBin,
    launchedActualBinary: true,
    location: appBin.startsWith('/Applications/') ? 'installed' : 'candidate',
    realDouyinDownload: true,
    formalDataUntouched: true
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
    active = await launch();
    const {evaluate, wait, click, screenshot} = active;
    await evaluate(`(() => {Session.stop(); Store.db.videos=[]; Store.db.sessions=[];Store.db.onboarding={done:true};Store.db.freshInstall=false;Object.assign(Store.settings(),{videoMode:'awakening',autoPauseOnBlur:false,keepInTray:false,remindersEnabled:false}); Store.save(true); App.goCollection('awakening');})()`);
    await click('#td-import');
    await wait("!!document.querySelector('#ux-import-text')");
    await evaluate(`document.querySelector('#ux-import-text').value='https://www.douyin.com/video/7620084017840344329'`);
    const downloadStart = Date.now();
    await click('#ux-import-go');
    await wait("Store.db.videos.length===1 && Store.db.videos[0].source==='local'", 'real Douyin downloaded and imported', 90000);
    report.downloadMs = Date.now()-downloadStart;
    report.video = await evaluate("({...Store.db.videos[0],playUrl:undefined})");
    assert.equal(report.video.collectionId,'awakening');
    assert.equal(report.video.douyinId,'7620084017840344329');
    const probe=JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,width,height','-of','json',report.video.localPath],{encoding:'utf8'}));
    report.media=probe;
    assert.ok(Number(probe.format.duration)>1);
    execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i',report.video.localPath,'-f','null','-'],{timeout:90000});
    await evaluate('closeModal(true)');
    await wait("document.querySelector('#modal-mask').classList.contains('hidden')");
    // 自动迁移旧引用复用同一缓存，并保留旧视频 ID 和观看账本。
    await evaluate(`(() => { const v=Store.db.videos[0];v.id='legacy-douyin';v.source='douyin';delete v.localPath;v.playUrl='expired';Store.save(true);App.render();})()`);
    await click('#td-vids .vid-card');
    await wait("Store.db.videos[0].source==='local'&&document.querySelector('#stage video')?.readyState>=3", 'legacy reference becomes local video');
    assert.equal(await evaluate('Store.db.videos[0].id'),'legacy-douyin');
    assert.equal(await evaluate("document.querySelector('#stage iframe')===null"),true);
    await click('#t-toggle');
    await wait("Session.active?.running&&document.querySelector('#stage video')?.currentTime>1", 'real video playing and timer running');
    report.playback=await evaluate("({seconds:Session.active.seconds,time:document.querySelector('#stage video').currentTime,src:document.querySelector('#stage video').currentSrc,paused:document.querySelector('#stage video').paused})");
    assert.ok(report.playback.src.startsWith('file:'));
    await screenshot('real-local-playback.png');
    await click('#t-stop');
    await wait('!Session.active');
    await evaluate('Store.flushSync()');
    await stopOwnChild(active.connection);active=null;
    active=await launch();
    // 阻断 renderer 的全部在线解析/下载调用，再验证点击播放。
    await active.evaluate(`(() => {window.__networkCalls=0;window.native={...native,fetchDouyinInfo:()=>{__networkCalls++;throw Error('unexpected network')},fetchDouyinPlayUrl:()=>{__networkCalls++;throw Error('unexpected network')},downloadDouyin:()=>{__networkCalls++;throw Error('unexpected network')}};})()`);
    const start = Date.now();
    await active.click('#ux-home-video-play');
    await active.wait("Session.active?.running&&document.querySelector('#stage video')?.currentTime>0.1", 'cached video playing after restart');
    report.reopenMs=Date.now()-start;
    report.reopened=await active.evaluate("({networkCalls:__networkCalls,count:Store.db.videos.length,source:Store.db.videos[0].source,videoId:Session.active.videoId,src:document.querySelector('#stage video').currentSrc})");
    assert.equal(report.reopened.networkCalls,0);assert.equal(report.reopened.count,1);
    // 重复导入相同 ID 不新增，不下载。
    await active.evaluate("Douyin.importLocal(Douyin.parse('7620084017840344329'),'awakening').then(()=>true)");
    assert.equal(await active.evaluate('Store.db.videos.length'),1);
    assert.equal(await active.evaluate('__networkCalls'),0);
    await active.click('#t-stop');
    // 主进程缓存验证在真实应用中不启动隐藏浏览器。
    report.cache=await active.evaluate("native.downloadDouyin('cache-test','7620084017840344329')");
    assert.equal(report.cache.existed,true);
    report.ok=true;
  } catch(error) {report.ok=false;report.error=error.stack;process.exitCode=1;console.error(report.error);}
  finally {
    await stopOwnChild(active?.connection);
    fs.rmSync(profile,{recursive:true,force:true});report.profileCleaned=true;
    fs.writeFileSync(evidenceFile,JSON.stringify(report,null,2));
    console.log('DOUYIN_LOCAL_RESULT='+evidenceFile+' ok='+report.ok);
  }
})();
