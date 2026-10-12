'use strict';
// Recoverable logical deletion. Originals are never unlinked: a failed JSON
// commit or a power loss cannot leave a live record pointing at a deleted file.
function change(input, id, type, op, now=new Date().toISOString()) {
  if (!['photo','video'].includes(type) || !['delete','restore'].includes(op)) throw Error('无效媒体操作');
  const data=structuredClone(input), trash=data.mediaTrash || [];
  const pools=type==='video' ? [data.lifeVideos || []] : [data.rhythm?.mealPhotos || [], data.skin?.photos || []];
  if (op==='delete') {
    const record=pools.flat().find(p=>p.id===id);
    if (!record) throw Error('记录不存在或已删除');
    trash.push({id:type+':'+id,type,record:structuredClone(record),deletedAt:now});
    if(type==='video') data.lifeVideos=pools[0].filter(p=>p.id!==id);
    else {if(data.rhythm)data.rhythm.mealPhotos=pools[0].filter(p=>p.id!==id);if(data.skin)data.skin.photos=pools[1].filter(p=>p.id!==id);}
    if(record.sourceKey) {
      const key=type==='video' ? 'videoImportVersions' : 'photoImportVersions';
      data[key]=data[key] || {};data[key][record.sourceKey]={revision:record.sourceRevision || 1,state:'manual-deleted',kind:record.kind};
    }
    if(type==='photo' && data.skin?.aiAutoRun?.date===record.date) delete data.skin.aiAutoRun;
  } else {
    const item=trash.find(t=>t.id===type+':'+id);
    if(!item || pools.flat().some(p=>p.id===id || (item.record.sourceKey && p.sourceKey===item.record.sourceKey))) throw Error('记录不可恢复或存在冲突');
    const p=item.record;
    if(type==='video') (data.lifeVideos=data.lifeVideos || []).push(p);
    else if(p.kind==='meal') (data.rhythm.mealPhotos=data.rhythm.mealPhotos || []).push(p);
    else (data.skin.photos=data.skin.photos || []).push(p);
    if(p.sourceKey) {const key=type==='video'?'videoImportVersions':'photoImportVersions';data[key]=data[key] || {};data[key][p.sourceKey]={revision:p.sourceRevision || 1,state:'active',kind:p.kind};}
  }
  data.mediaTrash=op==='restore' ? trash.filter(t=>t.id!==type+':'+id) : trash;
  data.mediaHistory=[...(data.mediaHistory || []),{id,type,op,at:now}];
  return data;
}
module.exports={change};
