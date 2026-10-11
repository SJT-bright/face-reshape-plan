const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const https=require('node:https'),{EventEmitter}=require('node:events');let apiFail=true;
const realGet=https.get;https.get=(...args)=>{const url=typeof args[0]==='string'?new URL(args[0]):args[0],cb=args.at(-1);if(url.hostname!=='api.bilibili.com')return realGet(...args);const req=new EventEmitter();req.destroy=()=>{};queueMicrotask(()=>{const res=new EventEmitter();cb(res);const failed=String(url.href||url.path).includes('BV2xx411c7mD')&&apiFail;res.emit('data',JSON.stringify(failed?{code:-1,message:'模拟限流'}:{code:0,data:{title:'合成导入视频',pic:'',duration:90,cid:1,pages:[{page:1,cid:1,part:'第一段',duration:60},{page:2,cid:2,part:'第二段',duration:30}]}}));res.emit('end');});return req;};
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'face-ux20-ui-'));process.env.FACE_UX20_TEST='1';app.setPath('userData',profile);app.setPath('cache',path.join(profile,'cache'));
const evidence=path.resolve('.impeccable/review/ux20');fs.mkdirSync(evidence,{recursive:true});
app.on('will-quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
let once=false;
app.on('browser-window-created',(_,win)=>{if(once)return;once=true;
const consoleErrors=[];win.webContents.on('console-message',event=>{if(event.level==='error'){consoleErrors.push(event.message);console.error('UI_CONSOLE',event.message);}});
win.webContents.once('did-finish-load',async()=>{
 const js=x=>win.webContents.executeJavaScript(x.includes(';')?'(async()=>{'+x+'})()':'(async()=>('+x+'))()',true),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async x=>{for(let i=0;i<80;i++){if(await js(`!!(${x})`))return;await sleep(100);}throw Error('Timeout: '+x);};
 const shot=async name=>{await sleep(1000);fs.writeFileSync(path.join(evidence,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 try{
  await wait("typeof UX!=='undefined'&&Store.db&&document.querySelector('#ux-now')");
  /* 首页板块改为用户自选（默认 4 个核心）；本套件要覆盖全部快捷动作，显式开启全量 */
  await js("Store.db.settings.homeActions=['follow','strength','care','meal','sleep','skin','library'];Store.save(true);App.render()");
  await wait("document.querySelector('#ux-meal')");
  assert.equal(await js('Store.db.sessions.length'),0,'fresh profile has no invented plan');
  assert.equal(await js("Store.db.skin.predictions[todayKey()].overallDir"),null);
  win.setSize(980,640);await shot('UX-06-home-980');
  assert.equal(await js("document.querySelector('#ux-meal').getBoundingClientRect().bottom < innerHeight"),true);
  await js("document.querySelector('#ux-meal').click()");await sleep(100);
  assert.equal(await js("document.activeElement.closest('#modal-card')!==null"),true);
  await js("document.querySelector('#rh-save').click()");await wait("Store.db.rhythm.meals.length===1");
  assert.equal(await js('App.currentView'),'today','quick meal stays on home');
  await js("App.go('skincare')");await js("document.querySelector('[data-tab=record]').click();const n=document.querySelector('#sk-skin-note');n.value='草稿保留检验';n.dispatchEvent(new Event('input',{bubbles:true}));App.go('today');App.go('skincare');");
  assert.equal(await js("document.querySelector('#sk-skin-note').value"),'草稿保留检验');
  await shot('UX-01-02-skin-record');
  await js("App.go('settings')");await wait("document.querySelector('#ux-settings-form')");await shot('UX-08-settings-980');
  await js("document.querySelector('[name=target]').value='20';document.querySelector('#ux-settings-form').requestSubmit()");assert.equal(await js('Store.db.settings.dailyTargetMinutes'),20);
  fs.writeFileSync(path.join(profile,'inject-save-failure'),'true');
  await js("document.querySelector('[name=target]').value='25';document.querySelector('#ux-settings-form').requestSubmit()").catch(()=>{});await sleep(150);
  assert.equal(await js('Store.db.settings.dailyTargetMinutes'),20,'failed write rolled back committed model');
  assert.equal(await js("document.querySelector('[name=target]').value"),'25','failed form retained');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'face-reshape-data.json'))).settings.dailyTargetMinutes,20);
  await shot('UX-03-save-failure');fs.rmSync(path.join(profile,'inject-save-failure'));
  await js("document.querySelector('#ux-save-status button').click()");assert.equal(await js('Store.db.settings.dailyTargetMinutes'),25);
  // Persistence across renderer reload uses real Chromium local storage and production preload.
  await js("App.go('skincare');document.querySelector('[data-tab=record]').click();const n=document.querySelector('#sk-skin-note');n.value='重启草稿';n.dispatchEvent(new Event('input',{bubbles:true}));");
  await js('Store.flushSync()');win.webContents.reload();await wait("typeof Store!=='undefined'&&Store.db&&document.querySelector('#ux-now')");await js("App.go('skincare')");assert.equal(await js("document.querySelector('#sk-skin-note').value"),'重启草稿');
  // Shared quick forms, real writes, and keyboard dismissal protect drafts.
  await js("App.go('today');document.querySelector('#ux-sleep').click()");await sleep(100);
  /* 1.8.4 睡眠表单改为「时长 + 分数」直填（hours/minutes/qScore），不再有 bed/wake/awakeMin 时间差字段；
     仍驱动同一条 7h35m=455 分钟的记录，保持后续 sleepMinutes 断言不变。 */
  await js("const f=document.querySelector('#rh-sleep-form');Rhythm.selectedDay=todayKey();f.elements.hours.value='7';f.elements.minutes.value='35';f.elements.qScore.value='80';f.elements.complete.checked=true;f.requestSubmit();");
  await wait("Store.db.rhythm.sleeps.length===1&&!Rhythm.busy");assert.equal(await js('RhythmEngine.sleepMinutes(Store.db.rhythm.sleeps[0])'),455);
  await js("App.go('today');document.querySelector('#ux-skin').click()");await sleep(100);
  await js("document.querySelector('#modal-card #sk-acne-total').value='2';document.querySelector('#modal-card #sk-skin-save').click()");await wait("!!Store.db.skin.logs[todayKey()]");
  await js("App.go('skincare');Skincare.quickAddModal('morning',()=>App.render())");await sleep(100);await js("document.querySelector('#qa-name').value='合成洁面';document.querySelector('#qa-ok').click()");
  await js("Store.activeCycle().steps.day=[...Store.activeCycle().steps.morning];Store.activeCycle().steps.evening=[...Store.activeCycle().steps.morning];App.render();document.querySelector('#ux-care-all').click()");assert.equal(await js("Object.values(Store.daySkincare(todayKey())).flat().length"),1);await js("document.querySelector('#ux-care-undo').click()");assert.equal(await js("Object.values(Store.daySkincare(todayKey())).flat().length"),0);
  // Per-set differences and one-click completion; real domain + UI + persisted JSON.
  await js("Store.db.strength.days[Core.businessDate()]={date:Core.businessDate(),name:'合成推日',templateId:'fixture',status:'in-progress',actions:[{actionKey:'press',name:'卧推',plannedSets:3,repsText:'',weightKg:null,setsDone:null}]};Store.save(true);App.go('strength');UX.setEditor(Store.db.strength.days[Core.businessDate()]);");await sleep(100);
  await js("const r=document.querySelector('.ux-set-row');r.querySelector('[data-field=weight]').value='10';r.querySelector('[data-field=reps]').value='12';r.querySelector('[data-done]').click();");
  assert.equal(await js("Store.db.strength.days[Core.businessDate()].actions[0].setsDone"),1);
  assert.equal(await js("document.querySelectorAll('.ux-set-row')[1].querySelector('[data-field=reps]').value"),'12','next set inherits actual pending values');
  await js("const r=document.querySelectorAll('.ux-set-row')[1];r.querySelector('[data-field=weight]').value='15';r.querySelector('[data-field=reps]').value='10';r.querySelector('[data-done]').click();");
  assert.equal(await js("Store.db.strength.days[Core.businessDate()].actions[0].repsText"),'12+10');await shot('UX-11-per-set');
  // 逐组记录同样接受「自重」文本：折算成明确自重 0 并回显「自重」
  await js("const r=document.querySelector('.ux-set-row');r.querySelector('[data-field=weight]').value='自重';r.querySelector('[data-done]').click();");
  await js("const r=document.querySelector('.ux-set-row');r.querySelector('[data-done]').click();");
  assert.equal(await js("Store.db.strength.days[Core.businessDate()].actions[0].sets[0].weightKg"),0,'per-set 自重 stored as explicit 0');
  assert.equal(await js("document.querySelector('.ux-set-row').querySelector('[data-field=weight]').value"),'自重','per-set 自重 echoes back as text');
  await js("const r=document.querySelectorAll('.ux-set-row')[1];r.querySelector('[data-field=weight]').value=' nonsense ';r.querySelector('[data-done]').click();");
  assert.equal(await js("Store.db.strength.days[Core.businessDate()].actions[0].sets[1].weightKg"),15,'unparseable per-set weight is rejected, record unchanged');
  // 做了这一组却没填重量 = 自重（0）；没做的组仍记 null，不凭空多出自重
  await js("const r=document.querySelectorAll('.ux-set-row')[1];r.querySelector('[data-field=weight]').value='';r.querySelector('[data-done]').click();");
  await js("const r=document.querySelectorAll('.ux-set-row')[1];r.querySelector('[data-done]').click();");
  assert.equal(await js("Store.db.strength.days[Core.businessDate()].actions[0].sets[1].weightKg"),0,'blank weight on a done set means bodyweight');
  assert.equal(await js("document.querySelectorAll('.ux-set-row')[1].querySelector('[data-field=weight]').value"),'自重');
  await js('closeModal()');
  // Mixed import list, different pages, failures and retry preserve item-level outcomes.
  await js("Views.importModal()");await sleep(100);await js("document.querySelector('#ux-import-text').value="+JSON.stringify(['BV1xx411c7mD','BV1xx411c7mD?p=2','BV1xx411c7mD','invalid','BV2xx411c7mD'].join('\n'))+";document.querySelector('#ux-import-go').click();");
  await wait("!document.querySelector('#ux-import-go').disabled");
  assert.equal(await js('Store.db.videos.length'),2);apiFail=false;await js("document.querySelector('#ux-import-retry').click()");await wait("!document.querySelector('#ux-import-go').disabled");assert.equal(await js('Store.db.videos.length'),3);await shot('UX-19-import-results');await js('closeModal()');
  // Synthetic PNGs exercise original-file integrity, tags, alignment, and complete backup.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');fs.mkdirSync(path.join(profile,'skin-photos'),{recursive:true});fs.writeFileSync(path.join(profile,'skin-photos','a.png'),png);fs.writeFileSync(path.join(profile,'skin-photos','b.png'),png);
  await js("Store.db.skin.photos=[{id:'a',kind:'skin',file:'a.png',date:addDays(todayKey(),-14),angle:'front'},{id:'b',kind:'skin',file:'b.png',date:todayKey(),angle:'front'}];Store.save(true);App.go('skincare');UX.photoCompare(Skincare._photoList('skin'));");await sleep(150);
  await js("document.querySelector('#ux-photo-scale').value='1.5';document.querySelector('#ux-photo-scale').dispatchEvent(new Event('input'));document.querySelector('#ux-photo-overlay').checked=true;document.querySelector('#ux-photo-overlay').dispatchEvent(new Event('input'));document.querySelector('#ux-photo-save').click();");assert.equal(await js('Store.db.skin.comparison.scale'),1.5);await shot('UX-17-photo-align');assert.deepEqual(fs.readFileSync(path.join(profile,'skin-photos','a.png')),png);await js('closeModal()');
  const archive=path.join(profile,'roundtrip.frbackup');dialog.showSaveDialog=async()=>({canceled:false,filePath:archive});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[archive]});
  await js("App.go('settings');document.querySelector('#ux-export').click()");await wait("!document.querySelector('#ux-export').disabled");assert.ok(fs.existsSync(archive));
  const backup=require('../src/js/portable-backup').decode(fs.readFileSync(archive));assert.equal(backup.files.length,2);assert.equal(backup.data.settings.aiApiKey,undefined);
  await js("Store.db.rhythm.meals=[];Store.db.skin.photos=[];Store.save(true);document.querySelector('#ux-restore').click()");await wait("document.querySelector('#m-ok')!==null");await shot('UX-05-restore-preview');await js("document.querySelector('#m-ok').click()");await wait("Store.db.skin.photos.length===2&&App.currentView==='today'");assert.equal(await js('Store.db.rhythm.meals.length'),1);
  await js("Views.importModal()");await sleep(100);await js("document.querySelector('#ux-import-text').value='键盘草稿';document.querySelector('#ux-import-text').dispatchEvent(new Event('input',{bubbles:true}));");win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait("document.querySelector('#modal-mask').classList.contains('hidden')");await js('Views.importModal()');await sleep(100);assert.equal(await js("document.querySelector('#ux-import-text').value"),'键盘草稿');await js('closeModal(true)');
  // Modal focus stays inside, native shortcut routes respect composition, and commit clears only its draft.
  await js("App.go('today');document.querySelector('#ux-meal').click()");await sleep(100);
  await js("const fields=[...document.querySelectorAll('#modal-card button,#modal-card input,#modal-card select')].filter(x=>!x.disabled&&x.offsetParent);fields.at(-1).focus();");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await sleep(60);
  assert.equal(await js("document.activeElement.id"),'ux-discard-draft','Tab wraps to first control');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['shift']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['shift']});await sleep(60);
  assert.equal(await js("document.activeElement.id"),'rh-save','Shift-Tab wraps to last control');
  await js("document.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));");win.webContents.send('app:shortcut','s');await sleep(100);assert.equal(await js('Store.db.rhythm.meals.length'),1,'IME composition does not submit');
  await js("document.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));const t=document.querySelector('[name=time]');t.value=todayKey()+'T00:01';t.dispatchEvent(new Event('input',{bubbles:true}));");
  win.webContents.send('app:shortcut','s');await wait('Store.db.rhythm.meals.length===2');assert.equal(await js("document.querySelector('#modal-mask').classList.contains('hidden')"),true);
  win.webContents.send('app:shortcut','2');await wait("App.currentView==='plan'");
  // Two edited objects keep independent drafts, including non-input weekday buttons.
  await js("Store.db.sessions=[{id:'draft-a',name:'安排甲',time:'20:00',days:[1],enabled:true},{id:'draft-b',name:'安排乙',time:'20:00',days:[2],enabled:true}];Store.save(true);Views.sessionModal(Store.db.sessions[0]);");await sleep(50);
  await js("const n=document.querySelector('#sm-name');n.value='甲的草稿';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#sm-days [data-d=\"3\"]').click();closeModal();Views.sessionModal(Store.db.sessions[1]);");await sleep(50);assert.equal(await js("document.querySelector('#sm-name').value"),'安排乙');await js("closeModal();Views.sessionModal(Store.db.sessions[0]);");await sleep(50);assert.equal(await js("document.querySelector('#sm-name').value"),'甲的草稿');assert.equal(await js("document.querySelector('#sm-days [data-d=\"3\"]').classList.contains('on')"),true);await js("document.querySelector('#sm-ok').click()");assert.deepEqual(await js('Store.db.sessions[0].days'),[1,3]);
  // IPC-backed snooze survives reload; completed and skipped are distinct.
  await js("Store.db.settings.eveningReviewTime='22:00';Store.save(true);const rows=await native.reminderList();const row=rows.find(x=>x.kind==='review');await native.reminderAction(row.id,'later');Store.db.reminderActions=(await native.loadData()).reminderActions;");
  win.webContents.reload();await wait("typeof UX!=='undefined'&&Store.db&&document.querySelector('#ux-now')");assert.equal(await js("(await native.reminderList()).find(x=>x.kind==='review').state"),'稍后提醒');
  await js("UX.reminders()");await wait("document.querySelector('[data-act=skip]')");await js("document.querySelector('[data-act=skip]').click()");await sleep(150);await shot('UX-13-reminder-timeline');await js('closeModal()');
  // The real system encryption API is exercised only with a synthetic non-credential.
  /* 1.8.4 起 keyStatus 不再探测钥匙串（避免临时签名触发系统授权弹窗阻塞主进程），available 恒为 null；
     真实可用性由下一行的加密写入 + 回读 + 密文校验证明。 */
  const keyState=await js('native.keyStatus()');assert.equal(keyState.available,null,'status lookup does not probe Keychain by design');
  assert.equal((await js("native.saveApiKey('synthetic-ux20-not-a-real-key')")).ok,true);assert.equal(fs.readFileSync(path.join(profile,'ai-key.enc')).includes(Buffer.from('synthetic-ux20-not-a-real-key')),false);assert.equal((await js('native.loadData()')).settings.aiApiKey,undefined);await js("native.saveApiKey('')");
  // Relocation changes only the file reference, retaining plan and history identity. Playback is separately tested with a real local fixture.
  const relocated=path.join(profile,'relocated.webm');fs.writeFileSync(relocated,'reference-only-fixture');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[relocated]});
  await js("Store.db.videos.push({id:'local-relocate',source:'local',title:'待重新定位',localPath:'/missing/synthetic.webm'});Store.db.sessions[0].videoId='local-relocate';Store.save(true);App.go('today');document.querySelector('#ux-library-panel').open=true;");await wait("document.querySelector('[data-relocate]')");await js("document.querySelector('[data-relocate]').click()");await wait("Store.videoById('local-relocate').localPath.endsWith('relocated.webm')");assert.equal(await js('Store.db.sessions[0].videoId'),'local-relocate');assert.equal(await js("Store.videoById('local-relocate').playbackVerified"),false);
  for(const width of [1240,980]){win.setSize(width,width===1240?820:640);for(const view of ['today','plan','strength','skincare','nutrition','achievements']){await js(`App.go('${view}')`);await shot('UX-16-'+view+'-'+width);assert.equal(await js("!!document.querySelector('#view-root').textContent.includes('这一页没能打开')"),false,view+' rendered');assert.equal(await js("document.querySelector('#view-root').scrollWidth<=document.querySelector('#view-root').clientWidth+1"),true,view+' page does not overflow');}}
  win.webContents.setZoomFactor(1.2);await js("App.go('today');document.documentElement.classList.add('dark')");await shot('UX-16-home-dark-120percent');assert.equal(await js("document.querySelector('#ux-meal').getBoundingClientRect().right<=innerWidth"),true);win.webContents.setZoomFactor(1);

  await js("App.go('settings');document.documentElement.classList.add('dark')");win.setSize(980,640);await shot('UX-16-settings-dark-980');
  assert.deepEqual(consoleErrors,[],'no unexpected renderer errors');
  console.log('UX20_UI_PASS: onboarding/empty prediction, quick meal/sleep/skin, draft route/reload/Esc/object-weekday isolation, Tab/Shift-Tab/IME/native shortcuts, reminders reload, native encryption, relocation identity, write failure/rollback/retry, care all/undo, per-set variations, import mixed/retry, photo alignment/hash, backup UI inspect/restore, seven routes/two sizes/dark/120% zoom');app.quit();
 }catch(e){console.error(e);await shot('UX20-failure');app.exit(1);}
});});
require('../main');
