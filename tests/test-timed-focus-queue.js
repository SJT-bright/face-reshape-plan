const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(initial={}){
  const nodes={},saved=[],context={structuredClone,Date,console,setInterval:()=>1,clearInterval:()=>{},toast:()=>{},esc:String,fmtSeconds:String,todayKey:()=> '2026-10-14',
    Store:{db:{focusSessions:initial,settings:{timedFocusEnabled:true,remindersEnabled:true}},settings(){return this.db.settings;},save(){saved.push(structuredClone(this.db));return true;}},
    Routine:{active:{kind:'training'},async close(){this.active=null;}},SkincareSession:{recording:false,start:async()=>{},stop:async()=>{}},
    Session:{autoPause:()=>{}},Bilibili:{MediaSync:{pauseAll:()=>{}}},Drafts:{capture:()=>{}},UX:{afterRender:()=>{}},App:{boot:async()=>{},go(v){this.currentView=v;}},
    native:{focusEnter:async()=>({ok:true}),focusLeave:async()=>true,reminderAction:async()=>true},
    document:{addEventListener:()=>{},createElement:()=>({setAttribute:()=>{},remove:()=>{}}),body:{classList:{add:()=>{},remove:()=>{}},append:node=>{nodes['#'+node.id]=node;}}},
    $:selector=>['#timed-focus-done','#timed-focus-exit','#timed-focus-clock'].includes(selector)?(nodes[selector] ||= {}):nodes[selector] || null};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/js/timed-focus.js'),'utf8')+'\nglobalThis.focus=TimedFocus;',context);
  return {context,saved,focus:context.focus};
}
test('正在录像/流程时的多个到点事项先落盘，重启后按队列继续，不丢后续复盘',async()=>{
  const f=fixture(),care={id:'2026-10-14|care-evening',date:'2026-10-14',kind:'care',period:'evening',title:'护肤'},review={id:'2026-10-14|review',date:'2026-10-14',kind:'review',title:'复盘'};
  assert.equal(await f.focus.start(care),false);assert.equal(await f.focus.start(review),false);
  assert.equal(f.saved.at(-1).focusSessions[care.id].queued,true);assert.equal(f.saved.at(-1).focusSessions[review.id].queued,true);
  const restored=fixture(f.saved.at(-1).focusSessions);restored.focus.boot();assert.equal(restored.focus.queue.length,2);
  restored.context.Routine.active=null;restored.focus.drain();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(restored.focus.active.id,care.id);assert.equal(restored.context.App.currentView,'skincare');
  await restored.focus.finish(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(restored.focus.active.id,review.id);assert.equal(restored.context.App.currentView,'daily-review');
  await restored.focus.finish(true);assert.equal(restored.context.Store.db.focusSessions[review.id].completed,true);
});
test('稍后事项不被重启立刻打开，写盘失败不创建假排队',async()=>{
  const f=fixture({'2026-10-14|review':{id:'2026-10-14|review',date:'2026-10-14',kind:'review',completed:false,deferred:true}});
  f.context.Routine.active=null;f.focus.boot();assert.equal(f.focus.queue.length,0);assert.equal(f.focus.active,null);
  f.context.Routine.active={kind:'training'};f.context.Store.save=()=>{throw Error('disk full');};
  assert.equal(await f.focus.start({id:'2026-10-14|care-evening',date:'2026-10-14',kind:'care'}),false);assert.equal(f.focus.queue.length,0);
});
