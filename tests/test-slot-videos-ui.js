/* E：早晚槽位独立 + 数据分账 · Electron UI 测试（真实应用、隔离 profile、真实计时）。
   运行：FACE_RESHAPE_PROFILE=/tmp/fr-dev-20261011-e FACE_HUB_PORT=18481 electron tests/test-slot-videos-ui.js <write|restart>
   write：早上选 A → 晚上选 B → 切回早上仍是 A；同一视频双槽各自计时后分账正确。
   restart：同 profile 再启动，槽位记忆与当日分账仍在。 */
const { app } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const profile = process.env.FACE_RESHAPE_PROFILE;
if (!profile || !profile.startsWith('/tmp/') || path.basename(profile) !== 'fr-dev-20261011-e') {
  throw Error('必须用 FACE_RESHAPE_PROFILE=/tmp/fr-dev-20261011-e 指定隔离 profile 运行');
}
const mode = process.argv[2] || 'write';
if (!['write', 'restart'].includes(mode)) throw Error('mode 必须是 write 或 restart');
const clip = path.join(profile, 'slot-fixture.webm');
if (!fs.existsSync(clip)) throw Error('缺少合成视频：' + clip + '（先跑 tests/run-slot-videos.js）');
process.env.FACE_UX20_TEST = '1';
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const evidence = path.resolve('.zcode/dev-20261011/e-feature');
fs.mkdirSync(evidence, { recursive: true });

let once = false;
app.on('browser-window-created', (_, win) => {
  if (once) return;
  once = true;
  win.setBounds({ x: 40, y: 40, width: 1400, height: 920 });
  win.webContents.once('did-finish-load', async () => {
    const js = async code => {
      const expression = code.includes(';') && !code.trim().startsWith('(')
        ? `(async () => { ${code} })()` : `(async () => (${code}))()`;
      try { return await win.webContents.executeJavaScript(expression, true); }
      catch (error) { console.error('Failed expression:', code); throw error; }
    };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const wait = async code => {
      for (let i = 0; i < 120; i++) { if (await js(code)) return; await sleep(100); }
      throw Error('Timed out: ' + code);
    };
    const click = async selector => {
      const point = await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    };
    const shot = async name => {
      await sleep(500);
      fs.writeFileSync(path.join(evidence, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    const pick = (id, value) => `(() => { const s = document.querySelector('#ux-home-video-select'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change',{bubbles:true})); })()`;
    try {
      await wait("typeof Store !== 'undefined' && !!Store.db && !!document.querySelector('#ux-now')");
      await js('window.slotErrors=[];window.addEventListener("error",e=>{if(e.message)slotErrors.push(e.message)});window.addEventListener("unhandledrejection",e=>slotErrors.push(String(e.reason)));');
      if (mode === 'write') {
        /* 三个本地视频；va 最近使用（无记忆回落首个），无自动流程预设与安排，回落链确定 */
        await js(`Store.db.onboarding={done:true};Store.settings().autoPauseOnBlur=false;Store.settings().remindersEnabled=false;
          Store.db.videos=[
            {id:'va',title:'早课A',source:'local',localPath:${JSON.stringify(clip)},durationSec:30,lastUsedAt:'2026-10-11T01:00:00Z'},
            {id:'vb',title:'晚课B',source:'local',localPath:${JSON.stringify(clip)},durationSec:30,lastUsedAt:'2026-10-10T01:00:00Z'},
            {id:'vc',title:'放松C',source:'local',localPath:${JSON.stringify(clip)},durationSec:30,lastUsedAt:'2026-10-09T01:00:00Z'}];
          Store.db.sessions=[];Store.save(true);App.render();`);
        await wait("!!document.querySelector('#ux-home-video-select')");
        /* 「全部」：无记忆回落最近使用首个，进度显示总数 */
        assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'va');
        assert.match(await js("document.querySelector('#ux-home-video-progress').textContent"), /^今日已跟练 0 分钟$/);
        /* 早上：无记忆回落首个 va；选择只写早上槽位 */
        await click('[data-face-period="morning"]');
        await wait("UX.facePeriod==='morning'&&!!document.querySelector('#ux-home-video-select')");
        assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'va', '早上无记忆回落列表首个');
        assert.match(await js("document.querySelector('#ux-home-video-progress').textContent"), /^早上已跟练 0 分钟$/);
        await js(pick('sel', 'vb'));
        assert.equal(await js("Store.db.settings.videoSlots['face:morning']?.id"), 'vb', '选择写入早上槽位');
        assert.equal(await js("Store.db.settings.videoSlots['face:evening']"), undefined, '早上选择不写晚上槽位');
        /* 晚上：独立回落（va 刚被顶成最近使用），选择只写晚上槽位 */
        await js("Store.videoById('va').lastUsedAt=new Date().toISOString();Store.save(true);App.render();");
        await click('[data-face-period="evening"]');
        await wait("UX.facePeriod==='evening'&&!!document.querySelector('#ux-home-video-select')");
        assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'va', '晚上不读早上槽位记忆');
        await js(pick('sel', 'vc'));
        assert.equal(await js("Store.db.settings.videoSlots['face:evening']?.id"), 'vc');
        assert.equal(await js("Store.db.settings.videoSlots['face:morning']?.id"), 'vb', '晚上选择不覆盖早上槽位');
        /* 切回早上：仍是 vb */
        await click('[data-face-period="morning"]');
        await wait("UX.facePeriod==='morning'&&!!document.querySelector('#ux-home-video-select')");
        assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'vb', '切回早上仍是早上的选择');
        await shot('slot-write-morning-vb');
        /* 同视频双槽：晚上也选 vb */
        await click('[data-face-period="evening"]');
        await wait("UX.facePeriod==='evening'&&!!document.querySelector('#ux-home-video-select')");
        await js(pick('sel', 'vb'));
        assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'vb');
        /* 早上视图开练（vb）→ 真实计时 → 结束：入早上账 */
        await click('[data-face-period="morning"]');
        await wait("UX.facePeriod==='morning'&&!!document.querySelector('#ux-home-video-select')");
        await click('#ux-home-video-play');
        await wait("App.currentView==='follow'&&Session.active?.running&&!document.querySelector('#stage video').paused");
        await sleep(1600);
        assert.ok(await js('Session.active.seconds>=1'));
        await js("Session.stop();App.go('today')");
        await wait("UX.facePeriod==='morning'&&!!document.querySelector('#ux-home-video-progress')");
        assert.ok(await js("(Store.dayTraining(todayKey()).byPeriod||{}).morning>=1"), '早上会话入早上分账');
        assert.equal(await js("(Store.dayTraining(todayKey()).byPeriod||{}).evening"), undefined, '晚上还没有分账');
        assert.equal(await js("Store.dayTraining(todayKey()).entries.at(-1).period"), 'morning', 'entry 打上 morning');
        /* 借「改记录」把本次时长补到 95 秒（成就日历的修正路径），验证分账文案跟随 */
        await js("(() => { const en = Store.dayTraining(todayKey()).entries.at(-1); Store.updateTrainingEntry(todayKey(), en.id, { seconds: 95 }); App.render(); })()");
        assert.match(await js("document.querySelector('#ux-home-video-progress').textContent"), /^早上已跟练 2 分钟$/);
        /* 晚上同一视频 vb 开练：入晚上账，互不混 */
        await click('[data-face-period="evening"]');
        await wait("UX.facePeriod==='evening'&&!!document.querySelector('#ux-home-video-select')");
        assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'vb', '晚上槽位也是同一视频');
        await click('#ux-home-video-play');
        await wait("App.currentView==='follow'&&Session.active?.running&&!document.querySelector('#stage video').paused");
        await sleep(1600);
        await js("Session.stop();App.go('today')");
        await wait("UX.facePeriod==='evening'&&!!document.querySelector('#ux-home-video-progress')");
        const buckets = await js('Store.dayTraining(todayKey()).byPeriod');
        assert.ok(buckets.morning >= 1 && buckets.evening >= 1, '同一视频早晚各自分账');
        const total = await js('Store.dayTraining(todayKey()).seconds');
        assert.ok(Math.abs(total - (buckets.morning + buckets.evening)) < 2, '总数=两段之和');
        assert.deepEqual(await js("Store.dayTraining(todayKey()).entries.map(e => e.period)"), ['morning', 'evening']);
        await js("(() => { const en = Store.dayTraining(todayKey()).entries.at(-1); Store.updateTrainingEntry(todayKey(), en.id, { seconds: 130 }); App.render(); })()");
        assert.match(await js("document.querySelector('#ux-home-video-progress').textContent"), /^晚上已跟练 2 分钟$/);
        assert.match(await js("document.querySelector('#ux-home-video-progress').textContent"), /^晚上已跟练/, '晚上视图不混入早上总数');
        /* 晚上改回 vc，槽位记忆与分账落库后退出 */
        await js(pick('sel', 'vc'));
        assert.equal(await js("Store.db.settings.videoSlots['face:evening']?.id"), 'vc');
        await js('Store.flushSync()');
        await shot('slot-write-evening-vc');
        console.log('SLOT_VIDEOS_WRITE_PASS: 早晚槽位互不覆盖、可同可不同；同一视频双槽各自计时分账正确；entry 带 period；总数=两段之和');
      } else {
        /* 重启（同 profile）：槽位记忆与当日分账仍在 */
        assert.equal(await js("Store.db.settings.videoSlots['face:morning']?.id"), 'vb', '早上槽位记忆重启仍在');
        assert.equal(await js("Store.db.settings.videoSlots['face:evening']?.id"), 'vc', '晚上槽位记忆重启仍在');
        const buckets = await js('Store.dayTraining(todayKey()).byPeriod');
        assert.ok(buckets && buckets.morning >= 1 && buckets.evening >= 1, '当日分账重启仍在');
        assert.equal(await js("Store.dayTraining(todayKey()).entries.filter(e => e.period==='morning').length"), 1);
        assert.equal(await js("Store.dayTraining(todayKey()).entries.filter(e => e.period==='evening').length"), 1);
        const total = await js('Store.dayTraining(todayKey()).seconds');
        assert.ok(Math.abs(total - (buckets.morning + buckets.evening)) < 2, '重启后总数与分账一致');
        await click('[data-face-period="morning"]');
        await wait("UX.facePeriod==='morning'&&!!document.querySelector('#ux-home-video-select')");
        assert.equal(await js("document.querySelector('#ux-home-video-select').value"), 'vb', '重启后早上视图显示早上记忆');
        assert.match(await js("document.querySelector('#ux-home-video-progress').textContent"), /^早上已跟练 2 分钟$/);
        await shot('slot-restart-morning');
        console.log('SLOT_VIDEOS_RESTART_PASS: 槽位记忆与当日分账在同 profile 重启后仍在');
      }
      assert.deepEqual(await js('slotErrors'), []);
      app.exit(0);
    } catch (error) {
      console.error(error);
      await shot('slot-failure-' + mode);
      app.exit(1);
    }
  });
});
require('../main');
