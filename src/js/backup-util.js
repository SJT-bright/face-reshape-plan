/* 自动备份文件名与轮转名单（纯函数，可独立测试）：
   与 main.js autoBackupData 的调用约定逐字对齐——
   - 文件名格式 data-YYYY-MM-DD.json；
   - 合法名单过滤正则 /^data-\d{4}-\d{2}-\d{2}\.json$/（只验形状，不验日期合法性）；
   - 文件名默认字符串升序（零填充日期下即时间升序，最旧在前）；
   - 轮转 = 删除「升序排列后最旧的 (length - keep) 份」，删除顺序与 main.js 原
     `while (files.length > keep) shift()` 逐个 shift 的顺序一致。 */
'use strict';

const BACKUP_NAME_RE = /^data-\d{4}-\d{2}-\d{2}\.json$/;

/** 生成当日备份文件名，如 backupFileName('2026-09-15') → 'data-2026-09-15.json' */
function backupFileName(today) {
  return `data-${today}.json`;
}

/** 是否为自动备份文件名（只验形状：data-YYYY-MM-DD.json，日期数值合法性不校验，与原过滤正则一致） */
function isBackupFileName(name) {
  return BACKUP_NAME_RE.test(String(name));
}

/**
 * 从「已通过 isBackupFileName 过滤」的文件名数组（任意顺序）里，
 * 返回应删除的名单：按文件名升序排序后最旧的 (length - keep) 个。
 * keep 无效（非整数/负数）或文件数不超过 keep 时返回空数组。
 * 纯函数：不修改入参数组。
 */
function pruneBackupList(fileNames, keep) {
  if (!Array.isArray(fileNames)) return [];
  if (!Number.isInteger(keep) || keep < 0) return [];
  const sorted = [...fileNames].sort();
  const excess = sorted.length - keep;
  if (excess <= 0) return [];
  return sorted.slice(0, excess);
}

module.exports = { backupFileName, isBackupFileName, pruneBackupList };
