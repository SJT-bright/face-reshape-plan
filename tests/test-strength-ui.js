/* 力量训练视图集成验收：真实生产链路（main + IPC + preload + src/index.html）+ 隔离临时 profile。
   覆盖：不渲染秒表、组间休息、开始/暂停/继续和手填时长；保存、补记、切换训练日可用；
   历史不展示时长；建议卡不写死旧递进比例；「按建议更新模板」可用；模板编辑器排序仍可用。
   种子为纯本地合成数据，不触网；真实系统通知在主进程侧被禁用。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Notification } = require('electron');

const profile = process.argv[2];
if (!profile || !path.basename(profile).startsWith('face-strength-acceptance-')) throw new Error('Isolated test profile required');
app.setPath('userData', profile);
app.commandLine.appendSwitch('disk-cache-dir', path.join(profile, 'cache'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

/* 验收禁止真实系统通知：主进程 Notification 一律不弹（双保险：种子也关闭全部定时提醒） */
Notification.prototype.show = function () {};

const file = path.join(profile, 'face-reshape-data.json');
const now = new Date().toISOString();
/* 种子模板：推日 3 个动作，首个动作带「组间休息2分钟」目标（渲染为动作名下的 hint 与模板目标列） */
const seedDays = [
  {
    dayKey: 'push', name: '推日（胸肩三头）', bodyPart: '胸', isRest: false, note: '', ordinal: 0,
    actions: [
      { actionKey: 'push-a1', name: '哑铃卧推', plannedSets: 4, plannedRepsText: '10-12', plannedWeightText: '', targetText: '组间休息2分钟', note: '', ordinal: 0 },
      { actionKey: 'push-a2', name: '哑铃肩推', plannedSets: 3, plannedRepsText: '12', plannedWeightText: '轻重量', targetText: '肩胛后收', note: '', ordinal: 1 },
      { actionKey: 'push-a3', name: '绳索下压', plannedSets: 3, plannedRepsText: '15', plannedWeightText: '', targetText: '', note: '', ordinal: 2 }
    ]
  },
  {
    dayKey: 'pull', name: '拉日（背二头）', bodyPart: '背', isRest: false, note: '', ordinal: 1,
    actions: [
      { actionKey: 'pull-a1', name: '弹力带划船', plannedSets: 4, plannedRepsText: '12-15', plannedWeightText: '', targetText: '', note: '', ordinal: 0 }
    ]
  },
  {
    dayKey: 'legs', name: '腿日（臀腿）', bodyPart: '腿', isRest: false, note: '', ordinal: 2,
    actions: [
      { actionKey: 'legs-a1', name: '徒手深蹲', plannedSets: 4, plannedRepsText: '15-20', plannedWeightText: '', targetText: '', note: '', ordinal: 0 },
      { actionKey: 'legs-a2', name: '臀桥', plannedSets: 3, plannedRepsText: '12', plannedWeightText: '自重', targetText: '', note: '', ordinal: 1 }
    ]
  }
];
fs.writeFileSync(file, JSON.stringify({
  version: 1,
  /* 全部提醒时段置空 + sessions 清空 + grace 0：定时提醒引擎在验收窗口内零触发 */
  settings: {
    dailyTargetMinutes: 15, keepInTray: false, eveningReviewTime: '', skinLogReminderTime: '',
    skincareTimes: { morning: '', noon: '', evening: '' }, graceMinutes: 0, restDefaultSeconds: 90
  },
  videos: [], sessions: [], skincare: { cycles: [] },
  logs: { training: {}, skincare: {} }, reminderState: {},
  strength: {
    templates: [{
      id: 'tpl-seed-acceptance', name: '验收推拉腿', currentRevision: 1, createdAt: now, updatedAt: now,
      versions: [{ revision: 1, effectiveFrom: '2026-01-01', changeNote: '集成验收种子', createdAt: now, days: seedDays }]
    }],
    cycle: { 'tpl-seed-acceptance': { currentDayKey: 'push', revision: 1, updatedAt: now } },
    days: {
      '2026-08-01': {
        date: '2026-08-01', templateId: 'tpl-seed-acceptance', templateRevision: 1, dayKey: 'push',
        name: '推日（胸肩三头）', bodyPart: '胸', isRest: false, status: 'completed',
        totalSeconds: 2700, startedAt: '2026-08-01T01:00:00.000Z', pausedAt: null, revision: 2,
        supplements: { creatineTaken: null, proteinPowderTaken: null, note: '' },
        confirmedDurationMinutes: 45, note: '', completionText: '',
        actions: [
          { actionKey: 'push-a1', name: '哑铃卧推', plannedSets: 4, plannedRepsText: '10-12', plannedWeightText: '', targetText: '组间休息2分钟', setsDone: 4, repsText: '10', weightKg: 12, durationMinutes: 8, note: '' },
          { actionKey: 'push-a2', name: '哑铃肩推', plannedSets: 3, plannedRepsText: '12', plannedWeightText: '轻重量', targetText: '', setsDone: 3, repsText: '12', weightKg: null, durationMinutes: null, note: '' },
          { actionKey: 'push-a3', name: '绳索下压', plannedSets: 3, plannedRepsText: '15', plannedWeightText: '', targetText: '', setsDone: 3, repsText: '15', weightKg: null, durationMinutes: null, note: '' }
        ],
        resolution: { outcome: 'completed', note: '', cycleAdvanced: true, resolvedAt: '2026-08-01T02:00:00.000Z' },
        createdAt: '2026-08-01T01:00:00.000Z'
      }
    }, events: [], progress: []
  },
  sentinel: 'preserve-strength-seed'
}));

let started = false;
app.on('browser-window-created', (_event, win) => {
  if (started) return; started = true;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    const js = expression => win.webContents.executeJavaScript(expression);
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const wait = async condition => {
      const until = Date.now() + 15000;
      while (!(await js(condition))) { if (Date.now() > until) throw new Error(`Timed out: ${condition}`); await pause(35); }
    };
    try {
      await wait("typeof Store !== 'undefined' && Store.db && document.querySelector('#today-status-pill').textContent !== '加载中…'");
      await js("window.__errors=[];window.addEventListener('error',e=>__errors.push(e.message));window.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)))");

      /* a) 力量视图打开：生产链路渲染无错误 */
      await js("App.go('strength')");
      await pause(80); /* 含生产图标 MutationObserver */
      assert.equal(await js("App.currentView"), 'strength');
      assert.deepEqual(await js('__errors'), []);

      /* b) 秒表、组间休息、开始/暂停/继续、手填时长都不在；餐后时机提示仍在 */
      const timing = await js(`(() => {
        const labels = [...document.querySelectorAll('#view-root button')].map(b => b.textContent.replace(/\\s+/g, ''));
        const rule = document.querySelector('#st-advise .row > .hint');
        return {
          timer: !!document.querySelector('#st-timer'),
          rest: !!document.querySelector('#st-rest'),
          restLeft: !!document.querySelector('#st-rest-left'),
          minutes: !!document.querySelector('#st-conf-min'),
          clock: !!document.querySelector('.st-timer, .st-timer-row'),
          statusHidden: document.querySelector('#today-status-pill')?.classList.contains('hidden'),
          startPause: labels.some(t => /开始训练|暂停|继续/.test(t)),
          hint: !!document.querySelector('#st-meal-timing'),
          save: !!document.querySelector('#st-save'),
          tick: typeof Strength.tick,
          flush: typeof Strength._flushTimer,
          advise: !!document.querySelector('#st-advise'),
          apply: !!document.querySelector('#st-adv-apply'),
          rule: rule ? rule.textContent : ''
        };
      })()`);
      assert.equal(timing.timer, false);
      assert.equal(timing.rest, false);
      assert.equal(timing.restLeft, false);
      assert.equal(timing.minutes, false);
      assert.equal(timing.clock, false);
      assert.equal(timing.statusHidden, true);
      assert.equal(timing.startPause, false);
      assert.equal(timing.hint, true);
      assert.equal(timing.save, true);
      assert.equal(timing.tick, 'undefined');
      assert.equal(timing.flush, 'undefined');
      assert.equal(timing.advise, true);
      assert.equal(timing.apply, true);
      assert.equal(/2\.5|10%|0\.5\s*kg|连续两次|双递进|减载|到上限/.test(timing.rule), false);
      assert.match(timing.rule, /组数、次数和负重/);

      /* 今日记录不展示纯组间休息时长；其他动作说明仍显示。模板原文留到编辑器里核对 */
      const cues = await js(`(() => {
        const names = [...document.querySelectorAll('#st-actions .st-name')].map(el => el.innerText);
        return { rest: names.some(t => /组间休息/.test(t)), cue: names.some(t => t.includes('肩胛后收')) };
      })()`);
      assert.equal(cues.rest, false);
      assert.equal(cues.cue, true);

      /* c) 模板编辑器：#st-tpl-edit 进入后，动作行有 ↑/↓/删 三个操作按钮，且排序真实生效 */
      await js("document.querySelector('#st-tpl-edit').click()");
      const editor = await js(`(() => {
        const day = document.querySelector('.st-tpl-day');
        if (!day) return null;
        const row = day.querySelector('.st-act-row');
        return {
          rows: day.querySelectorAll('.st-act-row').length,
          up: !!row.querySelector('[data-move-act][data-dir="-1"]'),
          down: !!row.querySelector('[data-move-act][data-dir="1"]'),
          del: !!row.querySelector('[data-del-act]'),
          upDisabledAtTop: row.querySelector('[data-move-act][data-dir="-1"]').disabled,
          names: [...day.querySelectorAll('[data-akey="name"]')].map(i => i.value),
          targets: [...day.querySelectorAll('[data-akey="targetText"]')].map(i => i.value)
        };
      })()`);
      assert.deepEqual(editor, {
        rows: 3, up: true, down: true, del: true, upDisabledAtTop: true,
        names: ['哑铃卧推', '哑铃肩推', '绳索下压'],
        targets: ['组间休息2分钟', '肩胛后收', '']
      });
      /* 动作排序（近期改动）：点第 1 行 ↓ → 与第 2 行交换；↑/↓ 禁用是位置性边界（首行 ↑ 恒禁用、末行 ↓ 恒禁用） */
      await js("document.querySelector('.st-tpl-day .st-act-row [data-move-act][data-dir=\"1\"]').click()");
      assert.deepEqual(await js(`(() => {
        const day = document.querySelector('.st-tpl-day');
        const rows = [...day.querySelectorAll('.st-act-row')];
        return {
          names: rows.map(r => r.querySelector('[data-akey="name"]').value),
          firstUpDisabled: rows[0].querySelector('[data-move-act][data-dir="-1"]').disabled,
          firstDownDisabled: rows[0].querySelector('[data-move-act][data-dir="1"]').disabled,
          lastDownDisabled: rows[rows.length - 1].querySelector('[data-move-act][data-dir="1"]').disabled,
          draftNames: Strength.ui.tplDraft.days[0].actions.map(a => a.name)
        };
      })()`), {
        names: ['哑铃肩推', '哑铃卧推', '绳索下压'],
        firstUpDisabled: true, firstDownDisabled: false, lastDownDisabled: true,
        draftNames: ['哑铃肩推', '哑铃卧推', '绳索下压']
      });

      /* d) 回到今日训练后，计时控件和手填时长仍然不出现，餐后时机还在 */
      await js("document.querySelector('[data-tab=\"today\"]').click()");
      assert.equal(await js("!!document.querySelector('#st-rest') || !!document.querySelector('#st-timer') || !!document.querySelector('#st-conf-min')"), false);
      assert.equal(await js("!!document.querySelector('#st-meal-timing')"), true);

      /* e) 按建议更新模板：取消不改版本；确认后升一版，旧训练日和时长字段不动 */
      const beforeApply = await js(`(() => {
        const tpl = Store.db.strength.templates[0];
        const days = tpl.versions[tpl.versions.length - 1].days;
        return { rev: tpl.currentRevision, shape: days.map(d => d.dayKey + ':' + d.actions.map(a => a.name).join(',')) };
      })()`);
      await js("document.querySelector('#st-adv-apply').click()");
      await wait("!!document.querySelector('#m-cancel')");
      assert.match(await js("document.querySelector('#modal-card').innerText"), /按建议更新模板/);
      await js("document.querySelector('#m-cancel').click()");
      assert.equal(await js("Store.db.strength.templates[0].currentRevision"), beforeApply.rev);
      await js("document.querySelector('#st-adv-apply').click()");
      await wait("!!document.querySelector('#m-ok')");
      await js("document.querySelector('#m-ok').click()");
      await wait(`Store.db.strength.templates[0].currentRevision === ${beforeApply.rev + 1}`);
      assert.deepEqual(await js(`(() => {
        const tpl = Store.db.strength.templates[0];
        const days = tpl.versions[tpl.versions.length - 1].days;
        const old = Store.db.strength.days['2026-08-01'];
        return {
          rev: tpl.currentRevision,
          shape: days.map(d => d.dayKey + ':' + d.actions.map(a => a.name).join(',')),
          oldMin: old.confirmedDurationMinutes,
          oldSec: old.totalSeconds,
          oldSets: old.actions[0].setsDone
        };
      })()`), {
        rev: beforeApply.rev + 1,
        shape: beforeApply.shape,
        oldMin: 45,
        oldSec: 2700,
        oldSets: 4
      });

      /* f) 预览里切换训练日，不必确认 */
      const pulled = await js(`(() => {
        const sel = document.querySelector('#st-belong-day');
        sel.value = 'pull';
        sel.dispatchEvent(new Event('change'));
        return {
          title: document.querySelector('#st-today h3').textContent,
          first: document.querySelector('#st-actions .st-name').textContent,
          modal: !!document.querySelector('#m-ok')
        };
      })()`);
      assert.match(pulled.title, /拉日/);
      assert.match(pulled.first, /弹力带划船/);
      assert.equal(pulled.modal, false);
      await js(`(() => {
        const sel = document.querySelector('#st-belong-day');
        sel.value = 'push';
        sel.dispatchEvent(new Event('change'));
      })()`);
      assert.match(await js("document.querySelector('#st-today h3').textContent"), /推日/);

      /* g) 保存只写入组数、次数、负重 */
      const savedToday = await js(`(() => {
        const rows = [...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key="setsDone"]'));
        rows[0].querySelector('[data-key="setsDone"]').value = '4';
        rows[0].querySelector('[data-key="repsText"]').value = '10';
        rows[0].querySelector('[data-key="weightKg"]').value = '13.5';
        document.querySelector('#st-save').click();
        const date = StrengthCore.businessDate();
        const day = Store.db.strength.days[date];
        const a = day.actions[0];
        const shown = [...document.querySelectorAll('#st-actions .st-name')].map(el => el.innerText);
        return {
          date, name: day.name, sets: a.setsDone, reps: a.repsText, weight: a.weightKg,
          untouched: day.actions.slice(1).map(x => x.weightKg),
          minutes: day.confirmedDurationMinutes, seconds: day.totalSeconds, keptTarget: a.targetText,
          restShown: shown.some(t => /组间休息/.test(t)), cueShown: shown.some(t => t.includes('肩胛后收'))
        };
      })()`);
      assert.equal(savedToday.name.includes('推日'), true);
      assert.equal(savedToday.sets, 4);
      assert.equal(savedToday.reps, '10');
      assert.equal(savedToday.weight, 13.5);
      assert.deepEqual(savedToday.untouched, [null, null]); // 整行没动过仍算「没记」，不凭空记成自重
      assert.equal(savedToday.minutes, null);
      assert.equal(savedToday.keptTarget, '组间休息2分钟');
      assert.equal(savedToday.restShown, false);
      assert.equal(savedToday.cueShown, true);
      assert.equal(savedToday.seconds, 0);

      /* h) 已填写后再切换训练日：确认后换成新的一天，原来的组数清空 */
      await js(`(() => {
        const sel = document.querySelector('#st-belong-day');
        sel.value = 'legs';
        sel.dispatchEvent(new Event('change'));
      })()`);
      await wait("!!document.querySelector('#m-ok')");
      await js("document.querySelector('#m-ok').click()");
      await wait("document.querySelector('#st-today h3') && document.querySelector('#st-today h3').textContent.includes('腿日')");
      const switched = await js(`(() => {
        const date = StrengthCore.businessDate();
        const day = Store.db.strength.days[date];
        const input = document.querySelector('#st-actions [data-key="setsDone"]');
        return { name: day.name, first: document.querySelector('#st-actions .st-name').textContent, sets: day.actions[0].setsDone, input: input.value, minutes: day.confirmedDurationMinutes };
      })()`);
      assert.match(switched.name, /腿日/);
      assert.match(switched.first, /徒手深蹲/);
      assert.equal(switched.sets, null);
      assert.equal(switched.input, '');
      assert.equal(switched.minutes, null);

      /* i) 日期补记：前一天单独保存，不写到今天，也不写时长 */
      const backfill = await js(`(() => {
        document.querySelector('#st-dn-prev').click();
        const date = document.querySelector('#st-dn-date').value;
        const marker = document.querySelector('.st-dn-cur .hint').textContent;
        const rows = [...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key="setsDone"]'));
        rows[0].querySelector('[data-key="setsDone"]').value = '2';
        rows[0].querySelector('[data-key="repsText"]').value = '8';
        rows[0].querySelector('[data-key="weightKg"]').value = '6';
        document.querySelector('#st-save').click();
        const day = Store.db.strength.days[date];
        const today = StrengthCore.businessDate();
        return {
          date, marker, sets: day.actions[0].setsDone, reps: day.actions[0].repsText, weight: day.actions[0].weightKg,
          minutes: day.confirmedDurationMinutes, seconds: day.totalSeconds,
          notToday: date !== today,
          todayName: Store.db.strength.days[today].name
        };
      })()`);
      assert.equal(backfill.notToday, true);
      assert.match(backfill.marker, /补记/);
      assert.equal(backfill.sets, 2);
      assert.equal(backfill.reps, '8');
      assert.equal(backfill.weight, 6);
      assert.equal(backfill.minutes, null);
      assert.equal(backfill.seconds, 0);
      assert.match(backfill.todayName, /腿日/);

      /* j) 训练历史和日详情不展示时长；旧记录的时间字段仍在 */
      await js("document.querySelector('#st-dn-today').click()");
      const historyText = await js("[...document.querySelectorAll('.st-history-row')].map(el => el.innerText).join('\\n')");
      assert.match(historyText, /08-01/);
      assert.match(historyText, /10 组/);
      assert.match(historyText, /480/);
      assert.equal(/\d+\s*分钟/.test(historyText), false);
      await js("document.querySelector('[data-tab=\"history\"]').click()");
      const historyTab = await js("[...document.querySelectorAll('.st-history-row')].map(el => el.innerText).join('\\n')");
      assert.equal(/\d+\s*分钟/.test(historyTab), false);
      assert.match(historyTab, /08-01/);
      await js("document.querySelector('.st-history-row[data-date=\"2026-08-01\"]').click()");
      const modalText = await js("document.querySelector('#modal-card').innerText");
      assert.equal(/分钟/.test(modalText), false);
      assert.match(modalText, /4 组/);
      assert.match(modalText, /12kg/);
      await js("document.querySelector('#st-day-close').click()");

      /* k) 负重框兼容「自重」文本：可输入、存成明确自重 0、回显「自重」；练了留空同样按自重记；无法识别的写法报错且不落库 */
      await js("document.querySelector('[data-tab=\"today\"]').click()");
      await wait("!!document.querySelector('#st-actions [data-key=\"weightKg\"]')");
      const bwTyped = await js(`(() => {
        const box = document.querySelector('#st-actions [data-key="weightKg"]');
        const shape = { type: box.type, placeholder: box.placeholder };
        const rows = [...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key="setsDone"]'));
        rows[0].querySelector('[data-key="setsDone"]').value = '3';
        rows[0].querySelector('[data-key="repsText"]').value = '15';
        box.value = '自重';
        document.querySelector('#st-save').click();
        const a = Store.db.strength.days[StrengthCore.businessDate()].actions[0];
        return { shape, weight: a.weightKg, sets: a.setsDone,
          shown: document.querySelector('#st-actions [data-key="weightKg"]').value,
          lastCol: document.querySelectorAll('#st-actions .st-last')[0].innerText };
      })()`);
      assert.equal(bwTyped.shape.type, 'text');
      assert.equal(bwTyped.weight, 0);
      assert.equal(bwTyped.sets, 3);
      assert.equal(bwTyped.shown, '自重');
      assert.match(bwTyped.lastCol, /上次/);
      /* 自重记录进记录机制：容量腿不计负重，递进建议按自重走（不提示「负重没记」） */
      const bwRecord = await js(`(() => {
        const date = StrengthCore.businessDate();
        const state = Store.db.strength;
        const advice = StrengthCore.nextSessionAdvice(state, state.days[date]);
        const item = advice.items[0];
        const vol = StrengthCore.volumeOf(state.days[date]);
        return { bodyweight: item.bodyweight, unknown: item.weightUnknown, weightKg: item.weightKg, volume: vol.volume };
      })()`);
      assert.equal(bwRecord.bodyweight, true);
      assert.equal(bwRecord.unknown, false);
      assert.equal(bwRecord.weightKg, null);
      assert.equal(bwRecord.volume, 0);
      /* 练了却留空 = 自重：清掉文本再存一次，仍是明确自重 0 */
      const blankIsBw = await js(`(() => {
        const rows = [...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key="setsDone"]'));
        rows[0].querySelector('[data-key="weightKg"]').value = '';
        document.querySelector('#st-save').click();
        return { weight: Store.db.strength.days[StrengthCore.businessDate()].actions[0].weightKg,
                 shown: document.querySelector('#st-actions [data-key="weightKg"]').value };
      })()`);
      assert.equal(blankIsBw.weight, 0);
      assert.equal(blankIsBw.shown, '自重');
      /* 认不出的写法（如「轻重量」）报错且不覆盖已存记录 */
      const badWeight = await js(`(() => {
        const rows = [...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key="setsDone"]'));
        rows[0].querySelector('[data-key="weightKg"]').value = '轻重量';
        document.querySelector('#st-save').click();
        return {
          toast: [...document.querySelectorAll('.toast')].map(el => el.textContent).join('|'),
          weight: Store.db.strength.days[StrengthCore.businessDate()].actions[0].weightKg
        };
      })()`);
      assert.match(badWeight.toast, /自重/);
      assert.equal(badWeight.weight, 0);
      await js(`(() => { const rows = [...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key="setsDone"]')); rows[0].querySelector('[data-key="weightKg"]').value = '自重'; })()`);

      /* l) 按计划填充：与计划冲突的未保存手输先弹确认，取消全部保留，确认后才按计划覆盖；
            无冲突（留空、已与计划一致、显式 0 对计划「自重」）直接填不弹窗；全程只改 DOM 不落盘 */
      const prefillDate = await js("StrengthCore.businessDate()");
      await js(`(() => {
        const rows = [...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key="setsDone"]'));
        rows[0].querySelector('[data-key="setsDone"]').value = '2';
        rows[0].querySelector('[data-key="repsText"]').value = '9';
        rows[0].querySelector('[data-key="weightKg"]').value = '30';
      })()`);
      await js("document.querySelector('#st-prefill').click()");
      await wait("!!document.querySelector('#m-ok')");
      const prefillModalText = await js("document.querySelector('#modal-card').innerText");
      assert.match(prefillModalText, /覆盖已填写的数据/);
      assert.match(prefillModalText, /与计划不同/);
      await js("document.querySelector('#m-cancel').click()");
      await wait("!document.querySelector('#m-ok')");
      await pause(120);
      const prefillInputs = "(() => [...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key=\"setsDone\"]')).map(tr => ['setsDone','repsText','weightKg'].map(k => tr.querySelector('[data-key=\"' + k + '\"]').value)))()";
      const afterCancel = await js(prefillInputs);
      assert.deepEqual(afterCancel[0], ['2', '9', '30'], '取消后手输值必须原样保留');
      await js("document.querySelector('#st-prefill').click()");
      await wait("!!document.querySelector('#m-ok')");
      await js("document.querySelector('#m-ok').click()");
      await pause(120);
      assert.deepEqual(await js(prefillInputs), [
        ['4', '15-20', ''],
        ['3', '12', '自重']
      ], '确认后按计划覆盖；计划无负重的动作清空负重框（原填充语义不变）');
      /* 表格已与计划一致：再次点击不弹确认，直接填充（幂等） */
      await js("document.querySelector('#st-prefill').click()");
      await pause(350);
      assert.equal(await js("!!document.querySelector('#m-ok')"), false);
      assert.deepEqual(await js(prefillInputs), [
        ['4', '15-20', ''],
        ['3', '12', '自重']
      ]);
      /* 显式 0 与计划「自重」是同一负重：不算冲突，不弹确认 */
      await js(`(() => {
        const rows = [...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key="setsDone"]'));
        rows[1].querySelector('[data-key="weightKg"]').value = '0';
      })()`);
      await js("document.querySelector('#st-prefill').click()");
      await pause(350);
      assert.equal(await js("!!document.querySelector('#m-ok')"), false);
      assert.equal(await js(`[...document.querySelectorAll('#st-actions .st-tr')].filter(tr => tr.querySelector('[data-key="setsDone"]'))[1].querySelector('[data-key="weightKg"]').value`), '自重');
      /* 填充不落盘：今天盘上的记录仍是 (k) 保存的 3/15/0 */
      const prefillDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(prefillDisk.strength.days[prefillDate].actions[0].setsDone, 3);
      assert.equal(prefillDisk.strength.days[prefillDate].actions[0].repsText, '15');
      assert.equal(prefillDisk.strength.days[prefillDate].actions[0].weightKg, 0);

      const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(disk.sentinel, 'preserve-strength-seed');
      assert.equal(disk.strength.days['2026-08-01'].confirmedDurationMinutes, 45);
      assert.equal(disk.strength.days['2026-08-01'].totalSeconds, 2700);
      assert.equal(disk.strength.days['2026-08-01'].actions[0].durationMinutes, 8);
      assert.equal(disk.strength.days[savedToday.date].confirmedDurationMinutes, null);
      assert.equal(disk.strength.days[savedToday.date].totalSeconds, 0);
      assert.equal(disk.strength.days[backfill.date].confirmedDurationMinutes, null);
      assert.equal(disk.strength.templates[0].currentRevision, beforeApply.rev + 1);

      assert.deepEqual(await js('__errors'), []);
      console.log('PASS strength: no timer or duration entry, save/backfill/switch day work, history hides duration, advice copy is neutral, apply-to-template works');
      app.exit(0);
    } catch (error) {
      console.error(error);
      try { console.error('__errors:', JSON.stringify(await js('__errors'))); } catch {}
      app.exit(1);
    }
  });
});
require('../main');
