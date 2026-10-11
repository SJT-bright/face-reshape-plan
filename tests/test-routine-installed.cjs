/* Actual app binary: schedule clock → native fullscreen → real local playback → skincare → normal window.
 * Camera is disabled here; camera/JPEG coverage belongs to test-routine-ui.cjs's fake device. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const appBin=path.resolve(process.argv[2]||'dist/routine-1.8.0/mac-arm64/人生重塑计划.app/Contents/MacOS/人生重塑计划');
const evidenceDir=path.resolve(process.argv[3]||'.impeccable/review/routine-1.8.0/binary');fs.mkdirSync(evidenceDir,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'life-routine-binary-'));
const report={appBin,scope:'actual app executable, isolated synthetic local video, native schedule and fullscreen, camera disabled',stages:[],shutdown:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class SocketCDP {
  constructor(child,socket){this.child=child;this.socket=socket;this.nextId=0;this.pending=new Map();this.contexts={};this.exited=false;this.exit=new Promise(resolve=>child.once('exit',(code,signal)=>{this.exited=true;this.rejectPending(Error('Own child exited'));resolve({code,signal});}));socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.executionContextCreated'&&message.params.context.auxData?.isDefault&&message.params.context.origin==='file://')this.contexts[message.sessionId]=message.params.context.id;if(message.method)fs.appendFileSync(path.join(evidenceDir,'cdp-events.jsonl'),JSON.stringify(message)+'\n');const request=this.pending.get(message.id);if(!request)return;this.pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result||{});});}
  send(method,params={},sessionId,timeoutMs=10000){const id=++this.nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout: '+method+' '+(params.expression||'')));},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  rejectPending(error){for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error);}this.pending.clear();}
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
  connection.rejectPending(Error('CDP connection closed after own child shutdown'));connection.socket.close();
  report.shutdown.push({ pid: connection.child.pid, method, result: await connection.exit });
}


let connection;
(async()=>{try{
 const clip=path.join(profile,'training.webm');execFileSync('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x3355aa:s=320x180:r=10','-t','8','-an','-c:v','libvpx',clip]);
 const now=new Date(),date=now.toLocaleDateString('en-CA');
 fs.writeFileSync(path.join(profile,'face-reshape-data.json'),JSON.stringify({version:1,onboarding:{done:true},videos:[{id:'fixture-v',source:'local',title:'合成训练',localPath:clip,durationSec:8}],sessions:[],skincare:{cycles:[{id:'cycle',startDate:'2026-01-01',steps:{morning:[],day:[],evening:[{id:'clean',name:'清洁'}]}}]},logs:{training:{},skincare:{}},settings:{videoMode:'face',keepInTray:false,autoPauseOnBlur:false,remindersEnabled:true,skinLogReminderTime:'',sleepLogReminderTime:'',eveningReviewTime:'',skincareTimes:{morning:'',noon:'',evening:''},automation:{enabled:false,camera:false,autoCapture:false,evening:{time:now.toTimeString().slice(0,5),videoId:'fixture-v',days:[now.getDay()]}}}}));
 const log=fs.openSync(path.join(evidenceDir,'app.log'),'w');const env={...process.env,FACE_RESHAPE_PROFILE:profile,FACE_UX20_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(appBin,['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--disable-backgrounding-occluded-windows',...(process.env.LIFE_DISABLE_AX?['--disable-renderer-accessibility']:[])],{env,stdio:['ignore',log,log]});fs.closeSync(log);const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<200&&!fs.existsSync(portFile);i++)await sleep(100);assert.ok(fs.existsSync(portFile));const [port,browserPath]=fs.readFileSync(portFile,'utf8').trim().split('\n');const socket=new WebSocket('ws://127.0.0.1:'+port+browserPath);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});connection=new SocketCDP(child,socket);
 let target;for(let i=0;i<150;i++){const r=await connection.send('Target.getTargets');target=r.targetInfos.find(x=>x.type==='page'&&x.url.includes('/src/index.html'));if(target)break;await sleep(150);}assert.ok(target);
 const {sessionId}=await connection.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
 await connection.send('Runtime.enable',{},sessionId);await connection.send('Page.enable',{},sessionId);await connection.send('Page.bringToFront',{},sessionId);report.stages.push({stage:'domains-ready'});
 for(let i=0;i<150&&!connection.contexts[sessionId];i++)await sleep(100);assert.ok(connection.contexts[sessionId],'Loaded file context ready');await sleep(500);
 const js=async expression=>{const r=await connection.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId,30000);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async(expr,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await js(expr))return;await sleep(80);}throw Error('Timed out: '+expr);};
 const click=async selector=>{const p=await js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'center',behavior:'instant'});const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);await connection.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p},sessionId);await connection.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p},sessionId);await sleep(200);};
 const shot=async name=>{const r=await connection.send('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync(path.join(evidenceDir,name+'.png'),Buffer.from(r.data,'base64'));};
 const sanity=await connection.send('Runtime.evaluate',{expression:'2+2',returnByValue:true,awaitPromise:false},sessionId,12000);report.stages.push({stage:'runtime-sanity',sanity});if(process.env.LIFE_BASELINE_ONLY){report.passed=true;console.log('BINARY_BASELINE_PASS: runtime evaluates 2+2');return;}
 await wait("typeof Routine!=='undefined' && !!document.querySelector('[data-period-filter]')",45000);report.stages.push({stage:'initial-ui-ready'});
 await js("Store.settings().automation.enabled=true;Store.save(true);");
 await wait("typeof Routine!=='undefined' && Routine.active?.stage==='training' && Session.active?.running===true && document.querySelector('#stage video')?.currentTime>0",45000);
 await wait('native.isFullscreen()');
 await shot('native-training');
 report.stages.push({stage:'scheduled-training',nativeFullscreen:await js('native.isFullscreen()'),playback:await js("({seconds:Session.active.seconds,currentTime:document.querySelector('#stage video').currentTime,playing:!document.querySelector('#stage video').paused})")});
 await wait("Routine.active?.stage==='snapshot' && Session.active===null",15000);
 assert.equal(await js("Store.dayTraining(todayKey()).entries.length"),1);
 assert.ok(await js('Store.dayTraining(todayKey()).seconds>0'));
 await shot('native-snapshot');
 await click('#routine-next');await wait("Routine.active?.stage==='care' && App.currentView==='skincare'");
 assert.match(await js("document.querySelector('#ux-care-now h3').textContent"),/晚间/);report.stages.push({stage:'care',videoRemoved:await js("!document.querySelector('#stage video')"),period:'evening'});
 await shot('native-care');
 await click('#routine-next');await wait('Routine.active===null');
 await wait('native.isFullscreen().then(value=>!value)');
 const disk=JSON.parse(fs.readFileSync(path.join(profile,'face-reshape-data.json')));assert.equal(disk.settings.automation.evening.videoId,'fixture-v');assert.equal(Object.values(disk.reminderActions).filter(x=>x.fired).length,1);
 report.stages.push({stage:'closed',nativeFullscreen:await js('native.isFullscreen()'),oneScheduledRun:true,automationPersisted:true});report.passed=true;
 console.log('ROUTINE_BINARY_PASS: actual executable, clock trigger, native fullscreen, real local playback and timer, evening skincare, normal window restored.');
}catch(error){report.error=error.stack;console.error(error.stack);process.exitCode=1;}finally{await stopOwnChild(connection);fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(report,null,2));fs.rmSync(profile,{recursive:true,force:true});}})();
