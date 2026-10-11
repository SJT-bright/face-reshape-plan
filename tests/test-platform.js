const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { readSleep } = require('../src/js/lifepivot-sleep');
const { localUrl } = require('../src/js/bilibili');

test('本地媒体 URL 支持盘符、UNC、中文和 # ?，已有 URL 不重复编码', () => {
  assert.equal(localUrl('C:\\视频 目录\\早晚 #1?.mp4'), 'file:///C:/%E8%A7%86%E9%A2%91%20%E7%9B%AE%E5%BD%95/%E6%97%A9%E6%99%9A%20%231%3F.mp4');
  assert.equal(localUrl('\\\\server\\share\\clip #1.webm'), 'file://server/share/clip%20%231.webm');
  assert.equal(localUrl('/tmp/clip #1?.webm'), 'file:///tmp/clip%20%231%3F.webm');
  assert.equal(localUrl('file:///C:/clip%20name.mp4'), 'file:///C:/clip%20name.mp4');
});

test('跨平台睡眠迁移读取真实 SQLite，源文件逐字节保持不变', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'life-sqlite-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(readSleep(root).ok, false);
  const file = path.join(root, 'LifePivot', 'life-pivot.sqlite');
  assert.equal(fs.existsSync(file), false, '缺失数据库不创建空库');
  fs.mkdirSync(path.dirname(file));
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE sleep_daily_records (record_date TEXT, asleep_time TEXT, wake_time TEXT,
    calculated_duration_minutes INTEGER, deep_sleep_minutes INTEGER, light_sleep_minutes INTEGER,
    rem_sleep_minutes INTEGER, morning_feeling TEXT, manual_quality_score INTEGER, awake_episodes INTEGER, quality_text TEXT);
    INSERT INTO sleep_daily_records VALUES ('2026-10-10','23:00','07:00',480,60,300,120,'精神不错',8,0,'良好');`);
  db.close();
  const bytes = fs.readFileSync(file);
  const result = readSleep(root);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.rows[0].record_date, '2026-10-10');
  assert.equal(result.rows[0].calculated_duration_minutes, 480);
  assert.equal(result.rows[0].quality_text, '良好');
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['life-pivot.sqlite']);
  fs.writeFileSync(file, 'corrupt-database');
  assert.equal(readSleep(root).ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'corrupt-database');
});
