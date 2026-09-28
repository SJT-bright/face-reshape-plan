/* 视频进度记忆测试（B 站 t 参数恢复 + 本地视频 currentTime 定位） */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* 最小 DOM stub：createElement 返回记录 src/属性/事件的可检查假节点 */
function makeNode(tag) {
  const attrs = {};
  return {
    tag, src: '', _attrs: attrs, _listeners: {},
    setAttribute(name, v) { attrs[name] = v; },
    addEventListener(ev, cb) { this._listeners[ev] = cb; },
    currentTime: 0,
    get srcValue() { return this.src; }
  };
}
global.document = { createElement(tag) { return makeNode(tag); } };

const B = require('../src/js/bilibili');
const BV_VIDEO = { id: 'v1', source: 'bilibili', bvid: 'BV1xx411c7mD', page: 1 };
const AID_VIDEO = { id: 'v2', source: 'bilibili', aid: '123', page: 2 };
const LOCAL_VIDEO = { id: 'v3', source: 'local', localPath: '/tmp/x.mp4' };

test('embedUrl：无恢复参数时保持原行为（autoplay=0、无 t）', () => {
  const u = B.embedUrl(BV_VIDEO);
  assert.ok(u.includes('bvid=BV1xx411c7mD'));
  assert.ok(u.includes('autoplay=0'));
  assert.ok(!u.includes('&t='));
});

test('embedUrl：startSec>0 → 追加 t 秒但保持暂停', () => {
  const u = B.embedUrl(BV_VIDEO, 75);
  assert.ok(u.includes('&t=75') && u.includes('autoplay=0'), u);
  assert.ok(B.embedUrl(BV_VIDEO, 75.9).includes('&t=75'), '小数向下取整');
  const u2 = B.embedUrl(AID_VIDEO, 300);
  assert.ok(u2.includes('aid=123') && u2.includes('&t=300') && u2.includes('autoplay=0'));
});

test('embedUrl：autoplay=true 强制自动播放（开始跟练=视频与计时同步启动）', () => {
  const u = B.embedUrl(BV_VIDEO, 0, true);
  assert.ok(u.includes('autoplay=1'), u);
  assert.ok(!u.includes('&t='), '无恢复秒数时不带 t');
  /* 恢复场景：autoplay 与 t 并存 */
  const u2 = B.embedUrl(BV_VIDEO, 95, true);
  assert.ok(u2.includes('&t=95') && u2.includes('autoplay=1'), u2);
  /* 默认（预览载入）不自动播放 */
  assert.ok(B.embedUrl(BV_VIDEO).includes('autoplay=0'));
});

test('embedUrl：startSec 为 0/负数/非数值 → 不带恢复参数', () => {
  for (const s of [0, -3, 'abc']) {
    const u = B.embedUrl(BV_VIDEO, s);
    assert.ok(!u.includes('&t='), `startSec=${s} 不应带 t 参数`);
  }
});

test('playerNode：B 站视频把恢复参数写进 iframe src', () => {
  const fr = B.playerNode(BV_VIDEO, 95);
  assert.ok(fr.src.includes('player.bilibili.com'));
  assert.ok(fr.src.includes('&t=95') && fr.src.includes('autoplay=0'));
  assert.equal(fr._attrs.allowfullscreen, 'true');
});

test('playerNode：本地视频 loadedmetadata 后定位 currentTime', () => {
  const vd = B.playerNode(LOCAL_VIDEO, 150);
  assert.equal(vd.src, 'file:////tmp/x.mp4'.replace('file:////', 'file:///'));
  assert.ok(typeof vd._listeners.loadedmetadata === 'function');
  vd._listeners.loadedmetadata();
  assert.equal(vd.currentTime, 150);
});

test('playerNode：无视频返回 null', () => {
  assert.equal(B.playerNode(null, 10), null);
});
