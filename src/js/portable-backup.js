/* Portable archive: gzip JSON envelope, relative paths + SHA256 manifest.
   A staging directory is validated before any existing data is moved. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const PhotoLib = require('./photo-library');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const MAX_BYTES = 512 * 1024 * 1024;
const MEDIA_NAMES = ['skin-photos', 'body-photos', 'meal-photos', 'imported-videos'];
function cleanData(input) {
  const db = JSON.parse(JSON.stringify(input));
  for (const key of Object.keys(db.settings || {})) if (/apikey|secret|token|encrypted/i.test(key)) delete db.settings[key];
  delete db.drafts; delete db.activeFollow;
  return db;
}
function mediaDirs(dir, opts={}) {
  return {
    'skin-photos': opts.skinDir || opts.photoDir || path.join(dir, 'skin-photos'),
    'body-photos': opts.bodyDir || path.join(dir, 'body-photos'),
    'meal-photos': opts.mealDir || path.join(dir, 'meal-photos'),
    'imported-videos': opts.videoDir || path.join(dir, 'imported-videos')
  };
}
function createBundle(db, dir, includeVideos=false, opts={}) {
  const data=cleanData(db), files=[], missing=[]; let total=0;
  const dirs = mediaDirs(dir, opts);
  function add(file, name) {
    if(!fs.existsSync(file)) {missing.push(name); return;}
    if(fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw Error('不接受链接或非普通文件：'+name);
    const size=fs.statSync(file).size; total+=size;
    if(total>MAX_BYTES)throw Error('照片和视频合计超过 512 MB，请改用仅保存视频引用');
    const bytes=fs.readFileSync(file);files.push({path:name,bytes:size,sha256:hash(bytes),data:bytes.toString('base64')});
  }
  for(const p of [...(data.skin?.photos || []),...(data.rhythm?.mealPhotos || [])]) {
    if(!PhotoLib.safePhotoName(p.file || '')) throw Error('照片文件名无效');
    const archive = PhotoLib.archiveForPhoto(p.kind)+'/'+p.file;
    if(files.some(f=>f.path===archive)) continue;
    const found = PhotoLib.locatePhotoFile(p.file, p.kind, dirs['skin-photos'], dirs['body-photos'],dirs['meal-photos']);
    add(found, archive);
  }
  for(const v of data.videos || [])if(v.source==='local') {
    if(!includeVideos){if(!v.localPath||!fs.existsSync(v.localPath))missing.push('视频引用：'+(v.title||v.id));continue;}
    const name='imported-videos/'+hash(Buffer.from(v.id)).slice(0,16)+path.extname(v.localPath).toLowerCase();
    add(v.localPath,name);if(files.some(f=>f.path===name)) {v.backupVideo=name;delete v.localPath;}
  }
  return {format:'face-reshape-portable',version:1,createdAt:new Date().toISOString(),includeVideos,missing,data,files};
}
function validateBundle(bundle) {
  if(bundle?.format!=='face-reshape-portable'||bundle.version!==1)throw Error('不支持的备份版本');
  if(!bundle.data || !bundle.data.logs || !Array.isArray(bundle.data.videos) || !Array.isArray(bundle.files))throw Error('备份内容不完整');
  let total=0;const names=new Set();
  for(const f of bundle.files) {
    if(!PhotoLib.isBundleRelPath(f.path)||names.has(f.path))throw Error('备份包含越界或重复路径');
    names.add(f.path);
    const bytes=Buffer.from(f.data || '', 'base64');total+=bytes.length;
    if(total>MAX_BYTES || bytes.length!==f.bytes || hash(bytes)!==f.sha256)throw Error('备份校验失败：'+f.path);
  }
  for(const v of bundle.data.videos)if(v.backupVideo && (!names.has(v.backupVideo)||!v.backupVideo.startsWith('imported-videos/')))throw Error('视频清单不匹配');
  return bundle;
}
function encode(bundle) { validateBundle(bundle);return zlib.gzipSync(Buffer.from(JSON.stringify(bundle))); }
function decode(bytes) {return validateBundle(JSON.parse(zlib.gunzipSync(bytes,{maxOutputLength:MAX_BYTES*1.5}).toString()));}
function summary(b) {return {version:b.version,date:b.createdAt,photos:b.files.filter(f=>['skin-photos/','body-photos/','meal-photos/'].some(p=>f.path.startsWith(p))).length,videos:b.data.videos.length,trainingDays:Object.keys(b.data.logs.training || {}).length,sleeps:b.data.rhythm?.sleeps?.length || 0,meals:b.data.rhythm?.meals?.length || 0,missing:b.missing || [],includeVideos:b.includeVideos};}
function destFor(dir, name, dests) {
  if (name === 'face-reshape-data.json') return path.join(dir, name);
  if (dests && dests[name]) {
    const kind = name === 'body-photos' ? 'body' : name === 'meal-photos' ? 'meal' : name === 'imported-videos' ? 'video' : 'skin';
    return PhotoLib.assertMediaDest(dir, dests[name], kind);
  }
  return path.join(dir, name);
}
function recover(dir) {
  const journal=path.join(dir,'restore-journal.json');if(!fs.existsSync(journal))return;
  const j=JSON.parse(fs.readFileSync(journal));
  if(!/^restore-before-[0-9-]+$/.test(j.before))throw Error('恢复日志无效');
  const dests = Object.assign({}, j.mediaDests || {});
  if (j.photoDest && !dests['skin-photos']) dests['skin-photos'] = j.photoDest;
  for(const name of j.names){
    if(!['face-reshape-data.json',...MEDIA_NAMES].includes(name))throw Error('恢复路径无效');
    const old=path.join(dir,j.before,name),cur=destFor(dir,name,dests);
    if(fs.existsSync(old)){fs.rmSync(cur,{recursive:true,force:true});fs.renameSync(old,cur);}
    else if(j.installed?.includes(name))fs.rmSync(cur,{recursive:true,force:true});
  }
  fs.rmSync(journal,{force:true});
}
function restore(bundle,dir,opts={}) {
  validateBundle(bundle); fs.mkdirSync(dir,{recursive:true});recover(dir);
  const dests = mediaDirs(dir, opts);
  const stage=fs.mkdtempSync(path.join(dir,'.restore-stage-')), before='restore-before-'+Date.now()+'-'+crypto.randomInt(1000000), old=path.join(dir,before);
  const names=[...MEDIA_NAMES,'face-reshape-data.json'],journal=path.join(dir,'restore-journal.json');
  try {
    const data=cleanData(bundle.data);
    for(const f of bundle.files){const dest=path.join(stage,f.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,Buffer.from(f.data,'base64'),{mode:0o600});}
    for(const v of data.videos)if(v.backupVideo){v.localPath=path.join(dests['imported-videos'], path.basename(v.backupVideo));delete v.backupVideo;}
    fs.writeFileSync(path.join(stage,'face-reshape-data.json'),JSON.stringify(data,null,2),{mode:0o600});
    /* 只替换这次包里真有的媒体目录。未打包的视频或照片留在原地，不能先挪进快照再无处写回。 */
    const replaceable=new Set(['face-reshape-data.json']);
    for(const name of MEDIA_NAMES) if(fs.existsSync(path.join(stage,name))) replaceable.add(name);
    fs.mkdirSync(old);const j={before,names:[...replaceable],installed:[],mediaDests:dests,photoDest:dests['skin-photos']};fs.writeFileSync(journal,JSON.stringify(j));
    for(const name of names){
      if(replaceable.has(name)){
        const dest=destFor(dir,name,dests);
        fs.mkdirSync(path.dirname(dest),{recursive:true});
        if(fs.existsSync(dest))fs.renameSync(dest,path.join(old,name));
        if(fs.existsSync(path.join(stage,name))){j.installed.push(name);fs.writeFileSync(journal,JSON.stringify(j));fs.renameSync(path.join(stage,name),dest);}
      }
      if(opts.failAfter===name)throw Error('Injected restore interruption');}
    fs.rmSync(journal);return {data,before};
  }catch(e){recover(dir);throw e;}finally{fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={cleanData,createBundle,validateBundle,encode,decode,summary,restore,recover,hash};
