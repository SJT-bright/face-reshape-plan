/* Shared diet / skincare / fitness gallery actions. No owner media is purged. */
const MediaActions={
  async change(id,type,op){
    if(op==='delete' && !await confirmModal('删除'+(type==='video'?'视频':'照片'),'移入回收站，原文件保留，可恢复。饮食、睡眠、护肤和训练记录不受影响；微信重试不会自动恢复它。','删除'))return;
    try {
      const result=native.changeMediaSync(Store.db,id,type,op);
      if(!result?.ok)throw Error(result?.error || '保存失败，请重试');
      Store.db=result.data;Store._committed=structuredClone(result.data);Store._failed=null;
      Store._statsVersion=(Store._statsVersion || 0)+1;
      closeModal();App.render();toast(op==='delete'?'已移入回收站，可恢复':'已恢复','green');
    }catch(error){toast(error.message,'red');}
  },
  trashHtml(kind,day){
    const list=(Store.db.mediaTrash || []).filter(t=>(t.record.kind || 'skin')===kind && (!day || t.record.date===day));
    return list.length?`<details class="life-media-trash"><summary>回收站 · ${list.length} 项（原文件保留）</summary>${list.map(t=>`<p>${esc(t.record.date || '')} ${esc(t.record.mealLabel || t.record.note || (t.type==='video'?'视频':'照片'))} <button class="btn small" data-media-restore="${esc(t.record.id)}" data-media-type="${t.type}">恢复</button></p>`).join('')}</details>`:'';
  },
  videosHtml(kind,day){
    const list=(Store.db.lifeVideos || []).filter(v=>v.kind===kind && (!day || v.date===day));
    return list.length?`<h4>生活视频 · ${list.length} 段</h4><div class="life-photo-grid">${list.map(v=>`<figure class="life-video-thumb" data-life-video="${esc(v.id)}"><video controls playsinline preload="metadata" data-life-video-file="${esc(v.file)}"></video><figcaption>${esc(v.mealLabel || v.note || '生活视频')} · ${esc(v.local.replace('T',' '))}${v.timeKind==='sent'?' · 发送时间':''}</figcaption></figure>`).join('')}</div>`:'';
  },
  dismiss(){document.querySelector('#life-media-menu')?.remove();},
  init(){
    document.addEventListener('contextmenu',event=>{
      const video=event.target.closest('[data-life-video]');
      const image=event.target.closest('img[data-photo-file]') || event.target.closest('[data-meal-photo],[data-body-photo],.sk-photo-thumb')?.querySelector('img[data-photo-file]');
      const record=video ? (Store.db.lifeVideos || []).find(v=>v.id===video.dataset.lifeVideo) : image ? [...(Store.db.rhythm?.mealPhotos || []),...(Store.db.skin?.photos || [])].find(p=>p.file===image.dataset.photoFile && (p.kind || 'skin')===(image.dataset.photoKind || 'skin')) : null;
      if(!record)return;event.preventDefault();this.dismiss();
      const menu=document.createElement('div');menu.id='life-media-menu';menu.setAttribute('role','menu');menu.dataset.noIcon='true';
      menu.style.cssText=`position:fixed;z-index:10000;padding:8px;background:#fff;border:1px solid #ccd4e8;border-radius:10px;box-shadow:0 4px 18px #0002;left:${Math.min(event.clientX,innerWidth-150)}px;top:${Math.min(event.clientY,innerHeight-65)}px`;
      const button=document.createElement('button');button.className='btn danger';button.setAttribute('role','menuitem');button.textContent='删除'+(video?'视频':'照片');
      button.onclick=()=>{this.dismiss();void this.change(record.id,video?'video':'photo','delete');};menu.append(button);document.body.append(menu);button.focus({preventScroll:true});
    },true); // Native video controls may stop bubbling; capture still handles right-click.
    document.addEventListener('click',event=>{const b=event.target.closest('[data-media-restore]');if(b)void this.change(b.dataset.mediaRestore,b.dataset.mediaType,'restore');if(!event.target.closest('#life-media-menu'))this.dismiss();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')this.dismiss();});
    // Delayed scroll-into-view (and video-control internal scrolling) must not
    // immediately dismiss a newly opened menu. Only intentional scrolling does.
    window.addEventListener('wheel',()=>this.dismiss(),{passive:true});
    window.addEventListener('resize',()=>this.dismiss());
    const observer=new MutationObserver(()=>this.loadVideos());observer.observe(document.body,{childList:true,subtree:true});this.loadVideos();
  },
  loadVideos(){document.querySelectorAll('video[data-life-video-file]:not([data-loading])').forEach(async video=>{
    video.dataset.loading='1';try{const uri=await native.lifeVideoURL(video.dataset.lifeVideoFile);if(uri && video.isConnected)video.src=uri;else video.title='原视频暂时无法读取';}catch{video.title='原视频暂时无法读取';}
  });}
};
MediaActions.init();
