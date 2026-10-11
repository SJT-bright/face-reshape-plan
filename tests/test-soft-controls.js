const {test}=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../src/js/strength-core');
const Rhythm=require('../src/js/rhythm-engine');
const Skin=require('../src/js/skin-engine');

test('training starts at original plan; increases and reductions become defaults and survive normalize',()=>{
  const db={},state=Core.normalize(db),action={actionKey:'a',name:'卧推',plannedSets:3,plannedRepsText:'10-12',plannedWeightText:'20kg',setsDone:null,repsText:'',weightKg:null};
  assert.deepEqual(Core.trainingBaseline(state,action,'2026-10-08'),{setsDone:3,repsText:'10-12',weightKg:20,sets:undefined,source:'plan'});
  state.days['2026-10-08']={date:'2026-10-08',status:'in-progress',revision:1,actions:[action]};
  assert.equal(Core.saveTraining(state,{date:'2026-10-08',actions:[{actionKey:'a',setsDone:3,repsText:'13',weightKg:21}]}).ok,true);
  assert.equal(Core.saveTraining(state,{date:'2026-10-08',actions:[{actionKey:'a',setsDone:2,repsText:'11',weightKg:19}]}).ok,true);
  assert.equal(state.adjustments.length,2);
  assert.equal(state.adjustments[1].before.repsText,'13');
  assert.equal(state.adjustments[1].after.repsText,'11');
  const reload=Core.normalize(JSON.parse(JSON.stringify(db)));
  assert.equal(reload.adjustments.length,2);
  assert.equal(Core.trainingBaseline(reload,action,'2026-10-09').repsText,'11');
  assert.equal(Core.trainingBaseline(reload,action,'2026-10-09').weightKg,19);
  assert.equal(Core.trainingBaseline(reload,action,'2026-10-07').source,'plan');
  const restored=Core.normalize({});assert.equal(Core.importFrom(restored,JSON.parse(JSON.stringify(reload))).ok,true);assert.equal(restored.adjustments.length,2);assert.equal(Core.trainingBaseline(restored,action,'2026-10-09').weightKg,19);
  const invalid=JSON.parse(JSON.stringify(reload));invalid.adjustments[0].after.weightKg=-1;const original=JSON.stringify(restored);assert.equal(Core.importFrom(restored,invalid).ok,false);assert.equal(JSON.stringify(restored),original);
});

test('duration-only sleep contributes exact duration without fabricating meal/sleep time pairs',()=>{
  const record={id:'duration',durationOnly:true,kind:'main',date:'2026-10-08',endLocal:'2026-10-08',startLocal:'2026-10-08',start:null,end:null,recordedMinutes:463,qualityScore:91};
  assert.equal(Rhythm.hasSleep(record),true);assert.equal(Rhythm.sleepMinutes(record),463);
  const report=Rhythm.analyze({sleeps:[record],meals:[],completeDays:{'2026-10-08':{sleep:true}}},{now:new Date('2026-10-09T12:00:00'),days:7});
  assert.equal(report.metrics.sleep,463);assert.equal(report.metrics.beforeBed,null);assert.equal(report.metrics.afterWake,null);assert.equal(report.metrics.bedVariation,null);
  assert.deepEqual(Skin.sleepForDate([record],'2026-10-08'),{minutes:463,bedtime:null,sessions:1});
});

test('legacy start-only zero does not replace the plan; explicitly saved zero remains a baseline',()=>{
  const state=Core.normalize({}),action={actionKey:'a',name:'引体向上',plannedSets:6,plannedRepsText:'8',plannedWeightText:'',setsDone:null,repsText:'',weightKg:null};
  state.days['2026-09-07']={date:'2026-09-07',status:'in-progress',revision:1,actions:[{...action,setsDone:0}]};
  assert.equal(Core.trainingBaseline(state,action,'2026-10-09').setsDone,6);
  state.days['2026-10-09']={date:'2026-10-09',status:'in-progress',revision:1,actions:[{...action}]};
  assert.equal(Core.saveTraining(state,{date:'2026-10-09',actions:[{actionKey:'a',setsDone:0,repsText:'8',weightKg:0}]}).ok,true);
  assert.equal(Core.trainingBaseline(state,action,'2026-10-10').setsDone,0);
  assert.equal(state.adjustments[0].before.setsDone,6);
  assert.equal(state.adjustments[0].after.setsDone,0);
});
