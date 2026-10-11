/* FACE-UX-20260929-A：快捷导入真实 UI 验收（隔离资料，不触碰正式用户数据）
   用法：FACE_RESHAPE_PROFILE=<dir> electron tests/test-quick-import-ui.js <dir> <mode> [expectClarify]
   mode=accept5：依次导入 5 个不同 BV（同名/同时间/同星期），断言第 5 个进视频库、全程仅 1 个安排；
                 真实走 B 站 API（api.bilibili.com），抓取成败如实记录，不虚构。
   mode=pending ：导入 1 个 API -404 的 BV（真实网络失败路径），记录「导入完成」反馈；
                 expectClarify=1 时额外断言出现含 BV 号的「待核实」提示（修复后回归）。
   mode=all    ：同一窗口内先跑 accept5，再清空库跑 pending 回归（一条命令全量验收）。
   证据（截图/JSON）写入 .impeccable/review/face-ux-20260929/（gitignore 内，随项目测试惯例）。 */
const { app } = require('electron'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const profile = process.argv[2], mode = process.argv[3], expectClarify = process.argv[4] === '1';
if (!path.basename(profile || '').startsWith('face-quick-ui-')) throw Error('Isolated profile (face-quick-ui-*) required');
if (!process.env.FACE_RESHAPE_PROFILE) throw Error('FACE_RESHAPE_PROFILE must be set (app-side isolation)');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const EVID = path.resolve('.impeccable/review/face-ux-20260929');
fs.mkdirSync(EVID, { recursive: true });
/* 2026-09-29 经 api.bilibili.com 逐个核实存在的公开视频；GHOST_BV 核实返回 code=-404 */
const REAL_BVS = ['BV1xx411c7mD', 'BV1GJ411x7h7', 'BV1uT4y1P7CX', 'BV1Vs411o7HN', 'BV1W4411U7u6'];
const GHOST_BV = 'BV1s411o776X';

let once = false;
app.on('browser-window-created', (_, win) => {
  if (once) return; once = true;
  win.webContents.once('did-finish-load', async () => {
    win.webContents.on('console-message', (_e, _lvl, msg) => { if (/error|uncaught/i.test(msg)) console.error('renderer:', msg); });
    const js = async s => { try { return await win.webContents.executeJavaScript(s); } catch (e) { throw new Error(`executeJavaScript failed [${s}]: ${e.message}`); } };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const wait = async (s, label) => { for (let i = 0; i < 600; i++) { if (await js(s)) return; await sleep(100); } throw Error('Timeout: ' + (label || s)); };
    const shot = async name => { fs.writeFileSync(path.join(EVID, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
    try {
      await wait("typeof Store!=='undefined'&&!!Store.db&&!!document.querySelector('.nav-item[data-view=\"plan\"]')");
      /* 观测钩子：只记录，不改变 toast 行为 */
      await js("window.__toastLog=[];(function(){const o=window.toast;window.toast=function(m,t){window.__toastLog.push(String(m));return o.call(this,m,t)}})();undefined");

      /* 真实用户路径：点侧栏进「跟练计划」→ 展开 ⚡快捷导入 → 填文本 → 点「解析并导入」 */
      async function importOnce(line) {
        await js(`document.querySelector('.nav-item[data-view="plan"]').click();undefined`);
        await wait("!!document.querySelector('#pl-quick-fold')", 'plan view rendered');
        await js(`(()=>{const f=document.querySelector('#pl-quick-fold');if(f&&!f.open)f.querySelector('summary').click();})()`);
        await js(`(()=>{const ta=document.querySelector('#pl-quick');ta.value=${JSON.stringify(line)};ta.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await js(`document.querySelector('#pl-quick-go').click();undefined`);
      }
      const snap = () => js('({v:Store.db.videos.length,s:Store.db.sessions.length,' +
        'sig:Store.db.sessions.map(x=>x.name+"|"+x.time+"|"+(x.days||[]).join(",")).join(";"),' +
        'ta:(document.querySelector("#pl-quick")||{}).value??"-",toasts:window.__toastLog.slice()})');

      /* —— 阶段一：5 个不同 BV 依次导入（同名/同时间/同星期）—— */
      async function phaseAccept5() {
        const log = { mode: 'accept5', steps: [], videos: [] };
        for (let i = 0; i < REAL_BVS.length; i++) {
          const before = await snap();
          await importOnce(`晚间瘦脸跟练 21:30 每天 ${REAL_BVS[i]}`);
          await wait(`Store.db.videos.length===${before.v + 1}`, `第 ${i + 1} 个视频进入视频库`);
          await sleep(400); /* 等最终 toast 落进记录 */
          const after = await snap();
          log.steps.push({ step: i + 1, bv: REAL_BVS[i], before: { v: before.v, s: before.s }, after: { v: after.v, s: after.s }, toasts: after.toasts });
          await js('window.__toastLog.length=0;undefined');
          assert.equal(after.v, before.v + 1, `第 ${i + 1} 次导入后视频数应 +1`);
          assert.equal(after.s, 1, `第 ${i + 1} 次导入后应仍只有 1 个训练安排`);
          assert.ok(after.sig.includes('晚间瘦脸跟练|21:30|0,1,2,3,4,5,6'), `安排签名不变（实际 ${after.sig}）`);
        }
        const vids = await js('Store.db.videos.map(v=>({bvid:v.bvid,title:v.title,cid:v.cid,pic:!!v.pic,dur:v.durationSec}))');
        log.videos = vids;
        const fetchedOk = vids.filter(v => v.cid != null && v.bvid && v.title !== v.bvid).length;
        const lastToasts = log.steps[4].toasts;
        assert.ok(lastToasts.some(t => t.includes('导入完成')), `第 5 次导入应出现「导入完成」提示（实际 ${JSON.stringify(lastToasts)}）`);
        if (fetchedOk === 5) assert.ok(!lastToasts.some(t => t.includes('待核实')), '全部抓取成功时不应出现待核实提示');
        await js(`document.querySelector('#pl-sessions').scrollIntoView({block:'start'});undefined`);
        await sleep(300);
        await shot('accept5-plan-after-5th');
        /* 到「今日」页视频库做 UI 层核验；等 toast 消失、滚到视频库卡片再截屏，保证可视证据 */
        await js(`document.querySelector('.nav-item[data-view="today"]').click();undefined`);
        await wait("!!document.querySelector('#td-vids')", 'today view rendered');
        await sleep(3300);
        await js(`(()=>{const el=document.querySelector('#td-vids');const r=document.querySelector('#view-root')||document.scrollingElement;r.scrollTop=el.offsetTop-r.offsetTop-r.clientHeight/2+el.clientHeight/2;})()`);
        await sleep(900); /* 等封面渲染 */
        const lib = await js(`(()=>{const h=[...document.querySelectorAll('h3')].find(x=>x.textContent.includes('视频库'));const r=document.querySelector('#view-root')||document.scrollingElement;return {header:(h?h.textContent:'').trim(),cards:document.querySelectorAll('#td-vids .vid-card').length,titles:[...document.querySelectorAll('#td-vids .vid-title')].map(x=>x.textContent),scrollTop:r.scrollTop,scrollH:r.scrollHeight}})()`);
        log.todayLibrary = lib;
        assert.equal(lib.cards, 5, `视频库应有 5 张卡片（实际 ${lib.cards}）`);
        assert.ok(lib.header.includes('5 个视频'), `视频库标题应显示 5 个视频（实际 ${lib.header}）`);
        assert.ok(lib.titles.some(t => t === vids[4].title), `第 5 个视频标题应出现在视频库（${vids[4].title}）`);
        await shot('accept5-today-videolib');
        /* 落盘 + 主进程侧复核持久化文件 */
        await js('Store.flushSync();undefined');
        const persisted = JSON.parse(fs.readFileSync(path.join(profile, 'face-reshape-data.json'), 'utf8'));
        assert.equal(persisted.videos.length, 5, '持久化文件中 5 个视频');
        assert.equal(persisted.sessions.length, 1, '持久化文件中仅 1 个安排');
        log.persisted = { videos: persisted.videos.length, sessions: persisted.sessions.length };
        fs.writeFileSync(path.join(EVID, 'accept5-log.json'), JSON.stringify(log, null, 2));
        console.log(`QUICK_IMPORT_ACCEPT5_PASS: 5/5 视频入库(元数据获取成功 ${fetchedOk}/5)、仅 1 个安排、今日页视频库 5 卡片；逐步记录见 accept5-log.json`);
        return fetchedOk;
      }

      /* —— 阶段二：API -404 链接的失败路径反馈（修复后要求出现「待核实」）—— */
      async function phasePending(wantClarify) {
        const log = { mode: 'pending', expectClarify: wantClarify };
        await importOnce(`晚间跟练 21:30 每天 ${GHOST_BV}`);
        await wait('Store.db.videos.length===1', '失败路径下引用仍应保存');
        await sleep(400);
        const rec = await snap();
        log.steps = [{ bv: GHOST_BV, ...rec }];
        const vid = await js('Store.db.videos.map(v=>({bvid:v.bvid,title:v.title,cid:v.cid}))');
        log.videos = vid;
        assert.equal(rec.s, 1, '失败路径下安排仍创建');
        assert.equal(vid[0].bvid, GHOST_BV);
        assert.ok(vid[0].cid == null, '该视频应无 cid（仅保存引用）');
        assert.ok(vid[0].title === GHOST_BV, `标题应回退为 BV 号（实际 ${vid[0].title}）`);
        assert.equal(rec.toasts.filter(t => t.includes('导入完成')).length, 1, '应有一条导入完成提示');
        if (wantClarify) {
          assert.ok(rec.toasts.some(t => t.includes('待核实') && t.includes(GHOST_BV)),
            `应出现含 BV 号的待核实提示（实际 ${JSON.stringify(rec.toasts)}）`);
        } else {
          console.log('PENDING_FEEDBACK_OBSERVED: ' + JSON.stringify(rec.toasts));
        }
        await js(`document.querySelector('.nav-item[data-view="today"]').click();undefined`);
        await wait("!!document.querySelector('#td-vids')");
        await sleep(600);
        await shot('pending-today-videolib');
        await js('Store.flushSync();undefined');
        fs.writeFileSync(path.join(EVID, 'pending-log.json'), JSON.stringify(log, null, 2));
        console.log(`QUICK_IMPORT_PENDING_${wantClarify ? 'REGRESSION_PASS' : 'OBSERVED'}: 引用已保存(title=${vid[0].title},cid=null)、安排=1、toasts=${JSON.stringify(rec.toasts)}`);
      }

      if (mode === 'accept5') {
        await phaseAccept5();
      } else if (mode === 'pending') {
        await phasePending(expectClarify);
      } else if (mode === 'all') {
        await phaseAccept5();
        await js('Store.db.videos=[];Store.db.sessions=[];Store.save(true);undefined'); /* 应用内重置，阶段二拿到干净状态 */
        await js('window.__toastLog.length=0;undefined');
        await phasePending(true);
        console.log('QUICK_IMPORT_UI_ALL_PASS');
      } else throw Error('unknown mode: ' + mode);
      app.exit(0);
    } catch (e) { console.error(e); app.exit(1); }
  });
});
require('../main');
