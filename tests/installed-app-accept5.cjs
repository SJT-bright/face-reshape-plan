/* FACE-UX-20260929-D：正式安装版第五视频真实点击验收驱动（独立脚本，不改 A/B/C 任何文件）
   用法：node tests/installed-app-accept5.cjs <隔离profile目录> <证据输出目录>
   - 只允许 basename 以 face-installed-ui- 开头的全新隔离资料（防误触真实用户数据）；
   - 以 --remote-debugging-pipe 启动 /Applications/面部重塑计划.app（不修改、不重签、不替换 App），
     通过 fd3/fd4 与 DevTools 代理通信（安装版的 DevTools HTTP/TCP 端点实测无响应，管道是替代通道）；
   - 在真实界面依次导入 5 个不同 BV、相同安排（同 A 的 accept5 流程与断言）：
     第 5 个视频必须进入视频库、全程仅 1 个训练安排；网络成败如实记录，不虚构。 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const APP_BIN = process.env.FACE_D_APP_BIN || '/Applications/面部重塑计划.app/Contents/MacOS/面部重塑计划';
const APP_ARG = process.env.FACE_D_APP_ARG || ''; /* 对照实验用：如指向安装版 asar 路径 */
const profile = process.argv[2];
const evidDir = process.argv[3];
if (!profile || !evidDir) { console.error('usage: node tests/installed-app-accept5.cjs <profile> <evidDir>'); process.exit(2); }
if (!path.basename(profile).startsWith('face-installed-ui-')) throw new Error('隔离资料目录必须以 face-installed-ui- 开头：' + profile);
if (fs.existsSync(path.join(profile, 'face-reshape-data.json'))) throw new Error('拒绝非全新隔离资料（profile 内已有数据文件）');
fs.mkdirSync(evidDir, { recursive: true });

const REAL_BVS = ['BV1xx411c7mD', 'BV1GJ411x7h7', 'BV1uT4y1P7CX', 'BV1Vs411o7HN', 'BV1W4411U7u6'];

/* ---- CDP over pipe（fd3 写 / fd4 读，消息 = UTF-8 JSON + '\0'） ---- */
const child = spawn(APP_BIN, [...(APP_ARG ? [APP_ARG] : []), '--remote-debugging-pipe'], {
  env: { ...process.env, FACE_RESHAPE_PROFILE: profile },
  stdio: ['ignore', fs.openSync(path.join(evidDir, 'app-stdout.log'), 'a'), fs.openSync(path.join(evidDir, 'app-stderr.log'), 'a'), 'pipe', 'pipe']
});
console.log('APP_BIN=' + APP_BIN + (APP_ARG ? ' APP_ARG=' + APP_ARG : ''));
console.log('APP_PID=' + child.pid);
fs.writeFileSync(path.join(evidDir, 'app-pid.txt'), String(child.pid));

let msgId = 0;
const pending = new Map();
const buf = [];
let waiters = [];
const RAW = fs.createWriteStream(path.join(evidDir, 'cdp-raw.log'));
let evalErrs = 0;
child.stdio[4].on('data', (chunk) => {
  buf.push(chunk);
  let total = Buffer.concat(buf), idx;
  while ((idx = total.indexOf(0)) >= 0) {
    const raw = total.slice(0, idx).toString('utf8').trim();
    total = total.slice(idx + 1);
    if (!raw) continue;
    RAW.write('IN ' + raw.slice(0, 400) + '\n');
    let msg; try { msg = JSON.parse(raw); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { const { resolve } = pending.get(msg.id); pending.delete(msg.id); resolve(msg); }
    else waiters.forEach((w) => w(msg));
  }
  buf.length = 0; buf.push(total);
});
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
  RAW.write('OUT ' + JSON.stringify(msg).slice(0, 400) + '\n');
  child.stdio[3].write(Buffer.from(JSON.stringify(msg) + '\0', 'utf8'));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); RAW.write('TIMEOUT ' + method + '\n'); reject(new Error('CDP timeout: ' + method)); } }, 30000);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
  const log = { mode: 'installed-app-accept5', appBin: APP_BIN, profile, pid: child.pid, steps: [], videos: [] };
  /* 等 DevTools 管道就绪：轮询 Target.getTargets 直到出现加载 src/index.html 的页面目标 */
  let page = null;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await send('Target.getTargets');
      const t = (r.result.targetInfos || []).find((x) => x.type === 'page' && /src\/index\.html/.test(x.url));
      if (t) { page = t; break; }
    } catch (e) { /* 管道尚未就绪 */ }
    await sleep(300);
  }
  if (!page) throw new Error('DevTools 管道未出现页面目标（60s 超时）');
  console.log('PAGE_TARGET=' + page.targetId);
  const att = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const sid = att.result.sessionId;
  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.result && r.result.exceptionDetails) {
      if (evalErrs++ < 3) console.error('EVAL_EXC:', JSON.stringify(r.result.exceptionDetails).slice(0, 300), 'EXPR:', expr.slice(0, 120));
      throw new Error('evaluate failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {}, sid).catch(() => {});
  await send('Page.enable', {}, sid).catch(() => {});
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(path.join(evidDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const wait = async (expr, label) => {
    for (let i = 0; i < 200; i++) { try { if (await evl(expr)) return; } catch {} await sleep(150); }
    throw new Error('Timeout: ' + (label || expr));
  };
  await wait("typeof Store!=='undefined'&&!!Store.db&&!!document.querySelector('.nav-item[data-view=\"plan\"]')", 'app ready');
  console.log('APP_READY');
  log.userAgent = await evl('navigator.userAgent');
  /* 观测钩子：只记录 toast 文案，不改变行为 */
  await evl("window.__toastLog=[];(function(){const o=window.toast;window.toast=function(m,t){window.__toastLog.push(String(m));return o.call(this,m,t)}})();undefined");

  async function importOnce(line) {
    await evl(`document.querySelector('.nav-item[data-view="plan"]').click();undefined`);
    await wait("!!document.querySelector('#pl-quick-fold')", 'plan view rendered');
    await evl(`(()=>{const f=document.querySelector('#pl-quick-fold');if(f&&!f.open)f.querySelector('summary').click();})()`);
    await evl(`(()=>{const ta=document.querySelector('#pl-quick');ta.value=${JSON.stringify(line)};ta.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evl(`document.querySelector('#pl-quick-go').click();undefined`);
  }
  const snap = () => evl('({v:Store.db.videos.length,s:Store.db.sessions.length,' +
    'sig:Store.db.sessions.map(x=>x.name+"|"+x.time+"|"+(x.days||[]).join(",")).join(";"),' +
    'ta:(document.querySelector("#pl-quick")||{}).value??"-",toasts:window.__toastLog.slice()})');

  for (let i = 0; i < REAL_BVS.length; i++) {
    const before = await snap();
    await importOnce(`晚间瘦脸跟练 21:30 每天 ${REAL_BVS[i]}`);
    await wait(`Store.db.videos.length===${before.v + 1}`, `第 ${i + 1} 个视频进入视频库`);
    await sleep(400);
    const after = await snap();
    const assert = require('node:assert/strict');
    assert.equal(after.v, before.v + 1, `第 ${i + 1} 次导入后视频数应 +1`);
    assert.equal(after.s, 1, `第 ${i + 1} 次导入后应仍只有 1 个训练安排`);
    assert.ok(after.sig.includes('晚间瘦脸跟练|21:30|0,1,2,3,4,5,6'), `安排签名不变（实际 ${after.sig}）`);
    log.steps.push({ step: i + 1, bv: REAL_BVS[i], before: { v: before.v, s: before.s }, after: { v: after.v, s: after.s }, toasts: after.toasts });
    console.log(`STEP${i + 1}_OK videos=${after.v} sessions=${after.s} toasts=${JSON.stringify(after.toasts)}`);
    await evl('window.__toastLog.length=0;undefined');
  }
  const vids = await evl('Store.db.videos.map(v=>({bvid:v.bvid,title:v.title,cid:v.cid,pic:!!v.pic,dur:v.durationSec}))');
  log.videos = vids;
  const fetchedOk = vids.filter((v) => v.cid != null && v.bvid && v.title !== v.bvid).length;
  log.fetchedOk = fetchedOk;
  if (fetchedOk === 5) assert2ok(log);
  function assert2ok(l) { const t = l.steps[4].toasts; if (t.some((x) => x.includes('待核实'))) throw new Error('全部抓取成功时不应出现待核实提示'); }

  /* 计划页：仅 1 个安排 + 第 5 次导入后的界面 */
  await evl(`document.querySelector('#pl-sessions').scrollIntoView({block:'start'});undefined`);
  await sleep(400);
  await shot('d-plan-after-5th');
  /* 今日页视频库：5 张卡片、标题含第 5 个视频 */
  await evl(`document.querySelector('.nav-item[data-view="today"]').click();undefined`);
  await wait("!!document.querySelector('#td-vids')", 'today view rendered');
  await sleep(3300);
  await evl(`(()=>{const el=document.querySelector('#td-vids');const r=document.querySelector('#view-root')||document.scrollingElement;r.scrollTop=el.offsetTop-r.offsetTop-r.clientHeight/2+el.clientHeight/2;})()`);
  await sleep(900);
  const lib = await evl(`(()=>{const h=[...document.querySelectorAll('h3')].find(x=>x.textContent.includes('视频库'));return {header:(h?h.textContent:'').trim(),cards:document.querySelectorAll('#td-vids .vid-card').length,titles:[...document.querySelectorAll('#td-vids .vid-title')].map(x=>x.textContent)}})()`);
  log.todayLibrary = lib;
  const assert = require('node:assert/strict');
  assert.equal(lib.cards, 5, `视频库应有 5 张卡片（实际 ${lib.cards}）`);
  assert.ok(lib.header.includes('5 个视频'), `视频库标题应显示 5 个视频（实际 ${lib.header}）`);
  assert.ok(lib.titles.some((t) => t === vids[4].title), `第 5 个视频标题应出现在视频库（${vids[4].title}）`);
  await shot('d-today-videolib');
  /* 持久化复核：隔离 profile 内的数据文件 */
  await evl('Store.flushSync();undefined');
  await sleep(300);
  const persisted = JSON.parse(fs.readFileSync(path.join(profile, 'face-reshape-data.json'), 'utf8'));
  assert.equal(persisted.videos.length, 5, '持久化文件中 5 个视频');
  assert.equal(persisted.sessions.length, 1, '持久化文件中仅 1 个安排');
  log.persisted = { videos: persisted.videos.length, sessions: persisted.sessions.length, fifth: persisted.videos.map((v) => v.bvid).includes(REAL_BVS[4]) };
  fs.writeFileSync(path.join(evidDir, 'accept5-log.json'), JSON.stringify(log, null, 2));
  console.log(`INSTALLED_APP_ACCEPT5_PASS: 5/5 入库(元数据成功 ${fetchedOk}/5)、仅 1 个安排、今日页视频库 5 卡片`);
  console.log('RESULT_JSON=' + path.join(evidDir, 'accept5-log.json'));
  finish(0);
  } catch (e) {
    console.error('DRIVER_FAIL:', e && e.stack || e);
    try { fs.writeFileSync(path.join(evidDir, 'accept5-log.json'), JSON.stringify({ fail: String(e && e.stack || e) }, null, 2)); } catch {}
    finish(1);
  }
})();

function finish(code) {
  /* 优先 CDP Browser.close 优雅退出；失败再 TERM → KILL（如实记录） */
  send('Browser.close').then(() => { setTimeout(() => hardExit(code), 4000); }).catch(() => {
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { if (!child.killed) child.kill('SIGKILL'); } catch {} hardExit(code); }, 6000);
  });
  function hardExit(c) { try { if (!child.killed) child.kill('SIGKILL'); } catch {} process.exit(c); }
}
