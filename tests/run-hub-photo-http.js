// Actual Electron HTTP, original files, renderer Store and visible image decoding.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
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
    if(evidence)await page.screenshot({path:path.join(evidence,`${kind}.png`),fullPage:true});
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
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  try{await stop();}catch(e){console.error(e);process.exitCode=1;}
  if(!child || child.exitCode!==null)fs.rmSync(profile,{recursive:true,force:true});
});
