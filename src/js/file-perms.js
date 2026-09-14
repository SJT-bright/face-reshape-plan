/* 数据文件权限收紧（可独立测试的小单元）：
   应用数据含皮肤日志、可能的 AI API Key 等隐私，默认 0644 会被同机其他账户读取，
   统一收紧到 0600。成功返回 true 并以实际 mode 验证；文件不存在或失败返回 false。 */
'use strict';
const fs = require('fs');

function ensurePrivatePerms(fsPath) {
  try {
    fs.chmodSync(fsPath, 0o600);
    return (fs.statSync(fsPath).mode & 0o777) === 0o600;
  } catch {
    return false;
  }
}

module.exports = { ensurePrivatePerms };
