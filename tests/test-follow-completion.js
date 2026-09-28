/* 跟练完播判定测试（util.followCompletion）：
   ≥80% 视频时长且 ≥120s；无时长按 3 分钟门槛。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { followCompletion } = require('../src/js/util');

test('有视频时长：80% 门槛，且不低于 120 秒', () => {
  /* 10 分钟视频（600s）：480s（80%）起算完整 */
  assert.equal(followCompletion(479, 600).completed, false);
  assert.equal(followCompletion(480, 600).completed, true);
  assert.equal(followCompletion(600, 600).threshold, 480);
  /* 3 分钟视频（180s）：80%=144s（高于 120s 下限，按 144 计） */
  assert.equal(followCompletion(119, 180).completed, false);
  assert.equal(followCompletion(143, 180).completed, false);
  assert.equal(followCompletion(144, 180).completed, true);
  assert.equal(followCompletion(120, 180).threshold, 144);
});

test('无视频时长：按 3 分钟门槛（本地视频未探测到时长）', () => {
  assert.equal(followCompletion(179, null).completed, false);
  assert.equal(followCompletion(180, null).completed, true);
  assert.equal(followCompletion(300, undefined).completed, true);
});

test('非法输入：负数/非数值一律不算完整', () => {
  assert.equal(followCompletion(-5, 600).completed, false);
  assert.equal(followCompletion('abc', 600).completed, false);
  assert.equal(followCompletion(0, 600).completed, false);
});
