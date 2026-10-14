'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Core = require('../src/js/habit-reminder-core');
const { registerHabitReminders } = require('../src/js/habit-reminder-host.cjs');
function harness() {
  let clock = +new Date(2026, 9, 14, 12), db = { settings: { remindersEnabled: true }, habitReminders: Core.configure(undefined, { id: 'water', name: '喝水提醒', actionLabel: '我去喝水', intervalMinutes: 1, enabled: true }, clock).state }, fail = false, suspended = false, writes = 0, timerCleared = false;
  const handlers = new Map(), windows = [], changes = [];
  const ipcMain = { handle(name, fn) { handlers.set(name, fn); }, removeHandler(name) { handlers.delete(name); } };
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.destroyed = false; this.visible = false; this.shows = 0; this.focuses = 0; this.messages = []; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.send = (channel, payload) => this.messages.push({ channel, payload }); this.webContents.setWindowOpenHandler = fn => { this.openHandler = fn; }; windows.push(this); }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } show() { this.visible = true; this.shows++; } focus() { this.focuses++; } hide() { this.visible = false; } setMenu() {} loadFile(file) { this.file = file; return Promise.resolve(); } destroy() { this.destroyed = true; this.emit('closed'); }
    close() { let prevented = false; this.emit('close', { preventDefault() { prevented = true; } }); return prevented; }
  }
  const mainEvent = { sender: {}, senderFrame: {} }, invalid = { sender: {}, senderFrame: {} };
  const host = registerHabitReminders({ BrowserWindow: Window, ipcMain, getData: () => db, saveData: async next => { writes++; if (fail) return false; db = next; return true; }, isAppFrame: event => event === mainEvent, getSuspended: () => suspended, onChanged: state => changes.push(state), now: () => clock, timers: { setInterval() { return { unref() {} }; }, clearInterval() { timerCleared = true; } }, logger: { error() {} } });
  return { host, windows, changes, mainEvent, invalid, handlers, call: (name, event, ...args) => handlers.get(name)(event, ...args), event: () => ({ sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame }), setTime: value => { clock = value; }, getTime: () => clock, getDB: () => db, setFail: value => { fail = value; }, setSuspended: value => { suspended = value; }, writes: () => writes, timerCleared: () => timerCleared };
}
test('只创建一个窗口；就绪后显示，重复 tick 不抢焦点，不可信 IPC 不写记录', async () => {
  const h = harness(); h.setTime(h.getTime() + Core.MINUTE); await h.host.tick();
  assert.equal(h.windows.length, 1); assert.equal(h.windows[0].isVisible(), false);
  await h.call('habit:popup-ready', h.event());
  assert.equal(h.windows[0].isVisible(), true); assert.equal(h.windows[0].focuses, 1);
  const delivered = h.windows[0].messages.length;
  await h.host.tick(); assert.equal(h.windows[0].focuses, 1); assert.equal(h.windows.length, 1); assert.equal(h.windows[0].messages.length, delivered, 'unchanged ticks do not reset popup keyboard focus');
  const before = h.writes();
  assert.equal((await h.call('habit:popup-action', h.invalid, h.host.snapshot().active.id, 'complete')).ok, false);
  assert.equal((await h.call('habit:save', h.invalid, {})).ok, false);
  assert.equal(h.writes(), before);
  assert.equal(h.windows[0].options.webPreferences.sandbox, true);
  assert.equal(h.windows[0].openHandler({ url: 'https://bad.test' }).action, 'deny');
  await h.host.dispose(); assert.equal(h.timerCleared(), true); assert.equal(h.handlers.size, 0);
});
test('写盘失败不加次数且保持当前弹窗，重试成功，连续双击只记一次', async () => {
  const h = harness(); h.setTime(h.getTime() + Core.MINUTE); await h.host.tick(); await h.call('habit:popup-ready', h.event());
  const id = h.host.snapshot().active.id; h.setFail(true);
  const failed = await h.call('habit:popup-action', h.event(), id, 'complete');
  assert.equal(failed.ok, false); assert.equal(h.host.snapshot().todayTotal, 0); assert.equal(h.host.snapshot().active.id, id);
  assert.equal(h.windows[0].isVisible(), true); assert.match(h.windows[0].messages.at(-1).payload.error, /尚未记录/);
  h.setFail(false);
  const replies = await Promise.all([h.call('habit:popup-action', h.event(), id, 'complete'), h.call('habit:popup-action', h.event(), id, 'complete')]);
  assert.deepEqual(replies.map(x => x.ok), [true, false]); assert.equal(h.host.snapshot().todayTotal, 1); assert.equal(h.windows[0].isVisible(), false);
  await h.host.dispose();
});
test('关窗等同 5 分钟稍后，恢复时使用原 occurrenceId，不记次数', async () => {
  const h = harness(); h.setTime(h.getTime() + Core.MINUTE); await h.host.tick(); await h.call('habit:popup-ready', h.event());
  const id = h.host.snapshot().active.id, at = h.getTime();
  assert.equal(h.windows[0].close(), true); await h.host.tick();
  assert.equal(h.host.snapshot().todayTotal, 0); assert.equal(h.host.snapshot().active, null);
  assert.equal(h.getDB().habitReminders.runtime.water.nextDueAt, at + 5 * Core.MINUTE);
  h.setTime(at + 5 * Core.MINUTE); await h.host.tick();
  assert.equal(h.host.snapshot().active.id, id); assert.equal(h.windows.length, 1); assert.equal(h.windows[0].isVisible(), true);
  await h.host.dispose();
});
test('调度保存失败不显示；勿扰隐藏而不丢当前事件，解除后继续', async () => {
  const h = harness(); h.setTime(h.getTime() + Core.MINUTE); h.setFail(true);
  await assert.rejects(h.host.tick(), /保存失败/); assert.equal(h.windows.length, 0);
  h.setFail(false); await h.host.tick(); await h.call('habit:popup-ready', h.event());
  const id = h.host.snapshot().active.id;
  h.setSuspended(true); await h.host.tick(); assert.equal(h.windows[0].isVisible(), false); assert.equal(h.host.snapshot().active.id, id);
  h.setSuspended(false); await h.host.tick(); assert.equal(h.windows[0].isVisible(), true); assert.equal(h.host.snapshot().active.id, id);
  await h.host.dispose();
});
test('配置通过 IPC 保存，自定义提醒/按钮生效，过时版本拒绝覆盖', async () => {
  const h = harness(); const before = h.host.snapshot();
  const saved = await h.call('habit:save', h.mainEvent, { name: '看远处', actionLabel: '我去休息眼睛', intervalMinutes: 20, enabled: true }, before.revision);
  assert.equal(saved.ok, true); const c = saved.state.configs.find(x => x.name === '看远处');
  assert.equal(c.intervalMinutes, 20); assert.equal(c.actionLabel, '我去休息眼睛');
  const stale = await h.call('habit:save', h.mainEvent, { ...c, intervalMinutes: 30 }, before.revision);
  assert.equal(stale.ok, false); assert.match(stale.error, /其他窗口更新/);
  const removed = await h.call('habit:remove', h.mainEvent, c.id, saved.state.revision);
  assert.equal(removed.ok, true); assert.equal(removed.state.configs.some(x => x.id === c.id), false);
  await h.host.dispose();
});
test('午夜日期变化会刷新每日次数，即使所有周期提醒都关闭', async () => {
  const h = harness(); await h.host.tick(); const before = h.host.snapshot();
  await h.call('habit:save', h.mainEvent, { ...before.configs.find(c => c.id === 'water'), enabled: false }, before.revision);
  const previous = h.changes.length; h.setTime(+new Date(2026, 9, 15, 0, 0)); await h.host.tick();
  assert.equal(h.changes.length, previous + 1); assert.equal(h.changes.at(-1).date, '2026-10-15');
  await h.host.dispose();
});
