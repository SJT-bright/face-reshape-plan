const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const PhotoStore=require('../src/js/hub-photo-store');
const RhythmEngine=require('../src/js/rhythm-engine');
const Backup=require('../src/js/portable-backup');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yV8AAAAASUVORK5CYII=','base64');
const base={sourceKey:'a'.repeat(64),revision:1,kind:'meal',local:'2026-10-10T12:20',
  at:'2026-10-10T12:20:00+08:00',sentAt:'2026-10-10T12:21:00+08:00',timeKind:'occurred',
  note:'餐食照片',mealSourceKey:'b'.repeat(64),sha256:crypto.createHash('sha256').update(PNG).digest('hex'),mime:'image/png',imageBase64:PNG.toString('base64')};

function harness(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-photo-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dataPath=path.join(root,'data.json');let fail=false;
  const context=vm.createContext({RhythmEngine,structuredClone,Date,JSON,Promise,setInterval,clearInterval,setTimeout,clearTimeout,
    window:{native:{onHubAction(){},hubActionReady(){},saveDataSync(next){if(fail)return false;fs.writeFileSync(dataPath,JSON.stringify(next));return true;}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/js/store.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/js/hub-actions.js'),'utf8'),context);
  vm.runInContext('Store.db={rhythm:RhythmEngine.normalize({}),skin:{photos:[]},settings:{},logs:{training:{},skincare:{}},videos:[]};Store._committed=structuredClone(Store.db)',context);
  return {root,handle(photo){context.payload={op:'photo-import',photo};return vm.runInContext('window.HubActions.handle(payload)',context);},
    workout(workout){context.payload={op:'workout-import',workout};return vm.runInContext('window.HubActions.handle(payload)',context);},
    data(){return JSON.parse(fs.readFileSync(dataPath));},fail(value){fail=value;},mutate(code){vm.runInContext(code,context);}};
}

test('original bytes are privately archived, replayed without duplication and restored in portable backup',async t=>{
  const h=harness(t);const dir=path.join(h.root,'meal-photos');
  const validated=PhotoStore.validate(base);const photo=PhotoStore.save(validated,dir);
  assert.deepEqual(fs.readFileSync(path.join(dir,photo.file)),PNG);
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(dir,photo.file)).mode&0o777,0o600);
  assert.deepEqual(PhotoStore.save(validated,dir),photo);
  assert.equal((await h.handle(photo)).ok,true);
  assert.equal((await h.handle(photo)).alreadyDone,true);
  assert.equal(h.data().rhythm.mealPhotos.length,1);
  const bundle=Backup.decode(Backup.encode(Backup.createBundle(h.data(),h.root)));
  assert.equal(bundle.files.filter(f=>f.path.startsWith('meal-photos/')).length,1);
  const target=path.join(h.root,'restored');Backup.restore(bundle,target);
  assert.deepEqual(fs.readFileSync(path.join(target,'meal-photos',photo.file)),PNG);
});

test('meal, skincare and fitness stay in their own records; stale revisions do not move them back',async t=>{
  const h=harness(t);
  for(const [i,kind] of ['meal','skin','body'].entries()){
    const p=PhotoStore.validate({...base,sourceKey:String(i+1).repeat(64),kind}).photo;
    assert.equal((await h.handle(p)).ok,true);
  }
  assert.equal(h.data().rhythm.mealPhotos.length,1);
  assert.deepEqual(h.data().skin.photos.map(p=>p.kind),['skin','body']);
  const revised=PhotoStore.validate({...base,sourceKey:'1'.repeat(64),kind:'skin',revision:2}).photo;
  assert.equal((await h.handle(revised)).ok,true);
  assert.equal((await h.handle(PhotoStore.validate({...base,sourceKey:'1'.repeat(64)}).photo)).stale,true);
  assert.equal(h.data().rhythm.mealPhotos.length,0);
  assert.equal(h.data().skin.photos.length,3);
});

test('save failure keeps old data and succeeds on retry; manual deletion blocks recreation',async t=>{
  const h=harness(t);const photo=PhotoStore.validate(base).photo;
  await h.handle(photo);h.fail(true);
  assert.equal((await h.handle({...photo,revision:2,note:'时间补充'})).retryable,true);
  assert.equal(h.data().rhythm.mealPhotos[0].note,'餐食照片');h.fail(false);
  assert.equal((await h.handle({...photo,revision:2,note:'时间补充'})).ok,true);
  h.mutate(`Store.db.photoImportVersions['${base.sourceKey}']={revision:2,state:'manual-deleted'};Store.save(true)`);
  assert.equal((await h.handle({...photo,revision:3})).conflict,true);
});

test('tampered bytes, unknown categories, invalid date and non-photo formats are rejected',()=>{
  assert.throws(()=>PhotoStore.validate({...base,sha256:'f'.repeat(64)}));
  assert.throws(()=>PhotoStore.validate({...base,kind:'unknown'}));
  assert.throws(()=>PhotoStore.validate({...base,local:'2026-02-30T12:20',at:'2026-02-30T12:20:00+08:00'}));
  assert.throws(()=>PhotoStore.validate({...base,imageBase64:Buffer.from('not an image').toString('base64')}));
});

test('large original photos do not overflow base64 validation; noncanonical encoding is rejected',()=>{
  const original=Buffer.concat([PNG,Buffer.alloc(1024*1024)]);
  const payload={...base,sha256:crypto.createHash('sha256').update(original).digest('hex'),imageBase64:original.toString('base64')};
  assert.deepEqual(PhotoStore.validate(payload).bytes,original);
  assert.throws(()=>PhotoStore.validate({...base,imageBase64:base.imageBase64+'='}));
});

test('diet folders use occurrence date and meal label, allow extra photos, and replay exactly once',t=>{
  const h=harness(t),root=path.join(h.root,'饮食');
  const v=PhotoStore.validate(base),one=PhotoStore.projectMeal(v,root);
  assert.equal(one.archiveRelativePath,'饮食/2026年10月10日/2026年10月10日午餐.png');
  assert.deepEqual(fs.readFileSync(path.join(h.root,one.archiveRelativePath)),PNG);
  assert.deepEqual(PhotoStore.projectMeal(v,root),one);
  const two=PhotoStore.projectMeal(PhotoStore.validate({...base,sourceKey:'c'.repeat(64)}),root);
  assert.equal(two.archiveRelativePath,'饮食/2026年10月10日/2026年10月10日午餐-02.png');
  const explicit=PhotoStore.projectMeal(PhotoStore.validate({...base,local:'2026-10-10T16:00',at:'2026-10-10T16:00:00+08:00',mealLabel:'晚餐',sourceKey:'d'.repeat(64)}),root);
  assert.ok(explicit.archiveRelativePath.endsWith('2026年10月10日晚餐.png'));
  assert.equal(PhotoStore.validate({...base,local:'2026-10-10T15:00',at:'2026-10-10T15:00:00+08:00'}).photo.mealLabel,'下午加餐');
  const pending=PhotoStore.projectMeal(PhotoStore.validate({...base,timeKind:'sent',sourceKey:'e'.repeat(64)}),root);
  assert.equal(pending.archiveRelativePath,'饮食/日期待确认/日期待确认餐别待确认.png');
  assert.equal(fs.readdirSync(path.join(root,'2026年10月10日')).length,3);
});

test('workout matching uses current template, retains raw description, history and all existing progress',async t=>{
  const h=harness(t);
  h.mutate(`Store.db.strength={templates:[{id:'old',name:'旧计划',currentRevision:1,versions:[{revision:1,days:[{dayKey:'old',name:'胸和三头',actions:[]}]}]},{id:'current',name:'练三腹一',currentRevision:2,versions:[{revision:2,days:[{dayKey:'one',name:'第一天 · 胸＋三头',actions:[{name:'哑铃卧推'}]},{dayKey:'two',name:'第二天 · 背＋二头＋小臂',actions:[{name:'哑铃弯举'}]},{dayKey:'three',name:'第三天 · 肩＋腿',actions:[]}]}]}],cycle:{old:{updatedAt:'2026-09-01'},current:{updatedAt:'2026-10-10',currentDayKey:'two'}},days:{'2026-10-10':{status:'completed',actions:[{setsDone:4}]}},events:[{type:'completed'}]};Store.save(true)`);
  const before=structuredClone(h.data().strength);
  const w={sourceKey:'f'.repeat(64),revision:1,date:'2026-10-10',state:'active',description:'三头和胸',rawText:'今天练了三头和胸',sentAt:base.sentAt};
  const result=await h.workout(w);
  assert.equal(result.match.status,'matched');assert.equal(result.match.dayKey,'one');assert.equal(result.match.templateName,'练三腹一');
  assert.deepEqual(h.data().strength,before);
  assert.equal(h.data().workoutImports[w.sourceKey].rawText,w.rawText);
  assert.equal((await h.workout(w)).alreadyDone,true);
  assert.equal((await h.workout({...w,revision:2,description:'哑铃弯举'})).match.dayKey,'two');
  assert.equal(h.data().workoutImports[w.sourceKey].history.length,1);
  assert.equal((await h.workout({...w,revision:3,state:'cancelled'})).match.status,'cancelled');
  assert.deepEqual(h.data().strength,before);
});

test('weak or equal workout matches stay pending; App save failure retries without a partial record',async t=>{
  const h=harness(t);
  h.mutate(`Store.db.strength={templates:[{id:'t',name:'计划',currentRevision:1,versions:[{revision:1,days:[{dayKey:'a',name:'胸日A',actions:[]},{dayKey:'b',name:'胸日B',actions:[]}]}]}],cycle:{t:{updatedAt:'2026-10-10'}}};Store.save(true)`);
  const w={sourceKey:'f'.repeat(64),revision:1,date:'2026-10-10',state:'active',description:'胸',rawText:'今天练了胸',sentAt:base.sentAt};
  assert.equal((await h.workout(w)).match.status,'ambiguous');
  assert.equal((await h.workout({...w,revision:2,description:'散步'})).match.status,'unmatched');
  h.fail(true);assert.equal((await h.workout({...w,revision:3})).retryable,true);h.fail(false);
  assert.equal(h.data().workoutImports[w.sourceKey].revision,2);
  assert.equal((await h.workout({...w,revision:3})).ok,true);
});

test('colloquial muscle names, connectors and either order match the same current plan',async t=>{
  const h=harness(t);
  h.mutate(`Store.db.strength={templates:[{id:'t',name:'练三腹一',currentRevision:1,versions:[{revision:1,days:[{dayKey:'push',name:'第一天 · 胸＋三头',actions:[{name:'哑铃卧推'},{name:'凳上反屈伸'}]},{dayKey:'pull',name:'第二天 · 背＋二头',actions:[{name:'哑铃弯举'}]},{dayKey:'legs',name:'第三天 · 肩＋腿',actions:[]}]}]}],cycle:{t:{updatedAt:'2026-10-12'}}};Store.save(true)`);
  const before=structuredClone(h.data().strength);
  const w={sourceKey:'f'.repeat(64),revision:1,date:'2026-10-10',state:'active',description:'',rawText:'微信口语',sentAt:base.sentAt};
  const forms=['胸和三头','三头跟胸','胸部加肱三头肌','胸肌以及三头肌','肱三头肌、胸大肌','胸部还有三头','哑铃平板卧推、凳上臂屈伸','推胸与肱三头','三頭與胸','chest and triceps'];
  for(let index=0;index<forms.length;index++){
    const result=await h.workout({...w,revision:index+1,description:forms[index]});
    assert.equal(result.match.status,'matched',forms[index]);assert.equal(result.match.dayKey,'push',forms[index]);
  }
  assert.deepEqual(h.data().strength,before);
});
