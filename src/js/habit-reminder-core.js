/* Durable interval reminders. No timers, Electron, storage, or notifications here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HabitReminderCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const MINUTE = 60000, SNOOZE_MINUTES = 5;
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
  const validOccurrenceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}\|\d{1,16}\|\d{1,16}$/.test(value) && validId(value.split('|')[0]);
  const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
  const clock = value => {
    const now = value instanceof Date ? +value : value;
    if (!timestamp(now)) throw Error('提醒时间无效');
    return now;
  };
  function dateKey(value) {
    const d = new Date(clock(value));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function validateConfig(value) {
    if (!object(value) || !validId(value.id)) throw Error('提醒标识无效');
    const name = String(value.name || '').trim(), actionLabel = String(value.actionLabel || '').trim();
    if (!name || name.length > 40) throw Error('请填写 1–40 个字的提醒名称');
    if (actionLabel.length > 60) throw Error('完成按钮最多填写 60 个字');
    const intervalMinutes = Number(value.intervalMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) throw Error('提醒间隔需要填写 1–1440 的整数分钟');
    if (typeof value.enabled !== 'boolean') throw Error('提醒开关无效');
    return { id: value.id, name, actionLabel: actionLabel || `我去${name.replace(/提醒$/, '')}`, intervalMinutes, enabled: value.enabled };
  }
  function defaults() {
    return {
      version: 1, revision: 0,
      configs: [
        { id: 'water', name: '喝水提醒', actionLabel: '我去喝水', intervalMinutes: 10, enabled: false },
        { id: 'movement', name: '运动提醒', actionLabel: '我去运动', intervalMinutes: 60, enabled: false }
      ], runtime: {}, queue: [], activeId: null, completions: {}
    };
  }
  function normalize(value) {
    if (!object(value)) return defaults();
    const out = { version: 1, revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0, configs: [], runtime: {}, queue: [], activeId: null, completions: {} };
    const seen = new Set();
    for (const config of Array.isArray(value.configs) ? value.configs : []) {
      try { const valid = validateConfig(config); if (!seen.has(valid.id) && out.configs.length < 50) { seen.add(valid.id); out.configs.push(valid); } } catch { /* A malformed reminder cannot stop the others. */ }
    }
    for (const c of out.configs) {
      const r = value.runtime?.[c.id];
      if (!object(r)) continue;
      out.runtime[c.id] = {
        generation: Number.isSafeInteger(r.generation) && r.generation >= 0 ? r.generation : 0,
        serial: Number.isSafeInteger(r.serial) && r.serial >= 0 ? r.serial : 0,
        nextDueAt: timestamp(r.nextDueAt) ? r.nextDueAt : null,
        pendingId: validOccurrenceId(r.pendingId) ? r.pendingId : null,
        snoozed: !!r.snoozed
      };
    }
    for (const [id, entry] of Object.entries(object(value.completions) ? value.completions : {})) {
      if (!validOccurrenceId(id) || !object(entry) || !validId(entry.reminderId) || !timestamp(entry.completedAt)) continue;
      out.completions[id] = { reminderId: entry.reminderId, name: String(entry.name || '').slice(0, 40), completedAt: entry.completedAt, date: /^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') ? entry.date : dateKey(entry.completedAt) };
    }
    const queued = new Set();
    for (const entry of Array.isArray(value.queue) ? value.queue : []) {
      const config = out.configs.find(c => c.id === entry?.reminderId), r = out.runtime[entry?.reminderId];
      if (!config?.enabled || !r || !validOccurrenceId(entry.id) || entry.id !== r.pendingId || !timestamp(entry.dueAt) || out.completions[entry.id] || queued.has(entry.id)) continue;
      queued.add(entry.id); out.queue.push({ id: entry.id, reminderId: config.id, dueAt: entry.dueAt });
    }
    out.queue.sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
    if (out.queue.some(e => e.id === value.activeId)) out.activeId = value.activeId;
    return out;
  }
  function changed(state, result) { state.revision += 1; return { state, changed: true, ...result }; }
  function unchanged(state, result) { return { state, changed: false, ...result }; }
  function checkRevision(state, expected) {
    if (expected !== undefined && expected !== state.revision) throw Error('提醒已在其他窗口更新，请刷新后再保存');
  }
  function configure(value, config, now = Date.now(), expectedRevision) {
    const state = normalize(value), at = clock(now), c = validateConfig(config);
    checkRevision(state, expectedRevision);
    const index = state.configs.findIndex(x => x.id === c.id), old = state.configs[index];
    if (!old && state.configs.length >= 50) throw Error('最多添加 50 个周期提醒');
    if (old && JSON.stringify(old) === JSON.stringify(c)) return unchanged(state, { ok: true });
    if (index < 0) state.configs.push(c); else state.configs[index] = c;
    const reset = !old || old.enabled !== c.enabled || old.intervalMinutes !== c.intervalMinutes || !state.runtime[c.id];
    if (reset) {
      state.queue = state.queue.filter(e => e.reminderId !== c.id);
      if (!state.queue.some(e => e.id === state.activeId)) state.activeId = null;
      state.runtime[c.id] = { generation: state.revision + 1, serial: 0, nextDueAt: c.enabled ? at + c.intervalMinutes * MINUTE : null, pendingId: null, snoozed: false };
    }
    return changed(state, { ok: true });
  }
  function remove(value, id, expectedRevision) {
    const state = normalize(value); checkRevision(state, expectedRevision);
    if (!state.configs.some(c => c.id === id)) return unchanged(state, { ok: false, error: '提醒已不存在' });
    state.configs = state.configs.filter(c => c.id !== id); delete state.runtime[id];
    state.queue = state.queue.filter(e => e.reminderId !== id);
    if (!state.queue.some(e => e.id === state.activeId)) state.activeId = null;
    return changed(state, { ok: true });
  }
  function advance(value, now = Date.now(), suspended = false) {
    const state = normalize(value), at = clock(now);
    if (suspended) return unchanged(state, { ok: true });
    let dirty = false;
    for (const c of state.configs) {
      if (!c.enabled) continue;
      let r = state.runtime[c.id];
      if (!r) { r = state.runtime[c.id] = { generation: state.revision + 1, serial: 0, nextDueAt: at + c.intervalMinutes * MINUTE, pendingId: null, snoozed: false }; dirty = true; }
      if (r.nextDueAt === null || r.nextDueAt > at || state.queue.some(e => e.reminderId === c.id)) continue;
      if (!r.pendingId) { r.serial += 1; r.pendingId = `${c.id}|${r.generation}|${r.serial}`; }
      if (state.completions[r.pendingId]) { r.pendingId = null; r.nextDueAt = at + c.intervalMinutes * MINUTE; dirty = true; continue; }
      state.queue.push({ id: r.pendingId, reminderId: c.id, dueAt: r.nextDueAt });
      r.nextDueAt = null; r.snoozed = false; dirty = true;
    }
    state.queue.sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
    if (!state.activeId && state.queue.length) { state.activeId = state.queue[0].id; dirty = true; }
    return dirty ? changed(state, { ok: true }) : unchanged(state, { ok: true });
  }
  function active(value, now = Date.now()) {
    const state = normalize(value), item = state.queue.find(e => e.id === state.activeId);
    if (!item) return null;
    const c = state.configs.find(x => x.id === item.reminderId);
    return { ...item, name: c.name, actionLabel: c.actionLabel, intervalMinutes: c.intervalMinutes, todayCount: count(state, c.id, dateKey(now)), queuedCount: state.queue.length - 1 };
  }
  function act(value, occurrenceId, action, now = Date.now()) {
    const state = normalize(value), at = clock(now), item = state.queue.find(e => e.id === occurrenceId && e.id === state.activeId);
    if (!['complete', 'later'].includes(action)) return unchanged(state, { ok: false, error: '提醒操作无效' });
    if (!item || state.completions[occurrenceId]) return unchanged(state, { ok: false, stale: true, error: '这条提醒已处理，未重复记录' });
    const c = state.configs.find(x => x.id === item.reminderId), r = state.runtime[c.id];
    state.queue = state.queue.filter(e => e.id !== occurrenceId); state.activeId = null;
    if (action === 'complete') {
      state.completions[occurrenceId] = { reminderId: c.id, name: c.name, completedAt: at, date: dateKey(at) };
      r.pendingId = null; r.nextDueAt = at + c.intervalMinutes * MINUTE; r.snoozed = false;
    } else { r.nextDueAt = at + SNOOZE_MINUTES * MINUTE; r.snoozed = true; }
    if (state.queue.length) state.activeId = state.queue[0].id;
    return changed(state, { ok: true, todayCount: count(state, c.id, dateKey(at)), nextDueAt: r.nextDueAt });
  }
  function count(value, reminderId, date) {
    return Object.values(value.completions || {}).filter(e => e.reminderId === reminderId && e.date === date).length;
  }
  function snapshot(value, now = Date.now()) {
    const state = normalize(value), date = dateKey(now);
    return { revision: state.revision, date, configs: state.configs.map(c => ({ ...c, todayCount: count(state, c.id, date), nextDueAt: state.runtime[c.id]?.nextDueAt ?? null, snoozed: !!state.runtime[c.id]?.snoozed, waiting: state.queue.some(e => e.reminderId === c.id) })), active: active(state, now), todayTotal: Object.values(state.completions).filter(e => e.date === date).length };
  }
  /* A renderer's old full-DB save cannot erase main-process acknowledgments. */
  function mergeState(current, incoming) {
    if (!object(current)) return normalize(incoming);
    if (!object(incoming)) return normalize(current);
    const a = normalize(current), b = normalize(incoming), selected = clone(b.revision > a.revision ? b : a);
    selected.completions = { ...b.completions, ...a.completions };
    return normalize(selected);
  }
  return { MINUTE, SNOOZE_MINUTES, defaults, normalize, validateConfig, configure, remove, advance, active, act, snapshot, count, dateKey, mergeState };
});
