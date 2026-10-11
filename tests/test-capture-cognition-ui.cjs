/* Real app renderer + production IPC, temporary data, fake camera, independent restart. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'face-capture-cognition-'));
 try{for(const stage of ['write','restart'])require('node:child_process').execFileSync(require('electron'),[__filename,profile,stage],{stdio:'inherit',timeout:120000,env:{...process.env,FACE_RESHAPE_PROFILE:profile,FACE_UX20_TEST:'1',FACE_HUB_PORT:'19484'}});}finally{fs.rmSync(profile,{recursive:true,force:true});}
}else{
 const {app,ipcMain,Notification,session}=require('electron'),profile=process.argv[2],stage=process.argv[3];
 if(!path.basename(profile).startsWith('face-capture-cognition-'))throw Error('Isolated profile required');
 app.setPath('userData',profile);app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');Notification.prototype.show=function(){};
 const file=path.join(profile,'face-reshape-data.json'),out=path.resolve(process.env.CAPTURE_COGNITION_EVIDENCE||'.impeccable/review/capture-cognition-20261010/source');fs.mkdirSync(out,{recursive:true});
 const date=new Date(),today=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,yesterday=new Date(+date-86400000).toLocaleDateString('en-CA');
 const original={seconds:75,entries:[{id:'original-watch',seconds:75,note:'旧观看记录'}]};
 if(stage==='write')fs.writeFileSync(file,JSON.stringify({version:1,onboarding:{done:true},settings:{remindersEnabled:false,keepInTray:false,autoPauseOnBlur:false,skincareTimes:{morning:'07:00',noon:'12:00',evening:'20:00'},skinLogReminderTime:'',sleepLogReminderTime:'',eveningReviewTime:'',automation:{enabled:false}},videos:[],sessions:[],skincare:{cycles:[{id:'care',name:'日常护理',startDate:'2026-01-01',steps:{morning:[{id:'am',name:'晨间保湿'}],day:[{id:'noon',name:'日间补水'}],evening:[{id:'pm',name:'晚间修护'}]}}]},logs:{training:{[yesterday]:{seconds:321,entries:[{id:'original-training',seconds:321}]}},skincare:{[yesterday]:{morning:['am']}},videoWatching:{awakening:{[yesterday]:original}}},videoCollections:[{id:'face',name:'瘦脸护理',periods:[]},{id:'awakening',name:'认知觉醒',periods:['morning','evening']},{id:'night',name:'夜间阅读',periods:['evening']}],sentinel:'preserve-all-records'}));
 let permission={granted:true},permissionCalls=0,permissionDelay=0,started=false;
 app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(_,cb)=>cb({cancel:true})));
 app.on('browser-window-created',(_,win)=>{
  if(started)return;started=true;win.setSize(1240,950);win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load',async()=>{
   const js=async expression=>{try{return await win.webContents.executeJavaScript(expression,true);}catch(error){console.error('Failed expression:',expression);throw error;}},pause=ms=>new Promise(r=>setTimeout(r,ms));
   const wait=async(expression,timeout=15000)=>{const until=Date.now()+timeout;while(!await js(expression)){if(Date.now()>until)throw Error('Timeout: '+expression);await pause(40);}};
   const click=async selector=>{await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await pause(100);const point=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await pause(100);};
   const shot=async name=>{await pause(800);await js("document.querySelector('#toast-wrap').innerHTML=''");fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());};
   try{
    await wait("typeof Store!=='undefined'&&Store.db&&document.querySelector('#view-root .view')");
    await js("window.__captureErrors=[];addEventListener('error',e=>__captureErrors.push(e.message));addEventListener('unhandledrejection',e=>__captureErrors.push(String(e.reason)))");
    if(stage==='write'){
     await js("App.go('skincare')");
     assert.equal(await js("document.querySelector('#ux-sk-tabs').classList.contains('card')"),false);
     assert.equal(await js("getComputedStyle(document.querySelector('#ux-sk-tabs')).backgroundColor"),'rgba(0, 0, 0, 0)');
     assert.equal(await js("document.querySelector('#sk-open-camera')===null"),true);
     await js("window.__recordBefore=JSON.stringify({training:Store.db.logs.training,care:Store.db.logs.skincare,skin:Store.db.skin.logs})");
     const watching='[data-watch-plan="awakening"]';
     assert.equal(await js(`document.querySelector('${watching} [data-watch-field=targetMinutes]').readOnly`),true);
     await js(`document.querySelector('${watching} .soft-stepper-arrows button').click();document.querySelector('${watching} [data-watch-field=morning]').value='08:00';document.querySelector('${watching} [data-watch-field=evening]').value='22:00';document.querySelector('[data-watch-plan=night] [data-watch-field=targetMinutes]').value='30';document.querySelector('#sk-times-save').click()`);
     assert.equal(await js('Store.settings().watchingPlans.awakening.targetMinutes'),16);
     assert.equal(JSON.parse(fs.readFileSync(file)).settings.watchingPlans.awakening.targetMinutes,16);
     assert.equal(await js(`Store.watchingTarget('${yesterday}','awakening')`),15);
     await js("document.querySelector('.daily-time-settings').scrollIntoView({block:'center',behavior:'instant'})");await shot('common-time-settings');
     await click('[data-tab=photos]');
     assert.equal(await js("(()=>{const h=document.querySelector('.sk-photo-heading').getBoundingClientRect(),b=document.querySelector('#sk-photo-shoot').getBoundingClientRect();return b.x>h.x+h.width/2&&Math.abs(b.right-h.right)<3})()"),true);
     await shot('photo-archive');
     const beforeCalls=permissionCalls;await click('#sk-photo-shoot');
     await wait("CareCamera.stream&&document.querySelector('#camera-preview').videoWidth>0&&!document.querySelector('#camera-capture').disabled");
     assert.equal(permissionCalls,beforeCalls+1);
     assert.equal(await js("getComputedStyle(document.querySelector('#care-camera')).position"),'static');
     assert.equal(await js("document.querySelector('#camera-sheet-slot').contains(document.querySelector('#care-camera'))"),true);
     assert.equal(await js("document.querySelector('#camera-preview').paused"),false);
     await js('window.__cameraTracks=CareCamera.stream.getTracks()');await shot('camera-preview');
     await click('#camera-capture');await wait('Store.db.skin.photos.length===1&&CareCamera.stream===null');
     const photo=await js('Store.db.skin.photos[0]');assert.equal(photo.date,today);assert.equal(photo.source,'camera');assert.equal(photo.kind,'skin');assert.equal(photo.stage,'daily-record');assert.equal(photo.videoId,null);
     const bytes=fs.readFileSync(path.join(profile,'skin-photos',photo.file));assert.ok(bytes.length>1000);assert.equal(bytes[0],255);assert.equal(bytes[1],216);
     assert.equal(await js('__cameraTracks.every(t=>t.readyState===\'ended\')'),true);
     assert.equal(await js('Skincare.ui.tab'),'photos');assert.equal(await js("document.querySelector('#modal-mask').classList.contains('hidden')"),true);
     assert.equal(await js("JSON.stringify({training:Store.db.logs.training,care:Store.db.logs.skincare,skin:Store.db.skin.logs})===__recordBefore"),true);
     await shot('photo-saved');
     // Closing preview releases camera and creates no photo; skin-record entry uses the same flow.
     await click('[data-tab=record]');await click('#sk-skin-shoot');await wait('!!CareCamera.stream');await js('window.__cameraTracks=CareCamera.stream.getTracks()');await click('#camera-close');
     assert.equal(await js('CareCamera.stream'),null);assert.equal(await js('__cameraTracks.every(t=>t.readyState===\'ended\')'),true);assert.equal(await js('Store.db.skin.photos.length'),1);
     // A denied permission offers system settings, without pretending preview or save succeeded.
     permission={granted:false,status:'denied'};await click('#sk-skin-shoot');await wait("document.querySelector('#camera-status').textContent.includes('权限')");assert.equal(await js("document.querySelector('#camera-capture').disabled"),true);await click('#camera-close');permission={granted:true};
     // Close while permission request is pending: late permission cannot reopen a camera.
     permissionDelay=350;await click('#sk-skin-shoot');await click('#camera-close');await pause(500);permissionDelay=0;
     assert.equal(await js('CareCamera.stream'),null);assert.equal(await js("document.querySelector('#care-camera')===null"),true);
     // Failed metadata write rolls back the record and removes the image, including retry snapshot.
     await click('#sk-skin-shoot');await wait("CareCamera.stream&&document.querySelector('#camera-preview').videoWidth>0&&!document.querySelector('#camera-capture').disabled");
     fs.writeFileSync(path.join(profile,'inject-save-failure'),'true');await click('#camera-capture');await wait("!CareCamera.saving&&document.querySelector('#camera-status').textContent.includes('失败')");
     assert.equal(await js('Store.db.skin.photos.length'),1);assert.equal(await js('Store._failed.skin.photos.length'),1);assert.equal(fs.readdirSync(path.join(profile,'skin-photos')).filter(x=>/\.jpg$/.test(x)).length,1);
     fs.rmSync(path.join(profile,'inject-save-failure'));await click('#camera-capture');await wait('Store.db.skin.photos.length===2&&CareCamera.stream===null');
     assert.equal(await js('Skincare.ui.tab'),'record');assert.equal(await js('Store._failed'),null);
     // Cognitive periods remain local, update at the boundary, and never start a face routine.
     await js("App.goCollection('awakening');window.__originalMinutes=nowMinutes;nowMinutes=()=>8*60;UX.updateWatchingNow()");
     assert.equal(await js("document.querySelector('[data-watch-period=morning]').getAttribute('aria-pressed')"),'true');
     assert.match(await js("document.querySelector('.mini-stat').textContent"),/16 分钟/);
     await js("window.__goalBefore=Store.db.logs.videoWatching.awakening[todayKey()];Store.db.logs.videoWatching.awakening[todayKey()]={seconds:16*60-1,entries:[]};App.render()");
     assert.equal(await js("document.querySelector('.mini-stat i').textContent"),'按自己的节奏积累','Rounded display cannot complete the exact duration target');
     await js("if(__goalBefore)Store.db.logs.videoWatching.awakening[todayKey()]=__goalBefore;else delete Store.db.logs.videoWatching.awakening[todayKey()];App.render()");
     await click('[data-watch-period=evening]');assert.equal(await js('App.currentView'),'awakening');assert.equal(await js('Store.currentMode()'),'awakening');assert.equal(await js('Routine.active'),null);
     await js('nowMinutes=()=>22*60;UX.updateWatchingNow()');assert.equal(await js("document.querySelector('[data-watch-period=evening]').getAttribute('aria-pressed')"),'true');
     await click('[data-watch-period=morning]');await js('UX.updateWatchingNow()');assert.equal(await js("document.querySelector('[data-watch-period=morning]').getAttribute('aria-pressed')"),'true');
     await js('nowMinutes=()=>8*60;UX.updateWatchingNow()');assert.equal(await js('UX.watchManualPhase'),null);await js('nowMinutes=__originalMinutes;void 0');await shot('cognition-target');
     await click('#watch-plan-settings');assert.equal(await js('UX.settingsPanel'),'reminders');
     assert.equal(await js("document.querySelector('#ux-reminders [data-watch-plan=awakening] [data-watch-field=targetMinutes]').value"),'16');
     await js("document.querySelector('#ux-reminders [data-watch-plan=awakening] [data-watch-field=targetMinutes]').closest('.soft-stepper').querySelector('button').click();document.querySelector('#ux-settings-form').requestSubmit()");
     assert.equal(await js('Store.settings().watchingPlans.awakening.targetMinutes'),17);assert.equal(await js('Store.settings().watchingPlans.night.targetMinutes'),30);
     await js('UX.reminders()');await wait("!!document.querySelector('#ux-reminder-rows')");
     await js("const row=[...document.querySelectorAll('.ux-reminder-row')].find(x=>x.textContent.includes('认知觉醒'));row.querySelector('[data-act=now]').click()");
     assert.equal(await js('App.currentView'),'awakening');assert.equal(await js('Store.currentMode()'),'awakening');
     // Real Session keeps cognitive seconds in its own book and snapshots the goal.
     await js("Store.addVideo({id:'watch-test',title:'测试观看',source:'local',localPath:'/synthetic/watch.webm'},'awakening');Session.start('watch-test',null,{awaitPlay:true});Session.beginCounting();Session.active.seconds=45;Session.stop()");
     assert.equal(await js(`Store.db.logs.videoWatching.awakening['${today}'].seconds`),45);assert.equal(await js(`Store.db.logs.videoWatching.awakening['${today}'].targetMinutes`),17);
     assert.equal(await js("JSON.stringify({training:Store.db.logs.training,care:Store.db.logs.skincare,skin:Store.db.skin.logs})===__recordBefore"),true);
     for(const width of [980,1440]){win.setSize(width,950);await pause(150);await js("App.go('skincare');document.querySelector('[data-tab=care]').click()");assert.equal(await js("document.querySelector('#view-root').scrollWidth<=document.querySelector('#view-root').clientWidth+1"),true);await shot('skincare-'+width);}
     console.log('CAPTURE_COGNITION_WRITE_PASS: separate tabs, shared DIY schedule, real JPEG save, preview close, denied permission, late request, save rollback/retry, independent logs, reminder routing, widths.');
    }else{
     assert.equal(await js('Store.settings().watchingPlans.awakening.targetMinutes'),17);assert.equal(await js('Store.settings().watchingPlans.night.targetMinutes'),30);
     assert.equal(await js('Store.db.skin.photos.length'),2);
     for(const photo of await js('Store.db.skin.photos'))assert.ok(fs.existsSync(path.join(profile,'skin-photos',photo.file)));
     assert.equal(await js(`Store.db.logs.videoWatching.awakening['${today}'].seconds`),45);assert.equal(await js(`Store.db.logs.videoWatching.awakening['${yesterday}'].seconds`),75);
     await js("App.go('skincare')");assert.equal(await js("document.querySelector('[data-watch-plan=awakening] [data-watch-field=targetMinutes]').value"),'17');
     assert.equal(await js('CareCamera.stream'),null);assert.equal(await js('Store.db.sentinel'),'preserve-all-records');
     console.log('CAPTURE_COGNITION_RESTART_PASS: saved settings, independent histories and both photos survive process restart.');
    }
    assert.deepEqual(await js('__captureErrors'),[]);
    fs.writeFileSync(path.join(out,stage+'-result.json'),JSON.stringify({passed:true,stage,scope:process.env.CAPTURE_COGNITION_APP?'candidate ASAR in isolated Electron':'source in isolated Electron',camera:'fake device; real JPEG file and production storage IPC',photos:await js('Store.db.skin.photos.length'),targetMinutes:await js('Store.settings().watchingPlans.awakening.targetMinutes')},null,2));app.quit();
   }catch(error){console.error(error.stack);try{await shot('failure');}catch{}app.exit(1);}
  });
 });
 require(process.env.CAPTURE_COGNITION_APP?path.join(process.env.CAPTURE_COGNITION_APP,'Contents/Resources/app.asar/main.js'):'../main.js');
 ipcMain.removeHandler('camera:permission');ipcMain.handle('camera:permission',async()=>{permissionCalls++;if(permissionDelay)await new Promise(r=>setTimeout(r,permissionDelay));return permission;});
}
