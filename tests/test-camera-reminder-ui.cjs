/* Portable native Electron checks for the current recorder, focus session and reminder UI. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright-core');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'face-camera-reminder-'));
const evidence=path.resolve(process.env.FACE_CAMERA_REMINDER_EVIDENCE || '.impeccable/review/camera-reminder');
fs.mkdirSync(evidence,{recursive:true});const dataFile=path.join(profile,'face-reshape-data.json');
fs.writeFileSync(dataFile,JSON.stringify({version:1,onboarding:{done:true},freshInstall:false,settings:{keepInTray:false,remindersEnabled:true,quietStart:'',quietEnd:'',skincareTimes:{morning:'',noon:'',evening:''},eveningReviewTime:'',skinLogReminderTime:'',sleepLogReminderTime:'',timedFocusEnabled:false},videos:[],sessions:[],skincare:{cycles:[]},skin:{photos:[{id:'legacy-photo',file:'unavailable-legacy.jpg',date:'2026-10-01',kind:'skin'}]},logs:{training:{'2026-10-01':{seconds:75}},skincare:{}},sentinel:'keep-native-records'}));
let app,phase='launch';const deadline=setTimeout(()=>{console.error('Camera reminder test deadline: '+phase);app?.process().kill('SIGTERM');},90000);
async function main(){
  app=await electron.launch({args:[path.join(root,'main.js'),'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--disable-backgrounding-occluded-windows'],env:{...process.env,FACE_RESHAPE_PROFILE:profile,FACE_UX20_TEST:'1',FACE_HUB_PORT:'0'},timeout:30000});
  app.process().stderr?.on('data',b=>process.stderr.write(b));
  const page=await app.firstWindow();
  await app.evaluate(({ipcMain,BrowserWindow})=>{for(const channel of ['camera:permission','camera:microphone']){ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>({granted:true,status:'synthetic'}));}BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);});
  await page.waitForFunction(()=>typeof Store!=='undefined'&&Store.db);const wait=fn=>page.waitForFunction(fn,{},{polling:100,timeout:15000});
  await page.evaluate(()=>{window.cameraReminderErrors=[];addEventListener('error',e=>cameraReminderErrors.push(e.error?.stack||e.message));addEventListener('unhandledrejection',e=>cameraReminderErrors.push(String(e.reason)));App.go('skincare');});
  phase='morning video';await page.locator('#sk-record-phase').selectOption('morning');await page.locator('#sk-start-record').click();
  await wait(()=>document.querySelector('#sk-record-preview')?.srcObject?.getVideoTracks().length===1);assert.equal(await page.evaluate(()=>document.querySelector('#sk-record-preview').srcObject.getAudioTracks().length),0);
  await page.waitForTimeout(1200);await page.locator('#sk-stop-record').click();await wait(()=>!SkincareSession.recording && !!document.querySelector('#sk-start-record'));
  assert.equal(await page.locator('[data-record-phase="morning"] [data-review-video]').count(),0);
  phase='evening video';await page.locator('#sk-record-phase').selectOption('evening');await page.locator('#sk-start-record').click();
  await wait(()=>document.querySelector('#sk-record-preview')?.srcObject?.getAudioTracks().length===1);
  await page.waitForTimeout(1200);await page.screenshot({path:path.join(evidence,process.platform+'-recording.png')});await page.locator('#sk-stop-record').click();await wait(()=>!SkincareSession.recording && !!document.querySelector('#sk-start-record'));
  await wait(()=>!!document.querySelector('[data-record-phase="evening"] [data-review-video]'));
  const records=JSON.parse(fs.readFileSync(dataFile)).skin.videos;assert.equal(records.length,2);const evening=records.find(v=>v.phase==='evening');assert.equal(evening.audioRecorded,true);
  assert.ok(fs.readFileSync(path.join(profile,'skincare-videos',evening.file)).includes(Buffer.from('A_OPUS')),'Saved WebM has an actual Opus audio track');
  await page.locator('[data-record-phase="evening"] video').click({button:'right'});assert.match(await page.locator('#evening-video-menu').innerText(),/转文字并存入复盘/);await page.keyboard.press('Escape');
  phase='foreground review timer';const date=await page.evaluate(()=>todayKey());
  await app.evaluate(({BrowserWindow},date)=>{const w=BrowserWindow.getAllWindows()[0];w.__focusSettled=false;w.once('enter-full-screen',()=>w.__focusSettled=true);w.webContents.send('routine-activate',{id:date+'|review',date,kind:'review',title:'晚间复盘',focus:true});},date);
  await wait(()=>TimedFocus.active?.kind==='review' && App.currentView==='daily-review');await page.waitForTimeout(1300);assert.notEqual(await page.locator('#timed-focus-clock').innerText(),'00:00');
  for(let i=0;i<40;i++){if(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].__focusSettled))break;await page.waitForTimeout(100);}
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()&&BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),true);
  await page.locator('#timed-focus-done').click();await wait(()=>!TimedFocus.active);await page.waitForTimeout(1000);
  phase='snooze and count';await page.evaluate(()=>{UX.settingsPanel='reminders';App.go('settings');});await page.locator('[data-habit-id="water"]').waitFor();
  const row=page.locator('[data-habit-id="water"]');await row.locator('[data-field="name"]').fill('喝水提醒');await row.locator('[data-field="intervalMinutes"]').fill('1');await row.locator('[data-field="enabled"]').check();await row.locator('[data-habit-save]').click();
  await wait(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water')?.enabled);const due=await page.evaluate(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water').nextDueAt);
  await app.evaluate((_,at)=>{globalThis.__habitTestNow=at;Date.now=()=>globalThis.__habitTestNow;},due+1);
  await wait(()=>HabitRemindersUI.state.active?.reminderId==='water');let popup;for(let i=0;i<30;i++){popup=app.windows().find(p=>p.url().endsWith('habit-reminder-popup.html'));if(popup)break;await page.waitForTimeout(100);}assert.ok(popup);
  await popup.locator('#habit-popup-later').waitFor();await popup.screenshot({path:path.join(evidence,process.platform+'-water.png')});await popup.locator('#habit-popup-later').click();
  await wait(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water')?.snoozed);const snooze=await page.evaluate(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water'));
  assert.equal(snooze.todayCount,0);assert.equal(snooze.nextDueAt,due+300001);
  await app.evaluate((_,at)=>{globalThis.__habitTestNow=at;},snooze.nextDueAt+1);await wait(()=>HabitRemindersUI.state.active?.reminderId==='water'&&!HabitRemindersUI.state.configs.find(c=>c.id==='water')?.snoozed);
  for(let i=0;i<30;i++){if(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='生活提醒').isVisible()))break;await page.waitForTimeout(100);}
  await popup.locator('#habit-popup-complete').click();await wait(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water')?.todayCount===1);await page.evaluate(()=>Store.save(true));
  const saved=JSON.parse(fs.readFileSync(dataFile));assert.equal(Object.keys(saved.habitReminders.completions).length,1);assert.equal(saved.skin.photos[0].id,'legacy-photo');assert.equal(saved.logs.training['2026-10-01'].seconds,75);assert.equal(saved.sentinel,'keep-native-records');
  assert.deepEqual(await page.evaluate(()=>cameraReminderErrors),[]);
  fs.writeFileSync(path.join(evidence,process.platform+'-result.json'),JSON.stringify({passed:true,platform:process.platform,syntheticDevices:true,asrTested:false,checks:['morning video-only','evening actual Opus audio','evening-only right-click','native fullscreen/foreground timer','snooze 5 minutes no count','ack counts once','stale renderer safe save','old archives/logs retained']},null,2));
  console.log('PASS native recorder, fullscreen review and custom reminder snooze/count on '+process.platform);
}
main().catch(error=>{console.error(phase,error);process.exitCode=1;}).finally(async()=>{clearTimeout(deadline);if(app)await app.close();fs.rmSync(profile,{recursive:true,force:true});});
