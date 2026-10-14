const {test}=require('node:test');
const assert=require('node:assert/strict');
const {videoMetadata}=require('../src/js/evening-video-meta');
const Reminder=require('../src/js/reminders-v2');
const Recorder=require('../src/js/skincare-recorder');
test('晚间记录元数据优先，旧文件按上海日期/小时识别，早晨不会变成晚间复盘',()=>{
  const file='护肤-20261014-220000.webm';
  assert.equal(videoMetadata(file).phase,'evening');assert.equal(videoMetadata(file).date,'2026-10-14');
  assert.equal(videoMetadata(file,[{file,phase:'morning'}]).phase,'morning');
  assert.equal(videoMetadata('护肤-20261014-090000.webm').phase,'morning');
  for(const invalid of ['../'+file,'护肤-20260231-220000.webm','护肤-20261014-290000.webm','other.mp4'])assert.equal(videoMetadata(invalid),null);
});
test('含声音的晚间流优先 Opus 编码，画面流沿用原编码',()=>{
  assert.equal(Recorder.pickMime(()=>true,true),'video/webm;codecs=vp9,opus');
  assert.equal(Recorder.pickMime(t=>t==='video/webm;codecs=vp8,opus',true),'video/webm;codecs=vp8,opus');
  assert.equal(Recorder.pickMime(()=>true,false),'video/webm;codecs=vp9');
});
test('启用到点大窗后，无参考步骤也有护肤计时，进餐/睡眠记全不误认为复盘完成',()=>{
  const db={settings:{enabledModules:['skincare','nutrition'],timedFocusEnabled:true,skincareTimes:{evening:'20:00'},eveningReviewTime:'22:00'},
    skincare:{cycles:[]},rhythm:{completeDays:{'2026-10-14':{meals:true,sleep:true}}}};
  const now=new Date('2026-10-14T22:00:00');
  const rows=Reminder.timeline(db,now);
  const care=rows.find(r=>r.kind==='care'),review=rows.find(r=>r.kind==='review');
  assert.equal(care.autoStart,true);assert.equal(care.focus,true);assert.equal(care.done,false);
  assert.equal(review.autoStart,true);assert.equal(review.done,false);assert.equal(review.view,'daily-review');
  assert.equal(Reminder.due(db,now).some(r=>r.kind==='review'),true);
  db.focusSessions={'2026-10-14|review':{completed:true}};
  assert.equal(Reminder.due(db,now).some(r=>r.kind==='review'),false);
});
test('旧自动流程与显式关闭到点大窗保留原提醒行为',()=>{
  const db={settings:{timedFocusEnabled:false,skincareTimes:{evening:'20:00'},eveningReviewTime:'22:00'},skincare:{cycles:[]}};
  const rows=Reminder.timeline(db,new Date('2026-10-14T22:00:00'));
  assert.equal(rows.some(r=>r.kind==='care'),false);assert.equal(rows.find(r=>r.kind==='review').autoStart,false);
});
