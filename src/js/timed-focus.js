/* Scheduled care/review foreground session. Timers never depend on video playback. */
const TimedFocus = {
  active:null, queue:[], timer:null, starting:false,
  async start(payload) {
    if (!['care','review'].includes(payload.kind)) return false;
    if (this.active?.id === payload.id) return true;
    if (this.active || this.starting || Routine.active || SkincareSession.recording) {
      if (!this.queue.some(x=>x.id===payload.id)) {
        Store.db.focusSessions ||= {};Store.db.focusSessions[payload.id]={...payload,queued:true,completed:false,deferred:false,updatedAt:Date.now()};
        try{Store.save(true);this.queue.push(payload);}catch(error){toast('待开始的提醒未能保存，请重试','red');return false;}
      }
      this.pending(); return false;
    }
    this.starting=true;
    const old = Store.db.focusSessions?.[payload.id];
    const state = {...payload,startedAt:old?.startedAt || new Date().toISOString(),completed:false,deferred:false,queued:false,updatedAt:Date.now()};
    try {
      const before=structuredClone(Store.db.focusSessions || {});
      Store.db.focusSessions={...before,[payload.id]:state};
      if (!Store.save(true)) { Store.db.focusSessions=before; throw Error('开始时间未能保存，请重试'); }
      this.active=state;
      Drafts.capture($('#view-root')); Bilibili.MediaSync.pauseAll(); Session.autoPause('focus');
      const entered=await native.focusEnter();
      if (!entered?.ok) throw Error('大窗口没能打开');
      App.go(payload.kind==='care'?'skincare':'daily-review');
      document.body.classList.add('timed-focus-running');this.draw();
      this.timer=setInterval(()=>this.tick(),1000);this.tick();
      if (payload.kind==='care') await SkincareSession.start({phase:payload.period});
      return true;
    } catch(error) { this.active=null; clearInterval(this.timer); this.timer=null; await native.focusLeave(); $('#timed-focus-bar')?.remove();document.body.classList.remove('timed-focus-running');toast(error.message,'red');return false; }
    finally { this.starting=false; }
  },
  elapsed() { return this.active?Math.max(0,Math.floor((Date.now()-Date.parse(this.active.startedAt))/1000)):0; },
  tick() { const clock=$('#timed-focus-clock');if(clock)clock.textContent=fmtSeconds(this.elapsed()); },
  draw() {
    if (!this.active) return;
    $('#timed-focus-bar')?.remove();
    const bar=document.createElement('aside');bar.id='timed-focus-bar';bar.setAttribute('role','region');bar.setAttribute('aria-label','定时开始的护理与复盘');
    bar.innerHTML=`<div><b>${esc(this.active.title || (this.active.kind==='care'?'护肤时间到了':'晚间复盘时间到了'))}</b><small>已自动开始计时 · 开始于 ${esc(new Date(this.active.startedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}))}</small></div><strong id="timed-focus-clock">${fmtSeconds(this.elapsed())}</strong><button class="btn primary" id="timed-focus-done">${this.active.kind==='care'?'结束护肤':'完成本次复盘'}</button><button class="btn ghost" id="timed-focus-exit">稍后继续</button>`;
    document.body.append(bar);$('#timed-focus-done').onclick=()=>this.finish(true);$('#timed-focus-exit').onclick=()=>this.finish(false);
  },
  async finish(completed) {
    if (!this.active || this.finishing) return;
    this.finishing=true;
    try {
      if (this.active.kind==='care' && SkincareSession.recording) await SkincareSession.stop();
      const state={...this.active,completed,deferred:!completed,seconds:this.elapsed(),updatedAt:Date.now(),endedAt:completed?new Date().toISOString():null};
      const before=Store.db.focusSessions[this.active.id];Store.db.focusSessions[this.active.id]=state;
      if (!Store.save(true)) { Store.db.focusSessions[this.active.id]=before;toast('这次计时未能保存，请重试','red');return; }
      if (!completed) await native.reminderAction(this.active.id,'later');
      this.active=null;clearInterval(this.timer);this.timer=null;$('#timed-focus-bar')?.remove();document.body.classList.remove('timed-focus-running');await native.focusLeave();this.drain();
    } finally {this.finishing=false;}
  },
  pending() {
    $('#timed-focus-pending')?.remove(); if(!this.queue.length)return;
    const node=document.createElement('aside');node.id='timed-focus-pending';node.textContent=`${this.queue.map(x=>x.title).join('、')}已到时间，当前录像或流程结束后会自动打开。`;document.body.append(node);
  },
  drain() { if(this.queue.length&&!this.active&&!this.starting&&!Routine.active&&!SkincareSession.recording){$('#timed-focus-pending')?.remove();void this.start(this.queue.shift());} },
  boot() {
    document.addEventListener('skincare-recording-ended',()=>this.drain());
    const active=Object.values(Store.db.focusSessions || {}).filter(s=>!s.completed && !s.deferred && s.date===todayKey()).sort((a,b)=>(a.updatedAt||0)-(b.updatedAt||0));
    if (Store.settings().timedFocusEnabled!==false && Store.settings().remindersEnabled!==false) this.queue.push(...active);
    this.drain();
  }
};
const focusAfterRender=UX.afterRender.bind(UX);
UX.afterRender=function(){focusAfterRender();if(TimedFocus.active){document.body.classList.add('timed-focus-running');TimedFocus.draw();}};
const focusBoot=App.boot.bind(App);
App.boot=async function(){await focusBoot();TimedFocus.boot();};
const focusRoutineClose=Routine.close.bind(Routine);
Routine.close=async function(){await focusRoutineClose();TimedFocus.drain();};
