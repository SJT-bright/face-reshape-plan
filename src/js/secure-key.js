const fs=require('node:fs'),path=require('node:path');
function keyStore(dir,safeStorage) {
  const file=path.join(dir,'ai-key.enc');
  const available=()=>safeStorage.isEncryptionAvailable() && (!safeStorage.getSelectedStorageBackend || safeStorage.getSelectedStorageBackend()!=='basic_text');
  return {
    // A metadata lookup must not access Keychain: a new ad-hoc signature can
    // trigger an OS authorization dialog and block the entire main process.
    // Availability is checked only for an explicit encrypt/decrypt operation.
    status(){return {available:null,configured:fs.existsSync(file)};},
    read(){if(!fs.existsSync(file))return '';if(!available())throw Error('系统安全存储不可用');return safeStorage.decryptString(fs.readFileSync(file));},
    save(key){if(!key){fs.rmSync(file,{force:true});return;}
      if(!available())throw Error('系统安全存储不可用；密钥未写入');
      const encrypted=safeStorage.encryptString(key);
      if(safeStorage.decryptString(encrypted)!==key)throw Error('密钥加密回读失败');
      fs.mkdirSync(dir,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,encrypted,{mode:0o600});fs.renameSync(tmp,file);
      if(this.read()!==key)throw Error('密钥回读失败');
    },
    migrate(db){if(!db.settings?.aiApiKey)return false;this.save(db.settings.aiApiKey);delete db.settings.aiApiKey;return true;}
  };
}
module.exports=keyStore;
