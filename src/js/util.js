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

/* 完播判定：一次跟练是否算「完整看过」。
   有视频时长：有效计时 ≥ 80% 时长（且至少 120 秒，防极短视频刷次数）；
   无时长数据（本地视频未探测到）：按 3 分钟门槛。 */
function followCompletion(seconds, durationSec) {
  const threshold = durationSec ? Math.max(120, Math.round(durationSec * 0.8)) : 180;
  return { completed: (Number(seconds) || 0) >= threshold, threshold };
}

/* 专注参考分（0–100）：按「每 10 分钟打断次数」密度线性扣分——0 次满 100，每 10 分钟 1 次扣 20，下限 0。
   打断 = 跟练中的手动暂停/视频暂停/切后台自动暂停次数（后台字段，仅在成就日历展示）。
   分钟数 <5 不评估（过短无意义）。映射为设计取值，溯源见 docs/scoring-parameters.md。 */
function focusScore(interruptions, minutes) {
  if (!Number.isInteger(interruptions) || interruptions < 0) return null;
  const min = Number(minutes);
  if (!Number.isFinite(min) || min < 5) return null;
  const per10 = interruptions / (min / 10);
  return Math.max(0, Math.min(100, Math.round(100 - per10 * 20)));
}

/* 今日简报：把各模块现成数据拼成早/晚两态的建议行（纯拼接，无新算法，缺数据自动降级）。
   输入全可空；输出 { form: 'morning'|'evening', lines: [{ icon, text, go }] }，go 为跳转视图名。 */
function dayBrief(input) {
  const i = input || {};
  const form = i.nowMinutes >= 18 * 60 ? 'evening' : 'morning';
  const lines = [];
  if (form === 'morning') {
    if (i.sleepMinutes != null && Number.isFinite(i.sleepMinutes)) {
      lines.push({ icon: '😴', text: `昨晚睡眠 ${Math.round(i.sleepMinutes / 6) / 10} 小时${Number.isInteger(i.sleepScore) ? ` · 质量 ${i.sleepScore} 分` : ''}`, go: 'nutrition' });
    } else {
      lines.push({ icon: '😴', text: '昨晚睡眠还没记——去「饮食与睡眠」按手环填一下', go: 'nutrition' });
    }
    if (i.skinLogged) lines.push({ icon: '🔬', text: '皮肤已记录 ✓', go: 'skincare' });
    else if (i.skinDir === 'up') lines.push({ icon: '🔬', text: '皮肤预测：今天预计向好', go: 'skincare' });
    else if (i.skinDir === 'down') lines.push({ icon: '🔬', text: '皮肤预测：预计下滑，注意睡眠与清洁', go: 'skincare' });
    else if (i.skinDir === 'flat') lines.push({ icon: '🔬', text: '皮肤预测：预计平稳', go: 'skincare' });
    else lines.push({ icon: '🔬', text: '皮肤：暂无足够记录', go: 'skincare' });
  } else {
    if (i.bedtime) lines.push({ icon: '🌙', text: `今晚建议 ${i.bedtime} 入睡`, go: 'nutrition' });
    lines.push({ icon: '🍚', text: i.sweetLogged ? '今天甜食档已记 ✓' : '今天甜食档还没选（营养卡里选一下）', go: 'nutrition' });
    if (i.focusScore != null) lines.push({ icon: '🎯', text: `今日专注参考 ${i.focusScore} 分（成就日历可看详情）`, go: 'achievements' });
  }
  const min = Math.round(Math.max(0, i.trainingSeconds || 0) / 60);
  const target = Math.max(1, i.targetMinutes || 15);
  lines.push({ icon: '🏋️', text: min >= target ? `今日训练 ${min} 分钟，已达标 ✓` : `今日训练 ${min}/${target} 分钟`, go: 'follow' });
  return { form, lines };
}

/* node 测试可用（浏览器端 module 未定义，无影响） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pad2, dateKey, todayKey, hhmm, nowMinutes, fmtSeconds, fmtDuration, minutesOf, uid, esc, addDays, daysBetween, followCompletion, focusScore, dayBrief, $, $$, toast, openModal, closeModal, confirmModal };
}
