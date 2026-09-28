// Launch the actual arm64 build with an isolated profile and inspect its renderer via local CDP.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),crypto=require('node:crypto');
const dir=path.resolve('.impeccable/review/ux20'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'face-ux20-package-'));
const appPath=path.resolve('dist/mac-arm64/面部重塑计划.app'),binary=path.join(appPath,'Contents/MacOS/面部重塑计划');
const child=spawn(binary,['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env:{...process.env,FACE_RESHAPE_PROFILE:profile,FACE_UX20_TEST:'1'},stdio:['ignore','pipe','pipe']});
let browserSocket,sequence=0;const pending=new Map();const wait=ms=>new Promise(r=>setTimeout(r,ms));
child.stderr.on('data',b=>fs.appendFileSync(path.join(dir,'packaged-stderr.log'),b));
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);pending.set(id,x=>{clearTimeout(t);x.error?reject(Error(JSON.stringify(x.error))):resolve(x.result);});browserSocket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
(async()=>{try{
 let port;for(let n=0;n<100;n++){const f=path.join(profile,'DevToolsActivePort');if(fs.existsSync(f)){port=fs.readFileSync(f,'utf8').split('\n')[0];break;}await wait(100);}assert.ok(port,'packaged app created isolated debugging listener');
 let target;for(let n=0;n<100;n++){const list=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=list.find(x=>x.type==='page'&&x.url.endsWith('/src/index.html'));if(target)break;await wait(100);}assert.ok(target,'packaged application window loaded');
 browserSocket=new WebSocket(target.webSocketDebuggerUrl);browserSocket.onmessage=e=>{const r=JSON.parse(e.data);if(r.id){pending.get(r.id)?.(r);pending.delete(r.id);}};await new Promise((resolve,reject)=>{browserSocket.onopen=resolve;browserSocket.onerror=reject;});
 for(let n=0;n<100;n++){if(await evaluate("typeof UX!=='undefined'&&!!Store.db&&!!document.querySelector('#ux-now')"))break;await wait(100);}
 assert.equal(await evaluate('Store.db.sessions.length'),0);assert.equal(await evaluate('Store.db.skin.predictions[todayKey()].overallDir'),null);
 await evaluate("App.go('settings');document.querySelector('[name=target]').value='21';document.querySelector('#ux-settings-form').requestSubmit();");
 assert.equal(await evaluate('Store.db.settings.dailyTargetMinutes'),21);await call('Page.reload');await wait(1000);assert.equal(await evaluate('Store.db.settings.dailyTargetMinutes'),21);
 await evaluate("App.go('today')");await wait(1200);const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(dir,'packaged-home.png'),Buffer.from(shot.data,'base64'));
 const asar=require('@electron/asar'),archive=path.join(appPath,'Contents/Resources/app.asar'),files=['main.js','preload.js',...fs.readdirSync('src/js').filter(x=>x.endsWith('.js')).map(x=>'src/js/'+x),'src/ux.css','src/index.html'];
 for(const file of files)assert.equal(crypto.createHash('sha256').update(asar.extractFile(archive,file)).digest('hex'),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),file+' matches final workspace');
 assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,'1.4.0');
 console.log('PACKAGED_UX20_PASS: actual arm64 app, isolated profile, empty state, settings save/reload, screenshot, '+files.length+' bundled files match current source, version 1.4.0');
 }finally{browserSocket?.close();child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},3000).unref();});fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
