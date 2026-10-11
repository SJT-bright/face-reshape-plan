/* 独立视频收藏夹的 Electron UI 验收。
   运行：node tests/test-video-collections-ui.js（两个真实进程：write → restart）。
   LIFE_COLLECTIONS_APP=/absolute/path/App.app 可测试目标 app.asar 内的实际代码。
   真实导入界面/保存 IPC，合成 B 站资料与播放器；不代表在线媒体播放验收。 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'life-video-collections-'));
  try {
    for (const stage of ['write', 'restart']) {
      execFileSync(require('electron'), [__filename, profile, stage], {
        stdio: 'inherit', env: { ...process.env, FACE_UX20_TEST: '1', FACE_RESHAPE_PROFILE: profile }
      });
    }
    console.log('VIDEO_COLLECTIONS_UI_PASS: isolated profile, two independent Electron processes, persisted 5 face + 5 awakening + DIY library; synthetic metadata/session routing only.');
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
} else {
  runElectron();
}

function runElectron() {
  const { app, ipcMain, session, dialog } = require('electron');
  const profile = process.argv[2];
  const stage = process.argv[3];
  if (!profile || !path.basename(profile).startsWith('life-video-collections-') || !['write', 'restart'].includes(stage)) {
    throw Error('Use node tests/test-video-collections-ui.js to create an isolated two-process test.');
  }
  process.env.FACE_UX20_TEST = '1';
  process.env.FACE_RESHAPE_PROFILE = profile;
  app.setPath('userData', profile);
  app.setPath('cache', path.join(profile, 'cache'));
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

  const target = process.env.LIFE_COLLECTIONS_APP;
  const label = process.env.LIFE_COLLECTIONS_EVIDENCE || (target ? 'app-bundle' : 'source');
  const evidence = path.resolve('.impeccable/review/video-collections', label.replace(/[^\w\u3400-\u9fff-]/g, '_'));
  fs.mkdirSync(evidence, { recursive: true });
  const dataFile = path.join(profile, 'face-reshape-data.json');
  const stateFile = path.join(profile, 'video-collections-test-state.json');
  const localSource = path.join(profile, 'synthetic-import-source.webm');
  const BVS = ['BV1xx411c7mA', 'BV1xx411c7mB', 'BV1xx411c7mC', 'BV1xx411c7mD', 'BV1xx411c7mE'];
  const HISTORY = '2026-10-02';
  const faceVideos = BVS.map((bvid, i) => ({
    id: 'old-face-' + i, title: '原瘦脸视频 ' + (i + 1), source: 'bilibili',
    bvid, cid: i + 1, page: 1, durationSec: 600, pic: '', favorite: i === 1,
    addedAt: '2026-09-29T08:00:00.000Z'
  }));
  const oldRecords = {
    training: { [HISTORY]: { seconds: 120, targetMinutes: 15, entries: [{ id: 'old-entry', videoId: 'old-face-0', seconds: 120, completed: false, note: '原训练记录' }] } },
    skincare: { [HISTORY]: { morning: ['old-clean'], day: [], evening: ['old-hydrate'] } },
    sessions: [{ id: 'old-plan', name: '原瘦脸安排', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], videoId: 'old-face-0', enabled: true }]
  };
  if (stage === 'write') {
    fs.writeFileSync(dataFile, JSON.stringify({
      version: 1, freshInstall: false, onboarding: { done: true },
      videos: faceVideos, sessions: oldRecords.sessions, skincare: { cycles: [] },
      logs: { training: oldRecords.training, skincare: oldRecords.skincare },
      settings: { dailyTargetMinutes: 15, keepInTray: false, remindersEnabled: false, autoPauseOnBlur: false, skinLogReminderTime: '', sleepLogReminderTime: '', eveningReviewTime: '' },
      reminderState: {}
    }, null, 2));
  }

  // 所有 iframe 请求都走明确的合成页面；本测试不访问真实 B 站账号或视频。
  app.whenReady().then(() => session.defaultSession.protocol.handle('https', request => {
    const url = new URL(request.url);
    if (url.hostname === 'player.bilibili.com') {
      return new Response('<!doctype html><html><body><video controls muted></video></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('', { status: 404 });
  }));

  const infoRequests = [];
  let started = false;
  app.on('browser-window-created', (_, win) => {
    if (started) return;
    started = true;
    win.webContents.once('did-finish-load', async () => {
      const js = async expression => {
        try { return await win.webContents.executeJavaScript(`(async () => (${expression}))()`, true); }
        catch (error) { console.error('Failed expression:', expression); throw error; }
      };
      const run = body => js(`(async () => { ${body} })()`);
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const wait = async (expression, message = expression) => {
        for (let i = 0; i < 120; i++) {
          if (await js(expression)) return;
          await pause(70);
        }
        throw Error('Timed out: ' + message);
      };
      const click = async selector => {
        // 页面入场和重绘会移动按钮；等位置稳定后再投递真实坐标点击。
        let prior;
        for (let attempt = 0; attempt < 12; attempt++) {
          const bounds = await js(`(() => { const element=document.querySelector(${JSON.stringify(selector)});if(!element)return null;element.scrollIntoView({block:'center',behavior:'instant'});const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
          if (prior && bounds && Math.abs(bounds.x-prior.x)<.5 && Math.abs(bounds.y-prior.y)<.5) break;
          prior=bounds;await pause(80);
        }
        const point = await js(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) throw Error('Missing UI element: ' + ${JSON.stringify(selector)});
          element.scrollIntoView({block:'center',behavior:'instant'});
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') throw Error('Invisible UI element: ' + ${JSON.stringify(selector)});
          const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
          if(!element.contains(hit))throw Error('Click target covered: '+${JSON.stringify(selector)}+' by '+(hit?.outerHTML||'outside window'));
          return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
        })()`);
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
        await pause(80); // 原生鼠标队列先处理完，再读取 DOM 状态。
      };
      const closeDialog = async () => {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await wait("document.querySelector('#modal-mask').classList.contains('hidden')");
      };
      const shot = async name => {
        await pause(550);
        fs.writeFileSync(path.join(evidence, stage + '-' + name + '.png'), (await win.webContents.capturePage()).toPNG());
      };
      const nav = id => id === 'face' ? '.nav-item[data-view="today"]' : '#video-collections-nav [data-collection-id=' + JSON.stringify(id) + ']';
      const selectCollection = async id => {
        await click(nav(id));
        await wait(`Store.currentMode() === ${JSON.stringify(id)} && !!document.querySelector('#td-vids')`);
      };
      const libraryIds = () => js("[...document.querySelectorAll('#td-vids .vid-card')].map(card=>card.dataset.video)");
      const assertLibrary = async id => {
        const expected = await js(`Store.videosForMode(${JSON.stringify(id)}).map(video=>video.id)`);
        assert.deepEqual((await libraryIds()).sort(), expected.sort(), '实际显示的卡片仅属于 ' + id);
        const options = await js("[...document.querySelectorAll('#ux-home-video-select option')].map(option=>option.value)");
        if (options.length) assert.deepEqual(options.sort(), expected.sort(), '快捷播放选择只含当前板块');
      };
      const exposeLibrary = async () => {
        if (await js("!!document.querySelector('#ux-library-panel') && !document.querySelector('#ux-library-panel').open")) {
          await click('#ux-library-panel summary');
        }
      };
      const importVideos = async (ids, added = ids.length) => {
        const mode = await js('Store.currentMode()');
        const before = await js('Store.videosForMode().length');
        await exposeLibrary();
        await click('#td-import');
        await wait("!!document.querySelector('#ux-import-text')");
        await run(`const input=document.querySelector('#ux-import-text');input.value=${JSON.stringify(ids.join('\n'))};input.dispatchEvent(new Event('input',{bubbles:true}));`);
        await click('#ux-import-go');
        await wait(`Store.videosForMode(${JSON.stringify(mode)}).length === ${before + added} && !document.querySelector('#ux-import-go').disabled`, '导入完成并落盘');
        const status = await js("document.querySelector('#ux-import-results').textContent");
        assert.ok(/成功|重复/.test(status), status);
        assert.doesNotMatch(status, /失败/);
        await closeDialog();
        await assertLibrary(mode);
      };
      const fillCollection = async (name, periods) => {
        await run(`const input=document.querySelector('#vc-name');input.value=${JSON.stringify(name)};input.dispatchEvent(new Event('input',{bubbles:true}));
          document.querySelectorAll('input[name="vc-period"]').forEach(input=>{input.checked=${JSON.stringify(periods)}.includes(input.value);input.dispatchEvent(new Event('change',{bubbles:true}));});`);
      };
      const createCollection = async (name, periods) => {
        await click('.nav-item[data-view="settings"]');
        await click('#ux-tab-collections');
        await click('#add-video-collection');
        await wait("!!document.querySelector('#vc-name')");
        await fillCollection(name, periods);
        await click('#vc-save');
        await wait(`!!Store.collections().find(collection=>collection.name===${JSON.stringify(name)}) && document.querySelector('#modal-mask').classList.contains('hidden')`);
        const id = await js(`Store.collections().find(collection=>collection.name===${JSON.stringify(name)}).id`);
        await selectCollection(id);
        return id;
      };
      const visibleCollectionIds = () => js("[...document.querySelectorAll('#video-collections-nav [data-collection-id]')].filter(button=>!button.hidden && getComputedStyle(button).display!=='none').map(button=>button.dataset.collectionId).sort()");
      const assertOriginalRecords = async () => {
        const records = await js('({training:Store.db.logs.training,skincare:Store.db.logs.skincare,sessions:Store.db.sessions})');
        assert.deepEqual(records, oldRecords, '旧训练、护肤与安排记录保持原样');
        assert.deepEqual(await js("Store.videosForMode('face')"), faceVideos, '旧 5 个视频逐字段保持原样');
      };
      const runtimeErrors = [];
      try {
        await wait("typeof UX!=='undefined' && !!Store.db && !!document.querySelector('#video-collections-nav [data-collection-id=\"awakening\"]')");
        await run("window.__collectionRuntimeErrors=[];window.addEventListener('error',event=>{if(event.message)__collectionRuntimeErrors.push(event.message)});window.addEventListener('unhandledrejection',event=>__collectionRuntimeErrors.push(String(event.reason)));");
        assert.equal(await js('document.title'), '人生重塑计划');
        assert.equal(await js("document.querySelector('.brand-name').textContent"), '人生重塑计划');
        assert.equal(path.resolve(await js('native.userDataPath()')), path.resolve(profile));

        if (stage === 'write') {
          await selectCollection('face');
          await assertLibrary('face');
          await assertOriginalRecords();
          await selectCollection('awakening');
          assert.equal(await js('Store.videosForMode().length'), 0, '新认知库从空库开始');
          await importVideos(BVS);
          assert.equal(await js('Store.db.videos.length'), 10);
          assert.equal(await js(`Store.db.videos.filter(video=>video.bvid===${JSON.stringify(BVS[0])}).length`), 2, '同 BV 可分别存在瘦脸和认知库');
          const awakeningIds = await js("Store.videosForMode('awakening').map(video=>video.id)");
          await importVideos([BVS[0]], 0);
          assert.equal(infoRequests.length, 5, '当前库重复项不重新获取资料');
          // 收藏按钮必须修改当前库卡片，不能按全库数组下标修改原瘦脸视频。
          await click('#td-vids .vid-card .ux-video-controls button');
          assert.equal(await js(`Store.videoById(${JSON.stringify(awakeningIds[0])}).favorite`), true);
          assert.equal(await js("Store.videoById('old-face-0').favorite"), false);
          await shot('awakening-five');

          const customId = await createCollection('晨间斗志', ['morning']);
          await importVideos([BVS[0]]);
          const customVideoId = await js('Store.videosForMode()[0].id');
          assert.notEqual(customVideoId, awakeningIds[0]);
          /* 【H 裁决 2026-10-11】此处原断言点击侧栏 [data-period-filter] 做「板块早晚筛选」。
             该筛选已在本工作区改动集中被有意移除，依据：
             · docs/video-period-filter-investigation-20261006.md 记录了该筛选「左侧按钮高亮、右侧内容与当前页脱节」的交互缺陷并建议重设计；
             · CHANGELOG 1.8.3「早晚切换移入瘦脸护理页面」、1.8.4「认知到点切换早晚时段并按独立观看目标提醒」——时段入口移到板块页顶部切换器（views.js data-watch-period）与「设置 → 视频板块」表单（vc-period 复选框）；
             · 当前源码（src/）无任何 data-period-filter 渲染，UX.filterCollections 已成无事件绑定的遗留助手。
             故按当前设计断言：① 侧栏无筛选按钮、始终列出全部板块；② 板块页顶部 data-watch-period
             按板块适用时段渲染、可真实切换且切时段不导航去其他板块。 */
          await selectCollection(customId);
          assert.equal(await js("document.querySelectorAll('[data-period-filter]').length"), 0, '侧栏不再渲染板块早晚筛选按钮');
          assert.deepEqual(await visibleCollectionIds(), ['awakening', customId].sort(), '侧栏始终列出全部板块（不按时段隐藏）');
          assert.deepEqual(await js("[...document.querySelectorAll('[data-watch-period]')].map(b=>b.dataset.watchPeriod)"), ['morning'], '仅早上板块的页面只渲染早上切换器');
          await selectCollection('awakening');
          assert.deepEqual(await js("[...document.querySelectorAll('[data-watch-period]')].map(b=>b.dataset.watchPeriod)"), ['morning', 'evening']);
          await click('[data-watch-period="evening"]');
          assert.equal(await js("document.querySelector('[data-watch-period=\"evening\"]').getAttribute('aria-pressed')"), 'true', '板块页时段切换器可真实切换');
          assert.equal(await js("document.querySelector('[data-watch-period=\"morning\"]').getAttribute('aria-pressed')"), 'false');
          assert.equal(await js('Store.currentMode()'), 'awakening', '切时段只换视图，不导航去其他板块');
          await selectCollection(customId);
          await click('#edit-video-collection');
          await wait("!!document.querySelector('#vc-name')");
          await fillCollection('夜间复盘', ['evening']);
          await click('#vc-save');
          await wait("document.querySelector('#modal-mask').classList.contains('hidden')");
          assert.equal(await js('Store.currentMode()'), customId);
          assert.deepEqual(await js('Store.currentCollection().periods'), ['evening']);
          assert.equal(await js('Store.videosForMode()[0].id'), customVideoId);
          assert.deepEqual(await js("[...document.querySelectorAll('[data-watch-period]')].map(b=>b.dataset.watchPeriod)"), ['evening'], '改时段后板块页切换器只剩晚上');
          await shot('custom-evening');

          // 只注入合成 Session 时长，验证真实 UI 结束按钮与日志路由；没有宣称播放已成功。
          await selectCollection('awakening');
          await run(`App.launchFollow(${JSON.stringify(awakeningIds[0])});`);
          await wait("!!document.querySelector('#f-video') && !!Session.active");
          assert.deepEqual((await js("[...document.querySelectorAll('#f-video option')].map(option=>option.value)")).sort(), awakeningIds.sort());
          assert.equal(await js('Session.active.mode'), 'awakening');
          await run("Session.active.awaitingPlay=false;Session.active.running=false;Session.active.seconds=300;Views.syncTimerUI(document.querySelector('#view-root'));");
          await click('#t-stop');
          await wait('Session.active === null');
          assert.equal(await js("Store.dayWatching(todayKey(),'awakening').seconds"), 300);
          assert.equal(await js('Store.dayTraining(todayKey()).seconds'), 0);
          assert.equal(await js('Store.dayTargetMet(todayKey())'), false);
          await selectCollection(customId);
          await run(`App.launchFollow(${JSON.stringify(customVideoId)});`);
          await wait("!!document.querySelector('#f-video') && !!Session.active");
          assert.deepEqual(await js("[...document.querySelectorAll('#f-video option')].map(option=>option.value)"), [customVideoId]);
          await run("Session.active.awaitingPlay=false;Session.active.running=false;Session.active.seconds=180;Views.syncTimerUI(document.querySelector('#view-root'));");
          await click('#t-stop');
          await wait('Session.active === null');
          assert.equal(await js(`Store.dayWatching(todayKey(),${JSON.stringify(customId)}).seconds`), 180);
          await selectCollection(customId);

          // 写失败时保留可重试输入，既不假成功也不改变最后落盘名称。
          await click('#edit-video-collection');
          await wait("!!document.querySelector('#vc-name')");
          await fillCollection('夜间复盘 · 放松', ['evening']);
          fs.writeFileSync(path.join(profile, 'inject-save-failure'), '1');
          await click('#vc-save');
          await wait("!!document.querySelector('#vc-error').textContent");
          assert.equal(await js('Store.currentCollection().name'), '夜间复盘');
          assert.equal(await js("document.querySelector('#vc-name').value"), '夜间复盘 · 放松');
          assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).videoCollections.find(c => c.id === customId).name, '夜间复盘');
          fs.rmSync(path.join(profile, 'inject-save-failure'));
          await click('#vc-save');
          await wait("document.querySelector('#modal-mask').classList.contains('hidden')");
          assert.equal(await js('Store.currentCollection().name'), '夜间复盘 · 放松');

          const temporary = await createCollection('临时收藏夹', ['morning']);
          await importVideos([BVS[1]]);
          // 本地合成文件只验证导入/目录扫描，绝不把无媒体流文件当作可播放证据。
          fs.writeFileSync(localSource, 'synthetic fixture: import and folder-scan only');
          await click('#td-import');
          await wait("!!document.querySelector('#ux-import-local')");
          await click('#ux-import-local');
          await wait('Store.videosForMode().length === 2');
          const localPath = await js("Store.videosForMode().find(video=>video.source==='local').localPath");
          assert.equal(path.dirname(localPath), path.join(profile, 'imported-videos'), '真实导入 IPC 复制至隔离媒体目录');
          assert.equal(fs.existsSync(localPath), true);
          assert.ok((await js('Store.db.videoFolderExclusions')).includes(localPath));
          await closeDialog();
          await click('#edit-video-collection');
          await wait("!!document.querySelector('#vc-delete')");
          await click('#vc-delete');
          await wait("!!document.querySelector('#m-ok')");
          await click('#m-ok');
          await wait(`!Store.collectionById(${JSON.stringify(temporary)}) && document.querySelector('#modal-mask').classList.contains('hidden')`);
          assert.equal(await js(`Store.videosForMode(${JSON.stringify(temporary)}).length`), 0);
          await wait('!UX._syncingVideos');
          assert.equal((await js('native.listNewVideos([])')).length, 1, '保留媒体文件原始扫描可发现该文件');
          await run('await UX.syncFolderVideos(true);');
          assert.ok((await js('Store.db.videoFolderExclusions')).includes(localPath), '删除引用仍保留路径排除');
          assert.equal(await js("Store.videosForMode('face').length"), 5, '真实媒体目录自动扫描不把已删除认知文件混入瘦脸库');
          assert.equal(await js("Store.videosForMode('awakening').length"), 5);
          assert.equal(await js(`Store.videosForMode(${JSON.stringify(customId)}).length`), 1);
          await assertOriginalRecords();
          await selectCollection(customId);
          await run('Store.flushSync();');
          const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
          assert.equal(persisted.videos.length, 11);
          assert.deepEqual(persisted.logs.training, oldRecords.training);
          fs.writeFileSync(stateFile, JSON.stringify({
            customId, customVideoId, awakeningIds, today: await js('todayKey()'),
            originalRecords: oldRecords, faceVideos, excludedLocalPath: localPath
          }, null, 2));
          await shot('saved-custom');
          console.log('VIDEO_COLLECTIONS_UI_WRITE_PASS: 5+5 isolation, same BV across libraries, scoped favorite, DIY create/rename/time filter, filtered immersion, synthetic session logs, save rollback/retry, scoped deletion, disk records preserved.');
        } else {
          const expected = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
          assert.equal(await js('Store.currentMode()'), expected.customId, '真实新进程恢复当前收藏夹');
          assert.ok((await js('Store.db.videoFolderExclusions')).includes(expected.excludedLocalPath), '真实重启恢复媒体排除路径');
          assert.equal(await js('Store.currentCollection().name'), '夜间复盘 · 放松');
          assert.deepEqual(await js('Store.currentCollection().periods'), ['evening']);
          await assertLibrary(expected.customId);
          assert.equal(await js('Store.videosForMode()[0].id'), expected.customVideoId);
          assert.equal(await js(`Store.dayWatching(${JSON.stringify(expected.today)},${JSON.stringify(expected.customId)}).seconds`), 180);
          assert.equal(await js(`Store.dayWatching(${JSON.stringify(expected.today)},'awakening').seconds`), 300);
          await selectCollection('awakening');
          await assertLibrary('awakening');
          assert.equal(await js('Store.videosForMode().length'), 5);
          assert.equal(await js(`Store.videoById(${JSON.stringify(expected.awakeningIds[0])}).favorite`), true);
          await selectCollection('face');
          await assertLibrary('face');
          assert.equal(await js('Store.videosForMode().length'), 5);
          await assertOriginalRecords();
          await selectCollection(expected.customId);
          for (const [width, height] of [[1240, 820], [980, 640]]) {
            win.setSize(width, height);
            await pause(200);
            assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true, '窗口不横向溢出');
            assert.equal(await js("document.querySelector('#view-root').scrollWidth <= document.querySelector('#view-root').clientWidth + 1"), true, '内容区不横向溢出');
            await shot('restored-' + width);
          }
          assert.equal(infoRequests.length, 0, '重启仅复读保存资料，不重新导入视频');
          console.log('VIDEO_COLLECTIONS_UI_RESTART_PASS: a fresh Electron main process restores custom name/evening period/videos/favorites/independent logs and original 5-video face library; two window sizes.');
        }
        runtimeErrors.push(...await js('__collectionRuntimeErrors'));
        assert.deepEqual(runtimeErrors, []);
        app.quit();
      } catch (error) {
        console.error(error.stack || error);
        try { await shot('failure'); } catch {}
        app.exit(1);
      }
    });
  });

  require(target ? path.join(target, 'Contents/Resources/app.asar/main.js') : '../main');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [localSource] });
  ipcMain.removeHandler('bilibili:fetchInfo');
  ipcMain.handle('bilibili:fetchInfo', (_event, bvid) => {
    infoRequests.push(bvid);
    const cid = 100 + infoRequests.length;
    return { ok: true, title: '合成视频 ' + bvid, pic: '', durationSec: 600, cid, pages: [{ page: 1, cid, part: '', duration: 600 }] };
  });
}
