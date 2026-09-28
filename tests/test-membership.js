const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/js/membership-core');
test('local calendar boundaries, invalid dates and expired plan',()=>{
 assert.equal(C.day('2026-09-26','2026-09-26'),1);
 assert.equal(C.day('2026-09-26','2026-10-02'),7);
 assert.equal(C.day('2026-09-26','2026-10-03'),8);
 assert.equal(C.day('2026-03-07','2026-03-09'),3);
 assert.equal(C.day('2026-02-30','2026-03-01'),null);
 assert.equal(C.day(undefined,'2026-09-26'),null);
 assert.equal(C.day('2026-09-27','2026-09-26'),0);
});
test('report excludes out-of-window, negative and corrupt durations, and sensitive fields',()=>{
 const db={name:'PRIVATE_NAME',skin:{notes:'PRIVATE_SKIN'},logs:{training:{'2026-09-19':{seconds:99999},'2026-09-20':{seconds:120},'2026-09-21':{seconds:-200},'2026-09-22':{seconds:'bad'},'2026-09-26':{seconds:180},'2026-09-27':{seconds:9999}}}};
 const r=C.summary(db,'2026-09-26');assert.equal(r.minutes,5);assert.equal(r.days,2);assert.equal(r.rows.length,7);
 assert.doesNotMatch(C.report(db,'2026-09-26'),/PRIVATE|2026-09-19|2026-09-27/);
 assert.equal(C.summary({},'2026-01-02').from,'2025-12-27');
});
test('next action follows unlocked undone tasks and frequency bounds',()=>{
 assert.equal(C.nextTask({},'2026-09-26'),null);
 assert.equal(C.nextTask({started:'2026-09-26',done:{}},'2026-09-26'),0);
 assert.equal(C.nextTask({started:'2026-09-26',done:{0:true}},'2026-09-26'),-1);
 assert.equal(C.nextTask({started:'2026-09-26',done:{0:true}},'2026-09-27'),1);
 assert.equal(C.target(0),3);assert.equal(C.target(8),3);assert.equal(C.target(5),5);
 assert.doesNotMatch(C.report({},'2026-09-19',false),/含今天/);
});
