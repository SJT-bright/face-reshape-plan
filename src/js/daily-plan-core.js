/* Shared clock boundaries; watching plans keep their own duration and history. */
const DailyPlanCore = {
  validMinutes(value) { return Number.isInteger(value)&&value>=1&&value<=600; },
  time(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0,2))*60+Number(value.slice(3)) : null; },
  phase(times, minute, fallback = 'morning') {
    const slots=Object.entries(times).map(([phase,time])=>({phase,minute:this.time(time)})).filter(x=>x.minute!==null).sort((a,b)=>a.minute-b.minute);
    return slots.filter(x=>x.minute<=minute).at(-1)?.phase || slots.at(-1)?.phase || fallback;
  },
  config(db, id) {
    const saved=db.settings?.watchingPlans?.[id] || {};
    return { targetMinutes:this.validMinutes(saved.targetMinutes)?saved.targetMinutes:15,
      morning:this.time(saved.morning)!==null?saved.morning:'', evening:this.time(saved.evening)!==null?saved.evening:'' };
  },
  validate(value) {
    const targetMinutes=Number(value.targetMinutes);
    if (!Number.isInteger(targetMinutes)||targetMinutes<1||targetMinutes>600) throw Error('观看时长需要是 1–600 分钟的整数');
    const times=Object.fromEntries(['morning','evening'].map(k=>[k,String(value[k]||'')]));
    for(const time of Object.values(times))if(time&&this.time(time)===null)throw Error('请填写有效的观看开始时间');
    if(times.morning&&times.morning===times.evening)throw Error('早上和晚上的开始时间需要不同');
    return {targetMinutes,...times};
  },
  target(db,id,date) {
    const snapshot=db.logs?.videoWatching?.[id]?.[date]?.targetMinutes;
    if(this.validMinutes(snapshot))return snapshot;
    const saved=db.settings?.watchingPlans?.[id] || {},history=Array.isArray(saved.history)?saved.history:[];
    const previous=history.filter(x=>typeof x?.from==='string'&&x.from<=date&&this.validMinutes(x.targetMinutes)).sort((a,b)=>a.from.localeCompare(b.from)).at(-1);
    return previous?.targetMinutes || (history.length&&this.validMinutes(saved.initialTargetMinutes)?saved.initialTargetMinutes:this.config(db,id).targetMinutes);
  },
  change(db,id,value,date) {
    const next=this.validate(value),prior=db.settings?.watchingPlans?.[id],initialTargetMinutes=this.validMinutes(prior?.initialTargetMinutes)?prior.initialTargetMinutes:this.config(db,id).targetMinutes;
    for(const [day,record]of Object.entries(db.logs?.videoWatching?.[id]||{}))if(day<date&&!this.validMinutes(record.targetMinutes))record.targetMinutes=this.target(db,id,day);
    const history=(Array.isArray(prior?.history)?prior.history:[]).filter(x=>typeof x?.from==='string'&&this.validMinutes(x.targetMinutes)&&x.from!==date);
    history.push({from:date,targetMinutes:next.targetMinutes});history.sort((a,b)=>a.from.localeCompare(b.from));
    db.settings ||= {};db.settings.watchingPlans ||= {};db.settings.watchingPlans[id]={...next,initialTargetMinutes,history};
    const today=db.logs?.videoWatching?.[id]?.[date];if(today)today.targetMinutes=next.targetMinutes;
    return next;
  }
};
if(typeof module!=='undefined')module.exports=DailyPlanCore;
