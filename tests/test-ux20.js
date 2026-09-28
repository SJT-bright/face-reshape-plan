const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const U=require('../src/js/ux-core'),B=require('../src/js/portable-backup'),R=require('../src/js/reminders-v2'),E=require('../src/js/skin-engine'),C=require('../src/js/strength-core'),Sleep=require('../src/js/rhythm-engine'),keys=require('../src/js/secure-key');
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'face-ux-unit-'));
const base=()=>({settings:{dailyTargetMinutes:15},logs:{training:{'2026-09-18':{seconds:900,entries:[]}},skincare:{}},videos:[],sessions:[],skincare:{cycles:[]},rhythm:{sleeps:[],meals:[]}});
test('UX-01 empty/partial/ready, late source and source removal never become normal',()=>{
 const input={dateKey:'2026-09-19',nowMs:Date.parse('2026-09-19T12:00:00+08:00'),sleeps:[],logs:{},meals:[]};
 assert.equal(E.predictForDate(input).status,'empty');input.logs={'2026-09-18':{redness:0}};assert.equal(E.predictForDate(input).status,'partial');
 input.sleeps=[{start:'2026-09-18T23:00:00+08:00',end:'2026-09-19T07:00:00+08:00',startLocal:'2026-09-18T23:00',endLocal:'2026-09-19T07:00',recordedMinutes:430}];
 assert.equal(E.predictForDate(input).status,'ready');assert.equal(E.sleepForDate(input.sleeps,input.dateKey).minutes,430);
 input.logs={};assert.equal(E.predictForDate(input).overallDir,null);input.dateKey='2026-09-20';assert.equal(E.predictForDate(input).status,'empty');
});
test('UX-02 draft version/signature/30-day expiry reject incompatible restores',()=>{
 const d={version:1,signature:'skin-a',updatedAt:100};assert.equal(U.draftCompatible(d,'skin-a',101),true);assert.equal(U.draftCompatible(d,'skin-b',101),false);assert.equal(U.draftCompatible({...d,version:2},'skin-a',101),false);assert.equal(U.draftCompatible(d,'skin-a',31*86400000),false);
});
test('UX-04 migration is idempotent and 15→20→10 leaves prior 15-minute achievement intact',()=>{
 const db=U.migrate(base(),'2026-09-19');const first=JSON.stringify(db);U.migrate(db,'2026-09-19');assert.equal(JSON.stringify(db),first);
 U.changeTarget(db,20,'2026-09-19');assert.equal(U.target(db,'2026-09-18'),15);assert.equal(U.target(db,'2026-09-19'),20);U.changeTarget(db,10,'2026-09-20');assert.equal(U.target(db,'2026-09-19'),20);assert.equal(U.target(db,'2027-01-01'),10);assert.equal(U.target(db,'2025-12-31'),15);
});
test('UX-05 full archive roundtrip retains records/files, strips key, validates hash and traversal',()=>{
 const source=dir(),target=dir();try{const db=base();db.settings.aiApiKey='never-export-this';db.skin={photos:[{id:'p',file:'p.png',angle:'front'}]};fs.mkdirSync(path.join(source,'skin-photos'));fs.writeFileSync(path.join(source,'skin-photos','p.png'),'synthetic-image');const v=path.join(source,'demo.mp4');fs.writeFileSync(v,'synthetic-video');db.videos=[{id:'v',source:'local',localPath:v}];
 const bundle=B.decode(B.encode(B.createBundle(db,source,true)));assert.equal(JSON.stringify(bundle).includes('never-export'),false);const restored=B.restore(bundle,target);assert.equal(restored.data.skin.photos[0].angle,'front');assert.equal(fs.readFileSync(restored.data.videos[0].localPath,'utf8'),'synthetic-video');assert.equal(fs.readFileSync(path.join(target,'skin-photos','p.png'),'utf8'),'synthetic-image');
 B.restore(bundle,target);const traversal=structuredClone(bundle);traversal.files[0].path='../evil';assert.throws(()=>B.validateBundle(traversal),/路径/);const bad=structuredClone(bundle);bad.files[0].sha256='bad';assert.throws(()=>B.validateBundle(bad),/校验/);assert.throws(()=>B.validateBundle({...bundle,version:999}),/版本/);
 const ref=B.createBundle(db,source,false);assert.equal(ref.files.length,1);fs.rmSync(v);assert.equal(B.createBundle(db,source,true).missing.length,1);assert.equal(B.createBundle(db,source,false).missing.length,1);
 }finally{fs.rmSync(source,{recursive:true,force:true});fs.rmSync(target,{recursive:true,force:true});}
});
test('UX-05 interrupted restore rolls original data and photos back',()=>{
 const source=dir(),target=dir();try{const db=base();fs.mkdirSync(path.join(target,'skin-photos'));fs.writeFileSync(path.join(target,'skin-photos','original.png'),'original');fs.writeFileSync(path.join(target,'face-reshape-data.json'),'original-db');const bundle=B.createBundle(db,source);
 assert.throws(()=>B.restore(bundle,target,{failAfter:'skin-photos'}),/Injected/);assert.equal(fs.readFileSync(path.join(target,'face-reshape-data.json'),'utf8'),'original-db');assert.equal(fs.readFileSync(path.join(target,'skin-photos','original.png'),'utf8'),'original');}finally{fs.rmSync(source,{recursive:true,force:true});fs.rmSync(target,{recursive:true,force:true});}
});
test('UX-07/08 old module selection and unknown profile fields survive migration',()=>{const db=base();db.settings.enabledModules=['nutrition'];db.strength={bmiProfile:{heightCm:172,custom:'preserve'}};U.migrate(db,'2026-09-19');assert.deepEqual(db.settings.enabledModules,['nutrition']);assert.equal(db.profile.custom,'preserve');assert.equal(db.onboarding.done,true);const fresh={...base(),freshInstall:true};U.migrate(fresh);assert.equal(fresh.onboarding.done,false);});
test('UX-11 per-set aggregation preserves varying loads and excludes unfinished sets',()=>{
 const sets=[{weightKg:10,reps:12,done:true},{weightKg:15,reps:10,done:true},{weightKg:20,reps:8,done:false}];assert.deepEqual(U.setSummary(sets),{setsDone:2,repsText:'12+10',weightKg:null,loadVolume:270});assert.equal(U.validSets(sets),true);assert.equal(U.validSets([{weightKg:-1,reps:2,done:true}]),false);
 const db={};const state=C.normalize(db);state.days['2026-09-19']={date:'2026-09-19',status:'in-progress',actions:[{actionKey:'a',name:'卧推',plannedSets:3}]};const r=C.saveTraining(state,{date:'2026-09-19',actions:[{actionKey:'a',sets,...U.setSummary(sets)}]});assert.equal(r.ok,true);assert.deepEqual(state.days['2026-09-19'].actions[0].sets,sets);
 const summary={actionKey:'a',...U.setSummary(sets)};C.saveTraining(state,{date:'2026-09-19',actions:[summary]});assert.deepEqual(state.days['2026-09-19'].actions[0].sets,sets,'unchanged summary save preserves per-set facts');
 assert.equal(state.days['2026-09-19'].actions[0].repsText,'12+10');
});
test('UX-13 simultaneous reminders form one due list; complete/snooze/skip/quiet honor clock',()=>{
 const db=base();Object.assign(db.settings,{skinLogReminderTime:'21:30',eveningReviewTime:'22:00'});db.sessions=[{id:'s',name:'练习',time:'21:30',days:[6],enabled:true}];const now=new Date(2026,8,19,21,30);let due=R.due(db,now);assert.equal(due.length,2);for(const x of due)R.action(db,x.id,'fired',+now);assert.equal(R.due(db,now).length,0);R.action(db,due[0].id,'later',+now);assert.equal(R.due(db,new Date(+now+600000)).length,1);R.action(db,due[0].id,'skip',+now);assert.equal(R.due(db,new Date(+now+600000)).length,0);
 db.settings.quietStart='22:00';db.settings.quietEnd='07:00';assert.equal(R.quiet(db.settings,new Date(2026,8,20,1)),true);assert.equal(R.quiet(db.settings,new Date(2026,8,20,8)),false);
 db.settings.enabledModules=[];assert.equal(R.timeline(db,now).some(x=>x.kind==='skin'),false);
});
test('UX-14 8-hour span uses explicit 430-minute actual, clearing restores estimate',()=>{const s={start:'2026-09-18T23:00:00+08:00',end:'2026-09-19T07:00:00+08:00',recordedMinutes:430};assert.equal(Sleep.sleepMinutes(s),430);s.recordedMinutes=null;assert.equal(Sleep.sleepMinutes(s),480);const input=Sleep.sleepInput('2026-09-19','23:00','07:00',490);assert.match(Sleep.validateSleep(input,{sleeps:[],meals:[]},Date.parse('2026-09-19T12:00:00+08:00')),/不超过/);});
test('UX-18 secure key migration requires encryption and readback, never plaintext fallback',()=>{
 const d=dir();try{const safe={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s.split('').reverse().join('')),decryptString:b=>b.toString().split('').reverse().join('')};const k=keys(d,safe),db={settings:{aiApiKey:'fake-secret'}};assert.equal(k.migrate(db),true);assert.equal(db.settings.aiApiKey,undefined);assert.equal(k.read(),'fake-secret');assert.equal(k.migrate(db),false);assert.equal(fs.readFileSync(path.join(d,'ai-key.enc'),'utf8').includes('fake-secret'),false);const bad={settings:{aiApiKey:'retain-until-success'}};assert.throws(()=>keys(d,{isEncryptionAvailable:()=>false}).migrate(bad));assert.equal(bad.settings.aiApiKey,'retain-until-success');}finally{fs.rmSync(d,{recursive:true,force:true});}
});
