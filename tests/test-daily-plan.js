const {test}=require('node:test');
const assert=require('node:assert/strict');
const Plan=require('../src/js/daily-plan-core');
const Reminders=require('../src/js/reminders-v2');

test('共同的时段边界准点切换，跨午夜沿用最近时段，允许关闭单个时段',()=>{
 const times={morning:'10:00',day:'15:00',evening:'23:00'};
 for(const [minute,phase]of [[0,'evening'],[599,'evening'],[600,'morning'],[899,'morning'],[900,'day'],[1379,'day'],[1380,'evening']])assert.equal(Plan.phase(times,minute),phase);
 assert.equal(Plan.phase({morning:'',evening:'21:00'},600),'evening');
 assert.equal(Plan.phase({},600,'morning'),'morning');
});
test('DIY 时长与开始时间验证：整分钟、范围、有效时间、早晚不重合',()=>{
 assert.deepEqual(Plan.validate({targetMinutes:'25',morning:'08:30',evening:'21:00'}),{targetMinutes:25,morning:'08:30',evening:'21:00'});
 for(const n of [0,601,1.5,'x'])assert.throws(()=>Plan.validate({targetMinutes:n}),/时长/);
 for(const value of ['24:00','09:61','9:00'])assert.throws(()=>Plan.validate({targetMinutes:15,morning:value}),/时间/);
 assert.throws(()=>Plan.validate({targetMinutes:15,morning:'09:00',evening:'09:00'}),/不同/);
 assert.equal(Plan.time('00:00'),0);assert.equal(Plan.time('23:59'),1439);assert.equal(Plan.time('24:00'),null);
});
test('修改今日目标保留旧目标和实际观看数据，下一日使用最新值，记录仍独立',()=>{
 const old={seconds:300,entries:[{id:'old',seconds:300}]},today={seconds:90,entries:[{id:'today',seconds:90}]};
 const db={settings:{dailyTargetMinutes:40},logs:{training:{sentinel:'training'},skincare:{sentinel:'care'},videoWatching:{awakening:{'2026-10-09':structuredClone(old),'2026-10-10':structuredClone(today)}}}};
 Plan.change(db,'awakening',{targetMinutes:20,morning:'09:00',evening:'22:00'},'2026-10-10');
 assert.equal(Plan.target(db,'awakening','2026-10-09'),15);assert.equal(Plan.target(db,'awakening','2026-10-08'),15);
 assert.equal(Plan.target(db,'awakening','2026-10-10'),20);assert.equal(Plan.target(db,'awakening','2026-10-11'),20);
 Plan.change(db,'awakening',{targetMinutes:21},'2026-10-10');assert.equal(db.settings.watchingPlans.awakening.history.length,1);
 Plan.change(db,'awakening',{targetMinutes:30},'2026-10-11');
 assert.equal(Plan.target(db,'awakening','2026-10-10'),21);assert.equal(Plan.target(db,'awakening','2026-10-11'),30);
 for(const date of ['2026-10-09','2026-10-10']){const {targetMinutes,...record}=db.logs.videoWatching.awakening[date];assert.deepEqual(record,date.endsWith('09')?old:today);}
 assert.deepEqual(db.logs.training,{sentinel:'training'});assert.deepEqual(db.logs.skincare,{sentinel:'care'});assert.equal(db.settings.dailyTargetMinutes,40);
});
test('不同视频板块目标隔离；损坏或越界的目标历史不会成为有效目标',()=>{
 const db={settings:{watchingPlans:{awakening:{targetMinutes:25,history:[null,{from:123,targetMinutes:50},{from:'2026-10-01',targetMinutes:9999}]} }}};
 assert.equal(Plan.target(db,'awakening','2026-10-10'),25);
 Plan.change(db,'night',{targetMinutes:40,evening:'22:00'},'2026-10-10');
 assert.equal(Plan.config(db,'awakening').targetMinutes,25);assert.equal(Plan.config(db,'night').targetMinutes,40);
 assert.equal(Plan.target(db,'night','2026-10-09'),15);
});
test('认知提醒只使用明确设置的时间与板块，独立目标达标后不再提醒',()=>{
 const now=new Date(2026,9,10,9,0),db={settings:{enabledModules:['follow'],watchingPlans:{awakening:{targetMinutes:20,morning:'09:00',evening:'22:00'},night:{targetMinutes:5,morning:'09:00',evening:'22:00'}}},videoCollections:[{id:'face'},{id:'awakening',name:'认知觉醒',periods:['morning','evening']},{id:'night',name:'夜间阅读',periods:['evening']}],logs:{training:{'2026-10-10':{seconds:9999}},videoWatching:{}}};
 const rows=Reminders.timeline(db,now);assert.equal(rows.length,3);
 const due=Reminders.due(db,now);assert.equal(due.length,1);assert.equal(due[0].collectionId,'awakening');assert.equal(due[0].view,'awakening');assert.equal(due[0].targetMinutes,20);assert.equal(due[0].autoStart,undefined);
 db.logs.videoWatching.awakening={'2026-10-10':{seconds:1200,targetMinutes:20}};assert.equal(Reminders.due(db,now).length,0);
 db.settings.remindersEnabled=false;assert.equal(Reminders.due(db,new Date(2026,9,10,22,0)).length,0);
 db.settings.remindersEnabled=true;db.settings.watchingPlans={};assert.equal(Reminders.timeline(db,now).length,0);
});
