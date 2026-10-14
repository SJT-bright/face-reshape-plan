/* One native reminder window. The application owns the durable DB and frame trust. */
'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Core = require('./habit-reminder-core');

function registerHabitReminders({ BrowserWindow, ipcMain, getData, saveData, isAppFrame, getSuspended = () => false, onChanged = () => {}, now = Date.now, timers = { setInterval, clearInterval }, intervalMs = 1000, parent, logger = console }) {
  if (![getData, saveData, isAppFrame].every(f => typeof f === 'function')) throw Error('Habit reminders require data and frame-trust callbacks');
  let popup = null, ready = false, disposed = false, shownId = null, shownPayload = null, publishedDate = null, queue = Promise.resolve();
  const channels = ['habit:state', 'habit:save', 'habit:remove', 'habit:popup-ready', 'habit:popup-action'];
  const current = () => Core.normalize(getData()?.habitReminders);
  const serialized = action => { const result = queue.then(action); queue = result.catch(error => logger.error('habit reminders failed:', error)); return result; };
  function trustedMain(event) { return !disposed && isAppFrame(event); }
  function trustedPopup(event) { return !disposed && popup && !popup.isDestroyed() && event.sender === popup.webContents && (!event.senderFrame || event.senderFrame === popup.webContents.mainFrame); }
  function publish(state) { try { const value = Core.snapshot(state, now()); publishedDate = value.date; onChanged(value); } catch (error) { logger.error('habit reminder refresh failed:', error); } }
  async function persist(result) {
    if (!result.changed) return result;
    const next = JSON.parse(JSON.stringify(getData())); next.habitReminders = result.state;
    if (await saveData(next) !== true) throw Error('提醒保存失败，请重试；本次操作尚未记录');
    publish(result.state); return result;
  }
  function payload(error) { const item = Core.active(current(), now()); return item ? { ...item, error: error || '' } : null; }
  function deliver(error) {
    if (disposed) return;
    if (getSuspended()) { if (popup && !popup.isDestroyed()) popup.hide(); return; }
    const item = payload(error);
    if (!item) { shownId = null; shownPayload = null; if (popup && !popup.isDestroyed()) popup.hide(); return; }
    ensurePopup();
    if (!ready) return;
    const previous = shownId; shownId = item.id;
    const encoded = JSON.stringify(item);
    if (encoded !== shownPayload) { shownPayload = encoded; popup.webContents.send('habit:popup', item); }
    if (!popup.isVisible() || previous !== item.id) { popup.show(); popup.focus(); }
  }
  function ensurePopup() {
    if (popup && !popup.isDestroyed()) return;
    popup = new BrowserWindow({ width: 560, height: 380, minWidth: 390, minHeight: 340, resizable: true, show: false, alwaysOnTop: true, title: '生活提醒', autoHideMenuBar: true, backgroundColor: '#f4f7fd', ...(parent ? { parent: typeof parent === 'function' ? parent() : parent } : {}), webPreferences: { preload: path.join(__dirname, 'habit-reminder-popup-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    ready = false; shownId = null; shownPayload = null;
    popup.setMenu?.(null);
    try { popup.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true }); } catch { /* Windows does not expose the macOS workspace behavior. */ }
    popup.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    popup.webContents.on('will-navigate', event => event.preventDefault());
    popup.on('close', event => {
      if (disposed) return;
      event.preventDefault();
      if (!shownId) { popup.hide(); return; }
      const occurrenceId = shownId;
      serialized(() => perform(occurrenceId, 'later')).catch(error => deliver(error.message));
    });
    popup.on('closed', () => { popup = null; ready = false; shownId = null; shownPayload = null; });
    Promise.resolve(popup.loadFile(path.join(__dirname, '..', 'habit-reminder-popup.html'))).catch(error => logger.error('habit popup load failed:', error));
  }
  async function perform(id, action) {
    const result = Core.act(current(), id, action, now());
    await persist(result); deliver();
    return { ok: result.ok, stale: result.stale || false, error: result.error || '', state: Core.snapshot(current(), now()) };
  }
  async function tick() {
    if (disposed) return;
    return serialized(async () => { if (disposed) return; const result = await persist(Core.advance(current(), now(), getSuspended())); if (!result.changed && Core.dateKey(now()) !== publishedDate) publish(current()); deliver(); });
  }
  ipcMain.handle('habit:state', event => trustedMain(event) ? { ok: true, state: Core.snapshot(current(), now()) } : { ok: false, error: '提醒读取来源无效' });
  ipcMain.handle('habit:save', (event, input, revision) => {
    if (!trustedMain(event)) return { ok: false, error: '提醒设置来源无效' };
    return serialized(async () => {
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('提醒设置无效');
        const config = { ...input, id: input.id || 'habit-' + randomUUID() };
        await persist(Core.configure(current(), config, now(), revision)); deliver();
        return { ok: true, state: Core.snapshot(current(), now()) };
      } catch (error) { return { ok: false, error: error.message, state: Core.snapshot(current(), now()) }; }
    });
  });
  ipcMain.handle('habit:remove', (event, id, revision) => {
    if (!trustedMain(event)) return { ok: false, error: '提醒设置来源无效' };
    return serialized(async () => { try { const result = await persist(Core.remove(current(), id, revision)); deliver(); return { ok: result.ok, error: result.error || '', state: Core.snapshot(current(), now()) }; } catch (error) { return { ok: false, error: error.message, state: Core.snapshot(current(), now()) }; } });
  });
  ipcMain.handle('habit:popup-ready', event => {
    if (!trustedPopup(event)) return { ok: false };
    ready = true; deliver(); return { ok: true, item: payload() };
  });
  ipcMain.handle('habit:popup-action', (event, id, action) => {
    if (!trustedPopup(event)) return { ok: false, error: '提醒窗口来源无效' };
    return serialized(async () => { try { return await perform(id, action); } catch (error) { deliver(error.message); return { ok: false, error: error.message }; } });
  });
  const timer = timers.setInterval(() => { tick().catch(error => logger.error('habit reminder tick failed:', error)); }, Math.max(100, intervalMs));
  timer?.unref?.();
  return { tick, snapshot: () => Core.snapshot(current(), now()), async dispose() { disposed = true; timers.clearInterval(timer); for (const channel of channels) ipcMain.removeHandler(channel); if (popup && !popup.isDestroyed()) popup.destroy(); await queue; } };
}
module.exports = { registerHabitReminders };
