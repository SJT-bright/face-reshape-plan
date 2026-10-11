'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_BYTES=25*1024*1024;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function imageType(bytes) {
  if(bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) return ['jpg','image/jpeg'];
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['png','image/png'];
  if(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return ['webp','image/webp'];
  if(bytes.toString('ascii',4,8)==='ftyp' && ['heic','heix','hevc','mif1'].includes(bytes.toString('ascii',8,12))) return ['heic','image/heic'];
  return null;
}

function validLocal(local) {
  if(!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local || ''))return false;
  const [y,m,d,h,n]=local.match(/\d+/g).map(Number);
  return new Date(Date.UTC(y,m-1,d,h,n)).toISOString().slice(0,16)===local;
}

function validate(input,now=Date.now()) {
  if(!input || !/^[a-f0-9]{64}$/.test(input.sourceKey || '') ||
      !Number.isSafeInteger(input.revision) || input.revision<1 || input.revision>=100000000 ||
      !['meal','skin','body'].includes(input.kind) || !validLocal(input.local) ||
      typeof input.at!=='string' || !input.at.startsWith(input.local+':') || !input.at.endsWith('+08:00') ||
      !Number.isFinite(Date.parse(input.at)) || Date.parse(input.at)>now+60000 ||
      typeof input.sentAt!=='string' || !input.sentAt.endsWith('+08:00') || !Number.isFinite(Date.parse(input.sentAt)) || Date.parse(input.sentAt)>now+60000 ||
      !['sent','occurred'].includes(input.timeKind) || typeof input.note!=='string' || input.note.length>180 ||
      (input.mealSourceKey!=null && !/^[a-f0-9]{64}$/.test(input.mealSourceKey)) ||
      !/^[a-f0-9]{64}$/.test(input.sha256 || '') || typeof input.imageBase64!=='string' ||
      input.imageBase64.length>Math.ceil(MAX_BYTES/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.imageBase64)) {
    throw new Error('照片字段无效');
  }
  const bytes=Buffer.from(input.imageBase64,'base64');
  const type=imageType(bytes);
  if(!bytes.length || bytes.length>MAX_BYTES || !type || type[1]!==input.mime || hash(bytes)!==input.sha256)throw new Error('照片格式或摘要不匹配');
  const {imageBase64,...photo}=input;
  return {bytes,ext:type[0],photo:{...photo,file:`wx-${input.sourceKey}.${type[0]}`}};
}

function save(validated,dir) {
  const {bytes,photo}=validated;
  fs.mkdirSync(dir,{recursive:true});
  const target=path.join(dir,photo.file);
  const verify=()=>{
    const st=fs.lstatSync(target);
    if(!st.isFile() || st.isSymbolicLink() || hash(fs.readFileSync(target))!==photo.sha256)throw new Error('已归档照片冲突');
  };
  if(fs.existsSync(target)){verify();return photo;}
  const temporary=path.join(dir,`.wx-${crypto.randomUUID()}.partial`);
  let descriptor;
  try {
    descriptor=fs.openSync(temporary,'wx',0o600);
    fs.writeFileSync(descriptor,bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);descriptor=undefined;
    try {fs.linkSync(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;verify();}
    // Windows 不支持对目录句柄 fsync；照片文件已先 fsync，硬链接仍保持不覆盖的原子写入。
    if(process.platform!=='win32'){
      const folder=fs.openSync(dir,'r');try{fs.fsyncSync(folder);}finally{fs.closeSync(folder);}
    }
    return photo;
  }finally{
    if(descriptor!==undefined)fs.closeSync(descriptor);
    if(fs.existsSync(temporary))fs.unlinkSync(temporary);
  }
}
module.exports={MAX_BYTES,imageType,validate,save};
