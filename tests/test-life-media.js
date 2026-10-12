const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const Trash=require('../src/js/media-trash'),Video=require('../src/js/hub-video-store'),Backup=require('../src/js/portable-backup');
const RhythmEngine=require('../src/js/rhythm-engine');
const bytes=Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d6d703432','hex'),Buffer.alloc(64)]);
const base={sourceKey:'a'.repeat(64),revision:1,kind:'meal',local:'2026-10-10T12:20',at:'2026-10-10T12:20:00+08:00',sentAt:'2026-10-10T12:30:00+08:00',timeKind:'occurred',note:'午餐视频',mime:'video/mp4',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
function temp(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'life-media-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
function data(){return {settings:{},videos:[],logs:{training:{a:1},skincare:{b:2}},rhythm:{meals:[{id:'m'}],sleeps:[{id:'s'}],mealPhotos:[]},skin:{photos:[]},strength:{untouched:true}};}
test('all photo categories delete and restore without changing journals; persistent tombstones block replay',()=>{
  for(const kind of ['meal','skin','body']){
    const d=data(),photo={id:'p',file:'original.png',kind,sourceKey:'a'.repeat(64),sourceRevision:2,date:'2026-10-10'};
    (kind==='meal'?d.rhythm.mealPhotos:d.skin.photos).push(photo);const before=structuredClone(d);
    const removed=Trash.change(d,'p','photo','delete');assert.deepEqual(d,before);
    assert.equal(removed.photoImportVersions[photo.sourceKey].state,'manual-deleted');assert.equal(removed.mediaTrash.length,1);
    assert.deepEqual(removed.rhythm.meals,before.rhythm.meals);assert.deepEqual(removed.rhythm.sleeps,before.rhythm.sleeps);assert.deepEqual(removed.strength,before.strength);assert.deepEqual(removed.logs,before.logs);
    const restored=Trash.change(JSON.parse(JSON.stringify(removed)),'p','photo','restore');
    assert.deepEqual((kind==='meal'?restored.rhythm.mealPhotos:restored.skin.photos)[0],photo);assert.equal(restored.mediaTrash.length,0);assert.equal(restored.photoImportVersions[photo.sourceKey].state,'active');assert.equal(restored.mediaHistory.length,2);
  }
});
test('missing, duplicate, conflict or invalid media commands never alter input',()=>{
  const d=data();assert.throws(()=>Trash.change(d,'no','photo','delete'));assert.throws(()=>Trash.change(d,'no','photo','restore'));assert.throws(()=>Trash.change(d,'no','unknown','delete'));
  d.mediaTrash=[{id:'photo:p',type:'photo',record:{id:'p',kind:'meal',sourceKey:'x'}}];d.rhythm.mealPhotos=[{id:'p',kind:'meal',sourceKey:'x'}];assert.throws(()=>Trash.change(d,'p','photo','restore'));
});
test('streaming video writes original once, preserves explicit meal name and cleans partials',t=>{
  const root=temp(t),meta=Video.validate({...base,mealLabel:'晚餐'});assert.equal(meta.mealLabel,'晚餐');
  for(let i=0;i<2;i++){const upload=Video.receiver(meta,root);upload.write(bytes.subarray(0,7));upload.write(bytes.subarray(7));assert.deepEqual(upload.finish(),meta);}
  assert.deepEqual(fs.readFileSync(path.join(root,meta.file)),bytes);assert.deepEqual(fs.readdirSync(root),[meta.file]);
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(root,meta.file)).mode&0o777,0o600);
});
test('truncation, changed hash, image HEIC, wrong MIME and oversized videos are rejected',t=>{
  const root=temp(t),meta=Video.validate(base);const upload=Video.receiver(meta,root);upload.write(bytes.subarray(0,7));assert.throws(()=>upload.finish());assert.equal(fs.readdirSync(root).length,0);
  const bad=Video.receiver({...meta,sha256:'f'.repeat(64)},root);bad.write(bytes);assert.throws(()=>bad.finish());assert.equal(fs.readdirSync(root).length,0);
  assert.equal(Video.type(Buffer.from('000000186674797068656963','hex')),null);
  assert.throws(()=>Video.validate({...base,bytes:Video.MAX_BYTES+1}));assert.throws(()=>Video.validate({...base,local:'2026-02-30T12:20'}));assert.throws(()=>Video.validate({...base,mime:'image/heic'}));
});
test('interrupted video and conflicting canonical files cannot overwrite originals',t=>{
  const root=temp(t),meta=Video.validate(base),upload=Video.receiver(meta,root);upload.write(bytes.subarray(0,20));upload.abort();assert.equal(fs.readdirSync(root).length,0);
  fs.writeFileSync(path.join(root,meta.file),'keep');const other=Video.receiver(meta,root);other.write(bytes);assert.throws(()=>other.finish());assert.equal(fs.readFileSync(path.join(root,meta.file),'utf8'),'keep');
});
test('real Store video import keeps course library separate, persists replay guard and survives save failure',async t=>{
  const root=temp(t),file=path.join(root,'db.json');let fail=false;
  const c=vm.createContext({RhythmEngine,structuredClone,Date,JSON,Promise,setInterval,clearInterval,setTimeout,clearTimeout,window:{native:{onHubAction(){},hubActionReady(){},saveDataSync(d){if(fail)return false;fs.writeFileSync(file,JSON.stringify(d));return true;}}}});
  vm.runInContext(fs.readFileSync('src/js/store.js','utf8'),c);vm.runInContext(fs.readFileSync('src/js/hub-actions.js','utf8'),c);
  c.fixture=data();vm.runInContext('Store.db=fixture;Store._committed=structuredClone(fixture)',c);
  const send=v=>{c.payload={op:'video-import',video:v};return vm.runInContext('window.HubActions.handle(payload)',c);};
  const video=Video.validate(base);assert.equal((await send(video)).ok,true);assert.equal((await send(video)).alreadyDone,true);
  assert.equal(JSON.parse(fs.readFileSync(file)).lifeVideos.length,1);assert.equal(JSON.parse(fs.readFileSync(file)).videos.length,0);
  fail=true;assert.equal((await send({...video,revision:2,note:'改备注'})).retryable,true);fail=false;
  assert.equal(JSON.parse(fs.readFileSync(file)).lifeVideos[0].note,'午餐视频');assert.equal((await send({...video,revision:2})).ok,true);
  c.key=video.sourceKey;vm.runInContext("Store.db.videoImportVersions[key]={revision:2,state:'manual-deleted'};Store.save(true)",c);assert.equal((await send({...video,revision:3})).conflict,true);
});
test('portable full backup includes life video and trash originals, restoration retains recoverability',t=>{
  const root=temp(t),meta=Video.validate(base);fs.mkdirSync(path.join(root,'life-videos'));fs.writeFileSync(path.join(root,'life-videos',meta.file),bytes);
  let d=data();d.lifeVideos=[{...meta,id:'v',date:'2026-10-10',sourceRevision:1}];d=Trash.change(d,'v','video','delete');
  const b=Backup.decode(Backup.encode(Backup.createBundle(d,root,true)));assert.equal(b.files.filter(f=>f.path.startsWith('life-videos/')).length,1);
  const dest=path.join(root,'restore'),r=Backup.restore(b,dest);assert.deepEqual(fs.readFileSync(path.join(dest,'life-videos',meta.file)),bytes);
  assert.equal(Trash.change(r.data,'v','video','restore').lifeVideos.length,1);
});
