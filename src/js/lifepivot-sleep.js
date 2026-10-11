'use strict';
const fs = require('node:fs');
const path = require('node:path');

const BASENAME = 'life-pivot.sqlite';
const SQL = 'SELECT record_date, asleep_time, wake_time, calculated_duration_minutes, ' +
  'deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes, morning_feeling, ' +
  'manual_quality_score, awake_episodes, quality_text FROM sleep_daily_records ORDER BY record_date';

// Electron 自带 SQLite：Mac/Windows 均只读打开，不依赖系统 CLI，也不创建缺失的库。
function readSleep(appData) {
  const file = path.join(appData, 'LifePivot', BASENAME);
  let db;
  try {
    if (!fs.existsSync(file)) return { ok: false, error: '未找到个人积累库数据库（LifePivot/life-pivot.sqlite）' };
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true, allowExtension: false, timeout: 5000 });
    const rows = db.prepare(SQL).all();
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, error: '读取失败：' + error.message };
  } finally {
    if (db) db.close();
  }
}

module.exports = { readSleep };
