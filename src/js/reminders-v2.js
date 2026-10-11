/* Deterministic reminder timeline; callers supply the clock and notification sink. */
const RoutineCore = require('./routine-core');
const DailyPlanCore = require('./daily-plan-core');
const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const min=t=>/^\d{2}:\d{2}$/.test(t||'')&&Number(t.slice(0,2))<24&&Number(t.slice(3))<60?Number(t.slice(0,2))*60+Number(t.slice(3)):null;
function quiet(settings,now){const a=min(settings.quietStart),b=min(settings.quietEnd),t=now.getHours()*60+now.getMinutes();return a!==null&&b!==null&&a!==b&&(a<b?t>=a&&t<b:t>=a||t<b);}
function timeline(db,now=new Date()){
 const date=dateKey(now),s=db.settings||{},mods=s.enabledModules||['follow','skincare','nutrition','strength','achievements'],rows=[];
 const add=(id,time,title,view,kind,done=false,sessionId=null,extra={})=>{if(min(time)===null)return;const key=date+'|'+id,a=db.reminderActions?.[key];rows.push({id:key,date,time,title,view,kind,done,sessionId,...extra,state:done?'已完成':a?.skip?'今天已跳过':a?.snoozeUntil?'稍后提醒':a?.fired?'已提醒':'待处理',...a});};
 if(mods.includes('follow'))for(const x of db.sessions||[])if(x.enabled&&x.days?.includes(now.getDay()))add(x.id,x.time,x.name,'follow','follow',(db.logs?.training?.[date]?.entries||[]).some(e=>e.sessionId===x.id&&e.end),x.id,{autoStart:!!x.autoStart&&!!db.videos?.some(v=>v.id===x.videoId),videoId:x.videoId});
 if(mods.includes('follow'))for(const x of RoutineCore.rows(db,now))add(x.id,x.time,x.title,'follow','routine',false,null,{autoStart:true,period:x.period,videoId:x.videoId});
 if(mods.includes('follow'))for(const c of db.videoCollections||[]){
  if(c.id==='face'||!s.watchingPlans?.[c.id])continue;
  const plan=DailyPlanCore.config(db,c.id),target=DailyPlanCore.target(db,c.id,date),done=(db.logs?.videoWatching?.[c.id]?.[date]?.seconds||0)>=target*60;
  for(const period of c.periods||[])if(['morning','evening'].includes(period))add('watch-'+c.id+'-'+period,plan[period],`${c.name} · ${period==='morning'?'早上':'晚上'}`,'awakening','watching',done,null,{collectionId:c.id,period,targetMinutes:target});
 }
 if(mods.includes('skincare')){
  const cyc=db.skincare?.cycles?.find(x=>x.startDate&&x.startDate<=date&&(!x.endDate||x.endDate>=date));
  for(const [phase,time,label]of [['morning',s.skincareTimes?.morning,'晨间护理'],['day',s.skincareTimes?.noon,'日间护理'],['evening',s.skincareTimes?.evening,'晚间护理']]){const steps=cyc?.steps?.[phase]||[];if(steps.length)add('care-'+phase,time,label,'skincare','care',steps.every(x=>(db.logs?.skincare?.[date]?.[phase]||[]).includes(x.id)),null,{autoStart:!!s.automation?.careAutoOpen,period:phase});}
  add('skin',s.skinLogReminderTime,'记录皮肤','skincare','skin',!!db.skin?.logs?.[date]);
 }
 if(mods.includes('nutrition'))add('sleep',s.sleepLogReminderTime,'记录昨晚睡眠','nutrition','sleep',(db.rhythm?.sleeps||[]).some(x=>(x.end||x.durationOnly&&Number.isInteger(x.recordedMinutes)&&x.recordedMinutes>0)&&x.kind!=='nap'&&x.endLocal?.slice(0,10)===date));
 if(mods.length)add('review',s.eveningReviewTime,'晚间复盘','today','review',!!db.rhythm?.completeDays?.[date]?.meals&&!!db.rhythm?.completeDays?.[date]?.sleep);
 return rows.sort((a,b)=>a.time.localeCompare(b.time));
}
function due(db,now=new Date()){
 if(db.settings?.remindersEnabled===false||quiet(db.settings||{},now))return [];
 const t=now.getHours()*60+now.getMinutes();return timeline(db,now).filter(x=>!x.done&&!x.skip&&
  (x.snoozeUntil ? +now>=x.snoozeUntil : !x.fired&&t>=min(x.time)&&t-min(x.time)<=Math.max(30,Number(db.settings?.graceMinutes)||3)));
}
function action(db,id,act,now=Date.now()){
 db.reminderActions ||= {};const old=db.reminderActions[id]||{};
 db.reminderActions[id]={...old,updatedAt:now,...(act==='later'?{snoozeUntil:now+600000,skip:false,fired:false}:act==='skip'?{skip:true,snoozeUntil:null}:{fired:true,snoozeUntil:null})};
}
module.exports={dateKey,quiet,timeline,due,action};
