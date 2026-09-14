/* 通用工具：日期 / 时间 / DOM / toast / 弹窗 */

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function dateKey(d) {
  const x = d || new Date();
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function todayKey() { return dateKey(); }
function hhmm(d) {
  const x = d || new Date();
  return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function fmtSeconds(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分钟`;
  return `${sec} 秒`;
}
function minutesOf(hhmmStr) {
  const [h, m] = String(hhmmStr || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function weekdayCN(d) {
  return '日一二三四五六'[d.getDay()];
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dateKey(dt);
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function toast(msg, type) {
  const wrap = $('#toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* 弹窗：openModal(html) 返回卡片节点；closeModal() 关闭 */
function openModal(html) {
  const mask = $('#modal-mask'), card = $('#modal-card');
  card.innerHTML = html;
  mask.classList.remove('hidden');
  mask.onclick = (e) => { if (e.target === mask) closeModal(); };
  return card;
}
function closeModal() {
  $('#modal-mask').classList.add('hidden');
  $('#modal-card').innerHTML = '';
}
function confirmModal(title, body, okText, cancelText) {
  return new Promise((resolve) => {
    const card = openModal(`
      <h3>${esc(title)}</h3>
      <p class="hint" style="font-size:13.5px; white-space:pre-line">${esc(body)}</p>
      <div class="row" style="justify-content:flex-end; margin-top:18px">
        <button class="btn ghost" id="m-cancel">${esc(cancelText || '取消')}</button>
        <button class="btn primary" id="m-ok">${esc(okText || '确定')}</button>
      </div>`);
    card.querySelector('#m-ok').onclick = () => { closeModal(); resolve(true); };
    card.querySelector('#m-cancel').onclick = () => { closeModal(); resolve(false); };
  });
}

/* node 测试可用（浏览器端 module 未定义，无影响） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pad2, dateKey, todayKey, hhmm, nowMinutes, fmtSeconds, fmtDuration, minutesOf, uid, esc, addDays, daysBetween, $, $$, toast, openModal, closeModal, confirmModal };
}
