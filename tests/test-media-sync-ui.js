const {app,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const live=process.argv.includes('--live');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'face-media-sync-'));
app.setPath('userData',profile);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('will-quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
// A real cross-origin iframe and real HTML video. Network-independent fixture;
// it deliberately has no Electron preload or Node access.
const fixture=`<video controls loop muted style="width:100%"></video><script>
(async()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');
const stream=c.captureStream(10),r=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
r.ondataavailable=e=>chunks.push(e.data); r.onstop=()=>{document.querySelector('video').src=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));stream.getTracks().forEach(t=>t.stop());};r.start();
let n=0;const t=setInterval(()=>{x.fillStyle=n++%2?'#456':'#789';x.fillRect(0,0,160,90);if(n>15){clearInterval(t);r.stop();}},100);})();</script>`;
if(!live) app.whenReady().then(()=>session.defaultSession.protocol.handle('https',request=>{
 if(new URL(request.url).hostname==='player.bilibili.com')return new Response(fixture,{headers:{'content-type':'text/html'}});
 return new Response('',{status:404});
}));
let started=false;
app.on('browser-window-created',(_,win)=>{
 if(started)return;started=true;
 win.webContents.once('did-finish-load',async()=>{
 const js=x=>win.webContents.executeJavaScript(x);
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(x)=>{for(let n=0;n<100;n++){if(await js(x))return;await pause(100);}throw Error('Timeout: '+x);};
 try{
 await wait("typeof Store!=='undefined'&&Store.db&&document.querySelector('.today-title')");
 await js("Store.db.settings.autoPauseOnBlur=false;Store.db.videos=[{id:'sync',source:'bilibili',bvid:'BV1xx411c7mD',title:'同步测试'}];App.launchFollow('sync')");
 await wait("document.querySelector('iframe')");
 let frame;for(let n=0;n<60;n++){frame=win.webContents.mainFrame.framesInSubtree.find(f=>f.url.startsWith('https://player.bilibili.com'));if(frame)break;await pause(100);}
 assert.ok(frame,'cross-origin WebFrameMain exists');
 for(let n=0;n<(live?250:60);n++){if(await frame.executeJavaScript("document.querySelector('video')?.readyState>=3"))break;await pause(100);}
 await pause(1200);
 assert.equal(await js('Session.active.running'),false);
 assert.equal(await js('Session.active.seconds'),0);
 assert.equal(await frame.executeJavaScript("document.querySelector('video').paused"),true);
 assert.equal((await js('native.embeddedMediaStatus()')).length,1,'production IPC finds child frame');
 await frame.executeJavaScript("document.querySelector('video').muted=true;document.querySelector('video').play()",true);
 await wait('Session.active.running');await pause(1250);
 assert.ok(await js('Session.active.seconds>=1'));
 await frame.executeJavaScript("document.querySelector('video').pause()");
 await wait('!Session.active.running');
 const stopped=await js('Session.active.seconds');await pause(1200);assert.equal(await js('Session.active.seconds'),stopped);
 await js("document.querySelector('#t-toggle').click()");await wait('Session.active.running');
 assert.equal(await frame.executeJavaScript("document.querySelector('video').paused"),false);
 await js("document.querySelector('#t-toggle').click()");await wait('!Session.active.running');
 assert.equal(await frame.executeJavaScript("document.querySelector('video').paused"),true);
 await frame.executeJavaScript("document.querySelector('video').muted=true;document.querySelector('video').play()",true);await wait('Session.active.running');
 await frame.executeJavaScript("document.querySelector('video').remove()");await wait('!Session.active.running');
 await js("App.go('today')");assert.equal(await js('Session.active.running'),false);
 console.log((live?'LIVE_BILIBILI_PASS: ':'FIXTURE_PASS: ')+'MEDIA_SYNC_UI_PASS: paused entry, real cross-origin video play/pause, timer controls, no video fail-closed, route exit');app.quit();
 }catch(e){console.error(e);app.exit(1);}
 });
});
require('../main.js');
