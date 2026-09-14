/* A month calendar: date layout is independent from labels and training state. */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') && value >= '2000-01'; }
  function monthCells(month) {
    if (!validMonth(month)) throw new Error('Invalid month');
    const [year, m] = month.split('-').map(Number);
    const offset = (new Date(year, m - 1, 1, 12).getDay() + 6) % 7;
    const length = new Date(year, m, 0, 12).getDate();
    return Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, i) => i >= offset && i < offset + length ? `${month}-${pad(i - offset + 1)}` : null);
  }
  function shiftMonth(month, delta) {
    const [year, m] = month.split('-').map(Number), d = new Date(year, m - 1 + delta, 1, 12);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  const calendar = {
    month: null, selected: null, monthCells, shiftMonth,
    select(date) { this.month = date.slice(0, 7); this.selected = date; },
    changeMonth(month) {
      if (!validMonth(month) || month > todayKey().slice(0, 7)) return;
      const day = this.selected?.slice(8) || '01';
      const last = monthCells(month).filter(Boolean).at(-1);
      this.month = month;
      this.selected = [month + '-' + day, last, todayKey()].sort()[0];
    },
    minutes(seconds) {
      if (!seconds) return '0 分钟';
      if (seconds < 60) return `${Math.round(seconds)} 秒`;
      return `${Math.round(seconds / 60 * 10) / 10} 分钟`;
    },
    render(host) {
      const today = todayKey(), currentMonth = today.slice(0, 7);
      if (!validMonth(this.month) || this.month > currentMonth) this.month = currentMonth;
      if (!this.selected || !this.selected.startsWith(this.month) || this.selected > today) this.selected = this.month === currentMonth ? today : this.month + '-01';
      const target = Math.max(1, Store.settings().dailyTargetMinutes || 15) * 60;
      const cells = monthCells(this.month), days = cells.filter(k => k && k <= today);
      const logs = Store.db.logs.training;
      const total = days.reduce((sum, k) => sum + (logs[k]?.seconds || 0), 0);
      const met = days.filter(k => (logs[k]?.seconds || 0) >= target).length;
      const logged = days.filter(k => (logs[k]?.seconds || 0) > 0).length;
      const selectedLog = Store.dayTraining(this.selected), seconds = selectedLog.seconds || 0;
      const entries = selectedLog.entries || [];
      const date = new Date(`${this.selected}T12:00`);
      const status = seconds >= target ? '已达标' : seconds > 0 ? '未达目标' : '尚未记录';
      const icon = name => Icon3D.makeIcon(name).outerHTML;
      host.innerHTML = `
        <div class="ac-heading"><div><h3>${icon('calendar')}达标日历</h3><p>把每一天的坚持，记在日期上。</p></div><button class="btn small" id="ac-manual">${icon('edit')}手动补记</button></div>
        <div class="ac-toolbar"><div class="ac-month-title"><label for="ac-month">查看月份</label><input id="ac-month" aria-label="选择查看月份" type="month" min="2000-01" max="${currentMonth}" value="${this.month}"></div><div class="ac-navigation"><button class="btn small ghost" id="ac-prev" ${this.month === '2000-01' ? 'disabled' : ''}>${icon('calendar')}上月</button><button class="btn small ghost" id="ac-today">${icon('target')}回到今天</button><button class="btn small ghost" id="ac-next" ${this.month === currentMonth ? 'disabled' : ''}>${icon('calendar')}下月</button></div></div>
        <div class="ac-layout"><div class="ac-month-panel">
          <div class="ac-weekdays" aria-hidden="true">${['一','二','三','四','五','六','日'].map(w => `<span>${w}</span>`).join('')}</div>
          <div class="ac-grid" role="group" aria-label="${this.month} 训练日历，可用方向键切换日期">${cells.map(key => {
            if (!key) return '<div class="ac-spacer" aria-hidden="true"></div>';
            const sec = logs[key]?.seconds || 0, ratio = Math.min(1, sec / target), future = key > today;
            const state = sec >= target ? 'met' : sec > 0 ? 'partial' : 'unrecorded';
            const label = `${key}${key === today ? ' 今天' : ''}，${future ? '尚未到来' : sec ? this.minutes(sec) + (sec >= target ? '，已达标' : '，未达目标') : '尚无训练记录'}`;
            return `<button type="button" class="ac-day ${state}${key === today ? ' is-today' : ''}${key === this.selected ? ' is-selected' : ''}" data-no-icon data-date="${key}" aria-label="${esc(label)}" aria-pressed="${key === this.selected}" ${key === today ? 'aria-current="date"' : ''} tabindex="${key === this.selected ? '0' : '-1'}" ${future ? 'disabled' : ''}>
              <span class="ac-day-top"><b>${Number(key.slice(8))}</b>${key === today ? '<small>今天</small>' : ''}</span>
              <span class="ac-day-value">${sec && !future ? this.minutes(sec) : ''}</span>${state === 'met' && !future ? icon('check') : ''}
              ${sec && !future ? `<span class="ac-day-progress" style="--progress:${Math.max(2, ratio * 100)}%"></span>` : ''}
            </button>`;
          }).join('')}</div>
          <div class="ac-legend"><span><i class="unrecorded"></i>未记录</span><span><i class="partial"></i>已训练</span><span><i class="met"></i>已达标</span><span class="ac-target">每日目标 ${target / 60} 分钟</span></div>
        </div>
        <aside class="ac-detail" aria-label="所选日期的训练记录" aria-live="polite"><div class="ac-detail-date">${date.getMonth() + 1} 月 ${date.getDate()} 日 <span>星期${'日一二三四五六'[date.getDay()]}</span></div><div class="ac-day-status ${seconds >= target ? 'met' : ''}">${this.selected === today ? '今天 · ' : ''}${status}</div><div class="ac-detail-total"><strong>${this.minutes(seconds)}</strong><span>本日累计 / 目标 ${target / 60} 分钟</span></div><div class="ac-detail-track" aria-hidden="true"><i style="width:${Math.min(100, seconds / target * 100)}%"></i></div><p class="ac-detail-hint">${seconds >= target ? '当日目标已完成。' : seconds ? `距离达标还差 ${this.minutes(target - seconds)}。` : '点击上方“手动补记”，为这一天记下训练。'}</p>
          <div class="ac-entries">${entries.length ? entries.slice().reverse().map(entry => `<div class="ac-entry"><strong>${esc(entry.note || (entry.manual ? '手动记录' : Store.videoById(entry.videoId)?.title || '跟练记录'))}</strong><span>${esc(entry.start || '')}${entry.start ? ' · ' : ''}${this.minutes(entry.seconds)}</span></div>`).join('') : ''}</div>
          <div class="ac-month-summary"><span>本月已训练 <b>${logged}</b> 天</span><span>本月达标 <b>${met}</b> 天</span><span>本月累计 <b>${this.minutes(total)}</b></span></div>
        </aside></div>
        <div class="ac-footer">按当前每日目标显示达标状态<span>晚间护肤连续打卡 ${Store.stats().skStreak} 天</span></div>`;
      $('#ac-prev', host).onclick = () => { this.changeMonth(shiftMonth(this.month, -1)); this.render(host); $('#ac-prev', host).focus(); };
      $('#ac-next', host).onclick = () => { this.changeMonth(shiftMonth(this.month, 1)); this.render(host); $('#ac-next', host).focus(); };
      $('#ac-today', host).onclick = () => { this.select(todayKey()); this.render(host); $('.ac-day.is-selected', host).focus(); };
      $('#ac-month', host).onchange = e => { if (e.target.validity.valid && validMonth(e.target.value)) { this.changeMonth(e.target.value); this.render(host); $('#ac-month', host).focus(); } };
      $('#ac-manual', host).onclick = () => Views.manualLogModal(this.selected);
      $$('.ac-day', host).forEach(button => {
        button.onclick = () => { this.select(button.dataset.date); this.render(host); $('.ac-day.is-selected', host).focus({ preventScroll: true }); };
        button.onkeydown = e => {
          const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          if (!(e.key in deltas)) return;
          e.preventDefault(); const next = addDays(button.dataset.date, deltas[e.key]);
          if (next < '2000-01-01' || next > todayKey()) return;
          this.select(next); this.render(host); $('.ac-day.is-selected', host).focus({ preventScroll: true });
        };
      });
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = calendar;
  else root.AchievementCalendar = calendar;
})(typeof window !== 'undefined' ? window : globalThis);
