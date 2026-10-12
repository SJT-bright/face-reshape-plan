'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Photo=require('./hub-photo-store');
const RE=require('./rhythm-engine');
const MAX_BYTES=200*1024*1024;
function invalid(message,code){const e=Error(message);e.code=code;return e;}
function type(bytes){
  if(bytes.length>=12 && bytes.toString('ascii',4,8)==='ftyp'){
    const brand=bytes.toString('ascii',8,12);if(['heic','heix','hevc','mif1','avif'].includes(brand))return null;
    return brand==='qt  '?['mov','video/quicktime']:['mp4','video/mp4'];
  }
  return bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]))?['webm','video/webm']:null;
}
function validate(input,now=Date.now()){
  if(!input || !/^[a-f0-9]{64}$/.test(input.sourceKey || '') || !Number.isSafeInteger(input.revision) || input.revision<1 || input.revision>=100000000 ||
     !['meal','skin','body'].includes(input.kind) || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.local || '') || !Photo.validateDate(input.local.slice(0,10)) || !RE.parse(input.local) ||
     typeof input.at!=='string' || !input.at.startsWith(input.local+':') || !input.at.endsWith('+08:00') || !Number.isFinite(Date.parse(input.at)) || Date.parse(input.at)>now+60000 ||
     typeof input.sentAt!=='string' || !input.sentAt.endsWith('+08:00') || !Number.isFinite(Date.parse(input.sentAt)) || Date.parse(input.sentAt)>now+60000 ||
     !['sent','occurred'].includes(input.timeKind) || typeof input.note!=='string' || input.note.length>180 ||
     !/^[a-f0-9]{64}$/.test(input.sha256 || '') || !Number.isSafeInteger(input.bytes) || input.bytes<=0 || input.bytes>MAX_BYTES ||
     !['video/mp4','video/quicktime','video/webm'].includes(input.mime) ||
     (input.mealSourceKey!=null && !/^[a-f0-9]{64}$/.test(input.mealSourceKey)) ||
     (input.trainingSourceKey!=null && !/^[a-f0-9]{64}$/.test(input.trainingSourceKey)) ||
     (input.trainingDate!=null && !Photo.validateDate(input.trainingDate)) ||
     (input.mealLabel!=null && !RE.MEAL_TYPE_WINDOWS.some(w=>w.label===input.mealLabel)))throw Error('视频字段无效');
  const ext={'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'}[input.mime];
  const {sourceKey,revision,kind,local,at,sentAt,timeKind,note,sha256,bytes,mime,mealSourceKey,trainingSourceKey,trainingDate}=input;
  const mealLabel=kind==='meal'?(input.mealLabel || (timeKind==='occurred'?RE.mealTypeLabel(RE.classifyMealType(local)):'餐别待确认')):null;
  return {sourceKey,revision,kind,local,at,sentAt,timeKind,note,sha256,bytes,mime,mealSourceKey,trainingSourceKey,trainingDate,mealLabel,file:`wx-${sourceKey}.${ext}`};
}
function receiver(meta,dir){
  fs.mkdirSync(dir,{recursive:true});if(fs.lstatSync(dir).isSymbolicLink())throw Error('无效视频目录');
  const temporary=path.join(dir,`.wx-video-${crypto.randomUUID()}.partial`),target=path.join(dir,meta.file);
  let fd=fs.openSync(temporary,'wx',0o600),size=0,head=Buffer.alloc(0);const digest=crypto.createHash('sha256');let finished=false;
  const abort=()=>{if(fd!==null){fs.closeSync(fd);fd=null;}if(fs.existsSync(temporary))fs.unlinkSync(temporary);};
  return {write(chunk){if(finished)throw Error('视频已结束');size+=chunk.length;if(size>meta.bytes || size>MAX_BYTES)throw invalid('视频过大','VIDEO_LIMIT');
      if(head.length<16)head=Buffer.concat([head,chunk.subarray(0,16-head.length)]);digest.update(chunk);
      let offset=0;while(offset<chunk.length)offset+=fs.writeSync(fd,chunk,offset,chunk.length-offset);},
    finish(){finished=true;try{
      const detected=type(head);if(size!==meta.bytes || digest.digest('hex')!==meta.sha256 || !detected || detected[1]!==meta.mime)throw invalid('视频字节或摘要无效','VIDEO_INVALID');
      fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
      const verify=()=>{const st=fs.lstatSync(target);if(!st.isFile() || st.isSymbolicLink() || st.size!==size)throw invalid('视频原文件冲突','VIDEO_CONFLICT');
        const check=crypto.createHash('sha256'),f=fs.openSync(target,'r');try{const b=Buffer.alloc(65536);let n;while(n=fs.readSync(f,b,0,b.length,null))check.update(b.subarray(0,n));}finally{fs.closeSync(f);}if(check.digest('hex')!==meta.sha256)throw invalid('视频原文件冲突','VIDEO_CONFLICT');};
      try{fs.linkSync(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;verify();}
      return meta;
    }finally{abort();}},abort};
}
module.exports={MAX_BYTES,type,validate,receiver};
