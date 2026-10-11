/* Daily workspace UI. Persistence remains in Store and the domain engines. */
const UX = {
  modules:{follow:'视频跟练',strength:'力量训练',skincare:'护肤',nutrition:'饮食与睡眠',achievements:'成就'},
  enabled(key){return (Store.settings().enabledModules || Object.keys(this.modules)).includes(key);},
  saved(){
    const status=$('#ux-save-status'); if(status){status.textContent='已保存';status.className='ux-status';}
    if(this.commitScope){Drafts.clear(this.commitScope);this.commitScope=null;}
  },
  saveFailed(error){
    let status=$('#ux-save-status'); if(!status){status=document.createElement('div');status.id='ux-save-status';document.body.appendChild(status);}
    status.className='ux-status error';status.innerHTML='保存失败，填写已保留。<button class="btn small">重试保存</button>';
    $('button',status).onclick=()=>{if(Store._failed){Store.db=UXCore.clone(Store._failed);Store.save(true);App.render();}};
    toast(error.message || '保存失败，输入已保留','red');
  },
  boot(){
    document.addEventListener('error',e=>{if(e.target?.tagName==='IMG')e.target.classList.add('ph');},true);
    document.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      this.commitScope=/(?:save|ok|apply)$/.test(b.id)||/^(?:保存|更新记录|记录$|添加$|导入并|确认添加|完成收尾)/.test(b.textContent.trim()) ? (b.closest('#modal-card') || b.closest('form') || $('#view-root')) : null;
    },true);
    document.addEventListener('submit',e=>{this.commitScope=e.target;},true);
    for(const event of ['error','unhandledrejection'])window.addEventListener(event,e=>{
      if(Store._failed){this.saveFailed(e.reason || e.error || Error('保存失败'));e.preventDefault();}
    });
    document.addEventListener('compositionstart',()=>{this.composing=true;});document.addEventListener('compositionend',()=>{this.composing=false;});
    document.addEventListener('keydown',e=>{
      if(e.isComposing || e.repeat || (!e.metaKey&&!e.ctrlKey))return;
      if((e.metaKey||e.ctrlKey)&&(/^[1-6]$/.test(e.key)||e.key.toLowerCase()==='s')){e.preventDefault();this.shortcut(e.key);}
    });
    native.onShortcut?.(key=>this.shortcut(key));
    Drafts.boot();SoftControls.boot();this.updateNav();
  },
  shortcut(key){
    if(this.composing||document.activeElement?.tagName==='IFRAME')return;
    if(key.toLowerCase()==='s'){
      const box=!$('#modal-mask').classList.contains('hidden')?$('#modal-card'):$('#view-root');
      const b=$$('button',box).find(x=>!x.disabled && x.offsetParent && /^(保存|更新睡眠|记录$|保存设置)/.test(x.textContent.trim()));
      if(b)b.click();else{const f=$('form',box);if(f)f.requestSubmit();}return;
    }
    if(!$('#modal-mask').classList.contains('hidden'))return;
    const view=['today','plan','strength','skincare','nutrition','achievements'][Number(key)-1];
    if(view)App.go(view);
  },
  updateNav(){
    $$('.nav-item').forEach(b=>{const k=b.dataset.view==='plan'?'follow':b.dataset.view;b.hidden=k in this.modules&&!this.enabled(k);});
  },
  afterRender(){
    this.updateNav();
    this.collectionNav();
    if(App.currentView==='today')this.today();
    if(App.currentView==='awakening')this.awakening();
    if(App.currentView==='skincare')this.skincare();
    if(App.currentView==='strength')this.strengthSets();
    if(App.currentView==='plan'){const old=$('#pl-target')?.closest('.row');if(old){old.hidden=true;const heading=$('h3',old.closest('.card'));if(heading)heading.textContent='每日固定安排';if(old.nextElementSibling?.tagName==='HR')old.nextElementSibling.hidden=true;}const hub=$('#pl-hub');if(hub)hub.closest('.card').hidden=true;const link=document.createElement('button');link.className='btn small';link.textContent='目标、外观和提醒设置';link.onclick=()=>App.go('settings');$('#view-root .view')?.prepend(link);}
    if(App.currentView==='nutrition'){
      const link=document.createElement('button');link.className='btn small';link.textContent='编辑个人资料';link.onclick=()=>App.go('settings');
      $('#rh-nutrition-title')?.parentElement.appendChild(link);
    }
    if(typeof Routine!=='undefined'&&Routine.active)Routine.drawFlow();
    this.sources();
    Drafts.bind($('#view-root'));
    SoftControls.bind($('#view-root'));
  },
  collectionNav(){
    const box=$('#video-collections-nav');if(!box)return;
    const mode=Store.currentMode();
    box.innerHTML=Store.collections().filter(c=>c.id!=='face').map(c=>`<button class="nav-item${['awakening','follow'].includes(App.currentView)&&mode===c.id?' active':''}" data-view="awakening" data-collection-id="${esc(c.id)}"><span class="nav-ico">${Icon3D.makeIcon('sun').outerHTML}</span><span class="vc-nav-label"><b>${esc(c.name)}</b></span></button>`).join('');
    $$('[data-collection-id]',box).forEach(b=>b.onclick=()=>App.goCollection(b.dataset.collectionId));
    const add=$('#add-video-collection');if(add)add.onclick=()=>this.collectionModal();
    const edit=$('#edit-video-collection');if(edit)edit.onclick=()=>this.collectionModal(Store.currentMode());
    if(App.currentView==='awakening')$('#page-title').textContent=Store.currentCollection().name;
    const face=$('.nav-item[data-view="today"]');if(face){const label=face.lastElementChild;if(label)label.textContent=Store.collectionById('face').name;face.classList.toggle('active',App.currentView==='today'||App.currentView==='follow'&&mode==='face');}
  },
  filterCollections(period){
    this.collectionPeriod=period;
    const current=Store.currentCollection(),matched=Store.collections().filter(c=>c.id!=='face'&&(period==='all'||(c.periods||[]).includes(period)));
    if(['awakening','follow'].includes(App.currentView)&&Store.currentMode()!=='face'&&period!=='all'&&!(current.periods||[]).includes(period)){
      if(matched.length)App.goCollection(matched[0].id);
      else{App.go('awakening');$('#view-root').innerHTML='<div class="view"><div class="card"><h3>这个时段暂无视频板块</h3><p class="hint">到「设置 → 视频板块」调整适用时段，或选择「全部」查看已有板块。</p></div></div>';}
    }else if(['awakening','today'].includes(App.currentView))App.render();else this.collectionNav();
  },
  collectionModal(id){
    const collection=id?Store.collectionById(id):null;
    const periods=collection?.periods||['morning'];
    const c=openModal(`<form id="vc-form"><h3>${collection?'编辑':'新增'}视频板块</h3><label class="field">板块名称<input class="input" id="vc-name" maxlength="40" value="${esc(collection?.name||'')}" placeholder="例如：认知唤醒、晚间复盘" required></label><fieldset class="vc-period-fields"><legend>什么时候看</legend>${[['morning','早上'],['evening','晚上']].map(([value,name])=>`<label><input type="checkbox" name="vc-period" value="${value}"${periods.includes(value)?' checked':''}>${name}</label>`).join('')}</fieldset><p class="hint">可以同时选早上和晚上。视频只加入当前板块，名称和时段可随时调整。</p><p id="vc-error" class="hint" role="alert"></p><div class="ux-actions"><button class="btn primary" type="submit" id="vc-save">${collection?'保存':'创建板块'}</button>${collection&&id!=='face'?'<button class="btn danger" type="button" id="vc-delete">删除板块</button>':''}</div></form>`);
    c.dataset.draftObject='video-collection:'+(id||'new');
    $('#vc-form',c).onsubmit=e=>{e.preventDefault();try{
      const name=$('#vc-name',c).value,selected=$$('input[name="vc-period"]:checked',c).map(x=>x.value);
      const result=collection?Store.updateCollection(id,{name,periods:selected}):Store.createCollection(name,selected);
      closeModal(true);this.collectionPeriod='all';if(App.currentView==='settings'){this.settingsPanel='collections';App.render();}else App.goCollection(result.id);toast(collection?'板块已保存':'视频板块已创建','green');
    }catch(error){$('#vc-error',c).textContent=error.message;}};
    const del=$('#vc-delete',c);if(del)del.onclick=async()=>{
      const count=Store.videosForMode(id).length;
      if(!await confirmModal('删除视频板块',`删除「${collection.name}」及其中 ${count} 个视频引用和观看记录？`,'删除板块'))return;
      try{if(Session.active&&(Session.active.mode||Store.videoMode(Store.videoById(Session.active.videoId)))===id){Bilibili.MediaSync.pauseAll();Session.stop();}
        Store.deleteCollection(id);closeModal(true);if(App.currentView==='settings'){this.settingsPanel='collections';App.render();}else App.goCollection('face');toast('板块已删除');
      }catch(error){$('#vc-error',c).textContent=error.message;}
    };
  },
  awakening(){
    $$('[data-watch-period]').forEach(b=>b.onclick=()=>{this.watchManualPhase=b.dataset.watchPeriod;this.updateWatchingNow();});
    $('#watch-plan-settings')?.addEventListener('click',()=>{this.settingsPanel='reminders';App.go('settings');});
    this.updateWatchingNow();
    const root=$('#view-root'),box=$('#ux-home-video',root);if(box)this.homeVideo(box);
    const library=$('#td-vids',root)?.closest('.card');if(library)this.videoLibrary(library);
  },
  updateWatchingNow(){
    if(App.currentView!=='awakening'||!Store.db)return;
    const mode=Store.currentMode(),plan=DailyPlanCore.config(Store.db,mode),periods=Store.currentCollection()?.periods||['morning','evening'],phase=DailyPlanCore.phase(Object.fromEntries(periods.map(p=>[p,plan[p]])),nowMinutes(),periods[0]);
    const clock=mode+'|'+todayKey()+'|'+phase;
    if(this.watchClock!==clock)this.watchManualPhase=null;
    this.watchClock=clock;
    const shown=this.watchManualPhase||phase;
    $$('[data-watch-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.watchPeriod===shown)));
    const label=$('#watch-current-period');if(label)label.textContent=(plan.morning||plan.evening)?`当前：${shown==='morning'?'早上':'晚上'} · 到点自动切换`:'设置早晚开始时间后，到点自动切换时段';
  },
  watchingSettingsFields(){
    return Store.collections().filter(c=>c.id!=='face').map(c=>{const plan=DailyPlanCore.config(Store.db,c.id);return `<fieldset class="watch-plan-fields" data-watch-plan="${esc(c.id)}"><legend>${esc(c.name)}</legend><label>每日观看时长<span class="watch-duration"><input class="input" data-watch-field="targetMinutes" data-stepper="观看时长" type="number" min="1" max="600" value="${plan.targetMinutes}">分钟</span></label><label>早上开始<input class="input" type="time" data-watch-field="morning" value="${esc(plan.morning)}"></label><label>晚上开始<input class="input" type="time" data-watch-field="evening" value="${esc(plan.evening)}"></label></fieldset>`;}).join('');
  },
  watchingSettingsValues(scope){
    return $$('[data-watch-plan]',scope).map(box=>({id:box.dataset.watchPlan,value:DailyPlanCore.validate(Object.fromEntries($$('[data-watch-field]',box).map(x=>[x.dataset.watchField,x.value])))}));
  },
  saveWatchingSettings(values){for(const {id,value}of values)DailyPlanCore.change(Store.db,id,value,todayKey());},
  sources(){
    const root=$('#view-root');if($('#ux-sources',root)||!['nutrition','strength','achievements'].includes(App.currentView))return;
    const node=document.createElement('details');node.className='card ux-source';node.id='ux-sources';let lines=[];
    if(App.currentView==='nutrition'){const d=Rhythm.selectedDay||todayKey(),records=Store.db.rhythm.sleeps.filter(s=>s.endLocal?.startsWith(d));lines=records.map(s=>`${d}：${RhythmEngine.sleepMinutes(s)} 分钟 · ${s.durationOnly?'手动记录时长与分数':s.source==='lifepivot'?'设备导入':s.recordedMinutes!=null?'手环时长手动填写':'按时间差估算'}；仅时长记录使用你保存的分数；旧记录按原规则评分。`);const g=RhythmEngine.glycemicScore(Store.db.rhythm,d);lines.push(g?`饮食习惯参考 ${g.score} 分；依据：${g.factors.map(x=>x.label+' × 权重 '+x.weight).join('，')}。缺项不参与；没有血糖实测数据。`:'尚无足够饮食习惯记录，未输出评分。');}
    else if(App.currentView==='strength'){const days=Object.values(Store.db.strength?.days||{});lines=[`依据 ${days.length} 个训练日的手动记录；逐组数据只汇总已完成组，旧汇总不拆成逐组事实。`,`肌群分数、估算最大重量和训练容量均为规则估算，详见肌群详情与原始组数、次数和重量；未记录不等于零表现。`];}
    else lines=['专注参考仅根据明确的手动暂停次数计算；缓冲、播放器错误与未知暂停单独记录，不扣分。历史记录无法辨认原因时不生成新的专注分。','达标依据各日期保存的目标；迁移前没有目标历史的日期使用升级时参考目标。'];
    node.innerHTML='<summary>当前指标的来源与缺失项 · 规则版本 1</summary>'+lines.map(x=>'<p>'+esc(x)+'</p>').join('');root.querySelector('.view,.rhythm-page')?.appendChild(node);
  },
  /* 「现在做什么」可添加板块：注册表决定有什么、homeActions 决定显示哪些（按添加顺序）。
     label 返回原始文本（渲染处统一 esc）；run 用 .call(this=UX) 调用。 */
  QUICK_ACTIONS:[
    {id:'follow',module:'follow',cls:'primary',label(){const a=Session.active&&Store.videoMode(Store.videoById(Session.active.videoId))==='face'?Session.active:null;return a?'继续：'+(Store.videoById(a.videoId)?.title||'未结束跟练'):'选择视频开练';},run(){const a=Session.active&&Store.videoMode(Store.videoById(Session.active.videoId))==='face'?Session.active:null;if(a)App.launchFollow(a.videoId,a.sessionId);else App.openPracticeChooser(null);}},
    {id:'strength',module:'strength',label(){const d=Store.db.strength?.days?.[Core.businessDate()];return d?.status==='in-progress'?'继续力量训练：'+(d?.name||''):d?.isRest?'今日休息 · 查看计划':d?.status==='completed'?'今日力量已完成 · 查看记录':'查看今日力量训练';},run(){Strength.ui.tab='today';App.go('strength');}},
    {id:'care',module:'skincare',label(){const phase=this.carePhase(),steps=Store.activeCycle()?.steps?.[phase]||[],done=Store.daySkincare(todayKey())[phase]||[],next=steps.find(x=>!done.includes(x.id));return !steps.length?'添加当前护理步骤':next?'护理：'+next.name:'本时段护理已完成';},run(){Skincare.ui.tab='care';App.go('skincare');}},
    {id:'meal',module:'nutrition',label(){return '记一餐';},run(){Rhythm.selectedDay=todayKey();Rhythm.mealModal();this.mealShortcuts();}},
    {id:'sleep',module:'nutrition',label(){return '记睡眠';},run(){this.quickSleep();}},
    {id:'skin',module:'skincare',label(){return '记皮肤';},run(){this.quickSkin();}},
    {id:'library',label(){return '视频库';},run(){const d=$('#ux-library-panel');if(d){d.open=true;d.scrollIntoView({block:'start'});}}}
  ],
  QUICK_ACTION_DEFAULT:['follow','strength','care','library'],
  homeActions(){
    const saved=Store.settings().homeActions,known=this.QUICK_ACTIONS.map(a=>a.id);
    const ids=Array.isArray(saved)&&saved.length?saved:this.QUICK_ACTION_DEFAULT;
    return [...new Set(ids.filter(id=>known.includes(id)))];
  },
  manageQuickActions(){
    const draw=()=>{const saved=this.homeActions(),nameHtml=a=>`${esc(a.label.call(this))}${a.module?`<small>${esc(this.modules[a.module]||'')}${!this.enabled(a.module)?' · 模块未启用，暂不显示':''}</small>`:''}`;
      const shown=saved.map(id=>this.QUICK_ACTIONS.find(a=>a.id===id)).filter(Boolean);
      const available=this.QUICK_ACTIONS.filter(a=>!saved.includes(a.id));
      return `<h3>自定义「现在做什么」</h3><p class="hint">板块按下面的顺序排成每行两个；用 ↑↓ 调整顺序，移除后可随时加回。</p>
        <div class="ux-qa-group"><b>已显示（${shown.length}）</b><div class="ux-qa-list">${shown.length?shown.map((a,i)=>`<div class="ux-qa-row"><span class="ux-qa-name">${nameHtml(a)}</span><span class="ux-qa-ops"><button class="btn small ghost" data-no-icon="true" data-qa-move="${a.id}" data-dir="-1" aria-label="上移${esc(a.label.call(this))}"${i===0?' disabled':''}>↑</button><button class="btn small ghost" data-no-icon="true" data-qa-move="${a.id}" data-dir="1" aria-label="下移${esc(a.label.call(this))}"${i===shown.length-1?' disabled':''}>↓</button><button class="btn small ghost" data-qa-toggle="${a.id}">移除</button></span></div>`).join(''):'<p class="hint ux-qa-none">还没有板块。</p>'}</div></div>
        <div class="ux-qa-group"><b>可添加（${available.length}）</b><div class="ux-qa-list">${available.length?available.map(a=>{const gated=a.module&&!this.enabled(a.module);return `<div class="ux-qa-row"><span class="ux-qa-name">${nameHtml(a)}</span><button class="btn small" data-qa-toggle="${a.id}"${gated?' disabled title="模块未启用"':''}>添加</button></div>`;}).join(''):'<p class="hint ux-qa-none">全部板块都已显示。</p>'}</div></div>
        <div class="ux-modal-controls"><button class="btn small primary" id="ux-qa-done">完成</button></div>`;};
    const card=openModal(draw());
    card.addEventListener('click',e=>{
      const mv=e.target.closest('[data-qa-move]');
      if(mv&&!mv.disabled){const id=mv.dataset.qaMove,dir=Number(mv.dataset.dir),cur=this.homeActions(),i=cur.indexOf(id),j=i+dir;
        if(i>-1&&j>-1&&j<cur.length){[cur[i],cur[j]]=[cur[j],cur[i]];Store.db.settings.homeActions=cur;Store.save(true);card.innerHTML=draw();App.render();}
        return;}
      const t=e.target.closest('[data-qa-toggle]');
      if(t){const id=t.dataset.qaToggle,cur=this.homeActions(),adding=!cur.includes(id);
        Store.db.settings.homeActions=adding?[...cur,id]:cur.filter(x=>x!==id);
        if(adding)this._qaFlash=id;
        Store.save(true);card.innerHTML=draw();App.render();return;}
      if(e.target.closest('#ux-qa-done'))closeModal();
    });
  },
  today(){
    const root=$('#view-root'),view=$('.view',root);if(!view)return;
    const first=document.createElement('div');first.className='card ux-now'+(this.enabled('follow')?' ux-now-with-video':'');first.id='ux-now';
    const active=Session.active&&Store.videoMode(Store.videoById(Session.active.videoId))==='face'?Session.active:null;
    const qa=this.homeActions().map(id=>this.QUICK_ACTIONS.find(a=>a.id===id)).filter(a=>a&&(!a.module||this.enabled(a.module)));
    first.innerHTML=`<div class="ux-now-main"><h3>现在做什么</h3><div class="ux-actions ux-actions-grid">${qa.length?'':'<p class="ux-qa-empty">还没有板块——点「添加板块」挑几个常用的放进来。</p>'}${qa.map(a=>`<button class="btn${a.cls?' '+a.cls:''}${this._qaFlash===a.id?' ux-qa-flash':''}" id="ux-${a.id}">${esc(a.label.call(this))}</button>`).join('')}<button class="btn ux-add-action" id="ux-add-action" data-no-icon="true" aria-label="添加或移除板块">${Icon3D.makeIcon('add').outerHTML}<span>添加板块</span></button></div>
      ${active?'<button class="btn small ghost ux-now-extra" id="ux-end-follow">结束上次跟练并保留记录</button>':''}
      ${nowMinutes()>=18*60&&this.enabled('nutrition')?'<button class="btn small ghost ux-now-extra" id="ux-completeness">确认今日饮食、睡眠已记全</button>':''}
      ${!Store.db.onboarding?.done?'<div class="ux-onboarding"><p>先选择需要的模块，随时可在设置中调整。</p><button class="btn small primary" id="ux-onboard">选择使用模块</button><button class="btn small ghost" id="ux-skip-onboard">暂时跳过</button></div>':''}</div>
      ${this.enabled('follow')?'<aside class="ux-home-video" id="ux-home-video" aria-label="快捷视频跟练"></aside>':''}`;
    const switcher=document.createElement('div');switcher.className='soft-period-row';switcher.innerHTML=`<span class="hint">跟练时段</span><div class="soft-segments" aria-label="瘦脸护理时段">${[['all','全部'],['morning','早上'],['evening','晚上']].map(([id,name])=>`<button type="button" data-face-period="${id}" data-no-icon="true" aria-pressed="${(this.facePeriod||'all')===id}">${name}</button>`).join('')}</div>`;first.prepend(switcher);
    /* 切时段只换视图：早上/晚上各自读写自己的持久槽位，互不覆盖；选择器无记忆时回落「自动流程预设 → 列表首个」。 */
    $$('[data-face-period]',switcher).forEach(b=>b.onclick=()=>{this.facePeriod=b.dataset.facePeriod;App.render();});
    view.prepend(first);
    if(typeof Membership !== 'undefined') Membership.home(first);
    this._qaFlash=null;
    if(this.enabled('follow'))this.homeVideo($('#ux-home-video',first));
    qa.forEach(a=>{const b=$('#ux-'+a.id,first);if(b)b.onclick=()=>a.run.call(this);});
    const bind=(id,fn)=>{const b=$(id,first);if(b)b.onclick=fn;};
    bind('#ux-add-action',()=>this.manageQuickActions());
    bind('#ux-end-follow',()=>{Session.stop();App.render();});
    const library=$('#td-vids',root)?.closest('.card');
    if(library){const d=document.createElement('details');d.id='ux-library-panel';d.innerHTML='<summary>视频库 · 搜索、收藏与最近使用</summary>';library.before(d);d.appendChild(library);this.videoLibrary(library);}
    // Daily details remain accessible below the compact action panel.
    $('#td-brief',root)?.setAttribute('data-ux-details','true');
    if(!this.enabled('follow')){$('.today-top',root)?.setAttribute('hidden','');$('#td-courses',root)?.closest('.card').setAttribute('hidden','');}
    if(!this.enabled('skincare'))$('#td-sk',root)?.closest('.card').setAttribute('hidden','');
  },
  /* ---------- 首页视频槽位（E：早晚独立） ----------
     「全部」沿用原内存记忆（现行为，不落盘、不读写早晚槽位）；
     早上/晚上是独立持久槽位 <mode>:morning / <mode>:evening，按日记忆（date 非当天视为无记忆），
     互不覆盖、可同可不同，重启后仍在。 */
  slotKey(mode,period){return period==='morning'||period==='evening'?mode+':'+period:mode;},
  videoSlot(mode,period){
    const slots=Store.db?.settings?.videoSlots;
    const slot=slots&&typeof slots==='object'&&!Array.isArray(slots)?slots[this.slotKey(mode,period)]:null;
    return slot&&typeof slot==='object'?slot:null;
  },
  /* 当前时段槽位应显示的记忆视频：按日记忆（date 非当天失效），视频须属于该板块 */
  slotChoice(mode,period){
    if(period!=='morning'&&period!=='evening')return null;
    const slot=this.videoSlot(mode,period);
    if(!slot||slot.date!==todayKey())return null;
    const video=Store.videoById(slot.id);
    return video&&Store.videoMode(video)===mode?video:null;
  },
  rememberHomeVideo(mode,period,id){
    if(period==='morning'||period==='evening'){
      const settings=Store.settings();
      settings.videoSlots=settings.videoSlots&&typeof settings.videoSlots==='object'&&!Array.isArray(settings.videoSlots)?settings.videoSlots:{};
      settings.videoSlots[this.slotKey(mode,period)]={date:todayKey(),id:id||null};
      Store.save(true);
      return;
    }
    this.homeVideoChoices=this.homeVideoChoices||{};
    this.homeVideoChoices[mode]={date:todayKey(),id};
    this.homeVideoChoice=this.homeVideoChoices[mode];
  },
  homeVideo(box){
    this._homeVideoMenuAbort?.abort();
    const mode=Store.currentMode(),watching=mode!=='face';
    const periodSlot=['morning','evening'].includes(this.facePeriod)?this.facePeriod:null;
    const videos=Store.videosForMode(mode),active=Session.active&&Store.videoMode(Store.videoById(Session.active.videoId))===mode?Session.active:null;
    const plans=(watching?[]:Store.db.sessions||[]).filter(s=>s.enabled&&(!this.facePeriod||this.facePeriod==='all'||(minutesOf(s.time)<12*60?'morning':'evening')===this.facePeriod)&&(s.days||[]).includes(new Date().getDay())&&Store.videoById(s.videoId)&&Store.videoMode(Store.videoById(s.videoId))===mode)
      .sort((a,b)=>(minutesOf(a.time)||0)-(minutesOf(b.time)||0));
    const planned=plans.find(s=>(minutesOf(s.time)||0)>=nowMinutes())||plans.at(-1);
    const recent=[...videos].sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite)||(Date.parse(b.lastUsedAt||b.addedAt)||0)-(Date.parse(a.lastUsedAt||a.addedAt)||0));
    const slotVideo=periodSlot?this.slotChoice(mode,periodSlot):null;
    const explicit=this.homeVideoChoice;
    const choice=explicit&&Store.videoMode(Store.videoById(explicit.id))===mode?explicit:this.homeVideoChoices?.[mode];
    const candidate=choice?.date===todayKey()?Store.videoById(choice.id):null;
    const chosen=!periodSlot&&candidate&&Store.videoMode(candidate)===mode?candidate:null;
    const auto=periodSlot?Store.videoById((typeof Routine!=='undefined'?Routine.config():{})[periodSlot]?.videoId):null;
    const autoVideo=auto&&Store.videoMode(auto)===mode?auto:null;
    let video=Store.videoById(active?.videoId)||slotVideo||chosen||autoVideo||Store.videoById(planned?.videoId)||recent[0];
    box.innerHTML=`<div class="ux-home-video-heading"><span>${watching?'视频观看':'视频跟练'}</span>${videos.length>1?`<div class="ux-home-video-picker"><select id="ux-home-video-select" tabindex="-1" aria-hidden="true">${videos.map(v=>`<option value="${esc(v.id)}">${esc(v.title||'未命名视频')}</option>`).join('')}</select><button type="button" id="ux-home-video-trigger" class="ux-home-video-trigger" aria-label="切换${watching?'观看':'跟练'}视频" aria-haspopup="listbox" aria-expanded="false" aria-controls="ux-home-video-menu" data-no-icon="true"><span></span><b aria-hidden="true">⌄</b></button></div>`:''}</div><div id="ux-home-video-content"></div>`;
    const draw=()=>{
      const resume=video&&Session.active?.videoId===video.id;
      const plan=video?plans.find(s=>s.videoId===video.id):null;
      const label=video?(resume?(watching?'继续观看':'继续跟练'):(watching?'点击观看':'点击开练')):'导入第一个视频';
      const title=video?.title||(watching?'把喜欢的视频放在这里':'把喜欢的课程放在这里');
      const duration=Number(video?.durationSec)>0?fmtSeconds(video.durationSec):'';
      const note=video?[resume?'上次未完成':plan?`今日安排 · ${plan.time}`:video.favorite?'已收藏':watching?'随时观看':'随时开练',video.source==='local'?'本地视频':'B 站'].join(' · '):'支持 B 站 / 抖音链接或本地视频';
      /* 时段视图显示该时段自己的分账（早上/晚上），「全部」显示总数；瘦脸与观看板块各自取数 */
      const periodLabel=periodSlot?(periodSlot==='morning'?'早上':'晚上'):'今日';
      const progSec=watching?Store.dayWatchingPeriod(todayKey(),periodSlot,mode):Store.dayTrainingPeriod(todayKey(),periodSlot);
      const progress=`${periodLabel}已${watching?'观看':'跟练'} ${Math.round(progSec/60)} 分钟`;
      $('#ux-home-video-content',box).innerHTML=`<button type="button" class="ux-home-video-card" id="ux-home-video-play" data-no-icon="true" aria-label="${esc(label+'：'+title)}">
        <span class="ux-home-video-cover">
          <span class="ux-home-video-fallback" aria-hidden="true">${Icon3D.makeIcon(video?'film':'video').outerHTML}</span>
          ${video?.pic?`<img class="ux-home-video-poster" src="${esc(video.pic)}" alt="" referrerpolicy="no-referrer" draggable="false">`:''}
          ${duration?`<span class="ux-home-video-duration">${esc(duration)}</span>`:''}
          <span class="ux-home-video-launch">${Icon3D.makeIcon(video?'play':'add').outerHTML}<span>${label}</span></span>
        </span>
        <span class="ux-home-video-caption"><strong>${esc(title)}</strong><small>${esc(note)}</small><small class="ux-home-video-progress" id="ux-home-video-progress">${esc(progress)}</small></span>
      </button>`;
      $('#ux-home-video-play',box).onclick=()=>{
        if(!video){Views.importModal();return;}
        if(!Store.videoById(video.id)){App.render();return;}
        App.launchFollow(video.id,resume?Session.active.sessionId:plan?.id||null,{autoplay:true});
      };
    };
    const select=$('#ux-home-video-select',box);
    if(select){
      select.value=video.id;
      const trigger=$('#ux-home-video-trigger',box);
      const syncTrigger=()=>{trigger.querySelector('span').textContent=video?.title||'未命名视频';};
      select.onchange=()=>{video=Store.videoById(select.value);this.rememberHomeVideo(mode,periodSlot,video?.id);syncTrigger();draw();};
      syncTrigger();
      const abort=new AbortController();this._homeVideoMenuAbort=abort;
      let menu=null,highlight=videos.findIndex(v=>v.id===video?.id);
      const close=()=>{if(!menu)return;menu.remove();menu=null;trigger.setAttribute('aria-expanded','false');};
      const preview=v=>{
        if(!menu)return;
        const panel=$('.ux-home-video-preview',menu);
        panel.innerHTML=`<div class="ux-home-video-preview-cover">${v.pic?`<img src="${esc(v.pic)}" alt="" referrerpolicy="no-referrer" draggable="false">`:''}<span class="ux-home-video-preview-empty"${v.pic?' hidden':''}>${Icon3D.makeIcon('film').outerHTML}<small>暂无封面</small></span></div><strong>${esc(v.title||'未命名视频')}</strong><small>${v.source==='local'?'本地视频':'B 站视频'}${Number(v.durationSec)>0?' · '+esc(fmtSeconds(v.durationSec)):''}</small>`;
        const img=$('img',panel);if(img)img.onerror=()=>{img.remove();$('.ux-home-video-preview-empty',panel).hidden=false;};
      };
      const focusRow=i=>{highlight=(i+videos.length)%videos.length;$$('.ux-home-video-option',menu).forEach((row,j)=>row.classList.toggle('is-hovered',j===highlight));preview(videos[highlight]);const row=$$('.ux-home-video-option',menu)[highlight];row?.focus();row?.scrollIntoView({block:'nearest'});};
      const open=()=>{
        if(menu){close();return;}
        menu=document.createElement('div');menu.id='ux-home-video-menu';menu.className='ux-home-video-menu';menu.innerHTML=`<div class="ux-home-video-options" role="listbox" aria-label="选择跟练视频">${videos.map(v=>`<button type="button" class="ux-home-video-option" role="option" data-video-id="${esc(v.id)}" aria-selected="${v.id===video?.id}" data-no-icon="true">${esc(v.title||'未命名视频')}</button>`).join('')}</div><div class="ux-home-video-preview" aria-live="off"></div>`;
        document.body.appendChild(menu);
        const rect=trigger.getBoundingClientRect(),width=Math.min(640,innerWidth-24);
        menu.style.width=`${width}px`;menu.style.left=`${Math.max(12,Math.min(rect.left,innerWidth-width-12))}px`;
        menu.style.top=`${Math.max(12,Math.min(rect.bottom+6,innerHeight-menu.offsetHeight-12))}px`;
        trigger.setAttribute('aria-expanded','true');
        $$('.ux-home-video-option',menu).forEach((row,i)=>{
          row.onmouseenter=()=>focusRow(i);
          row.onfocus=()=>focusRow(i);
          row.onclick=()=>{select.value=videos[i].id;select.dispatchEvent(new Event('change',{bubbles:true}));close();trigger.focus();};
        });
        preview(videos[Math.max(0,highlight)]);
      };
      trigger.onclick=open;
      trigger.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();if(!menu)open();focusRow(highlight+(e.key==='ArrowDown'?1:-1));}};
      document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target)&&e.target!==trigger)close();},{signal:abort.signal});
      document.addEventListener('keydown',e=>{
        if(!menu)return;
        if(e.key==='Escape'){e.preventDefault();close();trigger.focus();}
        else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();focusRow(highlight+(e.key==='ArrowDown'?1:-1));}
      },{signal:abort.signal});
      window.addEventListener('resize',close,{signal:abort.signal});
      window.addEventListener('scroll',close,{capture:true,signal:abort.signal});
      abort.signal.addEventListener('abort',close,{once:true});
    }
    draw();
  },
  mealShortcuts(){
    const f=$('#rh-form');if(!f)return;const row=document.createElement('div');row.className='ux-actions';row.innerHTML='<button type="button" class="btn small" data-min="0">刚刚</button><button type="button" class="btn small" data-min="30">半小时前</button><span class="hint">或直接修改下方时间</span>';f.querySelector('h3').after(row);
    $$('[data-min]',row).forEach(b=>b.onclick=()=>{const d=new Date(Date.now()-Number(b.dataset.min)*60000);f.elements.time.value=dateKey(d)+'T'+hhmm(d);f.elements.time.dispatchEvent(new Event('input',{bubbles:true}));});
  },
  quickSleep(){
    Rhythm.selectedDay=todayKey();const sleeps=Rhythm.data().sleeps.filter(x=>(x.endLocal || '').slice(0,10)===todayKey());
    const c=openModal('<h3>记昨晚睡眠</h3>'+Rhythm.sleepForm(sleeps));c.dataset.draftObject=Rhythm.formSleepId||'new-sleep';Rhythm.bindSleepForm(c);Drafts.bind(c);
    const f=$('#rh-sleep-form',c),save=f.onsubmit;f.onsubmit=async e=>{await save(e);if(!Store._failed&&!$('#rh-sleep-error',f).textContent)closeModal();};
  },
  quickSkin(){
    SkinEngine.normalize(Store.db);Skincare._ensureTodayPrediction();
    const c=openModal(Skincare._skinTodayCard());Skincare._bindSkin(c);const ai=$('#sk-ai-fill',c);if(ai)ai.hidden=true;
    $('#sk-skin-save',c).onclick=async()=>{UX.commitScope=c;if(await Skincare._saveSkinLog(c))closeModal();};
    Drafts.bind(c);
  },
  completeness(){
    const d=Rhythm.data().completeDays[todayKey()] || {};
    const c=openModal(`<h3>今日记录已记全吗？</h3><p class="hint">仅由你确认；之后补记或编辑会提示重新确认。</p><label><input type="checkbox" id="ux-c-meals" ${d.meals?'checked':''}>进餐已记全</label><label><input type="checkbox" id="ux-c-sleep" ${d.sleep?'checked':''}>睡眠已记全</label><button class="btn primary" id="ux-c-save">保存确认</button>`);
    $('#ux-c-save',c).onclick=async()=>{const ok=await Rhythm.commit(x=>{x.completeDays[todayKey()]={meals:$('#ux-c-meals',c).checked,sleep:$('#ux-c-sleep',c).checked};});if(ok){closeModal();App.render();}};
  },
  settings(root){
    const s=Store.settings(),p=Store.db.profile || {},val=v=>esc(v??'');
    const icon=name=>Icon3D.makeIcon(name).outerHTML;
    const sw=(attrs,on)=>`<span class="ux-switch"><input type="checkbox" ${attrs}${on?' checked':''}><i></i></span>`;
    const ctrl=inner=>`<span class="ux-set-control">${inner}</span>`;
    const row=(label,control)=>`<label class="ux-opt-row"><span>${label}</span>${ctrl(control)}</label>`;
    const moduleIcons={follow:'video',strength:'bolt',skincare:'skincare',nutrition:'nutrition',achievements:'trophy'};
    const nav=[['modules','使用模块','check'],['collections','视频板块','folder'],['automation','自动流程','alarm'],['profile','个人资料','edit'],['preferences','目标与外观','target'],['reminders','提醒','alarm'],['backup','数据与备份','folder'],['ai','AI 识图','sparkles']];
    const panel=nav.some(([k])=>k===this.settingsPanel)?this.settingsPanel:'modules';
    const shown=k=>k===panel?'':' hidden';
    const timeField=(name,label,value)=>`<label>${label}<input class="input" type="time" name="${name}" value="${val(value)}"></label>`;
    root.innerHTML=`<div class="view ux-settings"><div class="ux-console"><div class="ux-set-rail"><div class="ux-set-nav" role="tablist" aria-label="设置分区">${nav.map(([k,n,ic])=>`<button type="button" class="ux-set-tab" id="ux-tab-${k}" role="tab" aria-selected="${k===panel}" aria-controls="ux-${k}">${icon(ic)}<span>${n}</span></button>`).join('')}</div></div><div class="ux-set-main">
    <form id="ux-settings-form" autocomplete="off">
    <section class="ux-set-section" id="ux-modules" role="tabpanel" aria-labelledby="ux-tab-modules"${shown('modules')}><h3>使用模块</h3><p class="hint">隐藏仅收起入口和提醒，历史记录仍保留。</p><div class="ux-opt-rows">${Object.entries(this.modules).map(([k,n])=>`<label class="ux-opt-row"><span class="ux-opt-name">${icon(moduleIcons[k])}<span>${n}</span></span>${ctrl(sw(`name="module-${k}"`,this.enabled(k)))}</label>`).join('')}</div></section>
    <section class="ux-set-section" id="ux-profile" role="tabpanel" aria-labelledby="ux-tab-profile"${shown('profile')}><h3>个人资料</h3><p class="hint">缺少年龄、性别或活动水平时暂不计算营养目标；无需提供姓名。</p><div class="ux-set-fields">${[['heightCm','身高 cm',100,250],['weightKg','体重 kg',25,400],['age','年龄',10,100]].map(([k,n,min,max])=>`<label>${n}<input class="input" name="${k}" type="number" step="any" min="${min}" max="${max}" value="${val(p[k])}"></label>`).join('')}<label class="span-3">性别<select class="input" name="sex"><option value="">待补充</option>${['男','女'].map(v=>`<option ${p.sex===v?'selected':''}>${v}</option>`).join('')}</select></label><label class="span-3">活动水平<select class="input" name="activity"><option value="">待补充</option>${Object.entries({sedentary:'久坐',light:'轻度',moderate:'中度',active:'高强度'}).map(([k,v])=>`<option value="${k}" ${p.activity===k?'selected':''}>${v}</option>`).join('')}</select></label></div></section>
    <section class="ux-set-section" id="ux-preferences" role="tabpanel" aria-labelledby="ux-tab-preferences"${shown('preferences')}><h3>目标与外观</h3><div class="ux-opt-rows">${row('今日起每日跟练目标（分钟）',`<input class="input ux-set-num" name="target" type="number" min="1" max="600" value="${s.dailyTargetMinutes||15}" required>`)}${row('夜间外观',sw('name="dark"',s.darkMode))}${row('点击音效',sw('name="clickSounds"',s.clickSounds!==false))}${row('关闭窗口后常驻托盘',sw('name="tray"',s.keepInTray))}${row('隐藏窗口时暂停视频',sw('name="autopause"',s.autoPauseOnBlur!==false))}</div><details class="ux-set-history"><summary>历史目标依据</summary><p class="hint">旧资料无法还原历史设置的日期，使用升级时目标作参考值。修改从今日生效。</p>${(Store.db.targetHistory||[]).map(x=>`<p class="ux-set-history-line">${esc(x.from)} 起 ${esc(x.minutes)} 分钟 · ${x.source==='user'?'手动设置':'迁移参考值'}</p>`).join('')}</details></section>
    <section class="ux-set-section" id="ux-reminders" role="tabpanel" aria-labelledby="ux-tab-reminders"${shown('reminders')}><h3>提醒</h3><p class="hint">关闭窗口并常驻时继续提醒；完全退出后不能提醒。空时间代表关闭该类提醒。</p><div class="ux-opt-rows">${row('启用提醒',sw('name="reminders"',s.remindersEnabled!==false))}</div><fieldset class="ux-set-cluster"><legend>记录</legend><div class="ux-set-times">${[['skinLogReminderTime','皮肤记录',s.skinLogReminderTime],['sleepLogReminderTime','睡眠记录',s.sleepLogReminderTime],['eveningReviewTime','晚间复盘',s.eveningReviewTime]].map(([k,n,v])=>timeField(k,n,v)).join('')}</div></fieldset><fieldset class="ux-set-cluster"><legend>护肤与认知时间</legend><div class="ux-set-times">${[['morning','晨间护理',s.skincareTimes?.morning],['noon','日间护理',s.skincareTimes?.noon],['evening','晚间护理',s.skincareTimes?.evening]].map(([k,n,v])=>timeField('care-'+k,n,v)).join('')}</div>${this.watchingSettingsFields()}</fieldset><fieldset class="ux-set-cluster"><legend>勿扰</legend><div class="ux-set-times ux-set-pair">${timeField('quietStart','勿扰开始',s.quietStart)}${timeField('quietEnd','勿扰结束',s.quietEnd)}</div></fieldset><div class="ux-set-inline"><button type="button" class="btn small" id="ux-reminder-list">${icon('alarm')}今日提醒与稍后处理</button><button type="button" class="btn small" id="ux-test-notify">${icon('bolt')}测试通知</button></div></section>
    </form>
    <section class="ux-set-section" id="ux-collections" role="tabpanel" aria-labelledby="ux-tab-collections"${shown('collections')}></section>
    <section class="ux-set-section" id="ux-automation" role="tabpanel" aria-labelledby="ux-tab-automation"${shown('automation')}></section>
    <section class="ux-set-section" id="ux-backup" role="tabpanel" aria-labelledby="ux-tab-backup"${shown('backup')}><h3>数据与备份</h3><p class="ux-set-status" id="ux-backup-status">正在读取备份状态…</p><div class="ux-opt-rows">${row('同时打包本地视频文件（照片与视频合计最多 512 MB）',sw('id="ux-include-videos"',false))}</div><div class="ux-set-actions"><button type="button" class="btn" id="ux-export">${icon('download')}导出完整备份</button><button type="button" class="btn" id="ux-restore">${icon('folder')}检查并恢复备份</button></div><div class="ux-file-list"><button type="button" class="btn ghost ux-file-row" id="ux-media-root">${icon('folder')}打开媒体文件夹</button><button type="button" class="btn ghost ux-file-row" id="ux-photo-folder">${icon('skincare')}皮肤照片</button><button type="button" class="btn ghost ux-file-row" id="ux-body-folder">${icon('bolt')}健身照片</button><button type="button" class="btn ghost ux-file-row" id="ux-video-folder">${icon('video')}跟练视频</button><button type="button" class="btn ghost ux-file-row" id="ux-data-folder">${icon('save')}打开记录目录</button><button type="button" class="btn ghost ux-file-row" id="ux-drafts">${icon('edit')}管理草稿</button></div><p class="hint">照片和视频保存在本机的「皮肤照片」「健身照片」「跟练视频」文件夹；记录数据保存在系统资料目录。完整备份包含各模块记录、照片、视频清单和校验信息；勾选上方选项后还会打包本地视频文件。备份不包含 API 密钥。恢复会替换当前记录，并保留恢复前快照。力量模块的导出只包含力量数据。</p></section>
    <section class="ux-set-section" id="ux-ai" role="tabpanel" aria-labelledby="ux-tab-ai"${shown('ai')}><h3>AI 识图</h3><div class="ux-ai-layout"><p class="hint">手动：点击识图才发送。自动：启用后进入皮肤记录页时发送当天最新照片，每日去重。结果先预填，由你确认保存。服务商：智谱；额度及费用以服务商账户为准。</p><button type="button" class="btn" id="ux-ai-config">${icon('sparkles')}配置模型与安全密钥</button></div></section>
    <div class="ux-set-foot"${['collections','automation'].includes(panel)?' hidden':''}><button class="btn primary ux-settings-save" type="submit" form="ux-settings-form">${icon('save')}保存设置</button></div>
    </div></div></div>`;
    if(typeof Routine!=='undefined')Routine.settings(root);
    const f=$('#ux-settings-form',root);
    f.elements.dark.onchange=()=>document.documentElement.classList.toggle('dark',f.elements.dark.checked);
    f.onsubmit=e=>{e.preventDefault();if(!f.reportValidity()){const bad=f.querySelector(':invalid'),section=bad?.closest('section');if(section)show(section.id.slice(3));requestAnimationFrame(()=>f.reportValidity());return;}
      let watchPlans;try{watchPlans=this.watchingSettingsValues(f);}catch(error){toast(error.message,'red');return;}
      UXCore.changeTarget(Store.db,Number(f.elements.target.value),todayKey());
      Store.db.profile={...p,...Object.fromEntries(['heightCm','weightKg','age'].map(k=>[k,f.elements[k].value===''?null:Number(f.elements[k].value)])),sex:f.elements.sex.value,activity:f.elements.activity.value};
      if(Store.db.strength)Store.db.strength.bmiProfile=UXCore.clone(Store.db.profile);
      const currentSettings=Store.settings();
      Object.assign(currentSettings,{darkMode:f.elements.dark.checked,clickSounds:f.elements.clickSounds.checked,keepInTray:f.elements.tray.checked,autoPauseOnBlur:f.elements.autopause.checked,remindersEnabled:f.elements.reminders.checked,
        enabledModules:Object.keys(this.modules).filter(k=>f.elements['module-'+k].checked)});
      for(const k of ['skinLogReminderTime','sleepLogReminderTime','eveningReviewTime','quietStart','quietEnd'])currentSettings[k]=f.elements[k].value;
      currentSettings.skincareTimes=Object.fromEntries(['morning','noon','evening'].map(k=>[k,f.elements['care-'+k].value]));
      this.saveWatchingSettings(watchPlans);
      Store.db.onboarding={done:true};Store.save(true);toast('设置已保存');App.render();};
    $('#ux-ai-config',root).onclick=()=>Skincare._aiSettingsModal();$('#ux-data-folder',root).onclick=()=>native.openDataFolder();
    $('#ux-media-root',root).onclick=()=>native.openMediaRoot?.();
    $('#ux-photo-folder',root).onclick=()=>native.openPhotoFolder?.('skin');
    $('#ux-body-folder',root).onclick=()=>native.openPhotoFolder?.('body');
    $('#ux-video-folder',root).onclick=()=>native.openVideoFolder?.();
    $('#ux-drafts',root).onclick=()=>Drafts.manage();
    $('#ux-reminder-list',root).onclick=()=>this.reminders();$('#ux-test-notify',root).onclick=async()=>{const r=await native.notify('提醒测试','通知点击将打开今日待办');toast(r?'测试通知已提交':'系统通知不可用');};
    $('#ux-export',root).onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{Store.save(true);const r=await native.exportBackup($('#ux-include-videos',root).checked);if(r.ok)toast(`备份已导出 · ${r.summary.photos} 张照片${r.summary.missing.length?' · 缺失 '+r.summary.missing.length+' 项':''}`);else if(!r.canceled)toast(r.error,'red');}finally{button.disabled=false;}};
    $('#ux-restore',root).onclick=async()=>{const r=await native.inspectBackup();if(r.canceled)return;if(!r.ok)return toast(r.error,'red');const x=r.summary;
      const yes=await confirmModal('检查完整备份',`日期：${x.date}\n格式版本：${x.version}\n训练 ${x.trainingDays} 天 · 睡眠 ${x.sleeps} 条 · 进餐 ${x.meals} 条\n照片 ${x.photos} 张 · 视频 ${x.videos} 个（${x.includeVideos?'包含文件':'只保留引用'}）\n缺失项：${x.missing.join('、')||'无'}\n恢复将替换当前记录，并保留恢复前快照。`,'恢复此备份');
      if(!yes)return;const result=await native.restoreBackup();if(!result.ok)return toast(result.error,'red');Store.db=result.data;UXCore.migrate(Store.db,todayKey());Store.db.rhythm=RhythmEngine.normalize(Store.db.rhythm||{});Store._committed=UXCore.clone(Store.db);Store._failed=null;Session.active=null;App.go('today');toast('已恢复，原数据快照：'+result.before+'。AI 密钥不随备份迁移，需要识图/智能解析请到设置重新配置。');};
    native.backupStatus().then(x=>{const el=$('#ux-backup-status');if(el)el.textContent=`自动备份：${x.scope}；最近成功：${x.lastSuccess||'尚无'}。密钥：${x.key.configured?'已保存在系统安全存储':'未配置'}。`;});
    if(this._settingsScroll){$('#view-root').removeEventListener('scroll',this._settingsScroll);this._settingsScroll=null;}
    const show=key=>{
      if(!nav.some(([k])=>k===key))return;
      this.settingsPanel=key;const foot=$('.ux-set-foot',root);if(foot)foot.hidden=['collections','automation'].includes(key);
      $$('.ux-set-section',root).forEach(section=>{section.hidden=section.id!=='ux-'+key;});
      $$('.ux-set-tab',root).forEach(tab=>tab.setAttribute('aria-selected',tab.id==='ux-tab-'+key?'true':'false'));
    };
    $$('.ux-set-tab',root).forEach(tab=>tab.onclick=()=>show(tab.id.replace('ux-tab-','')));
    $('.ux-set-nav',root).onkeydown=event=>{
      const tabs=[...$$('.ux-set-tab',root)],index=tabs.indexOf(document.activeElement);
      if(index<0||!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='End'?tabs.length-1:event.key==='Home'?0:event.key==='ArrowUp'||event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:(index+1)%tabs.length;
      tabs[next].focus();tabs[next].click();
    };
    show(panel);
    Drafts.bind(root);
  },
  skincare(){
    const view=$('#view-root .view'),date=todayKey();if(!view || $('#ux-sk-tabs'))return;
    const tabs=document.createElement('nav');tabs.className='ux-tabs sk-page-tabs';tabs.id='ux-sk-tabs';tabs.setAttribute('aria-label','护肤栏目');tabs.innerHTML=[['care','今日护理'],['record','皮肤记录'],['photos','照片与趋势']].map(([k,n])=>`<button class="btn small" data-tab="${k}" aria-pressed="false">${n}</button>`).join('');view.prepend(tabs);
    const care=document.createElement('div');care.className='card';care.id='ux-care-now';tabs.after(care);this.updateCareNow(true);
    const show=tab=>{Skincare.ui.tab=tab;for(const el of [...view.children]){if(el===tabs)continue;const k=['sk-skin-today','sk-face-advice'].includes(el.id)?'record':['sk-skin-photos','sk-skin-insight'].includes(el.id)?'photos':'care';el.hidden=k!==tab;}
      $$('[data-tab]',tabs).forEach(b=>{b.classList.toggle('primary',b.dataset.tab===tab);b.setAttribute('aria-pressed',String(b.dataset.tab===tab));});if(tab==='record')Skincare._maybeAutoAnalyze();};
    $$('[data-tab]',tabs).forEach(b=>b.onclick=()=>show(b.dataset.tab));show(Skincare.ui.tab||'care');
    $$('.sk-seg button').forEach(b=>{b.dataset.noIcon='true';});
    const list=Skincare._photoList(Skincare.ui.skinPhotoKind||'skin');
    const btn=document.createElement('button');btn.className='btn small ghost';btn.textContent='角度、基准与对齐比较';btn.onclick=()=>this.photoCompare(list);$('#sk-photo-overview')?.after(btn);
    const source=document.createElement('details');source.className='ux-source';source.innerHTML=`<summary>评分来源与缺失项</summary><p>来源：${Store.db.skin.logs[date]?.source==='ai'?'AI 识别后人工确认':'手动记录'} · ${date} · 规则版本 1。缺失项：${SkinEngine.PARAMS.filter(p=>!Number.isInteger(Store.db.skin.logs[date]?.[p.key])).map(p=>p.label).join('、')||'无'}。估算字段仅用于参考，未写回实测记录。</p>`;$('#sk-skin-today .card')?.appendChild(source);
  },
  carePhase(now = nowMinutes()){
    const times=Store.settings().skincareTimes||{};
    return DailyPlanCore.phase({morning:times.morning??'09:00',day:times.noon??'12:00',evening:times.evening??'20:00'},now);
  },
  updateCareNow(force=false){
    const care=$('#ux-care-now');if(!care||!Store.db)return;
    const automatic=Store.settings().careAutoSwitch!==false,date=todayKey(),current=Store.activeCycle();
    const scheduled=typeof Routine!=='undefined'&&['snapshot','care'].includes(Routine.active?.stage)?Routine.active.period:this.carePhase();
    if(automatic&&(this.careScheduled!==scheduled||this.careDate!==date))this.careManualPhase=null;
    this.careScheduled=scheduled;this.careDate=date;
    const phase=this.careManualPhase||(automatic?scheduled:this.careShownPhase||scheduled);
    const steps=current?.steps?.[phase]||[],done=Store.daySkincare(date)[phase]||[];
    const signature=JSON.stringify([date,current?.id,phase,steps,done,automatic]);if(!force&&care.dataset.signature===signature)return;
    care.dataset.signature=signature;this.careShownPhase=phase;this.careUndo=null;
    const labels={morning:'晨间',day:'日间',evening:'晚间'};
    care.innerHTML=`<div class="soft-care-heading"><h3>当前：${labels[phase]}护理</h3><div class="soft-care-meta"><label class="soft-care-auto"><input type="checkbox" id="soft-care-auto"${automatic?' checked':''}>到点自动切换</label><div class="soft-segments" aria-label="护理时段">${Object.entries(labels).map(([key,name])=>`<button type="button" data-care-phase="${key}" data-no-icon="true" aria-pressed="${key===phase}">${name}</button>`).join('')}</div></div></div><div class="ux-care-steps"></div><div class="ux-actions"><button class="btn primary" id="ux-care-all">本时段全部完成</button><button class="btn ghost" id="ux-care-undo" disabled>撤销刚才操作</button><button class="btn" id="ux-care-add">添加步骤</button></div>`;
    const draw=()=>{const checked=Store.daySkincare(date)[phase]||[];$('.ux-care-steps',care).innerHTML=steps.length?steps.map((x,i)=>`<button class="btn ${checked.includes(x.id)?'green':''}" data-id="${esc(x.id)}">${checked.includes(x.id)?'✓ ':''}${i+1}. ${esc(x.name)}${x.detail?' · '+esc(x.detail):''}</button>`).join(''):'<p class="hint">这个时段还没有护理步骤，可以添加。</p>';$$('[data-id]',care).forEach(b=>b.onclick=()=>{this.careUndo=[...checked];Store.toggleSkincareStep(date,phase,b.dataset.id);Store.save(true);draw();$('#ux-care-undo',care).disabled=false;});$('#ux-care-all',care).disabled=!steps.length;care.dataset.signature=JSON.stringify([date,current?.id,phase,steps,checked,automatic]);};draw();
    $('#ux-care-all',care).onclick=()=>{this.careUndo=[...(Store.daySkincare(date)[phase]||[])];Store.db.logs.skincare[date]||={morning:[],day:[],evening:[]};Store.db.logs.skincare[date][phase]=steps.map(x=>x.id);Store.save(true);draw();$('#ux-care-undo',care).disabled=false;};
    $('#ux-care-undo',care).onclick=()=>{if(this.careUndo===null)return;Store.db.logs.skincare[date][phase]=this.careUndo;Store.save(true);draw();this.careUndo=null;$('#ux-care-undo',care).disabled=true;};
    $('#ux-care-add',care).onclick=()=>Skincare.quickAddModal(phase,()=>App.render());
    $$('[data-care-phase]',care).forEach(b=>b.onclick=()=>{this.careManualPhase=b.dataset.carePhase;this.updateCareNow(true);});
    $('#soft-care-auto',care).onchange=async e=>{Store.settings().careAutoSwitch=e.target.checked;await Store.save(true);this.careManualPhase=null;this.updateCareNow(true);};
  },
  strengthSets(){
    const box=$('#st-today');if(!box)return;const day=Store.db.strength?.days?.[Strength.ui.date||Core.businessDate()];
    if(!day||day.isRest)return;
    const row=document.createElement('div');row.className='ux-actions';row.id='ux-set-mode';row.innerHTML='<button class="btn small" id="ux-set-open">逐组记录</button><span class="hint">汇总模式保留；逐组重量与次数独立保存。</span>';$('h3',box).after(row);
    $('#ux-set-open',row).onclick=()=>this.setEditor(day);
  },
  setEditor(day){
    if(['completed','skipped'].includes(day.status)){toast('该记录已收尾，请先在训练历史中重开后修改');return;}
    const c=openModal(`<h3>逐组记录 · ${esc(day.name)}</h3><p class="hint">只有点“完成本组”才计入统计；带入的计划和上次数据只是待确认值。已带入计划或上次保存值，用箭头调整重量与次数。</p><div id="ux-set-actions"></div><button class="btn" id="ux-set-close">关闭并保留草稿</button>`);
    /* 负重文本与汇总表格同一口径：Core.resolveWeightInput 把「自重」折算成 0，做了却没填也记 0，没做的行记 null */
    const wText=(v)=>v===0?'自重':(v===undefined||v===null?'':String(v));
    const wRead=(r)=>Core.resolveWeightInput($('[data-field=weight]',r).value,Number($('[data-field=reps]',r).value||0)>0);
    const render=()=>{const rows=$('#ux-set-actions',c);rows.innerHTML=day.actions.map((a,ai)=>{
      const baseline=Core.trainingBaseline(Store.db.strength,a,day.date),prior=baseline.sets;
      const sets=a.sets||Array.from({length:Math.max(1,baseline.setsDone||a.plannedSets||1)},(_,i)=>({weightKg:prior?.[i]?.weightKg??baseline.weightKg,reps:prior?.[i]?.reps??Number(String(baseline.repsText).match(/\d+/)?.[0]||0),done:false}));
      return `<section class="ux-set-action" data-action="${ai}"><h4>${esc(a.name)}</h4>${!a.sets&&a.setsDone!=null?'<p class="hint">已有汇总记录，未拆成逐组事实。首次保存逐组数据将替换该动作汇总。</p>':''}<div class="ux-actions"><button class="btn small" data-fill="plan">按计划带入</button><button class="btn small" data-fill="last">沿用上次实际</button></div>${sets.map((s,si)=>`<div class="ux-set-row" data-set="${si}"><span>第 ${si+1} 组</span><label>kg<input class="input" type="text" inputmode="decimal" maxlength="12" autocomplete="off" spellcheck="false" data-field="weight" value="${esc(wText(s.weightKg))}" placeholder="自重" title="填数字（kg）；自重留空或写「自重」"></label><label>次数<input class="input" type="number" min="0" max="999" data-field="reps" value="${s.reps??0}"></label><button class="btn small ${s.done?'green':'primary'}" data-done="${s.done}">${s.done?'撤销完成':'完成本组'}</button></div>`).join('')}</section>`;}).join('');
      $$('.ux-set-action',rows).forEach(el=>{
        const a=day.actions[Number(el.dataset.action)];
        $$('[data-fill]',el).forEach(b=>b.onclick=()=>{const last=Core.lastActual(Store.db.strength,a.name,day.date)?.action;const source=b.dataset.fill==='last'?last:a;if(!source)return toast('没有上次实际记录');
          $$('.ux-set-row',el).forEach((r,i)=>{if($('[data-done]',r).dataset.done==='true')return;const saved=source.sets?.[i];const pw=Core.parseWeightInput(source.plannedWeightText);const planVal=pw.ok?pw.value:((String(source.plannedWeightText||'').match(/[0-9.]+/)||[])[0]??null);const w=saved&&saved.weightKg!==undefined&&saved.weightKg!==null?saved.weightKg:(b.dataset.fill==='last'?source.weightKg:planVal);$('[data-field=weight]',r).value=wText(w);$('[data-field=reps]',r).value=saved?.reps??(String(b.dataset.fill==='last'?source.repsText:source.plannedRepsText).match(/\d+/)||[])[0]??'';});Drafts.capture(c);});
        $$('[data-done]',el).forEach(b=>b.onclick=async()=>{const parsed=$$('.ux-set-row',el).map(wRead);const bad=parsed.find(p=>!p.ok);if(bad)return toast(bad.error,'red');const sets=$$('.ux-set-row',el).map((r,k)=>({weightKg:parsed[k].value,reps:Number($('[data-field=reps]',r).value),done:$('[data-done]',r).dataset.done==='true'}));const index=Number(b.closest('[data-set]').dataset.set);sets[index].done=!sets[index].done;
          if(!UXCore.validSets(sets)||sets[index].done&&sets[index].reps<1)return toast('请填写有效次数和重量','red');
          if(!a.sets&&a.setsDone!=null&&!await confirmModal('替换此动作的汇总？','已有汇总无法准确拆组。保存这次逐组记录后，统计改用已完成组。','使用逐组记录'))return;
          const next=sets[index+1];if(sets[index].done&&next&&!next.done&&next.reps===0){next.reps=sets[index].reps;next.weightKg=sets[index].weightKg;}
          const r=Core.saveTraining(Store.db.strength,{date:day.date,actions:[{actionKey:a.actionKey,sets,...UXCore.setSummary(sets)}]});if(!r.ok)return toast(r.error||r,'red');Store.save(true);
          render();Drafts.clear(c);});
      });Drafts.bind(c);SoftControls.bind(c);
    };render();$('#ux-set-close',c).onclick=closeModal;
  },
  async photoCompare(list){
    if(!list.length)return toast('先添加照片');const angles={unknown:'未标注',front:'正面',left:'左侧',right:'右侧'};
    let base=list.find(x=>x.id===Store.db.skin.comparison?.baseId)||list[0],other=list.find(x=>x.id!==base.id&&(x.angle||'unknown')===(base.angle||'unknown'))||list.find(x=>x.id!==base.id)||base;
    const c=openModal(`<h3>照片对齐比较</h3><p class="hint">原图保持不变。优先选择同类别、同角度、同光线照片。缩放和平移同步作用于两张照片。</p><div class="ux-fields"><label>基准照片<select class="input" id="ux-photo-a"></select></label><label>对比照片<select class="input" id="ux-photo-b"></select></label><label>基准角度<select class="input" id="ux-angle">${Object.entries(angles).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></label></div><p id="ux-photo-dates"></p><div class="ux-photo-compare"><div><img id="ux-img-a" alt="基准照片"></div><div><img id="ux-img-b" alt="对比照片"></div></div><div class="ux-fields"><label>同步缩放<input id="ux-photo-scale" type="range" min="1" max="4" step=".05" value="1"></label><label>水平平移<input id="ux-photo-x" type="range" min="-200" max="200" value="0"></label><label>垂直平移<input id="ux-photo-y" type="range" min="-200" max="200" value="0"></label><label>叠加透明度<input id="ux-photo-opacity" type="range" min="0" max="1" step=".05" value=".5"></label></div><label><input type="checkbox" id="ux-photo-sync" checked>同步调整两张（取消后只调整对比照）</label><label><input type="checkbox" id="ux-photo-overlay">透明叠加</label><button class="btn" id="ux-photo-reset">重置对齐</button><button class="btn primary" id="ux-photo-save">保存角度与比较设置</button>`);
    for(const [id,v]of [['ux-photo-a',base],['ux-photo-b',other]]){$('#'+id,c).innerHTML=list.map(x=>`<option value="${esc(x.id)}" ${x.id===v.id?'selected':''}>${x.date} · ${angles[x.angle||'unknown']} · ${esc(x.id.slice(-5))}</option>`).join('');}
    const prior=Store.db.skin.comparison||{};for(const k of ['scale','x','y','opacity'])if(prior[k]!=null)$('#ux-photo-'+k,c).value=prior[k];
    let generation=0;
    const load=async()=>{const gen=++generation;base=list.find(x=>x.id===$('#ux-photo-a',c).value);other=list.find(x=>x.id===$('#ux-photo-b',c).value);$('#ux-angle',c).value=base.angle||'unknown';$('#ux-photo-dates',c).textContent=`${base.date} → ${other.date} · 相隔 ${Math.abs(daysBetween(base.date,other.date))} 天${base.id===other.id?' · 当前只有同一张照片':''}`;
      for(const [id,p]of [['ux-img-a',base],['ux-img-b',other]]){const img=$('#'+id,c);img.removeAttribute('src');const b64=await native.readSkinPhoto(p.file,p.kind);if(gen!==generation)return;img.alt=b64?p.date:'照片无法读取';if(b64){const lower=String(p.file).toLowerCase();img.src=`data:image/${lower.endsWith('.png')?'png':lower.endsWith('.webp')?'webp':'jpeg'};base64,${b64}`;} }};
    const transform=()=>{const v=k=>$('#ux-photo-'+k,c).value;for(const img of ($('#ux-photo-sync',c).checked?$$('.ux-photo-compare img',c):[$('#ux-img-b',c)]))img.style.transform=`translate(${v('x')}px,${v('y')}px) scale(${v('scale')})`;$('.ux-photo-compare',c).classList.toggle('overlay',$('#ux-photo-overlay',c).checked);$('#ux-img-b',c).style.opacity=$('#ux-photo-overlay',c).checked?v('opacity'):1;};
    $('#ux-photo-a',c).onchange=()=>{base=list.find(x=>x.id===$('#ux-photo-a',c).value);const match=list.find(x=>x.id!==base.id&&(x.angle||'unknown')===(base.angle||'unknown'));if(match)$('#ux-photo-b',c).value=match.id;load();};$('#ux-photo-b',c).onchange=load;
    $$('input',c).forEach(x=>x.oninput=transform);$('#ux-photo-reset',c).onclick=()=>{for(const [k,v]of Object.entries({scale:1,x:0,y:0,opacity:.5}))$('#ux-photo-'+k,c).value=v;transform();};
    $('#ux-photo-save',c).onclick=()=>{base.angle=$('#ux-angle',c).value;Store.db.skin.comparison={baseId:base.id,otherId:other.id,baseTransform:$('#ux-img-a',c).style.transform,...Object.fromEntries(['scale','x','y','opacity'].map(k=>[k,Number($('#ux-photo-'+k,c).value)]))};Store.save(true);toast('角度和比较设置已保存');};await load();transform();if(prior.baseTransform)$('#ux-img-a',c).style.transform=prior.baseTransform;
  },
  async syncFolderVideos(manual){
    /* 文件夹投放沿用原瘦脸库；自定义板块须由用户明确导入。 */
    if(Store.currentMode()!=='face')return;
    if(!native.listNewVideos || this._syncingVideos) return;
    this._syncingVideos=true;
    try{
      const known=[...(Store.db.videos||[]).filter(v=>v.source==='local').map(v=>v.localPath),...(Store.db.videoFolderExclusions||[])];
      const listed=await native.listNewVideos(known);
      if(!listed||!listed.length){if(manual)toast('跟练视频文件夹里没有尚未登记的文件');return;}
      let n=0;
      for(const item of listed){
        if(known.includes(item.path)||(Store.db.videos||[]).some(v=>v.localPath===item.path)) continue;
        Store.addVideo({id:uid('vid'),source:'local',localPath:item.path,title:item.name,addedAt:new Date().toISOString()},'face');
        n++;
      }
      if(n){Store.save(true);toast(`已从文件夹读入 ${n} 个视频 ✓`,'green');App.render();}
    }catch{if(manual)toast('读取视频文件夹失败','red');}
    finally{this._syncingVideos=false;}
  },
  videoLibrary(box){
    const mode=Store.currentMode(),videos=Store.videosForMode(mode);
    const bar=document.createElement('div');bar.className='ux-actions';bar.innerHTML='<input class="input" id="ux-video-search" placeholder="搜索视频标题"><label><input type="checkbox" id="ux-favorites">只看收藏</label><select class="input" id="ux-video-sort"><option value="recent">最近使用</option><option value="added">最近导入</option></select>'+(mode==='face'?'<button class="btn small" id="ux-open-videos">打开跟练视频文件夹</button><button class="btn small ghost" id="ux-scan-videos">读取文件夹里的新视频</button>':'');$('#td-vids',box).before(bar);
    if(mode==='face'){
      $('#ux-open-videos',bar).onclick=async()=>{const r=await native.openVideoFolder?.();if(r?.error)toast('无法打开「跟练视频」文件夹：'+(r.path||''),'red');else toast('已打开跟练视频文件夹');};
      $('#ux-scan-videos',bar).onclick=()=>this.syncFolderVideos(true);
      this.syncFolderVideos(false);
    }
    const apply=()=>{const query=$('#ux-video-search',bar).value.toLowerCase(),favorites=$('#ux-favorites',bar).checked;const order=$('#ux-video-sort',bar).value;
      $$('.vid-card',box).forEach(card=>{const v=Store.videoById(card.dataset.video);card.hidden=!v||!v.title.toLowerCase().includes(query)||(favorites&&!v.favorite);card.style.order=String(-Math.floor(Date.parse(order==='recent'?(v?.lastUsedAt||v?.addedAt):v?.addedAt)||0)/1000);});};
    $$('.vid-card',box).forEach((card,i)=>{const v=Store.videoById(card.dataset.video)||videos[i];if(!v)return;card.dataset.video=v.id;const actions=document.createElement('div');actions.className='ux-video-controls';actions.innerHTML=`<button class="btn small ghost">${v.favorite?'取消收藏':'收藏'}</button>${v.source==='local'?'<button class="btn small ghost" data-relocate>重新定位文件</button>':''}<small>${v.playbackVerified?'曾成功读取播放状态':'已加入引用；播放可用性待实际验证'}</small>`;card.appendChild(actions);$('button',actions).onclick=e=>{e.stopPropagation();v.favorite=!v.favorite;Store.save(true);e.currentTarget.textContent=v.favorite?'取消收藏':'收藏';apply();};
      if(v.source==='local')native.videoExists(v.localPath).then(exists=>{if(!exists&&card.isConnected)$('small',actions).textContent='文件已移动或无法读取，请重新定位';});
      const relocate=$('[data-relocate]',actions);if(relocate)relocate.onclick=async e=>{e.stopPropagation();const r=await native.pickLocalVideo();if(!r)return;if(!/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(r.path))return toast('请选择视频文件','red');v.localPath=r.path;Store.rememberVideoPath(v);v.playbackVerified=false;Store.save(true);toast('已更新文件位置，计划和历史绑定保留');};});
    $$('input,select',bar).forEach(x=>x.oninput=apply);apply();
  },
  async importVideos(mode=Store.currentMode()){
    const collection=Store.collectionById(mode);if(!collection)return;
    const c=openModal(`<h3>批量导入视频 · ${esc(collection.name)}</h3><p class="hint">视频将加入「${esc(collection.name)}」。每行一个链接，可一次导入多个；抖音 App 的分享口令可整段粘贴，会自动提取链接并下载到本地，下载完成后可直接观看。</p><textarea class="textarea" id="ux-import-text" placeholder="每行一个 B 站链接 / BV / av 号（可带 ?p=分P），或抖音视频链接 / 分享口令"></textarea><div class="ux-actions"><button class="btn primary" id="ux-import-go">开始导入</button><button class="btn" id="ux-import-retry">仅重试失败项</button><button class="btn" id="ux-import-local">本地视频</button><button class="btn ghost" id="ux-import-cancel">取消剩余导入</button></div><div id="ux-import-results" role="status"></div>`);
    c.dataset.draftObject='video-import:'+mode;
    let rows=[],cancel=false,busy=false;const token=uid('import');c.dataset.importToken=token;c._onClose=()=>{cancel=true;};const draw=()=>{const results=$('#ux-import-results',c);if(!results||c.dataset.importToken!==token)return;results.innerHTML=rows.map(r=>`<p>${esc(r.text)} · <b>${esc(r.status)}</b>${r.reason?' · '+esc(r.reason):''}</p>`).join('');};
    const run=async retry=>{if(busy)return;busy=true;cancel=false;$('#ux-import-go',c).disabled=true;
      if(!retry)rows=$('#ux-import-text',c).value.split(/\n/).map(x=>x.trim()).filter(Boolean).map(text=>({text,status:'等待'}));
      try{for(const row of rows){if(retry&&row.status!=='失败')continue;if(cancel){if(row.status==='等待')row.status='已取消';continue;}const p=VideoLink.parse(row.text);if(!p){row.status='失败';row.reason='无法识别链接';draw();continue;}
        if(p.source==='douyin'){
          const exist=Store.videosForMode(mode).find(v=>Douyin.matches(v,p));
          if(exist?.source==='local' && await native.videoExists(exist.localPath)){row.status='重复';row.reason='已下载到本地，可直接观看';draw();continue;}
          row.status='下载中';row.reason='正在解析并下载到本地';draw();
          try {
            await Douyin.importLocal(p,mode,d=>{row.reason='下载中 '+(d.total?Math.floor(d.received/d.total*100)+'%':(d.received/1048576).toFixed(1)+' MB');draw();});
            row.status='成功';row.reason='已下载到本地，点击视频即可观看';
          } catch(e) {row.status='失败';row.reason=e.message||'下载失败，请重试';}
          draw();continue;
        }
        if(Store.videosForMode(mode).some(v=>(p.bvid?v.bvid===p.bvid:v.aid===p.aid)&&(v.page||1)===p.page)){row.status='重复';draw();continue;}
        row.status='获取资料中';draw();const info=await native.fetchBilibiliInfo(p.bvid||'av'+p.aid);if(cancel){row.status='已取消';draw();continue;}
        if(!info?.ok){row.status='失败';row.reason=info?.error||'资料获取失败';draw();continue;}
        const page=info.pages?.find(x=>x.page===p.page);if(p.page>1&&!page){row.status='失败';row.reason='分 P 不存在或资料不完整';draw();continue;}
        const v={id:uid('vid'),source:'bilibili',...p,cid:page?.cid||info.cid,title:page?.part?info.title+' · '+page.part:info.title,pic:info.pic,durationSec:page?.duration||info.durationSec,addedAt:new Date().toISOString(),playbackVerified:false};
        try{Store.addVideo(v,mode);Store.save(true);row.status='成功';row.reason='已加入'+collection.name;}catch(e){row.status='失败';row.reason=e.message||'保存失败，可重试';}draw();}
      }finally{busy=false;const button=$('#ux-import-go',c);if(button&&c.dataset.importToken===token)button.disabled=false;draw();if(!Store._failed)App.render();}};
    $('#ux-import-go',c).onclick=()=>run(false);$('#ux-import-retry',c).onclick=()=>run(true);$('#ux-import-cancel',c).onclick=()=>{cancel=true;};
    $('#ux-import-local',c).onclick=async()=>{const r=await native.pickLocalVideo();if(!r||cancel)return;try{Store.addVideo({id:uid('vid'),source:'local',localPath:r.path,title:r.name,addedAt:new Date().toISOString()},mode);Store.save(true);rows.push({text:r.name,status:'成功',reason:'已加入'+collection.name});draw();App.render();}catch(e){toast(e.message,'red');}};
  },
  async reminders(){
    const rows=await native.reminderList();const c=openModal(`<h3>今日提醒</h3><p class="hint">已完成任务不再提醒；“今天跳过”不等于完成。</p><div id="ux-reminder-rows"></div>`);
    $('#ux-reminder-rows',c).innerHTML=rows.length?rows.map((x,i)=>`<div class="ux-reminder-row"><b>${esc(x.time)} · ${esc(x.title)}</b><small>${esc(x.state||'待处理')}</small><button class="btn small" data-i="${i}" data-act="now">现在做</button><button class="btn small" data-i="${i}" data-act="later">10 分钟后</button><button class="btn small ghost" data-i="${i}" data-act="skip">今天跳过</button></div>`).join(''):'<p>今天没有待提醒事项。</p>';
    $$('[data-act]',c).forEach(b=>b.onclick=async()=>{const x=rows[Number(b.dataset.i)],act=b.dataset.act;if(act==='now'){closeModal();if(x.sessionId)App.onReminded(x.sessionId);else{if(x.view==='skincare')Skincare.ui.tab=x.kind==='skin'?'record':'care';if(x.collectionId)App.goCollection(x.collectionId);else App.go(x.view||'today');}}else{await native.reminderAction(x.id,act);Store.db.reminderActions=(await native.loadData()).reminderActions;closeModal();this.reminders();}});
  }
};

const Drafts={
  prefix:'face-draft-v1:',bindings:new WeakMap(),restoring:false,
  scopeKey(scope){const modal=scope.id==='modal-card';const heading=$('h3',scope)?.textContent||'';const view=App.currentView==='awakening'?App.currentView+':'+Store.currentMode():App.currentView;const date=App.currentView==='nutrition'?(Rhythm.selectedDay||todayKey()):App.currentView==='strength'?(Strength.ui.date||todayKey()):todayKey();return this.prefix+view+':'+date+':'+(modal?heading:'page')+':'+(scope.dataset?.draftObject||(App.currentView==='nutrition'?Rhythm.sleepEditId||Rhythm.formSleepId:'')||'new')+':'+(modal?this.signature(scope):'');},
  fields(scope){return $$('input,textarea,select',scope).filter(x=>!x.matches('[data-growth-done],.growth-report-text')&&(!['password','file','hidden'].includes(x.type)||x.hasAttribute('data-draft-value'))&&!['rh-date','rh-range','st-tpl-select','ux-home-video-select'].includes(x.id));},
  fingerprint(scope){
    if(!Store.db)return '';if(/导入|记一餐|记昨晚/.test($('h3',scope)?.textContent||''))return '';
    const d=App.currentView==='nutrition'?Rhythm.selectedDay||todayKey():App.currentView==='strength'?Strength.ui.date||todayKey():todayKey();
    const value=App.currentView==='skincare'?Store.db.skin?.logs?.[d]:App.currentView==='strength'?{day:Store.db.strength?.days?.[d],template:Strength.ui.tplEditId}:App.currentView==='nutrition'?{meals:Store.db.rhythm.meals.filter(x=>x.local?.startsWith(d)),sleeps:Store.db.rhythm.sleeps.filter(x=>x.endLocal?.startsWith(d))}:App.currentView==='plan'?Store.db.sessions:App.currentView==='settings'?{profile:Store.db.profile,settings:Store.settings()}:null;
    return JSON.stringify(value)||'';
  },
  signature(scope){return this.fields(scope).map(x=>[x.tagName,x.id,x.name,x.type,x.dataset.idx,x.dataset.key].join('/')).join('|');},
  bind(scope){if(!scope)return;const signature=this.signature(scope),key=this.scopeKey(scope),current=this.bindings.get(scope);if(current?.key===key&&current?.signature===signature)return;
    this.bindings.set(scope,{key,signature,dirty:false,base:this.fingerprint(scope)});let d;try{d=JSON.parse(localStorage.getItem(key)||'null');}catch{}
    if(d&&d.base!==undefined&&d.base!==this.fingerprint(scope)){const note=document.createElement('p');note.className='hint ux-draft-hint';note.textContent='原记录已更新或删除，旧草稿未自动覆盖。可在设置 → 管理草稿中查看。';scope.prepend(note);return;}
    if(UXCore.draftCompatible(d,signature)){this.restoring=true;this.fields(scope).forEach((x,i)=>{const v=d.values[i];if(!v)return;if(['checkbox','radio'].includes(x.type))x.checked=v.checked;else x.value=v.value;});for(const [param,val]of Object.entries(d.segments||{}))$$(`.sk-seg[data-param="${param}"] button`,scope).forEach(b=>b.classList.toggle('on',b.dataset.v===val));if(d.weekdays)$$('#sm-days [data-d]',scope).forEach(x=>x.classList.toggle('on',d.weekdays.includes(x.dataset.d)));this.restoring=false;this.bindings.get(scope).dirty=true;
      const hint=document.createElement('p');hint.className='hint ux-draft-hint';hint.textContent='已恢复未提交草稿 · '+new Date(d.updatedAt).toLocaleString();scope.prepend(hint);}
    const initial=this.snapshot(scope);this.bindings.get(scope).initial=JSON.stringify(initial);
  },
  snapshot(scope){return {weekdays:$$('#sm-days .on',scope).map(x=>x.dataset.d),values:this.fields(scope).map(x=>({value:x.value,checked:x.checked})),segments:Object.fromEntries($$('.sk-seg',scope).map(x=>[x.dataset.param,$('button.on',x)?.dataset.v]))};},
  capture(scope){if(!scope||this.restoring)return;let b=this.bindings.get(scope);if(!b){this.bind(scope);b=this.bindings.get(scope);}if(!b||this.signature(scope)!==b.signature)return;
    const snap=this.snapshot(scope);if(!b.dirty&&JSON.stringify(snap)===b.initial)return;b.dirty=true;try{localStorage.setItem(b.key,JSON.stringify({version:1,signature:b.signature,base:b.base,updatedAt:Date.now(),...snap}));}catch{toast('草稿无法保存，请先提交当前填写','red');}
  },
  clear(scope){if(!scope)return;const actual=scope.closest?.('#modal-card')||scope.closest?.('#view-root')||scope,b=this.bindings.get(actual);if(b){localStorage.removeItem(b.key);b.dirty=false;b.initial=JSON.stringify(this.snapshot(actual));}$('.ux-draft-hint',actual)?.remove();},
  boot(){for(const type of ['input','change'])document.addEventListener(type,e=>{if(e.target.type==='password')return;this.capture(e.target.closest('#modal-card')||$('#view-root'));if(App.currentView==='strength'&&Strength.ui.tplDirty&&Strength.ui.tplDraft){localStorage.setItem(this.prefix+'template-model:'+ (Strength.ui.tplEditId||'current'),JSON.stringify({updatedAt:Date.now(),draft:Strength.ui.tplDraft}));}});document.addEventListener('click',e=>{if(e.target.closest('.sk-seg,#sm-days'))this.capture(e.target.closest('#modal-card')||$('#view-root'));});window.addEventListener('beforeunload',()=>{this.capture($('#view-root'));if(!$('#modal-mask').classList.contains('hidden'))this.capture($('#modal-card'));});},
  manage(){const keys=Object.keys(localStorage).filter(k=>k.startsWith(this.prefix));const c=openModal(`<h3>未提交草稿</h3><p class="hint">草稿不计入统计。超过 30 天或表单版本变更的草稿不自动恢复，可在此检查后删除。</p>${keys.map((k,i)=>`<details><summary>${esc(k.slice(this.prefix.length))}</summary><pre>${esc(localStorage.getItem(k))}</pre><button class="btn danger" data-key="${i}">放弃这个草稿</button></details>`).join('')||'<p>没有未提交草稿</p>'}`);$$('[data-key]',c).forEach(b=>b.onclick=()=>{localStorage.removeItem(keys[Number(b.dataset.key)]);b.closest('details').remove();});}
};

// One modal stack retains live nodes and listeners when a confirmation is nested.
const ModalUX={stack:[],returnFocus:null};
openModal=function(html){
  const mask=$('#modal-mask'),card=$('#modal-card');
  if(!mask.classList.contains('hidden')){Drafts.capture(card);ModalUX.stack.push({nodes:[...card.childNodes],binding:Drafts.bindings.get(card),focus:document.activeElement,draftObject:card.dataset.draftObject,onClose:card._onClose});}
  else ModalUX.returnFocus=document.activeElement;
  card._onClose=null;card.dataset.draftObject='';card.replaceChildren();card.innerHTML=html;Drafts.bindings.delete(card);mask.classList.remove('hidden');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label',$('h3',card)?.textContent||'编辑');card.tabIndex=-1;
  const controls=document.createElement('div');controls.className='ux-modal-controls';controls.innerHTML='<button class="btn small ghost" type="button" id="ux-discard-draft">放弃本次草稿</button><button class="btn small ghost" type="button" id="ux-close-modal" aria-label="关闭并保留草稿">关闭</button>';card.prepend(controls);
  $('#ux-close-modal',card).onclick=()=>closeModal();$('#ux-discard-draft',card).onclick=()=>{Drafts.clear(card);closeModal(true);};
  mask.onclick=e=>{if(e.target===mask)closeModal();};
  queueMicrotask(()=>{Drafts.bind(card);SoftControls.bind(card);(Array.from(card.querySelectorAll('input:not([type=hidden]):not([type=file]),textarea,select,button')).find(x=>!x.closest('.ux-modal-controls')&&!x.disabled)||card).focus();});return card;
};
closeModal=function(discard=false){
  const mask=$('#modal-mask'),card=$('#modal-card');if(mask.classList.contains('hidden'))return;
  if(discard!==true)Drafts.capture(card);else Drafts.clear(card);
  const onClose=card._onClose;card._onClose=null;if(onClose)onClose();
  if(ModalUX.stack.length){const previous=ModalUX.stack.pop();card.replaceChildren(...previous.nodes);card._onClose=previous.onClose;card.dataset.draftObject=previous.draftObject||'';if(previous.binding)Drafts.bindings.set(card,previous.binding);card.setAttribute('aria-label',$('h3',card)?.textContent||'编辑');previous.focus?.focus();return;}
  mask.classList.add('hidden');card.replaceChildren();Drafts.bindings.delete(card);(ModalUX.returnFocus?.isConnected?ModalUX.returnFocus:document.querySelector('.nav-item.active'))?.focus();
};
document.addEventListener('keydown',e=>{
  const mask=$('#modal-mask'),card=$('#modal-card');if(!mask||mask.classList.contains('hidden')||e.isComposing)return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeModal();return;}
  if(e.key==='Tab'){const fields=$$('button,input,select,textarea,a[href],[tabindex="0"]',card).filter(x=>!x.disabled&&x.offsetParent);const first=fields[0],last=fields.at(-1);if(!fields.length){e.preventDefault();card.focus();}else if(!card.contains(document.activeElement)){e.preventDefault();first.focus();}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
},true);

const originalRender=App.render.bind(App),originalGo=App.go.bind(App),originalBoot=App.boot.bind(App);
App.render=function(){App._uxRenderEpoch=(App._uxRenderEpoch||0)+1;Drafts.capture($('#view-root'));Drafts.bindings.delete($('#view-root'));originalRender();UX.afterRender();};
App.go=function(view){Drafts.capture($('#view-root'));originalGo(view);};
App.boot=async function(){await originalBoot();UX.boot();if(typeof Routine!=='undefined')Routine.boot();if(Store.db.activeFollow && Store.videoById(Store.db.activeFollow.videoId)){Session.active={...Store.db.activeFollow,mode:Store.videoMode(Store.videoById(Store.db.activeFollow.videoId)),running:false,awaitingPlay:!!Store.db.activeFollow.awaitingPlay,autoPausedBy:'restore'};App.followVideoId=Session.active.videoId;App.render();}};
Views.importModal=mode=>UX.importVideos(mode);

/* 会话记账的时段归属（E：早晚分账）。addWatchingEntry 是所有会话入账的唯一入口：
   自动流程到点的会话按流程时段，首页「早上/晚上」槽位视图里开始的会话按所选时段；
   其余不标记，由 Store 按 entry.start 推断。this 透传，兼容实例化的 Store。 */
const baseAddWatchingEntry=Store.addWatchingEntry;
Store.addWatchingEntry=function(dateStr,entry,mode){
  try{
    if(entry&&typeof entry==='object'&&entry.period!=='morning'&&entry.period!=='evening'){
      const routinePeriod=typeof Routine!=='undefined'&&Routine.active&&['morning','evening'].includes(Routine.active.period)?Routine.active.period:null;
      const viewPeriod=['morning','evening'].includes(UX.facePeriod)?UX.facePeriod:null;
      const period=routinePeriod||viewPeriod;
      if(period)entry.period=period;
    }
  }catch{}
  return baseAddWatchingEntry.call(this,dateStr,entry,mode);
};

confirmModal=function(title,body,okText,cancelText){return new Promise(resolve=>{
  const c=openModal(`<h3>${esc(title)}</h3><p class="hint" style="white-space:pre-line">${esc(body)}</p><div class="ux-actions"><button class="btn ghost" id="m-cancel">${esc(cancelText||'取消')}</button><button class="btn primary" id="m-ok">${esc(okText||'确定')}</button></div>`);
  c._onClose=()=>resolve(false);$('#m-ok',c).onclick=()=>{c._onClose=null;closeModal();resolve(true);};$('#m-cancel',c).onclick=()=>closeModal();
});};

const originalTemplateView=Strength._templateView.bind(Strength),originalSaveTemplate=Strength._saveTemplate.bind(Strength);
Strength._templateView=function(state){
  if(!this.ui.tplDraft){try{const d=JSON.parse(localStorage.getItem(Drafts.prefix+'template-model:'+(this.ui.tplEditId||'current'))||'null');if(d&&Date.now()-d.updatedAt<30*86400000){this.ui.tplDraft=d.draft;this.ui.tplDirty=true;}}catch{}}
  return originalTemplateView(state);
};
Strength._saveTemplate=function(){const key=Drafts.prefix+'template-model:'+(this.ui.tplEditId||'current');originalSaveTemplate();if(!this.ui.tplDraft&&!Store._failed)localStorage.removeItem(key);};
