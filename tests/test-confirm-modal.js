/* confirmModal 渲染路径测试：正文统一转义为文本（P-B），特殊字符不得作为 HTML 执行，
   普通中文/换行文案保持可读、不引入双重转义。用真实 util.js 的 confirmModal，
   仅 stub 最小 DOM（$ 返回假 mask/card，openModal 捕获 html）。
   html 在 confirmModal 内同步构造，断言无需等待；末尾手动触发按钮让 promise 落定。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------- 最小 DOM stub ---------- */
let capturedHtml = '';
const maskStub = { classList: { add() {}, remove() {} }, onclick: null };
let lastBtns = null;
function fakeCard() {
  const btns = { '#m-ok': { onclick: null }, '#m-cancel': { onclick: null } };
  lastBtns = btns;
  return {
    innerHTML: '',
    set innerHTML(html) { this._html = html; capturedHtml = html; },
    get innerHTML() { return this._html; },
    querySelector(sel) { return btns[sel] || null; }
  };
}
const cardStub = fakeCard();
global.document = {
  querySelector(sel) { return sel === '#modal-mask' ? maskStub : sel === '#modal-card' ? cardStub : null; }
};
const util = require('../src/js/util');

function openAndSettle(title, body, okText) {
  const p = util.confirmModal(title, body, okText); // html 同步捕获
  const html = capturedHtml; // 快照：确认触发的 closeModal 会把 card.innerHTML 清空
  lastBtns['#m-ok'].onclick();
  return p.then(() => html);
}

test('特殊字符 body 被转义为文本，不作为可执行 HTML 出现', async () => {
  const html = await openAndSettle('标题', '<img src=x onerror=alert(1)>hello & "q" <script>', '确定');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'img 标签应转义为文本');
  assert.ok(html.includes('&amp;'), '& 应转义');
  assert.ok(html.includes('&quot;q&quot;'), '引号应转义');
  assert.ok(html.includes('&lt;script&gt;'), 'script 标签应转义为文本');
  assert.ok(!html.includes('<img'), '不得出现原始 img 标签');
  assert.ok(!html.includes('<script>'), '不得出现原始 script 标签');
});

test('普通中文文案原样出现，无双重转义', async () => {
  const body = '确定删除「哑铃卧推」吗？相关打卡记录保留。';
  const html = await openAndSettle('删除', body, '删除');
  assert.ok(html.includes(body), '普通文案应原样出现');
  assert.ok(!html.includes('&amp;'), '不含 & 的文案不得引入转义实体');
});

test('含 < 的用户文本恰好转义一次，不叠加成 &amp;lt;', async () => {
  const html = await openAndSettle('t', '确定删除「a<b」吗？', '删除');
  assert.ok(html.includes('确定删除「a&lt;b」吗？'), '应恰好转义一次');
  assert.ok(!html.includes('&amp;lt;'), '不得双重转义');
});

test('换行符原样保留（由弹窗 white-space:pre-line 折行）', async () => {
  const html = await openAndSettle('删除视频', '第一行\n第二行', '删除');
  assert.ok(html.includes('第一行\n第二行'), '换行符应原样保留在 html 中');
});

test('按钮交互路径可用：确认/取消分别 resolve true/false', async () => {
  const p1 = util.confirmModal('t', 'b', '确定');
  lastBtns['#m-ok'].onclick();
  assert.equal(await p1, true);
  const p2 = util.confirmModal('t', 'b', '确定');
  lastBtns['#m-cancel'].onclick();
  assert.equal(await p2, false);
});
