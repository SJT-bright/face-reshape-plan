/* Evening video → local transcript → cleaned daily review, without replacing source footage. */
const EveningReviewUI = {
  stages:{queued:'等待处理',transcribing:'1 / 3 · 本机转文字',transcribed:'原文字稿已保存',cleaning:'2 / 3 · 清理口水词与停顿',cleaned:'复盘稿已保存',syncing:'3 / 3 · 存入个人积累库',completed:'已存入每日复盘',failed:'处理未完成'},
  poll:null, jobs:[], busy:new Set(),
  async request(file) {
    if(this.busy.has(file))return;
    this.busy.add(file);this.paint();
    try {const result=await native.eveningReviewStart(file);if(!result.ok)throw Error(result.error || '处理未能开始');toast('已开始转写，完成后会自动清稿并存入每日复盘');await this.load();}
    catch(error){toast(error.message,'red');}
    finally{this.busy.delete(file);this.paint();}
  },
  async load() {
    try {const result=await native.eveningReviewList();const jobs=Array.isArray(result)?result:[];if(JSON.stringify(jobs)!==JSON.stringify(this.jobs)){this.jobs=jobs;this.paint();}}
    catch{ /* Keep a saved transcript visible when a refresh fails. */ }
  },
  statusHtml(job) {
    if(!job)return '<p class="review-video-status">原录像保留在本机；点击或右键开始转写。</p>';
    const error=job.error?.message || (typeof job.error==='string'?job.error:'');
    return `<p class="review-video-status${job.status==='failed'?' review-video-error':''}">${esc(this.stages[job.status] || '正在处理')}${error?' · '+esc(error):''}</p>${job.raw?.text?`<details><summary>原转写稿</summary><div class="review-source-card"><pre>${esc(job.raw.text)}</pre></div></details>`:''}${job.cleaned?.text?`<details${job.status==='completed'?' open':''}><summary>清理后的复盘稿</summary><div class="review-source-card"><pre>${esc(job.cleaned.text)}</pre></div></details>`:''}${job.status==='completed'?`<button class="btn small" type="button" data-open-review="${esc(job.date)}">打开这一天的每日复盘</button>`:''}`;
  },
  paint() {
    $$('[data-skincare-file]').forEach(row=>{
      if(row.dataset.recordPhase!=='evening')return;
      const job=this.jobs.find(j=>j.file===row.dataset.skincareFile), status=$('[data-review-status]',row), button=$('[data-review-video]',row);
      const html=this.statusHtml(job);if(status && status._reviewHTML!==html){status.innerHTML=html;status._reviewHTML=html;}
      if(button){button.disabled=this.busy.has(row.dataset.skincareFile)||job && !['failed','completed'].includes(job.status);button.textContent=job?.status==='completed'?'查看每日复盘':job?.status==='failed'?'重试转写并存入复盘':'转文字并存入复盘';}
      this.bindOpen(row);
    });
    if(App.currentView==='daily-review')this.paintReview();
  },
  bindOpen(root){$$('[data-open-review]',root).forEach(b=>b.onclick=()=>native.eveningReviewOpen(b.dataset.openReview));},
  bindVideos(root) {
    $$('[data-review-video]',root).forEach(b=>b.onclick=()=>{const file=b.closest('[data-skincare-file]').dataset.skincareFile;const job=this.jobs.find(j=>j.file===file);if(job?.status==='completed')native.eveningReviewOpen(job.date);else void this.request(file);});
    this.paint();void this.load();
  },
  view(root) {
    root.innerHTML=`<div class="view"><div class="card"><h2>晚间复盘</h2><p class="hint">回顾今天做了什么。晚间护肤录像可直接在本机转写，清理口水词后存入个人积累库的当天复盘。</p><div class="row"><button class="btn primary" id="review-record-evening">去录制晚间护肤</button><button class="btn" id="review-open-today">打开今天的每日复盘</button><button class="btn" id="review-refresh">刷新处理状态</button></div><div id="review-day-jobs"></div></div></div>`;
    $('#review-record-evening',root).onclick=async()=>{App.go('skincare');await SkincareSession.start({phase:'evening'});};
    $('#review-open-today',root).onclick=()=>native.eveningReviewOpen(todayKey());$('#review-refresh',root).onclick=()=>this.load();
    this.paintReview();void this.load();
  },
  paintReview() {
    const box=$('#review-day-jobs');if(!box)return;
    const jobs=this.jobs.filter(j=>j.date===todayKey());
    box.innerHTML=jobs.length?jobs.map(job=>`<article class="review-source-card"><h4>${esc(job.file)}</h4>${this.statusHtml(job)}${job.status==='failed'?`<button class="btn" type="button" data-review-retry="${esc(job.file)}">从失败步骤重试</button>`:''}</article>`).join(''):'<p class="hint">今天还没有已转写的晚间录像。录完后，右键录像选择“转文字并存入复盘”。</p>';
    this.bindOpen(box);$$('[data-review-retry]',box).forEach(b=>b.onclick=()=>this.request(b.dataset.reviewRetry));
  },
  dismissMenu(){document.getElementById('evening-video-menu')?.remove();},
  boot() {
    document.addEventListener('contextmenu',event=>{
      const row=event.target.closest('[data-skincare-file]');if(!row||row.dataset.recordPhase!=='evening')return;
      event.preventDefault();this.dismissMenu();const menu=document.createElement('div');menu.id='evening-video-menu';menu.setAttribute('role','menu');
      const b=document.createElement('button');b.className='btn';b.setAttribute('role','menuitem');b.textContent='转文字并存入复盘';b.onclick=()=>{this.dismissMenu();void this.request(row.dataset.skincareFile);};menu.append(b);document.body.append(menu);
      menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-menu.offsetHeight-8))+'px';b.focus();
    },true);
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('#evening-video-menu'))this.dismissMenu();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')this.dismissMenu();});
    this.poll=setInterval(()=>{if(App.currentView==='skincare'||App.currentView==='daily-review'||this.jobs.some(j=>!['failed','completed'].includes(j.status)))void this.load();},1800);
  }
};
document.addEventListener('DOMContentLoaded',()=>EveningReviewUI.boot());
