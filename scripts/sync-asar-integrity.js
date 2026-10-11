const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path');
const asar = require('@electron/asar');

const PLIST_BUDDY = '/usr/libexec/PlistBuddy';
const PLIST_KEY = ':ElectronAsarIntegrity:Resources/app.asar';

function headerHash(asarPath) {
  const { headerString } = asar.getRawHeader(asarPath);
  return createHash('sha256').update(headerString).digest('hex');
}

function syncMacAsarIntegrity(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const read = (key) => execFileSync(PLIST_BUDDY, ['-c', 'Print ' + key, plist], { encoding: 'utf8' }).trim();
  const algorithm = read(PLIST_KEY + ':algorithm');
  if (algorithm !== 'SHA256') throw new Error('不支持的 asar 完整性算法：' + algorithm);

  const hash = headerHash(asarPath);
  execFileSync(PLIST_BUDDY, ['-c', 'Set ' + PLIST_KEY + ':hash ' + hash, plist]);
  if (read(PLIST_KEY + ':hash') !== hash) throw new Error('asar 完整性记录写入后核对失败');
  return hash;
}

module.exports = { headerHash, syncMacAsarIntegrity };
