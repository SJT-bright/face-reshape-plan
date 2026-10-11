/* Shared tactile controls. Values remain ordinary form fields for persistence/drafts. */
const SoftControls = {
  boot() {
    if (this.started) return;
    this.started = true;
    document.addEventListener('click', e => {
      const control = e.target.closest('button,a[href],summary,input[type=checkbox],input[type=radio],[role=button]');
      if (e.isTrusted && control && !control.disabled) this.sound(control.matches('.primary,[type=submit]') ? 'save' : 'tap');
    }, true);
    const refresh=()=>{UX.updateCareNow?.();UX.updateWatchingNow?.();};
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('focus',refresh);
    this.careTimer = setInterval(refresh, 1000);
  },
  sound(kind = 'tap') {
    if (Store.settings().clickSounds === false) return;
    try {
      this.audio ||= new AudioContext();
      if (this.audio.state === 'suspended') this.audio.resume();
      const now = this.audio.currentTime, oscillator = this.audio.createOscillator(), gain = this.audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(kind === 'save' ? 660 : 520, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === 'save' ? 880 : 380, now + .055);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.045, now + .006);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .09);
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.start(now); oscillator.stop(now + .1);
    } catch { /* Audio availability must never block a user action. */ }
  },
  stepper(input, options = {}) {
    if (!input || input.closest('.soft-stepper')) return;
    const label = options.label || input.getAttribute('aria-label') || input.closest('label')?.firstChild?.textContent?.trim() || '数值';
    const min = options.min ?? (Number(input.min) || 0), max = options.max ?? (Number(input.max) || 999);
    const step = options.step ?? (Number(input.step) || 1);
    const box = document.createElement('span'); box.className = 'soft-stepper';
    input.before(box); box.append(input);
    input.readOnly = true; input.setAttribute('aria-label', label); input.setAttribute('role', 'spinbutton');
    input.setAttribute('aria-valuemin', min); input.setAttribute('aria-valuemax', max);
    const arrows = document.createElement('span'); arrows.className = 'soft-stepper-arrows';
    arrows.innerHTML = `<button type="button" data-no-icon="true" aria-label="增加${esc(label)}">⌃</button><button type="button" data-no-icon="true" aria-label="减少${esc(label)}">⌄</button>`;
    box.append(arrows);
    const sync = () => {
      input.setAttribute('aria-valuetext', input.value || '0');
      input.setAttribute('aria-valuenow', Number(input.value) || Number(input.value.match(/\d+(?:\.\d+)?/)?.[0]) || 0);
      for (const b of arrows.children) b.disabled = input.disabled;
    };
    const adjust = direction => {
      if (input.disabled) return;
      const original = input.value;
      const values = options.range ? String(original).match(/\d+(?:\.\d+)?/g)?.map(Number) : null;
      if (values?.length > 1 && /^\d+(?:\.\d+)?\s*[-–~～]\s*\d+(?:\.\d+)?$/.test(original)) {
        const delta = Math.min(max - Math.max(...values), Math.max(min - Math.min(...values), direction * step));
        input.value = values.map(n => Number((n + delta).toFixed(2))).join('-');
      } else {
        const parsed = options.weight ? StrengthCore.parseWeightInput(original) : null;
        const number = parsed?.ok ? parsed.value ?? 0 : Number(original) || values?.[0] || 0;
        const next = Number(Math.max(min, Math.min(max, number + direction * step)).toFixed(2));
        input.value = options.weight && next === 0 ? '自重' : String(next);
      }
      if (input.value !== original) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      sync();
    };
    arrows.children[0].onclick = () => adjust(1); arrows.children[1].onclick = () => adjust(-1);
    input.addEventListener('keydown', e => { if (['ArrowUp','ArrowDown'].includes(e.key)) { e.preventDefault(); adjust(e.key === 'ArrowUp' ? 1 : -1); this.sound(); } });
    input.addEventListener('input', sync); sync();
  },
  bind(scope) {
    if (!scope) return;
    scope.querySelectorAll('#st-actions [data-key]').forEach(input => this.stepper(input, {
      label: { setsDone: '组数', repsText: '次数', weightKg: '重量' }[input.dataset.key],
      range: input.dataset.key === 'repsText', weight: input.dataset.key === 'weightKg',
      step: input.dataset.key === 'weightKg' ? .5 : 1, max: input.dataset.key === 'weightKg' ? 2000 : 999
    }));
    scope.querySelectorAll('[data-stepper],.ux-set-row [data-field]').forEach(input => this.stepper(input, {
      weight: input.dataset.field === 'weight', step: input.dataset.field === 'weight' ? .5 : Number(input.step) || 1
    }));
  },
  timePicker(input, { date = null, onDate = null } = {}) {
    if (!input || input._wheel) return input?._wheel;
    const picker = document.createElement('div'); picker.className = 'soft-time-picker';
    input.before(picker); input.type = 'hidden'; picker.append(input);
    const label = document.createElement('span'); label.className = 'soft-time-date';
    label.textContent = date ? `${date.replaceAll('-', ' / ')}${date === todayKey() ? ' · 今天' : ''}` : '上下滚动选择时间';
    picker.append(label);
    const wheels = document.createElement('div'); wheels.className = 'soft-time-wheels'; picker.append(wheels);
    const columns = [];
    const values = () => input.value.slice(-5).split(':').map(Number);
    let ready = false;
    const update = () => {
      if (!ready) return;
      const [hour, minute] = columns.map(c => Math.max(0, Math.min(c.count - 1, Math.round(c.el.scrollTop / 40))));
      const prefix = date ? (onDate?.() || date) + 'T' : '';
      const next = prefix + pad2(hour) + ':' + pad2(minute);
      if (input.value !== next) {
        input.value = next; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      label.textContent = date ? `${(onDate?.() || date).replaceAll('-', ' / ')}${(onDate?.() || date) === todayKey() ? ' · 今天' : ''}` : '上下滚动选择时间';
    };
    for (const [index, count, unit] of [[0,24,'小时'],[1,60,'分钟']]) {
      if (index) { const colon = document.createElement('b'); colon.className = 'soft-time-colon'; colon.textContent = ':'; wheels.append(colon); }
      const column = document.createElement('div'); column.className = 'soft-time-column';
      const heading = document.createElement('span'); heading.className = 'soft-time-unit'; heading.textContent = unit; column.append(heading);
      const viewport = document.createElement('div'); viewport.className = 'soft-time-wheel'; viewport.tabIndex = 0;
      viewport.setAttribute('role','spinbutton'); viewport.setAttribute('aria-label',unit); viewport.setAttribute('aria-valuemin','0'); viewport.setAttribute('aria-valuemax',count - 1);
      viewport.innerHTML = Array.from({length: count}, (_, i) => `<button type="button" data-no-icon="true" data-value="${i}" tabindex="-1">${pad2(i)}</button>`).join('');
      column.append(viewport); wheels.append(column); columns.push({ el: viewport, count });
      const selected = () => {
        const n = Math.max(0, Math.min(count - 1, Math.round(viewport.scrollTop / 40)));
        viewport.setAttribute('aria-valuenow',n);
        for (const item of viewport.children) item.classList.toggle('selected', Number(item.dataset.value) === n);
        update();
      };
      let settle;
      viewport.addEventListener('scroll', () => { selected(); clearTimeout(settle); settle = setTimeout(() => viewport.scrollTo({top: Math.round(viewport.scrollTop / 40) * 40, behavior:'smooth'}), 110); });
      viewport.addEventListener('wheel', e => { e.preventDefault(); viewport.scrollTop = Math.max(0, Math.min((count - 1) * 40, viewport.scrollTop + Math.sign(e.deltaY) * 40)); this.sound(); }, {passive:false});
      viewport.addEventListener('click', e => { const b=e.target.closest('[data-value]'); if (b) { viewport.scrollTop=Number(b.dataset.value)*40; selected(); } });
      let drag = null;
      viewport.addEventListener('pointerdown', e => { drag={y:e.clientY,top:viewport.scrollTop,moved:false}; });
      viewport.addEventListener('pointermove', e => {
        if(!drag||!e.buttons)return;
        if(Math.abs(e.clientY-drag.y)>5){drag.moved=true;viewport.setPointerCapture(e.pointerId);}
        if(drag.moved){e.preventDefault();viewport.scrollTop=drag.top+drag.y-e.clientY;}
      });
      viewport.addEventListener('pointerup', e => {
        if(!drag)return;
        if(drag.moved){viewport.scrollTop=Math.round(viewport.scrollTop/40)*40;selected();this.sound();}
        const moved=drag.moved;drag=null;
        if(moved)viewport.addEventListener('click', event=>{event.preventDefault();event.stopImmediatePropagation();},{capture:true,once:true});
      });
      viewport.addEventListener('pointercancel',()=>{drag=null;});
      viewport.addEventListener('keydown', e => {
        if (!['ArrowUp','ArrowDown','Home','End'].includes(e.key)) return;
        e.preventDefault(); viewport.scrollTop = e.key === 'Home' ? 0 : e.key === 'End' ? (count-1)*40 : viewport.scrollTop + (e.key === 'ArrowUp' ? -40 : 40); selected(); this.sound();
      });
    }
    const sync = () => { ready = false; const parts = values(); columns.forEach((c,i) => { c.el.scrollTop = (parts[i] || 0) * 40; c.el.setAttribute('aria-valuenow',parts[i] || 0); [...c.el.children].forEach(b => b.classList.toggle('selected',Number(b.dataset.value) === (parts[i] || 0))); }); ready = true; };
    input.addEventListener('input', () => { if (columns.some((c,i) => Math.round(c.el.scrollTop/40) !== values()[i])) sync(); });
    input._wheel = { sync, picker }; requestAnimationFrame(sync); return input._wheel;
  }
};
