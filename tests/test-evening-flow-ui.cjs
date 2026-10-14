/* Full production IPC/renderer, synthetic camera+voice, real local ASR+LLM, isolated review API. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {_electron:electron}=require('playwright-core');
const root=path.resolve(__dirname,'..'), profile=fs.mkdtempSync(path.join(os.tmpdir(),'face-evening-flow-'));
const evidence=path.resolve(process.env.FACE_EVENING_EVIDENCE || '.impeccable/review/evening-flow');
const DATE=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const stamp=DATE.replaceAll('-',''),eveningFile=`护肤-${stamp}-220000.webm`,morningFile=`护肤-${stamp}-090000.webm`;
const videos=path.join(profile,'skincare-videos');fs.mkdirSync(videos,{recursive:true});fs.mkdirSync(evidence,{recursive:true});
const dataFile=path.join(profile,'face-reshape-data.json');
const original={version:1,onboarding:{done:true},freshInstall:false,settings:{keepInTray:false,remindersEnabled:true,quietStart:'',quietEnd:'',
  skinLogReminderTime:'',sleepLogReminderTime:'',eveningReviewTime:'',skincareTimes:{morning:'',noon:'',evening:''},timedFocusEnabled:false},
  videos:[],sessions:[],logs:{training:{'2026-10-01':{seconds:42}},skincare:{}},skincare:{cycles:[]},skin:{videos:[{file:eveningFile,phase:'evening',audioRecorded:true},{file:morningFile,phase:'morning',audioRecorded:false}]},sentinel:'evening-flow-preserve'};
fs.writeFileSync(dataFile,JSON.stringify(original));
let app,server,phase='fixtures',posts=0,note={id:'isolated-daily-review',businessDate:DATE,revision:3,content:JSON.stringify({schemaVersion:'daily-review-template-v1',completed:'既有事项',effective:'既有经验',tomorrow:'明天任务'})};
const deadline=setTimeout(()=>{console.error('Evening flow deadline: '+phase);app?.process().kill('SIGTERM');},210000);
async function main(){
  execFileSync('/usr/bin/say',['-v','Tingting','-o',path.join(profile,'voice.aiff'),'嗯，今天学习了三十分钟英语。我没有去跑步。呃，晚上做了护肤。']);
  execFileSync('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=320x180:r=10','-i',path.join(profile,'voice.aiff'),'-shortest','-c:v','libvpx','-c:a','libopus',path.join(videos,eveningFile)]);
  fs.copyFileSync(path.join(root,'tests/fixtures/synthetic.webm'),path.join(videos,morningFile));
  server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;res.setHeader('content-type','application/json');
    if(req.method==='GET'){res.end(JSON.stringify({note}));return;}
    const command=JSON.parse(body);assert.equal(command.type,'save-personal-daily-note');assert.equal(command.expectedRevision,note.revision);assert.ok(req.headers['idempotency-key']);posts++;
    note={...note,content:command.content,revision:note.revision+1};res.end(JSON.stringify({result:note}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${server.address().port}`;
  app=await electron.launch({...(process.env.FACE_EVENING_APP_BINARY?{executablePath:process.env.FACE_EVENING_APP_BINARY}:{}),
    args:[...(process.env.FACE_EVENING_APP_BINARY?[]:[path.join(root,'main.js')]),'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--disable-backgrounding-occluded-windows'],
    env:{...process.env,FACE_RESHAPE_PROFILE:profile,FACE_UX20_TEST:'1',FACE_REVIEW_ENDPOINT:endpoint,FACE_HUB_PORT:'0'},timeout:30000});
  await app.evaluate(({ipcMain})=>{for(const channel of ['camera:permission','camera:microphone']){ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>({granted:true,status:'synthetic'}));}});
  const page=await app.firstWindow();await page.waitForFunction(()=>typeof Store!=='undefined' && Store.db);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1240,950));
  await page.evaluate(()=>{window.flowErrors=[];addEventListener('error',e=>flowErrors.push(e.error?.stack||e.message));addEventListener('unhandledrejection',e=>flowErrors.push(String(e.reason)));App.go('skincare');});
  await page.waitForFunction(()=>document.querySelectorAll('[data-skincare-file]').length===2);
  assert.equal(await page.locator('[data-record-phase="morning"] [data-review-video]').count(),0);
  const morning=await page.evaluate(file=>native.eveningReviewStart(file),morningFile);assert.equal(morning.ok,false);assert.match(morning.error,/只有晚间/);
  phase='right-click production pipeline';
  await page.locator(`[data-skincare-file="${eveningFile}"] video`).click({button:'right'});
  await page.locator('#evening-video-menu button').click();
  await page.waitForFunction(()=>EveningReviewUI.jobs.some(j=>j.status==='transcribing'));
  await page.screenshot({path:path.join(evidence,'transcribing.png')});
  // While ASR runs independently, confirm camera+audio only on an evening recording.
  phase='evening recording with audio';
  await page.locator('#sk-record-phase').selectOption('evening');await page.locator('#sk-start-record').click();
  await page.waitForFunction(()=>document.querySelector('#sk-record-preview')?.srcObject?.getAudioTracks().length===1);
  assert.equal(await page.evaluate(()=>document.querySelector('#sk-record-preview').srcObject.getVideoTracks().length),1);
  await page.waitForTimeout(1500);await page.screenshot({path:path.join(evidence,'recording.png')});await page.locator('#sk-stop-record').click();
  await page.waitForFunction(()=>!SkincareSession.recording && !!document.querySelector('#sk-start-record'));
  const recorded=await page.evaluate(()=>Store.db.skin.videos.find(v=>v.ms>0));assert.equal(recorded.phase,'evening');assert.equal(recorded.audioRecorded,true);
  const audioProbe=JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','stream=codec_type','-of','json',path.join(videos,recorded.file)],{encoding:'utf8'}));
  assert.ok(audioProbe.streams.some(s=>s.codec_type==='audio'),'Actual saved WebM contains sound');
  phase='real local transcript and cleanup';
  await page.waitForFunction(()=>EveningReviewUI.jobs.some(j=>j.file===document.querySelector('[data-record-phase="evening"]')?.dataset.skincareFile&&j.status==='completed') || EveningReviewUI.jobs.some(j=>j.status==='completed'),{},{timeout:140000});
  const job=await page.evaluate(file=>EveningReviewUI.jobs.find(j=>j.file===file),eveningFile);
  assert.equal(job.status,'completed');assert.match(job.raw.text,/英语/);assert.match(job.raw.text,/没有/);assert.match(job.cleaned.text,/英语/);assert.match(job.cleaned.text,/没有/);assert.match(job.cleaned.text,/护肤/);
  assert.equal(posts,1);const content=JSON.parse(note.content);assert.ok(content.completed.startsWith('既有事项'));assert.equal(content.effective,'既有经验');assert.equal(content.tomorrow,'明天任务');
  await page.evaluate(file=>native.eveningReviewStart(file),eveningFile);await page.waitForTimeout(300);assert.equal(posts,1,'Repeated request never appends twice');
  await page.locator(`[data-skincare-file="${eveningFile}"]`).screenshot({path:path.join(evidence,'review-completed.png')});
  phase='timed fullscreen';
  await app.evaluate(({BrowserWindow},date)=>{const win=BrowserWindow.getAllWindows()[0];win.__focusSettled=false;win.once('enter-full-screen',()=>win.__focusSettled=true);win.webContents.send('routine-activate',{id:date+'|review',date,kind:'review',title:'晚间复盘',focus:true});},DATE);
  await page.waitForFunction(()=>TimedFocus.active?.kind==='review' && App.currentView==='daily-review');
  await page.waitForTimeout(1200);assert.notEqual(await page.locator('#timed-focus-clock').innerText(),'00:00');
  for(let i=0;i<30;i++){if(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].__focusSettled))break;await page.waitForTimeout(100);}
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),true);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);
  await page.screenshot({path:path.join(evidence,'timed-review.png')});await page.locator('#timed-focus-done').click();
  await page.waitForFunction(()=>!TimedFocus.active);await page.waitForTimeout(900);
  assert.equal(JSON.parse(fs.readFileSync(dataFile)).focusSessions[DATE+'|review'].completed,true);
  phase='custom reminders and snooze';
  await page.evaluate(()=>{UX.settingsPanel='reminders';App.go('settings');});await page.locator('[data-habit-id="water"]').waitFor();
  const water=page.locator('[data-habit-id="water"]');await water.locator('[data-field="name"]').fill('喝水提醒测试');await water.locator('[data-field="actionLabel"]').fill('我去喝水');await water.locator('[data-field="intervalMinutes"]').fill('1');await water.locator('[data-field="enabled"]').check();await water.locator('[data-habit-save]').click();
  await page.waitForFunction(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water')?.enabled);
  const due=(await page.evaluate(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water'))).nextDueAt;
  await app.evaluate((_,now)=>{globalThis.__testHabitNow=now;Date.now=()=>globalThis.__testHabitNow;},due+1);
  let popup;for(let i=0;i<30;i++){popup=app.windows().find(p=>p.url().endsWith('habit-reminder-popup.html'));if(popup)break;await page.waitForTimeout(100);}
  assert.ok(popup);await popup.locator('#habit-popup-later').waitFor({state:'visible'});
  await popup.screenshot({path:path.join(evidence,'water-popup.png')});await popup.locator('#habit-popup-later').click();
  await page.waitForFunction(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water')?.snoozed);
  const snoozed=await page.evaluate(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water'));assert.equal(snoozed.todayCount,0);assert.equal(snoozed.nextDueAt,due+1+300000);
  await app.evaluate((_,now)=>{globalThis.__testHabitNow=now;},snoozed.nextDueAt-1);await page.waitForTimeout(1100);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='生活提醒').isVisible()),false);
  await app.evaluate((_,now)=>{globalThis.__testHabitNow=now;},snoozed.nextDueAt+1);await popup.locator('#habit-popup-complete').waitFor({state:'visible'});await popup.locator('#habit-popup-complete').click();
  await page.waitForFunction(()=>HabitRemindersUI.state.configs.find(c=>c.id==='water')?.todayCount===1);
  await page.evaluate(()=>Store.save(true));assert.equal(Object.keys(JSON.parse(fs.readFileSync(dataFile)).habitReminders.completions).length,1,'Old renderer saves preserve new completion');
  await page.locator('#habit-reminders-settings').screenshot({path:path.join(evidence,'habit-settings.png')});
  assert.deepEqual(await page.evaluate(()=>flowErrors),[]);const saved=JSON.parse(fs.readFileSync(dataFile));assert.equal(saved.sentinel,original.sentinel);assert.equal(saved.logs.training['2026-10-01'].seconds,42);
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:true,installed:false,realLocalASR:true,realLocalLLM:true,syntheticDevices:true,reviewTarget:'isolated HTTP contract server',posts,
    checks:['evening-only right-click','actual recorded audio track','local ASR→LLM→review API','original review fields preserved','idempotent repeated click','native fullscreen+alwaysOnTop+timer','5-minute snooze no count','confirm-only count','stale renderer safe save','formal profile untouched']},null,2));
  console.log('PASS evening flow: native UI, sound, real ASR/LLM, isolated review append, fullscreen timer, reminder snooze/count');
}
main().catch(error=>{console.error(phase,error);process.exitCode=1;}).finally(async()=>{clearTimeout(deadline);if(app)await app.close();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(profile,{recursive:true,force:true});});
