/* 跟练计划页：早晚各一个钟，打勾把该安排固定到对应时段，不再单独排一个每日固定练时间。 */
const FixedPractice = {
  decoratePlan() {
    if (FixedPracticeCore.migrateFace(Store.db)) Store.save(true);
    if ($('#pl-clock-morning')) return;
    const fixed = $('#pl-fixed-time');
    if (!fixed) return;
    const fixedWrap = fixed.parentElement;
    if (fixedWrap) fixedWrap.hidden = true;
    const minInput = $('#pl-fixed-min');
    const anchor = minInput ? minInput.parentElement : null;
    const row = fixedWrap && fixedWrap.parentElement;
    if (row && anchor) {
      const times = FixedPracticeCore.clock(Store.db, 'face');
      row.insertBefore(this.clockField('pl-clock-morning', '早上几点练', times.morning), anchor);
      row.insertBefore(this.clockField('pl-clock-evening', '晚上几点练', times.evening), anchor);
    }
    const btn = $('#pl-fixed-apply');
    if (btn) {
      btn.textContent = '保存早上和晚上的时间';
      btn.onclick = () => this.saveClocks();
    }
    const card = fixed.closest('.card');
    const hint = card && $$('p.hint', card).find(p => p.textContent.includes('想每天练 20 分钟'));
    if (hint) hint.textContent = '早上几点练、晚上几点练在这里定一次。下面打勾之后，就固定到对应时段的这个时间，不再单独安排一个每日固定练的时间。时长仍可在这里调整。';
    this.mountPins();
  },
  clockField(id, label, value) {
    const wrap = document.createElement('div');
    const lab = document.createElement('label');
    lab.className = 'field';
    lab.textContent = label;
    const input = document.createElement('input');
    input.className = 'input';
    input.id = id;
    input.type = 'time';
    input.setAttribute('style', 'width:130px');
    input.value = value || '';
    wrap.append(lab, input);
    return wrap;
  },
  saveClocks() {
    const morning = $('#pl-clock-morning') ? $('#pl-clock-morning').value : '';
    const evening = $('#pl-clock-evening') ? $('#pl-clock-evening').value : '';
    const fallback = Store.settings().dailyTargetMinutes;
    const min = Math.max(1, Math.min(300, +$('#pl-fixed-min').value || fallback));
    try {
      FixedPracticeCore.setFaceClock(Store.db, { morning, evening });
    } catch (error) {
      toast(error.message, 'red');
      return;
    }
    for (const sess of Store.db.sessions || []) if (sess && sess.fixedDaily) sess.targetMinutes = min;
    if (typeof UXCore !== 'undefined' && UXCore.changeTarget) UXCore.changeTarget(Store.db, min, todayKey());
    FixedPracticeCore.applyClock(Store.db);
    Store.save(true);
    App.refreshStatusPill();
    toast('早晚练习时间已保存 ✓', 'green');
    App.render();
  },
  mountPins() {
    const sessions = (Store.db.sessions || []).slice().sort((a, b) => (DailyPlanCore.time(a.time) ?? 0) - (DailyPlanCore.time(b.time) ?? 0));
    $$('#pl-sessions .session-item').forEach((el, index) => {
      const sess = sessions[index];
      const sw = $('label.switch', el);
      if (!sess || !sw || $('[data-pin-period]', el)) return;
      sw.before(this.pinBox(sess, 'morning', '早上'), this.pinBox(sess, 'evening', '晚上'));
    });
  },
  pinBox(sess, period, name) {
    const label = document.createElement('label');
    label.className = 'ux-pin-period';
    label.innerHTML = `<input type="checkbox" data-pin-period="${period}"> ${name}`;
    const input = $('input', label);
    input.checked = !!(sess.fixedDaily && sess.period === period);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', (e) => {
      e.stopPropagation();
      if (input.checked) {
        const time = FixedPracticeCore.timeFor(Store.db, 'face', period);
        if (!time) {
          input.checked = false;
          toast(period === 'morning' ? '先填写早上几点练' : '先填写晚上几点练');
          return;
        }
        sess.period = period;
        sess.fixedDaily = true;
        sess.enabled = true;
        sess.time = time;
        if (!sess.days || !sess.days.length) sess.days = [0, 1, 2, 3, 4, 5, 6];
        Store.save(true);
        App.render();
        return;
      }
      if (sess.period === period) {
        sess.fixedDaily = false;
        delete sess.period;
      }
      Store.save(true);
      App.render();
    });
    return label;
  }
};
const fixedPracticeRender = UX.afterRender.bind(UX);
UX.afterRender = function () {
  fixedPracticeRender();
  if (App.currentView === 'plan') FixedPractice.decoratePlan();
};
