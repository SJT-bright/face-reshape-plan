const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/routine-core');
const Reminders = require('../src/js/reminders-v2');
const now = new Date(2026, 9, 6, 21, 30);
function data() { return { settings: { automation: { enabled:true, evening: { time:'21:30',videoId:'v',days:[now.getDay()] } } }, videos:[{id:'v'}], logs:{training:{}} }; }
test('自动流程仅在配置齐全、对应星期且视频存在时入队；关闭不改变普通提醒', () => {
  const db=data(); let due=Reminders.due(db,now);
  assert.equal(due.length,1);assert.equal(due[0].videoId,'v');assert.equal(due[0].autoStart,true);
  db.settings.automation.enabled=false;assert.equal(Reminders.due(db,now).length,0);
  db.settings.automation.enabled=true;db.videos=[];assert.equal(Reminders.due(db,now).length,0);
  db.videos=[{id:'v'}];db.settings.automation.evening.days=[];assert.equal(Reminders.due(db,now).length,0);
});
test('同一自动流程每日只启动一次，稍后和今天跳过遵循既有账本；勿扰与关闭提醒生效', () => {
  const db=data(), item=Reminders.due(db,now)[0];
  Reminders.action(db,item.id,'fired',+now);assert.equal(Reminders.due(db,now).length,0);
  Reminders.action(db,item.id,'later',+now);assert.equal(Reminders.due(db,now).length,0);
  assert.equal(Reminders.due(db,new Date(+now+600000)).length,1);
  Reminders.action(db,item.id,'skip',+now);assert.equal(Reminders.due(db,now).length,0);
  delete db.reminderActions;db.settings.quietStart='21:00';db.settings.quietEnd='22:00';assert.equal(Reminders.due(db,now).length,0);
  db.settings.quietStart='';db.settings.remindersEnabled=false;assert.equal(Reminders.due(db,now).length,0);
});
test('普通跟练提醒保持通知语义；显式启用并绑定视频才自动启动', () => {
  const db=data();db.settings.automation.enabled=false;
  db.sessions=[{id:'s',enabled:true,time:'21:30',days:[now.getDay()],videoId:'v'}];
  assert.equal(Reminders.due(db,now)[0].autoStart,false);
  db.sessions[0].autoStart=true;assert.equal(Reminders.due(db,now)[0].autoStart,true);
  db.videos=[];assert.equal(Reminders.due(db,now)[0].autoStart,false);
});
test('自动配置拒绝缺视频、无时间、无重复日；允许关闭时段，保留两时段选择', () => {
  const db=data(),c=db.settings.automation;
  assert.equal(Core.validate(c,db.videos).evening.videoId,'v');
  assert.throws(()=>Core.validate(c,[]),/不存在/);
  assert.throws(()=>Core.validate({...c,evening:{...c.evening,time:''}},db.videos),/同时/);
  assert.throws(()=>Core.validate({...c,evening:{...c.evening,days:[]}},db.videos),/一周/);
  assert.equal(Core.validate({enabled:false},db.videos).evening.time,'');
});
