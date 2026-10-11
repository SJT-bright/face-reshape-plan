/* Real Electron, production preload/IPC, isolated profile, then independent restart. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'face-soft-ui-'));
  try{for(const stage of ['write','restart'])require('node:child_process').execFileSync(require('electron'),[__filename,profile,stage],{stdio:'inherit',timeout:90000,env:{...process.env,FACE_RESHAPE_PROFILE:profile,FACE_UX20_TEST:'1'}});}finally{fs.rmSync(profile,{recursive:true,force:true});}
}else{
  const {app,Notification,session}=require('electron'),profile=process.argv[2],stage=process.argv[3];
  if(!path.basename(profile).startsWith('face-soft-ui-'))throw Error('Isolated profile required');
  app.setPath('userData',profile);app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');Notification.prototype.show=function(){};
  const file=path.join(profile,'face-reshape-data.json'),out=path.resolve(process.env.SOFT_CONTROLS_EVIDENCE||'.impeccable/review/soft-controls-20261009');fs.mkdirSync(out,{recursive:true});
  if(stage==='write')fs.writeFileSync(file,JSON.stringify({version:1,onboarding:{done:true},settings:{remindersEnabled:false,keepInTray:false,skincareTimes:{morning:'07:00',noon:'12:00',evening:'20:00'},skinLogReminderTime:'',eveningReviewTime:'',sleepLogReminderTime:'',automation:{enabled:false}},videos:[],sessions:[],skincare:{cycles:[{id:'care-seed',name:'我的护肤流程',startDate:'2026-01-01',endDate:'',steps:{morning:[{id:'am',name:'晨间保湿'}],day:[{id:'noon',name:'日间补水'}],evening:[{id:'pm',name:'晚间修护'}]}}]},logs:{training:{},skincare:{}},sentinel:'preserve-old-data'}));
  app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(_,cb)=>cb({cancel:true})));
  let started=false;app.on('browser-window-created',(_,win)=>{if(started)return;started=true;win.setSize(1240,900);win.webContents.setBackgroundThrottling(false);
    win.webContents.once('did-finish-load',async()=>{
      const js=async x=>{try{return await win.webContents.executeJavaScript(x,true);}catch(e){console.error('Failed expression:',x);console.error(await win.webContents.executeJavaScript('window.__softErrors||[]'));throw e;}},pause=ms=>new Promise(r=>setTimeout(r,ms));
      const wait=async x=>{const deadline=Date.now()+10000;while(!await js(x)){if(Date.now()>deadline)throw Error('Timeout: '+x);await pause(30);}};
      const capture=async name=>{await pause(800);await js("document.querySelector('#toast-wrap').innerHTML=''");fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());};
      try{
        await wait("typeof Store!=='undefined'&&Store.db&&document.querySelector('#ux-now')");
        await js("window.__softErrors=[];addEventListener('error',e=>__softErrors.push(e.message));addEventListener('unhandledrejection',e=>__softErrors.push(String(e.reason)))");
        if(stage==='write'){
          assert.equal(await js("document.querySelector('#sidebar [data-period-filter]')===null"),true);
          assert.equal(await js("document.querySelectorAll('#ux-now [data-face-period]').length"),3);
          assert.equal(await js("Math.abs(document.querySelector('#video-collections-nav .nav-item').getBoundingClientRect().height-document.querySelector('.nav-item[data-view=today]').getBoundingClientRect().height)<1"),true);
          await capture('today');
          await js("App.go('nutrition');Rhythm.mealModal();");await pause(150);
          assert.equal(await js("document.querySelector('[name=time]').type"),'hidden');
          assert.equal(await js("document.querySelectorAll('.soft-time-wheel').length"),2);
          const mealDate=await js('todayKey()');
          await js("document.querySelectorAll('.soft-time-wheel')[0].querySelector('[data-value=\"0\"]').click();document.querySelectorAll('.soft-time-wheel')[1].querySelector('[data-value=\"1\"]').click();");await pause(200);
          assert.equal(await js("document.querySelector('[name=time]').value"),mealDate+'T00:01');
          assert.equal(await js("document.querySelector('[name=mealType]').value"),'supper');
          await capture('meal-time-wheel');
          await js("document.querySelector('#rh-form').requestSubmit()");await wait('!Rhythm.busy&&Store.db.rhythm.meals.length===1');
          assert.equal(JSON.parse(fs.readFileSync(file)).rhythm.meals[0].local,mealDate+'T00:01');
          assert.equal(await js("document.querySelectorAll('#rh-sleep-form input:not([type=checkbox])').length"),3);
          assert.equal(await js("document.querySelector('.rhythm-sleep-column').getBoundingClientRect().top>document.querySelector('.rhythm-log-columns>div').getBoundingClientRect().bottom"),true);
          await js("document.querySelector('[name=hours]').closest('.soft-stepper').querySelector('[aria-label^=减少]').click();document.querySelector('[name=qScore]').closest('.soft-stepper').querySelector('[aria-label^=增加]').click();document.querySelector('#rh-sleep-form').requestSubmit()");
          await wait("!Rhythm.busy&&Store.db.rhythm.sleeps.some(s=>s.durationOnly)");
          assert.equal(await js('Store.db.rhythm.sleeps[0].recordedMinutes'),420);assert.equal(await js('Store.db.rhythm.sleeps[0].qualityScore'),81);
          assert.equal(await js("document.querySelector('[name=hours]').value"),'7');
          await capture('nutrition');
          await js("App.go('skincare');window.__nowMinutes=nowMinutes;nowMinutes=()=>8*60;UX.updateCareNow(true)");
          assert.equal(await js("document.querySelector('#ux-care-now').textContent.includes('晨间保湿')"),true);
          await js("document.querySelector('#ux-care-all').click();nowMinutes=()=>12*60;UX.updateCareNow()");
          assert.equal(await js("document.querySelector('#ux-care-now').textContent.includes('日间补水')"),true);
          await js("nowMinutes=()=>20*60;UX.updateCareNow()");
          assert.equal(await js("document.querySelector('#ux-care-now').textContent.includes('晚间修护')"),true);
          assert.deepEqual(await js("Store.db.logs.skincare[todayKey()].morning"),['am']);
          await js("document.querySelector('[data-care-phase=morning]').click();UX.updateCareNow()");
          assert.equal(await js("document.querySelector('#ux-care-now').textContent.includes('晨间保湿')"),true);
          await capture('skincare');
          await js("nowMinutes=__nowMinutes;const state=Core.normalize(Store.db);Core.replaceTemplate(state,{name:'初始训练计划',effectiveFrom:todayKey(),days:[{name:'力量训练',dayKey:'day1',actions:[{actionKey:'lift',name:'哑铃卧推',plannedSets:3,plannedRepsText:'12',plannedWeightText:'20kg'}]}]});Store.save(true);App.go('strength')");
          assert.equal(await js("document.querySelector('[data-key=repsText]').value"),'12');
          assert.equal(await js("document.querySelector('[data-key=weightKg]').value"),'20');
          assert.equal(await js("document.querySelector('[data-key=repsText]').readOnly"),true);
          await js("document.querySelector('[data-key=repsText]').closest('.soft-stepper').querySelector('[aria-label^=增加]').click();document.querySelector('#st-save').click()");
          await wait("Store.db.strength.adjustments?.length===1");
          await js("document.querySelector('[data-key=repsText]').closest('.soft-stepper').querySelector('[aria-label^=减少]').click();document.querySelector('[data-key=weightKg]').closest('.soft-stepper').querySelector('[aria-label^=增加]').click();document.querySelector('#st-save').click()");
          await wait("Store.db.strength.adjustments.length===2");
          assert.equal(await js('Store.db.strength.adjustments[1].before.repsText'),'13');assert.equal(await js('Store.db.strength.adjustments[1].after.repsText'),'12');
          assert.equal(await js("Core.trainingBaseline(Store.db.strength,Store.db.strength.days[todayKey()].actions[0],addDays(todayKey(),1)).weightKg"),20.5);
          await capture('strength');
          for(const width of [980,1440]){win.setSize(width,900);await pause(100);assert.equal(await js("document.querySelector('#view-root').scrollWidth<=document.querySelector('#view-root').clientWidth+1"),true);await capture('strength-'+width);}
          win.setSize(1240,900);await js("App.go('today')");await pause(100);
          const point=await js("(()=>{const r=document.querySelector('[data-face-period=morning]').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
          win.show();win.focus();win.webContents.sendInputEvent({type:'mouseDown',button:'left',...point,clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',button:'left',...point,clickCount:1});
          await wait("SoftControls.audio?.state==='running'");
          assert.equal(JSON.parse(fs.readFileSync(file)).sentinel,'preserve-old-data');
          console.log('SOFT_CONTROLS_WRITE_PASS: wheel, current-date meal, stacked layout, duration/score, live skincare phase, +/- baseline history, sound, widths, disk save.');
        }else{
          assert.equal(await js('Store.db.rhythm.sleeps[0].recordedMinutes'),420);
          await js("App.go('strength')");
          assert.equal(await js("document.querySelector('[data-key=weightKg]').value"),'20.5');
          assert.equal(await js('Store.db.strength.adjustments.length'),2);
          assert.equal(await js('Store.db.sentinel'),'preserve-old-data');
          console.log('SOFT_CONTROLS_RESTART_PASS: exact saved baseline and full adjustment history survive independent process restart.');
        }
        assert.deepEqual(await js('__softErrors'),[]);app.quit();
      }catch(e){console.error(e.stack);fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
    });
  });require(process.env.SOFT_CONTROLS_APP?path.join(process.env.SOFT_CONTROLS_APP,'Contents/Resources/app.asar/main.js'):'../main.js');
}
