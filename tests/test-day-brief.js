/* 今日简报（util.dayBrief）纯函数测试：早/晚两态、缺数据降级、行内容与跳转目标 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dayBrief } = require('../src/js/util');

test('早晨形态（<18:00）：睡眠/皮肤/训练三行，缺睡眠给补记引导', () => {
  const b = dayBrief({ nowMinutes: 8 * 60, targetMinutes: 15, trainingSeconds: 0 });
  assert.equal(b.form, 'morning');
  assert.equal(b.lines.length, 3);
  assert.ok(b.lines[0].text.includes('昨晚睡眠还没记') && b.lines[0].go === 'nutrition');
  assert.ok(b.lines[1].text.includes('暂无足够记录') && b.lines[1].go === 'skincare');
  assert.ok(b.lines[2].text.includes('0/15 分钟') && b.lines[2].go === 'follow');
});

test('早晨形态：数据齐全时展示数值（睡眠小时/质量分、预测方向、达标态）', () => {
  const b = dayBrief({ nowMinutes: 8 * 60 + 30, targetMinutes: 15, trainingSeconds: 16 * 60, sleepMinutes: 450, sleepScore: 88, skinLogged: true });
  assert.ok(b.lines[0].text.includes('7.5 小时') && b.lines[0].text.includes('88 分'));
  assert.ok(b.lines[1].text.includes('已记录'));
  assert.ok(b.lines[2].text.includes('已达标'));
});

test('皮肤预测方向：up/down/flat 各有对应文案，down 提示注意睡眠', () => {
  const up = dayBrief({ nowMinutes: 600, skinDir: 'up' });
  const down = dayBrief({ nowMinutes: 600, skinDir: 'down' });
  const flat = dayBrief({ nowMinutes: 600, skinDir: 'flat' });
  assert.ok(up.lines[1].text.includes('向好'));
  assert.ok(down.lines[1].text.includes('下滑') && down.lines[1].text.includes('睡眠'));
  assert.ok(flat.lines[1].text.includes('平稳'));
});

test('晚间形态（≥18:00）：入睡建议/甜食档/专注分；缺项自动省略', () => {
  const full = dayBrief({ nowMinutes: 20 * 60, targetMinutes: 15, trainingSeconds: 900, bedtime: '22:45', sweetLogged: true, focusScore: 92 });
  assert.equal(full.form, 'evening');
  assert.ok(full.lines[0].text.includes('今晚建议 22:45 入睡') && full.lines[0].go === 'nutrition');
  assert.ok(full.lines[1].text.includes('已记'));
  assert.ok(full.lines[2].text.includes('92 分') && full.lines[2].go === 'achievements');
  const sparse = dayBrief({ nowMinutes: 20 * 60 });
  assert.ok(sparse.lines.some(l => l.text.includes('甜食档还没选')));
  assert.ok(!sparse.lines.some(l => l.text.includes('专注参考'))); // 无专注数据不出现
  assert.ok(!sparse.lines.some(l => l.text.includes('今晚建议'))); // 无入睡建议不出现
});

test('边界：空输入不抛错，训练行恒在（默认目标 15 分钟）', () => {
  const b = dayBrief({});
  assert.equal(b.lines.length >= 1, true);
  assert.ok(b.lines[b.lines.length - 1].text.includes('0/15 分钟'));
});
