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
      const target = Math.max(1, Store.targetFor ? Store.targetFor(this.selected) : Store.settings().dailyTargetMinutes || 15) * 60;
      const cells = monthCells(this.month), days = cells.filter(k => k && k <= today);
      const logs = Store.db.logs.training;
      const total = days.reduce((sum, k) => sum + (logs[k]?.seconds || 0), 0);
      const met = days.filter(k => Store.dayTargetMet(k)).length;
      const logged = days.filter(k => (logs[k]?.seconds || 0) > 0).length;
      const selectedLog = Store.dayTraining(this.selected), seconds = selectedLog.seconds || 0;
      const entries = selectedLog.entries || [];
      /* 专注参考：仅来自后台打断计数（跟练/今日界面零显示，只在此处呈现）。
         按时长加权平均各条目的 focusScore；手动补记（无打断字段）不参与。 */
      const focus = (() => {
        const withData = entries.filter(e => e.source === 'media-observed' && Number.isInteger(e.interruptions));
        let s = 0, w = 0, ints = 0, mins = 0;
        for (const e of withData) {
          const m = Math.max(1, Math.round((e.seconds || 0) / 60));
          const f = focusScore(e.interruptions || 0, m);
          if (f === null) continue;
          s += f * m; w += m; ints += e.interruptions || 0; mins += m;
        }
        return w ? { score: Math.round(s / w), ints, mins } : null;
      })();
      /* 近 7 天复盘（含今天）：训练/皮肤/睡眠/饮食跨度/专注，全部聚合自现有记录，观察参考口径 */
      const weekReview = (() => {
        try {
          const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
          let trained = 0, metDays = 0, minutesSum = 0;
          const skinScores = [], sleepList = [], spanList = [], focusList = [];
          for (const d of days) {
            const tl = Store.dayTraining(d);
            if ((tl.seconds || 0) > 0) { trained++; minutesSum += Math.round(tl.seconds / 60); }
            if (Store.dayTargetMet(d)) metDays++;
            const log = ((Store.db.skin || {}).logs || {})[d];
            const sc = log ? SkinEngine.scoreSkin(log) : null;
            if (sc && sc.score !== null) skinScores.push(sc.score);
            const sl = ((Store.db.rhythm || {}).sleeps || []).filter(s => RhythmEngine.hasSleep(s) && s.kind !== 'nap' && String(s.endLocal || '').slice(0, 10) === d)
              .sort((a, b) => RhythmEngine.sleepMinutes(b)-RhythmEngine.sleepMinutes(a))[0];
            if (sl) sleepList.push(RhythmEngine.sleepMinutes(sl));
            const ms = ((Store.db.rhythm || {}).meals || []).filter(m => typeof m.local === 'string' && m.local.slice(0, 10) === d).sort((a, b) => a.local.localeCompare(b.local));
            if (ms.length >= 2) spanList.push((Date.parse(ms[ms.length - 1].local) - Date.parse(ms[0].local)) / 3600000);
            for (const e of tl.entries || []) {
              if (e.source === 'media-observed' && Number.isInteger(e.interruptions)) {
                const f = focusScore(e.interruptions || 0, Math.max(1, Math.round((e.seconds || 0) / 60)));
                if (f !== null) focusList.push(f);
              }
            }
          }
          const avg = arr => arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null;
          const skinAvg = avg(skinScores), sleepAvg = avg(sleepList), spanAvg = avg(spanList), focusAvg = avg(focusList);
          const rows = [
            ['🏋️ 训练', `${trained} 天有记录 · 共 ${minutesSum} 分钟 · 达标 ${metDays} 天`],
            ['🔬 皮肤', skinAvg !== null ? `记录 ${skinScores.length} 天 · 平均 ${skinAvg} 分` : '本周未记录'],
            ['😴 睡眠', sleepAvg !== null ? `记录 ${sleepList.length} 晚 · 平均 ${Math.round(sleepAvg / 6) / 10} 小时` : '本周未记录'],
            ['🍚 进食跨度', spanAvg !== null ? `${spanList.length} 天有 ≥2 次记录 · 平均 ${Math.round(spanAvg * 10) / 10} 小时` : '记录不足（每天 ≥2 次才统计）'],
            ['🎯 专注', focusAvg !== null ? `${focusList.length} 条跟练 · 平均 ${focusAvg} 分` : '无后台数据']
          ];
          return `<div class="ac-week-review" style="margin-top:10px; padding:10px 12px; border:1px dashed rgba(83,102,123,.3); border-radius:10px">
            <div><b style="font-size:12.5px">📊 近 7 天复盘</b> <span class="ac-target">含今天 · 聚合自现有记录 · 观察参考</span></div>
            <div style="display:grid; gap:3px; margin-top:6px">${rows.map(([k, v]) => `<span style="font-size:12px; color:#53667b">${k}　${esc(v)}</span>`).join('')}</div>
          </div>`;
        } catch { return ''; }
      })();
      const date = new Date(`${this.selected}T12:00`);
      const status = seconds >= target ? '已达标' : seconds > 0 ? '未达目标' : '尚未记录';
      const icon = name => Icon3D.makeIcon(name).outerHTML;
      host.innerHTML = `
        <div class="ac-heading"><div><h3>${icon('calendar')}达标日历</h3><p>记录跟练计时和手动补记的时长，按当日目标显示达标情况。</p></div><button class="btn small" id="ac-manual">${icon('edit')}手动补记</button></div>
        <div class="ac-toolbar"><div class="ac-month-title"><label for="ac-month">查看月份</label><input id="ac-month" aria-label="选择查看月份" type="month" min="2000-01" max="${currentMonth}" value="${this.month}"></div><div class="ac-navigation"><button class="btn small ghost" id="ac-prev" ${this.month === '2000-01' ? 'disabled' : ''}>${icon('calendar')}上月</button><button class="btn small ghost" id="ac-today">${icon('target')}回到今天</button><button class="btn small ghost" id="ac-next" ${this.month === currentMonth ? 'disabled' : ''}>${icon('calendar')}下月</button></div></div>
        <div class="ac-layout"><div class="ac-month-panel">
          <div class="ac-weekdays" aria-hidden="true">${['一','二','三','四','五','六','日'].map(w => `<span>${w}</span>`).join('')}</div>
          <div class="ac-grid" role="group" aria-label="${this.month} 训练日历，可用方向键切换日期">${cells.map(key => {
            if (!key) return '<div class="ac-spacer" aria-hidden="true"></div>';
            const dayTarget=(Store.targetFor?Store.targetFor(key):target/60)*60;
            const sec = logs[key]?.seconds || 0, ratio = Math.min(1, sec / dayTarget), future = key > today;
            const state = sec >= dayTarget ? 'met' : sec > 0 ? 'partial' : 'unrecorded';
            const label = `${key}${key === today ? ' 今天' : ''}，${future ? '尚未到来' : sec ? this.minutes(sec) + (sec >= dayTarget ? '，已达标' : '，未达目标') : '尚无训练记录'}`;
            return `<button type="button" class="ac-day ${state}${key === today ? ' is-today' : ''}${key === this.selected ? ' is-selected' : ''}" data-no-icon data-date="${key}" aria-label="${esc(label)}" aria-pressed="${key === this.selected}" ${key === today ? 'aria-current="date"' : ''} tabindex="${key === this.selected ? '0' : '-1'}" ${future ? 'disabled' : ''}>
              <span class="ac-day-top"><b>${Number(key.slice(8))}</b>${key === today ? '<small>今天</small>' : ''}</span>
              <span class="ac-day-value">${sec && !future ? this.minutes(sec) : ''}</span>${state === 'met' && !future ? icon('check') : ''}
              ${sec && !future ? `<span class="ac-day-progress" style="--progress:${Math.max(2, ratio * 100)}%"></span>` : ''}
            </button>`;
          }).join('')}</div>
          <div class="ac-legend"><span><i class="unrecorded"></i>未记录</span><span><i class="partial"></i>已训练</span><span><i class="met"></i>已达标</span><span class="ac-target">所选日期目标 ${target / 60} 分钟</span></div>
        </div>
        <aside class="ac-detail" aria-label="所选日期的训练记录" aria-live="polite"><div class="ac-detail-date">${date.getMonth() + 1} 月 ${date.getDate()} 日 <span>星期${'日一二三四五六'[date.getDay()]}</span></div><div class="ac-day-status ${seconds >= target ? 'met' : ''}">${this.selected === today ? '今天 · ' : ''}${status}</div><div class="ac-detail-total"><strong>${this.minutes(seconds)}</strong><span>本日累计 / 目标 ${target / 60} 分钟</span></div><div class="ac-detail-track" aria-hidden="true"><i style="width:${Math.min(100, seconds / target * 100)}%"></i></div><p class="ac-detail-hint">${seconds >= target ? '当日目标已完成。' : seconds ? `距离达标还差 ${this.minutes(target - seconds)}。` : '点击上方“手动补记”，为这一天记下训练。'}</p>
          <div class="ac-entries">${entries.length ? entries.slice().reverse().map(entry => `<div class="ac-entry"><strong>${esc(entry.note || (entry.manual ? '手动记录' : Store.videoById(entry.videoId)?.title || '跟练记录'))}</strong><span>${esc(entry.start || '')}${entry.start ? ' · ' : ''}${this.minutes(entry.seconds)}${entry.completed ? '<span title="完播口径：本次跟练有效时长 ≥ 视频时长 80%（不足 120 秒按 3 分钟门槛）"> · ✅完整</span>' : ''}</span><button class="btn small ghost ac-entry-edit" data-id="${esc(entry.id)}" data-no-icon title="修改或删除这条记录">改</button></div>`).join('') : ''}</div>
          ${focus ? `<div class="ac-focus" title="专注参考：按每 10 分钟打断次数线性扣分（0 次满 100）。仅明确的手动暂停计为打断；缓冲、错误和未知暂停不扣分"><strong>🎯 专注参考 ${focus.score}</strong><span>打断 ${focus.ints} 次 · 计入 ${focus.mins} 分钟 · 规则估算 · 版本 1 · 缓冲等技术暂停不计入</span></div>` : ''}
          <div class="ac-month-summary"><span>本月已训练 <b>${logged}</b> 天</span><span>本月达标 <b>${met}</b> 天</span><span>本月累计 <b>${this.minutes(total)}</b></span></div>
        </aside></div>
        <div class="ac-footer">按各日期当时的目标显示达标状态<span>晚间护肤连续打卡 ${Store.stats().skStreak} 天</span></div>
        ${weekReview}`;
      $('#ac-prev', host).onclick = () => { this.changeMonth(shiftMonth(this.month, -1)); this.render(host); $('#ac-prev', host).focus(); };
      $('#ac-next', host).onclick = () => { this.changeMonth(shiftMonth(this.month, 1)); this.render(host); $('#ac-next', host).focus(); };
      $('#ac-today', host).onclick = () => { this.select(todayKey()); this.render(host); $('.ac-day.is-selected', host).focus(); };
      $('#ac-month', host).onchange = e => { if (e.target.validity.valid && validMonth(e.target.value)) { this.changeMonth(e.target.value); this.render(host); $('#ac-month', host).focus(); } };
      $('#ac-manual', host).onclick = () => Views.manualLogModal(this.selected);
      $$('.ac-entry-edit', host).forEach(b => {
        b.onclick = (e) => { e.stopPropagation(); Views.editTrainingEntryModal(this.selected, b.dataset.id); };
      });
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
