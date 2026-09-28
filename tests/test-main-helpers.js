/* main.js 纯函数助手回归测试（隔离：不碰真实备份目录、不发系统通知）。
   覆盖 backup-util 与 reminder-util，口径与 main.js autoBackupData /
   checkSchedules 的既有行为逐字对齐。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backupFileName, isBackupFileName, pruneBackupList } = require('../src/js/backup-util');
const { parseHHmm, reminderDue } = require('../src/js/reminder-util');

const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

/* ---------------- backupFileName ---------------- */
test('backupFileName：data-YYYY-MM-DD.json 格式', () => {
  assert.equal(backupFileName('2026-09-15'), 'data-2026-09-15.json');
  assert.equal(backupFileName('2026-01-02'), 'data-2026-01-02.json');
  // 与过滤正则自洽：生成的名字必然被 isBackupFileName 认可
  assert.equal(isBackupFileName(backupFileName('2026-12-31')), true);
});

/* ---------------- isBackupFileName ---------------- */
test('isBackupFileName：匹配 data-YYYY-MM-DD.json 形状', () => {
  assert.equal(isBackupFileName('data-2026-09-15.json'), true);
  // 只验形状不验日期合法性（与原 main.js 过滤正则一致）
  assert.equal(isBackupFileName('data-2026-13-99.json'), true);
});

test('isBackupFileName：非该形状一律不匹配', () => {
  assert.equal(isBackupFileName('data-2026-9-15.json'), false);      // 月份未补零
  assert.equal(isBackupFileName('data-2026-09-15.json.bak'), false); // 后缀多余
  assert.equal(isBackupFileName('face-reshape-data.json'), false);   // 主数据文件
  assert.equal(isBackupFileName('data-20260915.json'), false);       // 无连字符
  assert.equal(isBackupFileName(''), false);
});

/* ---------------- pruneBackupList ---------------- */
test('pruneBackupList：29 个（未超 keep=30）返回空数组', () => {
  const files = Array.from({ length: 29 }, (_, i) => `data-2026-08-${pad2(i + 1)}.json`);
  assert.deepEqual(pruneBackupList(files, 30), []);
});

test('pruneBackupList：恰好 30 个也是空数组（边界）', () => {
  const files = Array.from({ length: 30 }, (_, i) => `data-2026-08-${pad2(i + 1)}.json`);
  assert.deepEqual(pruneBackupList(files, 30), []);
});

test('pruneBackupList：31 个删最旧 1 个，文件名正确', () => {
  const files = Array.from({ length: 31 }, (_, i) => `data-2026-08-${pad2(i + 1)}.json`);
  assert.deepEqual(pruneBackupList(files, 30), ['data-2026-08-01.json']);
});

test('pruneBackupList：乱序输入仍按文件名升序删最旧', () => {
  const files = Array.from({ length: 31 }, (_, i) => `data-2026-08-${pad2(i + 1)}.json`);
  // 确定性乱序：i*7 mod 31 是 0..30 的一个置换（31 为素数）
  const scrambled = Array.from({ length: 31 }, (_, i) => files[(i * 7) % 31]);
  assert.deepEqual(pruneBackupList(scrambled, 30), ['data-2026-08-01.json']);
  // 纯函数：不修改入参数组顺序
  assert.deepEqual(scrambled, Array.from({ length: 31 }, (_, i) => files[(i * 7) % 31]));
});

test('pruneBackupList：keep=0 时全部删除（升序返回）', () => {
  const files = ['data-2026-08-03.json', 'data-2026-08-01.json', 'data-2026-08-02.json'];
  assert.deepEqual(pruneBackupList(files, 0), [
    'data-2026-08-01.json',
    'data-2026-08-02.json',
    'data-2026-08-03.json'
  ]);
});

test('pruneBackupList：keep 无效（负数/非整数/缺省）返回空数组', () => {
  const files = ['data-2026-08-01.json', 'data-2026-08-02.json'];
  assert.deepEqual(pruneBackupList(files, -1), []);
  assert.deepEqual(pruneBackupList(files, 1.5), []);
  assert.deepEqual(pruneBackupList(files, undefined), []);
  assert.deepEqual(pruneBackupList(null, 30), []);
});

/* ---------------- parseHHmm ---------------- */
test("parseHHmm：'21:30' → 1290 分钟（h*60+m）", () => {
  const t = parseHHmm('21:30');
  assert.deepEqual(t, { h: 21, m: 30 });
  assert.equal(t.h * 60 + t.m, 1290);
});

test("parseHHmm：'9:05' 允许个位 → 545 分钟", () => {
  const t = parseHHmm('9:05');
  assert.deepEqual(t, { h: 9, m: 5 });
  assert.equal(t.h * 60 + t.m, 545);
});

test("parseHHmm：'25:00' 不拦——保持现口径（原实现只查 isNaN）", () => {
  // 已知口径：原 checkSchedules 不校验 0-23/0-59，'25:00' 被当作 25 点；
  // parseHHmm 刻意同样不拦，避免行为改变。
  assert.deepEqual(parseHHmm('25:00'), { h: 25, m: 0 });
});

test("parseHHmm：'abc' → null", () => {
  assert.equal(parseHHmm('abc'), null);
  assert.equal(parseHHmm('12:xx'), null); // 分钟段 NaN
});

test("parseHHmm：缺分钟段（'' / '21'）保持原路径——m=undefined，target=NaN，永不触发", () => {
  // 原实现 ''.split(':').map(Number) → [0]，m 取 undefined：Number.isNaN(undefined)
  // 为 false，所以不算解析失败，而是 target=NaN → diff=NaN → 条件恒假。
  assert.deepEqual(parseHHmm(''), { h: 0, m: undefined });
  assert.equal(Number.isNaN(parseHHmm('21').h * 60 + parseHHmm('21').m), true);
});

test("parseHHmm：多余冒号段与原实现一致被忽略（'21:30:45' 取前两段）", () => {
  assert.deepEqual(parseHHmm('21:30:45'), { h: 21, m: 30 });
});

/* ---------------- reminderDue ---------------- */
test('reminderDue：diff=0（正好到点）→ true', () => {
  assert.equal(reminderDue({ curMinutes: 540, targetMinutes: 540, graceMinutes: 3, alreadyFired: false }), true);
});

test('reminderDue：diff=grace（宽窗最后一分钟）→ true', () => {
  assert.equal(reminderDue({ curMinutes: 543, targetMinutes: 540, graceMinutes: 3, alreadyFired: false }), true);
});

test('reminderDue：diff=grace+1（刚出宽窗）→ false', () => {
  assert.equal(reminderDue({ curMinutes: 544, targetMinutes: 540, graceMinutes: 3, alreadyFired: false }), false);
});

test('reminderDue：alreadyFired=true → false（含 diff 在窗内的情形）', () => {
  assert.equal(reminderDue({ curMinutes: 541, targetMinutes: 540, graceMinutes: 3, alreadyFired: true }), false);
});

test('reminderDue：未到点（diff<0）→ false；grace=0 时只触发一次的边界', () => {
  assert.equal(reminderDue({ curMinutes: 539, targetMinutes: 540, graceMinutes: 3, alreadyFired: false }), false);
  // 训练提醒 grace 来自 db.settings.graceMinutes ?? 3，可能为 0：仅整点那一拍触发
  assert.equal(reminderDue({ curMinutes: 540, targetMinutes: 540, graceMinutes: 0, alreadyFired: false }), true);
  assert.equal(reminderDue({ curMinutes: 541, targetMinutes: 540, graceMinutes: 0, alreadyFired: false }), false);
});

test('reminderDue：四段提醒的实际 grace 组合抽查（3/20/30/20）', () => {
  // 训练 3 / 护肤 20 / 复盘 30 / 皮肤 20 —— 逐段核对宽窗边界
  assert.equal(reminderDue({ curMinutes: 1293, targetMinutes: 1290, graceMinutes: 3, alreadyFired: false }), true);
  assert.equal(reminderDue({ curMinutes: 540 + 20, targetMinutes: 540, graceMinutes: 20, alreadyFired: false }), true);
  assert.equal(reminderDue({ curMinutes: 1320 + 30, targetMinutes: 1320, graceMinutes: 30, alreadyFired: false }), true);
  assert.equal(reminderDue({ curMinutes: 1290 + 21, targetMinutes: 1290, graceMinutes: 20, alreadyFired: false }), false);
});
