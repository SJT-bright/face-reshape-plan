/* Explicit mount points for Settings and Today. All reminder writes use main IPC. */
const HabitRemindersUI = {
  state: null,
  escape(value) { return String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])); },
  time(value) { return value === null ? '' : new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); },
  next(config) { return !config.enabled ? '未启用' : config.waiting ? '等待处理' : config.nextDueAt !== null ? `${config.snoozed ? '稍后' : '下次'} ${this.time(config.nextDueAt)}` : '等待下一次提醒'; },
  async read() {
    if (!window.native?.habitReminderState) throw Error('周期提醒暂不可用');
    const result = await window.native.habitReminderState();
    if (!result.ok) throw Error(result.error || '读取提醒失败');
    this.state = result.state; return this.state;
  },
  async mount(root = document) {
    const panel = root.querySelector('#ux-reminders');
    if (!panel || panel.querySelector('#habit-reminders-settings')) return;
    const section = document.createElement('fieldset'); section.id = 'habit-reminders-settings'; section.className = 'ux-set-cluster habit-settings';
    section.innerHTML = '<legend>周期桌面提醒</legend><p class="hint">自定名称与间隔。弹窗只在确认完成后计数；稍等一下会在 5 分钟后重试。关闭应用窗口后常驻托盘时继续提醒，完全退出后不能提醒。</p><div class="habit-summary" aria-live="polite"></div><div class="habit-config-list"></div><button class="btn small" type="button" data-habit-add>添加提醒</button><div class="habit-create" hidden></div><p class="habit-error" role="alert"></p>';
    panel.appendChild(section);
    try { await this.read(); if (!section.isConnected) return; this.render(section); }
    catch (error) { section.querySelector('.habit-error').textContent = error.message; }
  },
  row(config, creating = false) {
    const esc = value => this.escape(value);
    return `<div class="habit-config" data-habit-id="${esc(config.id || '')}"><div class="habit-config-top"><b>${creating ? '新提醒' : esc(config.name)}</b>${creating ? '' : `<span data-habit-count>今天 ${config.todayCount} 次</span>`}<label class="habit-enabled"><input data-field="enabled" type="checkbox"${config.enabled ? ' checked' : ''}>启用</label></div><div class="habit-config-fields"><label>提醒名称<input class="input" data-field="name" maxlength="40" value="${esc(config.name)}" placeholder="例如：喝水提醒"></label><label>每隔几分钟<input class="input" data-field="intervalMinutes" type="number" min="1" max="1440" step="1" value="${esc(config.intervalMinutes)}"></label><label>完成按钮文字<input class="input" data-field="actionLabel" maxlength="60" value="${esc(config.actionLabel)}" placeholder="例如：我去喝水"></label></div><div class="habit-config-bottom"><small data-habit-next>${creating ? '保存启用后开始计时' : esc(this.next(config))}</small><div class="habit-row-actions"><button class="btn small primary" type="button" data-habit-save>${creating ? '添加' : '保存提醒'}</button><button class="btn small ghost" type="button" ${creating ? 'data-habit-cancel>取消' : 'data-habit-remove>删除'}</button></div></div><p class="habit-row-error habit-error" role="alert"></p></div>`;
  },
  render(section) {
    if (!this.state || !section.isConnected) return;
    section.querySelector('.habit-config-list').innerHTML = this.state.configs.map(config => this.row(config)).join('');
    section.querySelector('.habit-summary').textContent = `今天已确认完成 ${this.state.todayTotal} 次 · 默认提醒需自行启用`;
    const create = section.querySelector('.habit-create'), add = section.querySelector('[data-habit-add]');
    add.onclick = () => { create.hidden = false; create.innerHTML = this.row({ name: '', intervalMinutes: 10, actionLabel: '', enabled: true }, true); create.querySelector('[data-field="name"]').focus(); this.bindRow(create.firstElementChild, section); add.disabled = true; };
    section.querySelectorAll('.habit-config-list .habit-config').forEach(row => this.bindRow(row, section));
    if (!this.unsubscribe && window.native.onHabitReminderChanged) this.unsubscribe = window.native.onHabitReminderChanged(state => this.refresh(state));
  },
  draft(row) {
    return { id: row.dataset.habitId || undefined, name: row.querySelector('[data-field="name"]').value, intervalMinutes: Number(row.querySelector('[data-field="intervalMinutes"]').value), actionLabel: row.querySelector('[data-field="actionLabel"]').value, enabled: row.querySelector('[data-field="enabled"]').checked };
  },
  bindRow(row, section) {
    row.querySelectorAll('[data-field]').forEach(input => { input.oninput = input.onchange = () => { row.dataset.dirty = 'true'; }; });
    const save = row.querySelector('[data-habit-save]');
    save.onclick = async () => {
      const controls = [...row.querySelectorAll('input, button')], error = row.querySelector('.habit-row-error');
      error.textContent = ''; const draft = this.draft(row);
      if ([...row.querySelectorAll('input')].some(input => !input.reportValidity())) return;
      controls.forEach(control => { control.disabled = true; });
      try {
        const result = await window.native.habitReminderSave(draft, this.state.revision);
        if (!result.ok) { if (result.state) this.refresh(result.state); throw Error(result.error || '保存失败'); }
        this.state = result.state; delete row.dataset.dirty;
        const otherDrafts = [...section.querySelectorAll('.habit-config[data-dirty="true"]')].filter(x => x !== row).map(x => this.draft(x));
        this.render(section);
        for (const other of otherDrafts) {
          const target = [...section.querySelectorAll('.habit-config')].find(x => x.dataset.habitId === other.id); if (!target) continue;
          for (const field of ['name', 'intervalMinutes', 'actionLabel', 'enabled']) { const input = target.querySelector(`[data-field="${field}"]`); if (field === 'enabled') input.checked = other[field]; else input.value = other[field]; }
          target.dataset.dirty = 'true';
        }
        section.querySelector('.habit-create').hidden = true; section.querySelector('.habit-create').innerHTML = ''; section.querySelector('[data-habit-add]').disabled = false;
      } catch (failure) { error.textContent = failure.message; }
      finally { controls.forEach(control => { control.disabled = false; }); }
    };
    const cancel = row.querySelector('[data-habit-cancel]');
    if (cancel) cancel.onclick = () => { section.querySelector('.habit-create').hidden = true; section.querySelector('.habit-create').innerHTML = ''; section.querySelector('[data-habit-add]').disabled = false; };
    const remove = row.querySelector('[data-habit-remove]');
    if (remove) remove.onclick = async () => {
      const confirm = typeof confirmModal === 'function' ? await confirmModal('删除周期提醒', '停止这个提醒；已经确认的次数仍保留。', '删除') : window.confirm('停止这个提醒？已经确认的次数仍保留。');
      if (!confirm || !row.isConnected) return;
      remove.disabled = true;
      try { const result = await window.native.habitReminderRemove(row.dataset.habitId, this.state.revision); if (!result.ok) throw Error(result.error || '删除失败'); this.state = result.state; this.render(section); }
      catch (error) { row.querySelector('.habit-row-error').textContent = error.message; }
      finally { remove.disabled = false; }
    };
  },
  refresh(state) {
    if (!state || !Array.isArray(state.configs)) return;
    this.state = state;
    const section = document.querySelector('#habit-reminders-settings');
    if (section) {
      section.querySelector('.habit-summary').textContent = `今天已确认完成 ${state.todayTotal} 次 · 默认提醒需自行启用`;
      for (const row of section.querySelectorAll('.habit-config-list .habit-config')) {
        const c = state.configs.find(x => x.id === row.dataset.habitId); if (!c) continue;
        row.querySelector('[data-habit-count]').textContent = `今天 ${c.todayCount} 次`; row.querySelector('[data-habit-next]').textContent = this.next(c);
      }
    }
    const today = document.querySelector('#habit-reminders-today'); if (today) this.renderToday(today);
  },
  async mountToday(root = document) {
    const view = root.querySelector('.view'); if (!view || view.querySelector('#habit-reminders-today')) return;
    const card = document.createElement('section'); card.id = 'habit-reminders-today'; card.className = 'card habit-today';
    view.appendChild(card);
    try { await this.read(); if (card.isConnected) this.renderToday(card); }
    catch { card.remove(); }
    if (!this.unsubscribe && window.native.onHabitReminderChanged) this.unsubscribe = window.native.onHabitReminderChanged(state => this.refresh(state));
  },
  renderToday(card) {
    const configs = this.state?.configs.filter(c => c.enabled || c.todayCount > 0) || [];
    card.hidden = !configs.length;
    card.innerHTML = `<h3>今日习惯记录</h3><div class="habit-today-grid">${configs.map(c => `<div><span>${this.escape(c.name)}</span><b>${c.todayCount}<small> 次</small></b><small>${this.escape(this.next(c))}</small></div>`).join('')}</div><p class="hint">只统计桌面弹窗中确认完成的次数。</p>`;
  }
};
if (typeof module !== 'undefined') module.exports = HabitRemindersUI;
