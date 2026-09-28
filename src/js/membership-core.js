/* Product discovery only. Local preferences never grant paid entitlements. */
(function(root){
  const tasks=[
    {title:'选好自己的课程',text:'从视频库选择一节你愿意重复跟练的课程。',route:'plan'},
    {title:'完成一次跟练',text:'按自己的节奏练习，播放记录会保留在应用里。',route:'today'},
    {title:'整理护理步骤',text:'记录你正在使用的护理流程，方便每天查看。',route:'skincare'},
    {title:'记下昨晚的睡眠',text:'填写入睡与起床时间，建立自己的记录。',route:'nutrition'},
    {title:'回顾训练记录',text:'看看哪些时间更容易坚持，不必补做错过的训练。',route:'achievements'},
    {title:'设定跟练节奏',text:'选择每 7 天希望记录几天，按自己的情况调整。',route:'plan'},
    {title:'完成一周复盘',text:'查看下方的真实记录摘要，选一件下周继续做的事。',route:'membership'}
  ];
  function date(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function offset(key,n){const [y,m,d]=key.split('-').map(Number);return date(new Date(y,m-1,d+n));}
  function valid(key){return typeof key==='string' && /^\d{4}-\d{2}-\d{2}$/.test(key)&&offset(key,0)===key;}
  function day(start,today){if(!valid(start)||!valid(today))return null;const a=start.split('-').map(Number),b=today.split('-').map(Number);return Math.floor((Date.UTC(b[0],b[1]-1,b[2])-Date.UTC(a[0],a[1]-1,a[2]))/86400000)+1;}
  function summary(db,today){
    const days=Array.from({length:7},(_,i)=>offset(today,i-6));
    const rows=days.map(date=>{const seconds=Number(db.logs?.training?.[date]?.seconds);return {date,seconds:Number.isFinite(seconds)&&seconds>0?seconds:0};});
    return {from:days[0],to:today,days:rows.filter(x=>x.seconds>0).length,minutes:Math.round(rows.reduce((n,x)=>n+x.seconds,0)/60),rows};
  }
  function report(db,today,includesToday=true){const s=summary(db,today);return `我的跟练周报\n${s.from} — ${s.to}${includesToday?'（含今天）':''}\n有跟练记录：${s.days} / 7 天\n累计记录：${s.minutes} 分钟\n${s.rows.map(x=>`${x.date}：${x.seconds>0?Math.round(x.seconds/60)+' 分钟':'暂无跟练记录'}`).join('\n')}\n只统计应用内记录，不代表身体变化或疗效。` ;}
  function nextTask(state,today){const elapsed=day(state?.started,today);if(elapsed===null||elapsed<1)return null;return tasks.findIndex((_,i)=>i<Math.min(elapsed,7)&&!state.done?.[i]);}
  function target(value){const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=7?n:3;}
  const api={tasks,day,summary,report,offset,nextTask,target};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MembershipCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
