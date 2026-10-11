const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const RhythmEngine = require('../src/js/rhythm-engine');

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'hub-meal-test-'));
  const file = path.join(root,'data.json');
  let failSave = false;
  const context = vm.createContext({
    RhythmEngine, structuredClone, Date, JSON, Promise, setInterval, clearInterval, setTimeout, clearTimeout,
    window:{native:{
      onHubAction:()=>{},hubActionReady:()=>{},
      saveDataSync:(next)=>{ if (failSave) return false; fs.writeFileSync(file,JSON.stringify(next)); return true; }
    }}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/js/store.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/js/hub-actions.js'),'utf8'),context);
  vm.runInContext('Store.db={rhythm:RhythmEngine.normalize({}),settings:{}};Store._committed=structuredClone(Store.db)',context);
  return {
    handle:(meal)=>vm.runInContext('window.HubActions.handle(payload)',Object.assign(context,{payload:{op:'meal-import',meal}})),
    data:()=>JSON.parse(fs.readFileSync(file)),
    inMemory:()=>vm.runInContext('structuredClone(Store.db)',context),
    mutate:(source)=>vm.runInContext(source,context),
    fail:(value)=>{failSave=value;},
    close:()=>fs.rmSync(root,{recursive:true,force:true})
  };
}

const base = {
  sourceKey:'a'.repeat(64),revision:1,local:'2026-10-09T12:20',
  at:'2026-10-09T12:20:00+08:00',timeKind:'started',state:'active',
  foodText:'鸡蛋和米饭',photoCount:0
};

test('real Store save persists imported meal, update, cancellation and replay guard',async(t)=>{
  const h=harness();t.after(h.close);
  const first=await h.handle(base);
  assert.equal(first.ok,true,JSON.stringify(first));
  assert.equal(h.data().rhythm.meals.length,1);
  assert.equal(h.data().rhythm.meals[0].foodText,'鸡蛋和米饭');
  assert.equal((await h.handle(base)).alreadyDone,true);
  assert.equal(h.data().rhythm.meals.length,1);
  assert.equal((await h.handle({...base,photoCount:2})).ok,true);
  assert.equal(h.data().rhythm.meals[0].photoCount,2);
  assert.equal((await h.handle({...base,revision:2,state:'cancelled'})).ok,true);
  assert.equal(h.data().rhythm.meals.length,0);
  assert.equal((await h.handle(base)).stale,true);
  assert.equal(h.data().rhythm.meals.length,0);
});

test('same-time manual meal and manual override prevent duplicate/overwrite',async(t)=>{
  const h=harness();t.after(h.close);
  await h.handle(base);
  const conflict=await h.handle({...base,sourceKey:'b'.repeat(64)});
  assert.equal(conflict.conflict,true);
  h.mutate('Store.db.rhythm.meals[0].manualOverride=true;Store.save(true)');
  const protectedEdit=await h.handle({...base,revision:2,foodText:'远端改写'});
  assert.equal(protectedEdit.conflict,true);
  assert.equal(h.data().rhythm.meals[0].foodText,'鸡蛋和米饭');
});

test('save failure returns retryable and retains previous meal state',async(t)=>{
  const h=harness();t.after(h.close);
  await h.handle(base);
  h.fail(true);
  const failed=await h.handle({...base,revision:2,foodText:'鸡蛋和鱼'});
  assert.equal(failed.retryable,true);
  assert.equal(h.data().rhythm.meals[0].foodText,'鸡蛋和米饭');
  assert.equal(h.inMemory().rhythm.meals[0].foodText,'鸡蛋和米饭');
  h.fail(false);
  assert.equal((await h.handle({...base,revision:2,foodText:'鸡蛋和鱼'})).ok,true);
  assert.equal(h.data().rhythm.meals[0].foodText,'鸡蛋和鱼');
});

test('invalid calendar date never enters formal meal store',async(t)=>{
  const h=harness();t.after(h.close);
  const invalid=await h.handle({...base,local:'2026-02-30T12:20',at:'2026-02-30T12:20:00+08:00'});
  assert.equal(invalid.ok,false);
  assert.equal(h.inMemory().rhythm.meals.length,0);
});
