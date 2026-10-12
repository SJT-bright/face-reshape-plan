// Actual Electron HTTP, original files, renderer Store and visible image decoding.
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'hub-photo-http-'));
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yV8AAAAASUVORK5CYII=','base64');
let child,browser,output='';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function request(port,method,route,body,token){return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:route,method,timeout:6000,headers:{'Content-Type':'application/json',...(token?{'x-life-meal-token':token}:{})}},res=>{
    let data='';res.setEncoding('utf8');res.on('data',b=>data+=b);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data)});}catch(e){reject(e);}});
  });req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('HTTP timeout')));req.end(body?JSON.stringify(body):undefined);
});}
async function start(port,debugPort){
  const executable=process.env.FACE_PHOTO_APP_BINARY || require('electron');
  child=spawn(executable,[...(process.env.FACE_PHOTO_APP_BINARY?[]:[path.join(root,'main.js')]),`--remote-debugging-port=${debugPort}`],
    {env:{...process.env,FACE_RESHAPE_PROFILE:profile,FACE_HUB_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const end=Date.now()+20000;
  while(Date.now()<end){
    if(child.exitCode!==null)throw new Error('Electron exited: '+output.slice(-1000));
    try{if((await request(port,'GET','/hub/health')).body.ok){browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);break;}}catch{}
    await delay(150);
  }
  if(!browser)throw new Error('Electron readiness timeout: '+output.slice(-1000));
  const context=browser.contexts()[0];const page=context.pages().find(p=>p.url().includes('src/index.html')) || await context.waitForEvent('page',{timeout:10000});
  page.on('pageerror',error=>console.error('Isolated renderer error:',error.message));
  page.on('console',message=>{if(message.type()==='error')console.error('Isolated renderer console:',message.text());});
  await page.waitForFunction(()=>typeof Store!=='undefined' && Store.db && window.HubActions,{},{timeout:12000});
  return page;
}
async function stop(){
  if(browser){await browser.close();browser=undefined;}
  if(!child || child.exitCode!==null)return;
  const running=child;running.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>running.once('exit',resolve)),delay(8000).then(()=>{throw new Error('Electron did not stop normally');})]);
  child=undefined;
}
async function screenshotReady(page,file){
  // Decoded images can exist while the entry animation still hides the page.
  await page.evaluate(async()=>{const root=document.querySelector('#view-root');if(root)await Promise.all(root.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  await page.screenshot({path:file,fullPage:true});
}
async function main(){
  const port=await freePort(),debugPort=await freePort();
  let page=await start(port,debugPort);
  const token=fs.readFileSync(path.join(profile,'hub-meal-token'),'ascii').trim();
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-86400000));
  const meal={sourceKey:'b'.repeat(64),revision:1,local:`${day}T12:20`,at:`${day}T12:20:00+08:00`,timeKind:'started',state:'active',foodText:'鸡蛋和米饭',photoCount:1};
  assert.equal((await request(port,'POST','/hub/meal',meal,token)).status,200);
  const payload={sourceKey:'a'.repeat(64),revision:1,kind:'meal',local:meal.local,at:meal.at,sentAt:`${day}T12:21:00+08:00`,timeKind:'occurred',note:'餐食照片',mealSourceKey:meal.sourceKey,sha256:crypto.createHash('sha256').update(PNG).digest('hex'),mime:'image/png',imageBase64:PNG.toString('base64')};
  assert.equal((await request(port,'POST','/hub/photo',payload,'f'.repeat(64))).status,403);
  assert.equal((await request(port,'POST','/hub/photo',{...payload,sha256:'f'.repeat(64)},token)).status,400);
  for(const [index,kind] of ['meal','skin','body'].entries()){
    const photo={...payload,sourceKey:String(index+1).repeat(64),kind,mealSourceKey:kind==='meal'?meal.sourceKey:null};
    const saved=await request(port,'POST','/hub/photo',photo,token);
    assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.sha256,payload.sha256);
    const folder=kind==='meal'?'meal-photos':kind==='skin'?'skin-photos':'body-photos';
    assert.deepEqual(fs.readFileSync(path.join(profile,folder,saved.body.file)),PNG);
  }
  const file=path.join(profile,'face-reshape-data.json');
  let data=JSON.parse(fs.readFileSync(file));assert.equal(data.rhythm.mealPhotos.length,1);assert.equal(data.skin.photos.length,2);
  assert.equal(data.rhythm.mealPhotos[0].sentAt,payload.sentAt);assert.equal(data.rhythm.mealPhotos[0].mealSourceKey,meal.sourceKey);
  const evidence=process.env.FACE_PHOTO_TEST_EVIDENCE;if(evidence)fs.mkdirSync(evidence,{recursive:true});
  for(const kind of ['meal','skin','body']){
    await page.evaluate(({kind,day})=>{
      if(kind==='meal'){Rhythm.selectedDay=day;App.go('nutrition');}
      else if(kind==='skin'){Skincare.ui.skinPhotoKind='skin';App.go('skincare');}
      else{Strength.ui.date=day;Strength.ui.tab='today';App.go('strength');}
    },{kind,day});
    await page.waitForFunction(kind=>[...document.querySelectorAll(`img[data-photo-kind="${kind}"]`)].some(img=>img.complete && img.naturalWidth>0),kind,{timeout:10000});
    if(evidence)await screenshotReady(page,path.join(evidence,`${kind}.png`));
  }
  await stop();page=await start(port,debugPort);
  for(const [index,kind] of ['meal','skin','body'].entries()){
    const replay=await request(port,'POST','/hub/photo',{...payload,sourceKey:String(index+1).repeat(64),kind,mealSourceKey:kind==='meal'?meal.sourceKey:null},token);
    assert.equal(replay.status,200);assert.equal(replay.body.alreadyDone,true);
  }
  data=JSON.parse(fs.readFileSync(file));assert.equal(data.rhythm.mealPhotos.length,1);assert.equal(data.skin.photos.length,2);
  console.log('PASS photo HTTP: unauthorized 403, tamper 400, 3 original files exact, meal relation/time retained, 3 UI images decoded, restart replay creates 0 duplicates; isolated profile only');
  const older=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-40*86400000));
  for(let index=0;index<32;index++){
    const local=`${index===0?older:day}T18:00`;
    const history={...payload,sourceKey:crypto.createHash('sha256').update('history-'+index).digest('hex'),
      kind:'body',mealSourceKey:null,local,at:local+':00+08:00',sentAt:local+':00+08:00',note:index===0?'历史健身成果原图':'近期健身成果'};
    assert.equal((await request(port,'POST','/hub/photo',history,token)).status,200);
  }
  await page.evaluate(day=>{Strength.ui.date=day;Strength.ui.tab='today';App.go('strength');},older);
  await page.locator('button[data-body-photo]').click();
  await page.waitForFunction(()=>document.querySelector('.sk-viewer-img img')?.naturalWidth>0,{},{timeout:10000});
  assert.ok((await page.locator('#modal-card').innerText()).includes('历史健身成果原图'));
  console.log('PASS long history: oldest fitness photo still opens after 32 newer records; original decoded in App viewer');
  const deletedKey=crypto.createHash('sha256').update('history-0').digest('hex');
  const deletedFile=path.join(profile,'body-photos','wx-'+deletedKey+'.png');
  await page.evaluate(async key=>{
    const photo=Store.db.skin.photos.find(p=>p.sourceKey===key);
    await native.deleteSkinPhoto(photo.file,'body');
    Store.db.skin.photos=Store.db.skin.photos.filter(p=>p.id!==photo.id);
    Store.db.photoImportVersions[key]={revision:1,state:'manual-deleted'};
    Store.save(true);
  },deletedKey);
  assert.equal(fs.existsSync(deletedFile),false);
  const deletedReplay={...payload,sourceKey:deletedKey,kind:'body',mealSourceKey:null,
    local:older+'T18:00',at:older+'T18:00:00+08:00',sentAt:older+'T18:00:00+08:00',note:'历史健身成果原图'};
  assert.equal((await request(port,'POST','/hub/photo',deletedReplay,token)).status,409);
  assert.equal(fs.existsSync(deletedFile),false,'a rejected replay must not restore a manually deleted original file');
  console.log('PASS manual deletion: replay 409 preserves deletion of both record and physical file');
  // Real active-plan setup in an isolated profile, not a matcher mock.
  await page.evaluate(()=>{
    const state=Core.normalize(Store.db);
    const result=Core.replaceTemplate(state,{id:'bridge-plan',name:'练三腹一',days:[
      {dayKey:'chest-triceps',name:'第一天 · 胸＋三头',actions:[{name:'哑铃卧推',plannedSets:3}]},
      {dayKey:'back-biceps',name:'第二天 · 背＋二头＋小臂',actions:[{name:'哑铃弯举',plannedSets:3}]}]});
    if(!result.ok)throw new Error(result.error);Store.save(true);
  });
  const strengthBefore=await page.evaluate(()=>JSON.stringify(Store.db.strength));
  fs.writeFileSync(path.join(profile,'bridge-original.png'),PNG);
  const diary=process.env.LIFE_DIARY_TEST_ROOT;
  if(!diary)throw new Error('LIFE_DIARY_TEST_ROOT is required for the actual Python/HTTP bridge acceptance');
  const bridgeOutput=execFileSync(path.join(diary,'.venv/bin/python'),[path.join(diary,'scripts/test_training_bridge.py'),'--profile',profile,'--port',String(port)],{env:{...process.env,PYTHONPATH:path.join(diary,'src')},encoding:'utf8',timeout:30000});
  console.log(bridgeOutput.trim());
  assert.equal(await page.evaluate(()=>JSON.stringify(Store.db.strength)),strengthBefore,'WeChat workout import must preserve plan/progress/cycle');
  const workout=await page.evaluate(()=>Object.values(Store.db.workoutImports)[0]);
  assert.equal(workout.description,'三头和胸');assert.equal(workout.match.dayKey,'chest-triceps');
  await page.evaluate(date=>{closeModal();Strength.ui.date=date;Strength.ui.tab='today';App.go('strength');},workout.date);
  await page.waitForFunction(()=>document.querySelector('[data-workout-source]')?.textContent.includes('胸＋三头'),{},{timeout:10000}).catch(async error=>{console.error('Isolated strength view:',await page.locator('#view-root').innerText());throw error;});
  const linked=await page.evaluate(key=>Store.db.skin.photos.find(p=>p.trainingSourceKey===key),workout.sourceKey);
  assert.ok(linked);assert.equal(linked.date,workout.date);
  await page.locator(`[data-body-photo="${linked.id}"]`).click();
  await page.waitForFunction(()=>document.querySelector('.sk-viewer-img img')?.naturalWidth>0);
  if(evidence)await screenshotReady(page,path.join(evidence,'training-plan-photo.png'));
  await page.evaluate(()=>closeModal());
  await page.evaluate(day=>{Rhythm.selectedDay=day;App.go('nutrition');},day);
  await page.locator('#rh-diet-entry').click();
  assert.ok((await page.locator('#rh-diet-journal').innerText()).includes('午餐'));
  const named=path.join(profile,'饮食',day.split('-').map(Number).reduce((out,value,index)=>out+(index===0?value+'年':index===1?value+'月':value+'日'),''));
  assert.ok(fs.readdirSync(named).some(name=>name.includes('午餐')));
  assert.deepEqual(fs.readFileSync(path.join(named,fs.readdirSync(named).find(name=>name.includes('午餐')))),PNG);
  if(evidence)await screenshotReady(page,path.join(evidence,'diet-entry.png'));
  console.log('PASS actual App: WeChat workout text/plan/photo visible, progress unchanged, diet entrance clickable, date/meal named original bytes exact');
  // Produce a visible timestamp fixture through the actual renderer, then the
  // local Vision reader must transcribe it without inventing a meal fact.
  await page.evaluate(()=>{const e=document.createElement('div');e.id='timestamp-fixture';e.style.cssText='background:white;color:black;font:36px Arial;padding:30px;width:760px';e.textContent='2026-05-20 12:20';document.body.append(e);});
  const fixture=path.join(profile,'visible-time.png');await page.locator('#timestamp-fixture').screenshot({path:fixture});
  await page.evaluate(()=>document.querySelector('#timestamp-fixture').remove());
  const timeOutput=execFileSync(path.join(diary,'.venv/bin/python'),['-c','import sys,json;from feishu_life_diary.photo_time import candidates;print(json.dumps(candidates(sys.argv[1])))',fixture],{env:{...process.env,PYTHONPATH:path.join(diary,'src')},encoding:'utf8',timeout:10000});
  assert.ok(JSON.parse(timeOutput).some(item=>item.text.includes('2026-05-20') && item.text.includes('12:20')));
  console.log('PASS image timestamp: real renderer PNG → local Vision recognizes original date/time; still requires owner confirmation before recording meal time');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  try{await stop();}catch(e){console.error(e);process.exitCode=1;}
  if(!child || child.exitCode!==null)fs.rmSync(profile,{recursive:true,force:true});
});
