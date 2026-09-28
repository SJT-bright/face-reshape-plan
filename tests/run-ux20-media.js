const {execFileSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'face-ux20-media-'));
try {
 execFileSync(fs.existsSync('/opt/homebrew/bin/ffmpeg')?'/opt/homebrew/bin/ffmpeg':'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=32x32:r=1','-t','600','-c:v','libvpx','-b:v','10k',path.join(profile,'synthetic.webm')]);
 for(const mode of ['write','restart'])execFileSync(require('electron'),[path.join(__dirname,'test-ux20-media.js'),profile,mode],{stdio:'inherit',env:{...process.env,FACE_UX20_TEST:'1'}});
 const restored=fs.mkdtempSync(path.join(os.tmpdir(),'face-ux20-media-restored-'));
 try{const B=require('../src/js/portable-backup'),db=JSON.parse(fs.readFileSync(path.join(profile,'face-reshape-data.json')));B.restore(B.decode(B.encode(B.createBundle(db,profile,true))),restored);execFileSync(require('electron'),[path.join(__dirname,'test-ux20-media.js'),restored,'backup-play'],{stdio:'inherit',env:{...process.env,FACE_UX20_TEST:'1'}});}finally{fs.rmSync(restored,{recursive:true,force:true});}
}finally{fs.rmSync(profile,{recursive:true,force:true});}
