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
