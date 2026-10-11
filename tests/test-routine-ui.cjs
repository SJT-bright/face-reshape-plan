/* Real Electron window, mouse clicks, actual synthetic video + fake camera device.
 * No formal profile, camera hardware, remote media or uploaded photos are used. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
if(!process.versions.electron){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'life-routine-ui-'));
  try{
    execFileSync('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:r=10','-t','5','-an','-c:v','libvpx',path.join(profile,'training.webm')]);
    execFileSync(require('electron'),[__filename,profile],{stdio:'inherit',env:{...process.env,FACE_RESHAPE_PROFILE:profile,FACE_UX20_TEST:'1'}});
  }finally{fs.rmSync(profile,{recursive:true,force:true});}
}else{
  const {app,ipcMain}=require('electron');const profile=process.argv[2];
  if(!path.basename(profile).startsWith('life-routine-ui-'))throw Error('Isolated profile required');
  app.setPath('userData',profile);app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  const evidence=path.resolve(process.env.LIFE_ROUTINE_EVIDENCE||'.impeccable/review/routine-1.8.0/source-ui');fs.mkdirSync(evidence,{recursive:true});
  const records={training:{'2026-10-01':{seconds:75,targetMinutes:15,entries:[{id:'original',seconds:75}]}},skincare:{}};
  fs.writeFileSync(path.join(profile,'face-reshape-data.json'),JSON.stringify({version:1,onboarding:{done:true},videos:[{id:'test-v',source:'local',title:'合成训练',localPath:path.join(profile,'training.webm'),durationSec:5}],sessions:[],skincare:{cycles:[{id:'c',startDate:'2026-01-01',steps:{morning:[],day:[],evening:[{id:'clean',name:'清洁'}]}}]},logs:records,settings:{keepInTray:false,autoPauseOnBlur:false,remindersEnabled:true,skinLogReminderTime:'',sleepLogReminderTime:'',eveningReviewTime:'',skincareTimes:{},automation:{enabled:false,camera:true,autoCapture:false}},videoCollections:[{id:'face',name:'瘦脸护理',periods:[]},{id:'awakening',name:'认知唤醒',periods:['morning','evening']},{id:'night',name:'仅晚上',periods:['evening']}]}));
  let started=false;
  app.on('browser-window-created',(_,win)=>{
    if(started)return;started=true;
    win.webContents.once('did-finish-load',async()=>{
      const js=expression=>win.webContents.executeJavaScript(expression,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
      const wait=async(expr,limit=20000)=>{const deadline=Date.now()+limit;while(Date.now()<deadline){if(await js(expr))return;await pause(80);}throw Error('Timed out: '+expr);};
      const click=async(selector)=>{await pause(200);const point=await js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing '+${JSON.stringify(selector)});b.scrollIntoView({block:'center',behavior:'instant'});const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await pause(150);};
      const shot=async name=>{await pause(450);fs.writeFileSync(path.join(evidence,name+'.png'),(await win.webContents.capturePage()).toPNG());};
      try{
        await wait("typeof Routine!=='undefined' && !!document.querySelector('#ux-now')");
        assert.equal(await js("!!document.querySelector('#sidebar #add-video-collection')"),false);
        await click('[data-collection-id="night"]');assert.equal(await js('Store.currentMode()'),'night');assert.equal(await js("document.querySelectorAll('[data-watch-period]').length"),1);
        await js("App.goCollection('awakening')");
        assert.equal(await js('Store.currentMode()'),'awakening');
        await click('[data-watch-period="morning"]');
        assert.equal(await js('App.currentView'),'awakening');assert.equal(await js('Routine.active'),null);
        await js("App.goCollection('awakening')");await click('[data-watch-period="evening"]');
        assert.equal(await js('App.currentView'),'awakening');assert.equal(await js('Routine.active'),null);
        await click('#watch-plan-settings');assert.equal(await js('UX.settingsPanel'),'reminders');assert.equal(await js('App.currentView'),'settings');
        await click('#ux-tab-collections');await click('#add-video-collection');
        await js("document.querySelector('#vc-name').value='测试新增';");await click('#vc-save');
        await wait("Store.collections().some(c=>c.name==='测试新增') && App.currentView==='settings'");
        await click('#ux-tab-automation');
        await js(`(()=>{const f=document.querySelector('#routine-settings');f.elements.enabled.checked=true;f.elements['evening-time'].value=${JSON.stringify(new Date().toTimeString().slice(0,5))};f.elements['evening-video'].value='test-v';f.requestSubmit();})()`);
        await wait("Store.settings().automation?.enabled && !!Routine.active",25000);
        await wait("Session.active?.running===true && document.querySelector('#stage video')?.currentTime>0 && !!CareCamera.stream");
        await wait("document.querySelector('#camera-preview').videoWidth>0");
        assert.equal(await js("document.querySelector('#camera-preview').paused"),false);
        await shot('training-camera');
        await wait("Routine.active?.stage==='snapshot' && Session.active===null",15000);
        assert.equal(await js("document.querySelector('#camera-preview').paused"),false,'Training pause must not pause camera');assert.match(await js("document.querySelector('#ux-care-now h3').textContent"),/晚间/);
        await shot('after-training-snapshot');
        await click('#routine-snapshot');await wait('Routine.active.snapshotSaved');
        const photo=await js('Store.db.skin.photos.at(-1)');assert.equal(photo.stage,'after-training-before-care');assert.equal(photo.videoId,'test-v');
        const saved=fs.readFileSync(path.join(profile,'skin-photos',photo.file));assert.ok(saved.length>1000);assert.equal(saved[0],255);assert.equal(saved[1],216);
        assert.deepEqual(await js("Store.db.logs.training['2026-10-01']"),records.training['2026-10-01']);
        await click('#routine-next');assert.equal(await js('Routine.active.stage'),'care');assert.equal(await js('App.currentView'),'skincare');assert.match(await js("document.querySelector('#ux-care-now h3').textContent"),/晚间/);
        await shot('care-camera');
        await click('#routine-next');await wait('Routine.active===null && CareCamera.stream===null');
        assert.equal(await js("!!document.querySelector('#care-camera')"),false);
        // Exercise fully automatic capture and follow-up care with the same fake camera.
        await js("Store.settings().automation.autoCapture=true;Session.start('test-v',null,{awaitPlay:true});Routine.start({videoId:'test-v',period:'evening',kind:'routine'});");
        await wait("Routine.active?.stage==='care' && Store.db.skin.photos.length===2",15000);
        await click('#routine-next');await wait('Routine.active===null');
        await js("App.goCollection('awakening')");await click('[data-watch-period="evening"]');
        assert.equal(await js('Store.currentMode()'),'awakening');assert.equal(await js('Routine.active'),null);
        // Denied permission keeps an actionable state, without writing a photo.
        ipcMain.removeHandler('camera:permission');ipcMain.handle('camera:permission',()=>({granted:false,status:'denied'}));
        assert.equal(await js('CareCamera.start()'),false);assert.match(await js("document.querySelector('#camera-status').textContent"),/权限/);await js('CareCamera.stop()');
        fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:true,scope:(process.env.LIFE_ROUTINE_APP?'candidate ASAR loaded by development Electron':'source loaded by development Electron')+', real 5-second synthetic video, fake camera stream, schedule timer, local JPEG and metadata persistence',screenshots:['training-camera.png','after-training-snapshot.png','care-camera.png'],photo,retainedOriginalTraining:true},null,2));
        console.log('ROUTINE_UI_PASS: scheduled full screen, actual synthetic playback → manual snapshot → care; automatic capture chain; permission denied; old records retained.');
        app.quit();
      }catch(error){console.error(error.stack);try{await shot('failure');}catch{}app.exit(1);}
    });
  });
  require(process.env.LIFE_ROUTINE_APP?path.join(process.env.LIFE_ROUTINE_APP,'Contents/Resources/app.asar/main.js'):'../main.js');
  ipcMain.removeHandler('camera:permission');ipcMain.handle('camera:permission',()=>({granted:true,status:'test-fake-camera'}));
}
