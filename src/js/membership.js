const Membership = {
  period:0,
  actionLabels:['选择课程','选择视频开练','整理护理流程','记录昨晚睡眠','查看成就记录','调整跟练节奏','查看本期复盘'],
  act(index){
    if(index===0||index===1){App.openPracticeChooser();return;}
    if(index===2){Skincare.ui.tab='care';App.go('skincare');return;}
    if(index===3){UX.quickSleep();return;}
    if(index===5){$('#growth-goal')?.scrollIntoView({behavior:'smooth',block:'center'});$('#growth-target')?.focus({preventScroll:true});return;}
    if(index===6){$('#growth-report')?.scrollIntoView({behavior:'smooth'});return;}
    App.go(MembershipCore.tasks[index].route);
  },
  restart(){
    const n=MembershipCore.day(this.state().started,todayKey());if(n===null||n<=7)return;
    this.commit(x=>{x.history=Array.isArray(x.history)?x.history:[];x.history.push({started:x.started,ended:todayKey(),done:{...x.done}});x.started=todayKey();x.done={};});
  },
  state(){const s=Store.db.settings.growthPlan;return s&&typeof s==='object'&&!Array.isArray(s)?s:{};},
  commit(change){
    try {const next=JSON.parse(JSON.stringify(this.state()));change(next);Store.db.settings.growthPlan=next;Store.save(true);App.render();return true;}
    catch(error){App.render();toast('未能保存，请重试。','red');return false;}
  },
  home(after){
    const s=this.state(),n=MembershipCore.day(s.started,todayKey());
    const box=document.createElement('div');box.className='card growth-home';
    const label=n===null?'从 7 天体验开始':n<1?'体验计划':n>7?'查看你的体验复盘':`7 天体验 · 第 ${n} 天`;
    box.innerHTML=`<div><b>${esc(label)}</b><p class="hint">${n===null?'把跟练、护理与记录变成可坚持的安排。免费体验，无需绑定支付。':'按自己的节奏完成任务，随时回顾真实记录。'}</p></div><button class="btn" id="growth-home-open">${n===null?'查看成长计划':'继续我的计划'}</button>`;
    after.after(box);$('#growth-home-open',box).onclick=()=>App.go('membership');
  },
  view(root){
    const s=this.state(),n=MembershipCore.day(s.started,todayKey()),done=s.done||{};
    const summary=MembershipCore.summary(Store.db,MembershipCore.offset(todayKey(),-7*this.period));
    const previous=MembershipCore.summary(Store.db,MembershipCore.offset(summary.to,-7));
    const completed=MembershipCore.tasks.filter((_,i)=>done[i]).length;
    /* 顶部按钮单独选目标，不跟 nextTask 的「最早未完成」走。1–7 天对齐高亮的今天；今天已完成才落到下一个已解锁且未完成的任务。n>7 仍用 nextTask。 */
    let heroIndex=-1;
    if(n>=1&&n<=7){
      const today=n-1;
      heroIndex=!done[today]?today:MembershipCore.tasks.findIndex((_,i)=>i<n&&!done[i]);
    }else if(n>7){
      const found=MembershipCore.nextTask(s,todayKey());
      heroIndex=found==null?-1:found;
    }
    const pricingOpen=$('#growth-pricing',root)?.open||false;
    const target=MembershipCore.target(s.targetDays),max=Math.max(60,...summary.rows.map(r=>r.seconds));
    root.innerHTML=`<div class="view growth-view">
      <section class="card growth-hero"><div class="growth-heading"><div><span class="growth-kicker">我的成长计划 · 免费体验</span><h2>${n===null?'从今天的一小步开始。':n>7?'这一轮结束，下一步由你决定。':n<1?'检查一下计划日期。':`第 ${n} 天，按自己的节奏继续。`}</h2><p>${n===null?'7 天，逐步整理跟练、护理与记录。无需绑定支付。':n<1?'计划开始日期晚于今天，请检查系统日期。':heroIndex>=0?esc(MembershipCore.tasks[heroIndex].text):n>=7?'你已完成本轮任务，可以查看记录，周期结束后再开启新一轮。':'已完成当前解锁的任务，明天再继续。'}</p></div>${n===null?'':`<div class="growth-progress"><strong>${completed}<small> / 7</small></strong><span>任务自评完成</span><progress max="7" value="${completed}" aria-label="任务自评进度"></progress></div>`}</div><div class="row">${n===null?'<button class="btn primary" id="growth-start">开始 7 天体验</button>':n<1?'<button class="btn primary" id="growth-start">把开始日改到今天</button>':heroIndex>=0?`<button class="btn primary" data-growth-action="${heroIndex}">${this.actionLabels[heroIndex]}</button>`:''}${n>7?'<button class="btn" id="growth-restart">保留记录，开始新一轮</button>':''}</div></section>
      ${n===null?'':`<section class="card growth-task-section"><div class="growth-section-heading"><h3>我的 7 天任务</h3><span class="hint">自评完成不会增加训练时长</span></div><div class="growth-tasks">${MembershipCore.tasks.map((t,i)=>`<article class="growth-task ${done[i]?'is-done':''} ${n===i+1?'is-today':''}"><span class="growth-day">${done[i]?'✓':String(i+1).padStart(2,'0')}<small>${n===i+1?'今天':`第 ${i+1} 天`}</small></span><div><b>${esc(t.title)}</b><p class="hint">${esc(t.text)}</p></div><button class="btn small" data-growth-action="${i}" ${n<i+1?'disabled':''}>${n<i+1?`第 ${i+1} 天解锁`:this.actionLabels[i]}</button><label><input type="checkbox" aria-label="${esc(t.title)}：自评完成" data-growth-done="${i}" ${done[i]?'checked':''} ${n<i+1?'disabled':''}> ${done[i]?'已完成':'标记完成'}</label></article>`).join('')}</div></section>`}
      <section class="card" id="growth-report"><div class="growth-section-heading"><div><h3>${this.period?'历史 7 天':'最近 7 天'} · 跟练复盘</h3><p class="hint">${summary.from} — ${summary.to}${this.period?'':'（含今天）'}</p></div><div class="row"><button class="btn small" id="growth-prev" aria-label="查看前 7 天">前 7 天</button><button class="btn small" id="growth-current" ${this.period===0?'disabled':''}>回到最近</button></div></div><div class="growth-metrics"><div><strong>${summary.days}<small> / 7 天</small></strong><span>有跟练记录</span></div><div><strong>${summary.minutes}<small> 分钟</small></strong><span>累计记录时长</span></div><p class="hint">${previous.days?`前一期有 ${previous.days} 天记录，共 ${previous.minutes} 分钟。`:'前一期暂无记录，继续记录后可作比较。'}</p></div><ol class="growth-chart" aria-label="每日跟练记录">${summary.rows.map(r=>`<li><span>${r.seconds>0?(r.seconds<60?'不足1':Math.round(r.seconds/60))+' 分':'—'}</span><div class="growth-bar-track" aria-hidden="true"><i style="height:${r.seconds?Math.max(4,Math.round(r.seconds/max*100)):0}%"></i></div><time datetime="${r.date}">${r.date.slice(5).replace('-','/')}</time><span class="growth-sr">${r.seconds?'有跟练记录':'暂无跟练记录'}</span></li>`).join('')}</ol><p>${summary.days===0?'这一期还没有跟练记录。选择课程后，实际播放会开始计时。':!s.targetDays?'可以在下方设置自己愿意坚持的记录频率。':summary.days>=target?'已达到你设定的记录天数，接下来保持适合自己的节奏。':`与当前设定的 ${target} 天节奏相比，少 ${target-summary.days} 天记录。没有记录的日子不必补练。`}</p><p class="hint">仅汇总应用内记录，未记录不等于未练习。</p><button class="btn" id="growth-copy">预览可分享周报</button></section>
      <section class="card" id="growth-goal"><h3>我的跟练节奏</h3><p class="hint">设一个自己愿意坚持的频率，随时可以调整；不改变已有训练安排或提醒。</p><form id="growth-goal-form" class="row"><label for="growth-target">每 7 天希望有记录</label><select class="input" id="growth-target">${Array.from({length:7},(_,i)=>`<option value="${i+1}" ${target===i+1?'selected':''}>${i+1} 天</option>`).join('')}</select><button class="btn" type="submit">保存节奏</button><span id="growth-goal-status" role="status">${s.targetDays?'已保存：'+target+' 天':'尚未设置，可自行选择'}</span></form></section>
      ${Array.isArray(s.history)&&s.history.length?`<details class="card growth-history"><summary>以前的体验 · ${s.history.length} 轮</summary><ul>${s.history.map(x=>`<li>${esc(x.started)} 开始 · 自评完成 ${MembershipCore.tasks.filter((_,i)=>x.done?.[i]).length} / 7 项</li>`).join('')}</ul></details>`:''}
      <details class="card growth-pricing" id="growth-pricing" ${pricingOpen?'open':''}><summary>长期陪伴方案 <span class="hint">筹备中 · 查看价格与权益</span></summary><p>先体验，再决定。以下为拟定方案，目前不能购买，不会自动扣费。</p><div class="growth-prices"><article><h4>基础版</h4><strong>免费</strong><p>已有的本地跟练、日常记录、备份与导出。</p><button class="btn" id="growth-free">继续免费使用</button></article><article><h4>陪伴会员</h4><strong>拟定 ¥19 / 月</strong><p>计划提供持续更新的主题安排、周复盘与进度回顾。当前体验内容免费开放。</p><button class="btn" data-growth-interest="monthly">${s.interest==='monthly'?'已保存偏好':'记录月付偏好'}</button></article><article><h4>年度会员</h4><strong>拟定 ¥129 / 年</strong><p>计划提供与月付相同的权益。正式上线时说明完整价格、续费及取消方式。</p><button class="btn" data-growth-interest="yearly">${s.interest==='yearly'?'已保存偏好':'记录年付偏好'}</button></article></div><p class="hint">偏好仅保存在这台设备，不是预约、订单或会员开通，也不会发送给运营方。</p>${s.interest?'<button class="btn small ghost" id="growth-clear-interest">清除付费偏好</button>':''}</details>
    </div>`;
    const bind=(id,fn)=>{const el=$(id,root);if(el)el.onclick=fn;};
    bind('#growth-start',()=>this.commit(x=>{x.started=todayKey();x.done={};}));
    bind('#growth-restart',()=>this.restart());
    bind('#growth-prev',()=>{this.period++;App.render();});
    bind('#growth-current',()=>{this.period=0;App.render();});
    $('#growth-goal-form',root).onsubmit=e=>{e.preventDefault();const value=Number($('#growth-target',root).value);if(!Number.isInteger(value)||value<1||value>7)return;if(this.commit(x=>{x.targetDays=value;})){$('#growth-target',root).value=String(value);Drafts.clear(root);$('#growth-goal-status',root).textContent='节奏已保存';$('#growth-target',root).focus({preventScroll:true});}};
    bind('#growth-free',()=>App.go('today'));
    bind('#growth-clear-interest',()=>this.commit(x=>delete x.interest));
    $$('[data-growth-interest]',root).forEach(b=>b.onclick=()=>this.commit(x=>{x.interest=b.dataset.growthInterest;}));
    $$('[data-growth-action]',root).forEach(b=>b.onclick=()=>this.act(Number(b.dataset.growthAction)));
    $$('[data-growth-done]',root).forEach(b=>b.onchange=()=>{const key=b.dataset.growthDone;if(this.commit(x=>{x.done=x.done||{};x.done[key]=b.checked;}))$(`[data-growth-done="${key}"]`,root)?.focus({preventScroll:true});});
    bind('#growth-copy',()=>{
      const card=openModal('<h3>分享前预览</h3><p class="hint">仅包含日期与跟练汇总，不包含照片、姓名、饮食或护肤记录。复制后由你自行分享。</p><textarea class="input growth-report-text" readonly aria-label="跟练周报"></textarea><div class="row"><button class="btn primary" id="growth-copy-confirm">复制周报</button><button class="btn" id="growth-copy-close">关闭</button></div>');
      $('textarea',card).value=MembershipCore.report(Store.db,summary.to,this.period===0);
      $('#growth-copy-close',card).onclick=()=>closeModal();
      $('#growth-copy-confirm',card).onclick=async()=>{try{await navigator.clipboard.writeText($('textarea',card).value);toast('周报已复制');}catch{$('textarea',card).select();toast('请按 Cmd/Ctrl+C 复制');}};
    });
  }
};
