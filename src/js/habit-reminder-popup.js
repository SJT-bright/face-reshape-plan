/* Text-only native popup; one acknowledgment at a time. */
(function () {
  'use strict';
  let item = null, busy = false;
  const $ = id => document.getElementById(id);
  function render(next) {
    if (!next || typeof next.id !== 'string') return;
    item = next; busy = false;
    $('habit-popup-title').textContent = item.name;
    $('habit-popup-count').textContent = `今天已完成 ${item.todayCount} 次`;
    $('habit-popup-queue').textContent = item.queuedCount ? `还有 ${item.queuedCount} 个提醒，当前完成或稍后处理后依次显示。` : '';
    $('habit-popup-error').textContent = item.error || '';
    $('habit-popup-complete').textContent = item.actionLabel;
    $('habit-popup-complete').disabled = $('habit-popup-later').disabled = false;
    $('habit-popup-complete').focus();
  }
  async function act(action) {
    if (!item || busy) return;
    busy = true; const id = item.id;
    $('habit-popup-complete').disabled = $('habit-popup-later').disabled = true;
    try {
      const result = await window.habitPopup.action(id, action);
      if (!result.ok && item?.id === id) $('habit-popup-error').textContent = result.error || '操作未保存，请重试';
    } catch { if (item?.id === id) $('habit-popup-error').textContent = '操作未保存，请重试'; }
    finally { if (item?.id === id) { busy = false; $('habit-popup-complete').disabled = $('habit-popup-later').disabled = false; } }
  }
  $('habit-popup-complete').onclick = () => act('complete');
  $('habit-popup-later').onclick = () => act('later');
  window.habitPopup.onReminder(render);
  window.habitPopup.ready().then(result => { if (result.item) render(result.item); }).catch(() => { $('habit-popup-error').textContent = '读取提醒失败，请关闭窗口后重试'; });
})();
