/**
 * 面部重塑计划 —— 主进程
 * 窗口 / 托盘 / 系统通知 / 定时提醒引擎 / 数据持久化
 */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, dialog, shell, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execFile } = require('child_process');
const { ensurePrivatePerms } = require('./src/js/file-perms');
const { backupFileName, isBackupFileName, pruneBackupList } = require('./src/js/backup-util');
const { parseHHmm, reminderDue } = require('./src/js/reminder-util');

const PortableBackup = require('./src/js/portable-backup');
const PhotoLib = require('./src/js/photo-library');
const makeKeyStore = require('./src/js/secure-key');
const Reminders = require('./src/js/reminders-v2');
const keys = () => makeKeyStore(dataDir(), safeStorage);
let pendingRestore = null;

if(process.env.FACE_RESHAPE_PROFILE){const profile=path.resolve(process.env.FACE_RESHAPE_PROFILE);fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('cache',path.join(profile,'cache'));}

const isMac = process.platform === 'darwin';
let mainWindow = null;
let tray = null;
let db = null;              // 内存中的数据副本（渲染端每次保存后同步）
let firedToday = new Set(); // 会话提醒去重：`${date}|${sessionId}`
let firedEveningReview = null; // 晚间复盘提醒去重：date string
let quitting = false;

/* ---------------- 数据持久化 ---------------- */
function dataDir() {
  return app.getPath('userData');
}
function dataFile() {
  return path.join(dataDir(), 'face-reshape-data.json');
}
function defaultData() {
  return {
    version: 1, freshInstall: true,
    settings: {
      dailyTargetMinutes: 15,   // 每日瘦脸训练目标（分钟）
      eveningReviewTime: '22:00', // 晚间复盘提醒时间
      skinLogReminderTime: '21:30', // 皮肤状态记录提醒（当天未记录时推送；置空字符串关闭）
      sleepLogReminderTime: '12:00', // 睡眠记录提醒（当天还没记「昨晚睡眠」时中午推送；置空字符串关闭）
      keepInTray: true,          // 关闭窗口最小化到托盘（保持提醒）
      graceMinutes: 3,           // 过点后多久内仍补发提醒
      autoPauseOnBlur: true,     // 窗口隐藏/最小化时自动暂停内嵌跟练视频（渲染端读取）
      // 护肤时段分界（到点提醒对应时段的护肤流程）
      skincareTimes: { morning: '09:00', noon: '12:00', evening: '20:00' }
    },
    videos: [],
    sessions: [],
    skincare: { cycles: [] },
    logs: { training: {}, skincare: {} },
    reminderState: {}
  };
}
function loadData() {
  try {
    PortableBackup.recover(dataDir());
    const raw = fs.readFileSync(dataFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    /* 必须是 plain object：数组/字符串等能通过 JSON.parse 的畸形文件同样走损坏隔离，不带病运行 */
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('数据文件结构损坏');
    db = parsed;
    // 简单的结构兜底
    db.settings = Object.assign(defaultData().settings, db.settings || {});
    db.settings.skincareTimes = Object.assign({ morning: '09:00', noon: '12:00', evening: '20:00' }, db.settings.skincareTimes || {});
    db.logs = db.logs || { training: {}, skincare: {} };
    db.logs.training = db.logs.training || {};
    db.logs.skincare = db.logs.skincare || {};
    db.videos = db.videos || [];
    db.sessions = db.sessions || [];
    db.skincare = db.skincare || { cycles: [] };
    db.reminderState = db.reminderState || {};
  } catch (e) {
    /* 损坏文件先隔离改名再重建默认库——直接覆盖会让断电截断的原文件永远无法抢救 */
    try {
      if (fs.existsSync(dataFile())) fs.renameSync(dataFile(), `${dataFile()}.corrupt-${Date.now()}`);
    } catch {}
    db = defaultData();
    saveData(db);
  }
  try { if(keys().migrate(db)) {
    if(!saveData(db))throw Error('密钥迁移后的数据保存失败');
    const backupDir=path.join(dataDir(),'auto-backups');
    if(fs.existsSync(backupDir))for(const name of fs.readdirSync(backupDir).filter(isBackupFileName)){const file=path.join(backupDir,name);try{const data=JSON.parse(fs.readFileSync(file));if(data.settings?.aiApiKey){delete data.settings.aiApiKey;const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,file);}}catch{}}
  } } catch { /* Keep legacy key until system encryption succeeds. */ }
  return db;
}
function rendererData() {
  const value=JSON.parse(JSON.stringify(db));
  delete value.settings.aiApiKey;
  value.settings.aiKeyConfigured = !!db.settings.aiApiKey || keys().status().configured;
  return value;
}
function saveData(data) {
  const next = data || db;
  try {
    if (process.env.FACE_UX20_TEST === '1' && fs.existsSync(path.join(dataDir(),'inject-save-failure'))) throw Error('Injected write failure');
    if(db?.settings?.aiApiKey && !keys().status().configured) next.settings.aiApiKey=db.settings.aiApiKey;
    fs.mkdirSync(dataDir(), { recursive: true });
    const actions={...(db?.reminderActions||{}),...(next.reminderActions||{})};
    for(const [k,v]of Object.entries(db?.reminderActions||{}))if((v.updatedAt||0)>(actions[k]?.updatedAt||0))actions[k]=v;
    next.reminderActions=actions;
    const tmp = dataFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmp, dataFile());
    ensurePrivatePerms(dataFile()); // 隐私数据（皮肤日志/AI密钥）不接受同机其他账户读取
    next.reminderActions = {...(db?.reminderActions||{}),...(next.reminderActions||{})};
    db = next;
    autoBackupData(); // 每天首次保存时做一份本地快照，防数据损坏/误操作
    writeHubExport();
    return true;
  } catch (e) {
    console.error('saveData failed:', e);
    return false;
  }
}

/* ---------------- 自动本地备份：每天一份，保留最近 30 份 ---------------- */
const AUTO_BACKUP_KEEP = 30;
let lastAutoBackupDay = '';
function autoBackupData() {
  try {
    const today = dateKey(new Date());
    if (today === lastAutoBackupDay) return;
    const dir = path.join(dataDir(), 'auto-backups');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, backupFileName(today));
    if (fs.existsSync(dataFile())) {
      /* 备份走 tmp+rename 原子落盘：它正是数据损坏时的最后手段，不能自己被截断 */
      const tmp = `${dest}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(PortableBackup.cleanData(db),null,2),{mode:0o600});
      fs.renameSync(tmp, dest);
    }
    ensurePrivatePerms(dest);
    const files = fs.readdirSync(dir).filter(isBackupFileName);
    for (const stale of pruneBackupList(files, AUTO_BACKUP_KEEP)) {
      fs.rmSync(path.join(dir, stale), { force: true });
    }
    lastAutoBackupDay = today;
  } catch (e) {
    console.error('auto backup failed:', e);
  }
}

/* ---------------- 中控提示器对接：导出今日任务到固定路径 ----------------
 * 写入 ~/Library/Application Support/面部重塑计划/hub-today.json
 * 中控提示器用「JSON 文件」连接器监听这个文件，任务字段：time/title/source/note */
let hubExportCache = '';
function writeHubExport() {
  try {
    if (!db) return;
    const now = new Date();
    const today = dateKey(now);
    const weekday = now.getDay();
    const tasks = [];

    // 1) 力量训练：今天的训练日（或休息日）
    try {
      const Core = require('./src/js/strength-core');
      const state = Core.normalize(db);
      const info = Core.todayPlan(state, today);
      if (info && info.day) {
        const d = info.day;
        if (d.isRest) {
          tasks.push({ id: 'strength', time: null, title: '休息日 · 恢复为主', source: '面部重塑计划', note: '今天没有安排力量训练，睡好吃好' });
        } else {
          const acts = d.actions || [];
          const first = acts[0];
          const note = `${acts.length} 个动作` + (first ? ` · 首个：${first.name} ${first.plannedSets || ''}组 ${first.plannedRepsText || ''}`.trim() : '') + (info.preview ? ' · 按计划预览' : '');
          tasks.push({ id: 'strength', time: '19:00', title: `力量训练 · ${d.name}`, source: '面部重塑计划', note });
        }
      }
    } catch (e) { /* 力量模块异常不阻塞其他导出 */ }

    // 2) 瘦脸操会话（今天生效的）
    for (const s of db.sessions || []) {
      if (!s.enabled || !(s.days || []).includes(weekday)) continue;
      tasks.push({
        id: 'training',
        time: /^\d{1,2}:\d{2}$/.test(s.time || '') ? s.time : null,
        title: `${s.name}${s.targetMinutes ? ` ${s.targetMinutes} 分钟` : ''}`,
        source: '面部重塑计划', note: '沉浸式跟练 · 打开应用开始'
      });
    }

    // 3) 护肤时段（当前周期的早/日/晚）
    const st = db.settings.skincareTimes || {};
    const cyc = (db.skincare.cycles || []).find(c =>
      c.startDate && today >= c.startDate && (!c.endDate || today <= c.endDate));
    if (cyc) {
      const phases = [['morning', st.morning, '晨间护肤'], ['noon', st.noon, '日间护肤'], ['evening', st.evening, '晚间护肤']];
      for (const [key, time, label] of phases) {
        const steps = (cyc.steps || {})[key] || [];
        if (!steps.length) continue;
        const names = steps.slice(0, 3).map(x => x.name).join('、') + (steps.length > 3 ? ' 等' : '');
        tasks.push({ id: `skincare-${key}`, time: /^\d{1,2}:\d{2}$/.test(time || '') ? time : null, title: label, source: '面部重塑计划', note: `当前周期「${cyc.name}」${steps.length} 步 · ${names}` });
      }
    }

    // 4) 睡前复盘 + 晨间睡眠补记
    if (db.settings.eveningReviewTime && /^\d{1,2}:\d{2}$/.test(db.settings.eveningReviewTime)) {
      tasks.push({ id: 'review', time: db.settings.eveningReviewTime, title: '睡前复盘', source: '面部重塑计划', note: '瘦脸操做了多久？护肤打卡了吗？' });
    }
    /* 与应用内睡眠提醒同口径：读取设置时间，留空=关闭（不再固定 10:00 无视设置） */
    if (db.settings.sleepLogReminderTime && /^\d{1,2}:\d{2}$/.test(db.settings.sleepLogReminderTime)) {
      tasks.push({ id: 'sleep', time: db.settings.sleepLogReminderTime, title: '记录昨晚睡眠', source: '面部重塑计划', note: '按手环填入睡/起床时间，计入睡眠积分' });
    }

    const payload = { app: '面部重塑计划', date: today, generatedAt: now.toISOString(), tasks };
    const json = JSON.stringify(payload, null, 2);
    if (json === hubExportCache) return;   // 内容没变不写盘
    hubExportCache = json;
    // Honor isolated profiles too; tests must not overwrite the user's hub export.
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'hub-today.json');
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, json, 'utf-8');
    fs.renameSync(tmp, p);
  } catch (e) {
    console.error('hub export failed:', e);
  }
}

/* ---------------- 中控提示器对接：本地回环 HTTP 接口（127.0.0.1:18466） ----------------
 * GET  /hub/health  → 存活探针
 * GET  /hub/today   → 返回 hub-today.json（任务自带稳定 id）
 * POST /hub/action  → {"id":"strength","op":"skip-today"} / {"id":...,"op":"postpone","minutes":15} / {"id":...,"op":"done"}
 * 安全边界：只绑定 127.0.0.1 回环、请求体限 64KB、只认上述三个路径。
 * 主进程不直接改数据文件（渲染端内存副本会在下次保存时覆盖外部改动）：
 * 动作经 webContents.send 转发给渲染端执行，渲染端走应用自身保存链路后经 IPC 回执。
 * 任何异常只打日志，绝不影响应用本身。 */
const http = require('http');
const HUB_PORT = 18466;
const HUB_ACTIONS = new Set(['done', 'skip-today', 'postpone']);
let hubRendererReady = false;          // 渲染端 hub-actions 模块已注册
let hubActionSeq = 0;
const hubPending = new Map();          // actionId → { respond, timer }

function hubRespond(res, status, obj) {
  try {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  } catch { /* 客户端先断了连接：无可回复对象 */ }
}

function hubRendererAvailable() {
  return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed() && hubRendererReady);
}

function hubDispatchAction(req, res, raw) {
  let body = null;
  try { body = JSON.parse(raw || '{}'); } catch { return hubRespond(res, 400, { ok: false, error: '请求体必须是 JSON' }); }
  const op = body && body.op;
  const id = body && body.id;
  if (!HUB_ACTIONS.has(op)) return hubRespond(res, 400, { ok: false, error: `op 必须是 ${[...HUB_ACTIONS].join('/')} 之一` });
  if (typeof id !== 'string' || !id.trim()) return hubRespond(res, 400, { ok: false, error: '缺少任务 id' });
  if (!hubRendererAvailable()) return hubRespond(res, 503, { ok: false, error: '应用主窗口/渲染端未就绪，无法执行动作' });
  const minutesRaw = Number(body.minutes);
  const minutes = op === 'postpone'
    ? (Number.isFinite(minutesRaw) && minutesRaw > 0 ? Math.min(1440, Math.max(1, Math.round(minutesRaw))) : 15)
    : undefined;
  const actionId = `hub-${Date.now().toString(36)}-${(++hubActionSeq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  hubPending.set(actionId, {
    respond: (result, status) => hubRespond(res, status || (result && result.ok ? 200 : 400), result),
    timer: setTimeout(() => {
      if (!hubPending.delete(actionId)) return;
      hubRespond(res, 504, { ok: false, error: '渲染端处理超时（5 秒）' });
    }, 5000)
  });
  try {
    mainWindow.webContents.send('hub:action', { actionId, op, id, minutes });
  } catch (e) {
    if (hubPending.delete(actionId)) hubRespond(res, 503, { ok: false, error: '动作转发失败：' + String((e && e.message) || e) });
  }
}

function hubHandle(req, res) {
  let url;
  try { url = new URL(req.url, `http://127.0.0.1:${HUB_PORT}`); } catch { return hubRespond(res, 400, { ok: false, error: 'bad request' }); }
  if (req.method === 'GET' && url.pathname === '/hub/health') {
    return hubRespond(res, 200, { ok: true, app: '面部重塑计划' });
  }
  if (req.method === 'GET' && url.pathname === '/hub/today') {
    const file = path.join(dataDir(), 'hub-today.json');
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf-8'); } catch { /* 首次启动可能还没有：现场生成一次 */ }
    if (raw == null) {
      try { hubExportCache = ''; writeHubExport(); raw = fs.readFileSync(file, 'utf-8'); } catch { raw = null; }
    }
    if (raw == null) return hubRespond(res, 500, { ok: false, error: '今日任务导出不可用' });
    try { return hubRespond(res, 200, JSON.parse(raw)); } catch { return hubRespond(res, 500, { ok: false, error: '今日任务文件损坏' }); }
  }
  if (req.method === 'POST' && url.pathname === '/hub/action') {
    let buf = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { req.destroy(); return; }
      buf += c;
    });
    req.on('end', () => {
      try { hubDispatchAction(req, res, buf); } catch (e) { hubRespond(res, 500, { ok: false, error: '服务器内部错误' }); }
    });
    req.on('error', () => { /* 客户端中断：无需应答 */ });
    return;
  }
  hubRespond(res, 404, { ok: false, error: 'not found' });
}

function startHubServer() {
  try {
    const server = http.createServer((req, res) => {
      try { hubHandle(req, res); } catch (e) { console.error('hub request failed:', e); try { hubRespond(res, 500, { ok: false, error: '服务器内部错误' }); } catch {} }
    });
    server.on('error', (e) => console.error(`hub server error（端口 ${HUB_PORT}，不影响应用本身）:`, e.message));
    server.listen(HUB_PORT, '127.0.0.1', () => console.log(`hub server listening on http://127.0.0.1:${HUB_PORT}`));
  } catch (e) {
    console.error('hub server failed to start（不影响应用本身）:', e);
  }
}

/* ---------------- 从「个人积累库」导入睡眠记录 ----------------
 * 用系统 sqlite3 只读查询 LifePivot 的 sleep_daily_records 表。
 * 安全约束：可执行文件固定为 /usr/bin/sqlite3、库文件路径固定由 appData 拼出并校验、
 * SQL 为本文件内的常量白名单（仅单条 SELECT），不接收任何外部输入。 */
const LIFEPivot_DB_BASENAME = 'life-pivot.sqlite';
const LIFEPivot_SLEEP_SQL =
  'SELECT record_date, asleep_time, wake_time, calculated_duration_minutes, ' +
  'deep_sleep_minutes, light_sleep_minutes, rem_sleep_minutes, morning_feeling, ' +
  'manual_quality_score, awake_episodes, quality_text ' +
  'FROM sleep_daily_records ORDER BY record_date';

function lifepivotDbPath() {
  return path.join(app.getPath('appData'), 'LifePivot', LIFEPivot_DB_BASENAME);
}

function readLifepivotSleep() {
  const dbPath = lifepivotDbPath();
  const resolved = path.resolve(dbPath);
  const allowedDir = path.resolve(path.join(app.getPath('appData'), 'LifePivot'));
  if (!resolved.startsWith(allowedDir + path.sep) || path.basename(resolved) !== LIFEPivot_DB_BASENAME) {
    return Promise.resolve({ ok: false, error: '数据库路径校验未通过' });
  }
  if (!/^SELECT\s[\s\S]+FROM\s[\s\S]+$/i.test(LIFEPivot_SLEEP_SQL) || /;|--|\/\*/.test(LIFEPivot_SLEEP_SQL)) {
    return Promise.resolve({ ok: false, error: '查询语句校验未通过' });
  }
  if (!fs.existsSync(resolved)) {
    return Promise.resolve({ ok: false, error: '未找到个人积累库数据库（LifePivot/life-pivot.sqlite）' });
  }
  return new Promise((resolve) => {
    execFile('/usr/bin/sqlite3', ['-readonly', '-json', resolved, LIFEPivot_SLEEP_SQL],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024, shell: false, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve({ ok: false, error: '读取失败：' + String(err.message || err) });
        try { resolve({ ok: true, rows: JSON.parse(stdout || '[]') }); }
        catch (e) { resolve({ ok: false, error: '返回内容解析失败' }); }
      });
  });
}

/* ---------------- 工具 ---------------- */
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function dateKey(d) {
  const x = d || new Date();
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function hhmm(d) {
  const x = d || new Date();
  return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
}
function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/* ---------------- 主窗口 ---------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: '面部重塑计划',
    backgroundColor: '#eef4fb',
    autoHideMenuBar: true,
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // 中控提示器远程动作依赖渲染端就绪：窗口重新加载/渲染进程崩溃时先置为不可用，
  // 等新页面里 hub-actions.js 通过 hub:ready 重新登记
  mainWindow.webContents.on('did-start-loading', () => { hubRendererReady = false; });
  mainWindow.webContents.on('render-process-gone', () => { hubRendererReady = false; });

  // 最小化/恢复 → 兜底可见性事件（渲染端据此联动内嵌视频的暂停/恢复等）
  mainWindow.on('blur', () => sendToRenderer('app-visibility', { hidden: true }));
  mainWindow.on('focus', () => sendToRenderer('app-visibility', { hidden: false }));
  mainWindow.on('minimize', () => sendToRenderer('app-visibility', { hidden: true }));
  mainWindow.on('restore', () => sendToRenderer('app-visibility', { hidden: false }));

  // 点关闭 → 隐藏到托盘（保持提醒能力），除非正在退出
  mainWindow.on('close', (e) => {
    if (!quitting && db && db.settings.keepInTray) {
      e.preventDefault();
      if (isMac) app.hide();
      else mainWindow.hide();
      sendToRenderer('app-visibility', { hidden: true }); // app.hide()/hide() 不触发 minimize，需显式兜底
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (isMac) app.show();
  sendToRenderer('app-visibility', { hidden: false }); // 窗口重新可见（webContents 未就绪时 sendToRenderer 判空跳过）
}

/* ---------------- 托盘 ---------------- */
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img.resize({ width: 18, height: 18 }));
  const menu = Menu.buildFromTemplate([
    { label: '显示主界面', click: () => showMainWindow() },
    { label: '现在提醒我练瘦脸操', click: () => notifyNow('该练瘦脸操啦 💪', '打开应用，开始今天的沉浸式跟练吧！') },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setToolTip('面部重塑计划');
  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
}

/* ---------------- 通知 ---------------- */
function notifyNow(title, body, sessionId) {
  if(process.env.FACE_UX20_TEST==='1'){fs.appendFileSync(path.join(dataDir(),'notification-test.jsonl'),JSON.stringify({title,body,sessionId})+'\n');return true;}
  if(!Notification.isSupported())return false;
  const n = new Notification({
    title,
    body,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    silent: false
  });
  n.on('click', () => {
    showMainWindow();
    if (sessionId) sendToRenderer('reminder-activate', { sessionId });
    else sendToRenderer('reminder-activate', {});
  });
  n.show();
  return n;
}

/* ---------------- 定时提醒引擎（每 15 秒检查一次） ---------------- */
function checkSchedules() {
  if(!db)return;const pending=Reminders.due(db,new Date());if(!pending.length)return;
  if(process.env.FACE_UX20_TEST!=='1'&&!Notification.isSupported())return;
  const next=JSON.parse(JSON.stringify(db));for(const x of pending)Reminders.action(next,x.id,'fired');
  if(!saveData(next))return;
  notifyNow(pending.length>1?`今日待办（${pending.length} 项）`:pending[0].title,pending.map(x=>x.title).join(' · '),null);
}


/* ---------------- B 站视频信息抓取（主进程无 CORS 限制） ---------------- */
function fetchBilibiliInfo(bvid) {
  return new Promise((resolve) => {
    const url = `https://api.bilibili.com/x/web-interface/view?${/^av\d+$/i.test(bvid)?'aid='+encodeURIComponent(bvid.slice(2)):'bvid='+encodeURIComponent(bvid)}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        'Referer': 'https://www.bilibili.com/'
      },
      timeout: 8000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j && j.code === 0 && j.data) {
            resolve({ ok: true, pages:j.data.pages, title: j.data.title, pic: j.data.pic, durationSec: j.data.duration, cid: j.data.cid, owner: j.data.owner ? j.data.owner.name : '' });
          } else {
            resolve({ ok: false, error: (j && j.message) || '接口返回异常' });
          }
        } catch (e) { resolve({ ok: false, error: '解析失败' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '请求超时' }); });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
  });
}

/* ---------------- IPC ---------------- */
ipcMain.handle('data:load', () => rendererData());
ipcMain.handle('key:status', () => keys().status());
ipcMain.handle('key:save', (_e,key) => { try {keys().save(String(key || '').trim());delete db.settings.aiApiKey;saveData(db);return {ok:true};}catch(e){return {ok:false,error:e.message};} });
ipcMain.handle('backup:status', () => ({lastSuccess:lastAutoBackupDay || null,scope:'每日 JSON 记录快照；不包含照片和视频',key:keys().status()}));
ipcMain.handle('backup:export', async (_e,includeVideos) => {
  try {const r=await dialog.showSaveDialog(mainWindow,{title:'导出完整备份',defaultPath:'面部重塑计划-'+dateKey()+'.frbackup',filters:[{name:'完整备份',extensions:['frbackup']}]});
    if(r.canceled)return {canceled:true};const b=PortableBackup.createBundle(db,dataDir(),!!includeVideos,mediaOpts());const tmp=r.filePath+'.tmp';fs.writeFileSync(tmp,PortableBackup.encode(b),{mode:0o600});fs.renameSync(tmp,r.filePath);return {ok:true,path:r.filePath,summary:PortableBackup.summary(b)};
  }catch(e){return {ok:false,error:e.message};}
});
ipcMain.handle('backup:inspect', async () => {
  try {const r=await dialog.showOpenDialog(mainWindow,{title:'选择完整备份',filters:[{name:'完整备份',extensions:['frbackup']}],properties:['openFile']});
    if(r.canceled)return {canceled:true};pendingRestore=PortableBackup.decode(fs.readFileSync(r.filePaths[0]));return {ok:true,summary:PortableBackup.summary(pendingRestore)};
  }catch(e){pendingRestore=null;return {ok:false,error:e.message};}
});
ipcMain.handle('backup:restore', () => {
  try {if(!pendingRestore)throw Error('请先选择并检查备份');const r=PortableBackup.restore(pendingRestore,dataDir(),mediaOpts());db=r.data;pendingRestore=null;loadData();writeHubExport();return {ok:true,before:r.before,data:rendererData()};}
  catch(e){return {ok:false,error:e.message};}
});
ipcMain.handle('video:exists', (_e,p) => {try{return fs.statSync(String(p)).isFile();}catch{return false;}});

ipcMain.handle('data:save', (_e, data) => saveData(data));

ipcMain.handle('notify', (_e, { title, body }) => !!notifyNow(title || '面部重塑计划', body || ''));
ipcMain.handle('reminder:list',()=>Reminders.timeline(db,new Date()));
ipcMain.handle('reminder:action',(_e,id,act)=>{if(!['later','skip'].includes(act)||!Reminders.timeline(db).some(x=>x.id===id))return false;const next=JSON.parse(JSON.stringify(db));Reminders.action(next,id,act);return saveData(next);});

ipcMain.handle('app:fullscreen', (_e, on) => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!!on);
  return true;
});
ipcMain.handle('app:isFullscreen', () => (mainWindow ? mainWindow.isFullScreen() : false));

ipcMain.handle('dialog:pickVideo', async () => {
  const dest = mediaDir('video');
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择本地视频文件（会复制到「跟练视频」文件夹）',
    defaultPath: dest,
    filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  const copied = PhotoLib.importVideoFile(r.filePaths[0], dest);
  if (copied.error) return null;
  return { path: copied.path, name: copied.name, copied: !!copied.copied, skippedCopy: !!copied.skippedCopy };
});

ipcMain.handle('bilibili:fetchInfo', async (_e, bvid) => fetchBilibiliInfo(bvid));

/* 内嵌视频属于主窗口的 WebFrameMain 子树，不是独立 WebContents。
   只允许本地应用主框架发起请求，且只访问官方播放器的 HTTPS 框架。 */
const EMBEDDED_PAUSE_SCRIPT = `(async () => {
  let n=0; for(const v of document.querySelectorAll('video')) { v.pause(); n++; } return n;
})()`;
const EMBEDDED_RESUME_SCRIPT = `(async () => {
  let n=0; for(const v of document.querySelectorAll('video')) {
    try { await v.play(); n++; } catch {} } return n;
})()`;
const EMBEDDED_STATUS_SCRIPT = `(() => {
  const v=document.querySelector('video');
  return v ? {paused:v.paused, ended:v.ended, readyState:v.readyState,
    seeking:v.seeking, currentTime:v.currentTime} : null;
})()`;
function embeddedFrames(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  const wc=mainWindow.webContents;
  if (event.sender !== wc || event.senderFrame !== wc.mainFrame) return [];
  return wc.mainFrame.framesInSubtree.filter(frame => {
    try { const u=new URL(frame.url);
      return frame !== wc.mainFrame && u.protocol==='https:' && u.hostname==='player.bilibili.com';
    } catch { return false; }
  });
}
async function embeddedEval(frame, script, gesture=false) {
  let timer;
  try { return await Promise.race([
    frame.executeJavaScript(script, gesture),
    new Promise(resolve => { timer=setTimeout(()=>resolve(null),1500); })
  ]); } catch { return null; } finally { clearTimeout(timer); }
}
for (const [channel, script] of [['media:embeddedPause',EMBEDDED_PAUSE_SCRIPT],['media:embeddedResume',EMBEDDED_RESUME_SCRIPT]]) {
  ipcMain.handle(channel, async event => {
    const frames=embeddedFrames(event);
    const results=await Promise.all(frames.map(f=>embeddedEval(f,script,channel==='media:embeddedResume')));
    return {count:results.reduce((n,v)=>n+(Number(v)||0),0),targets:frames.length};
  });
}
ipcMain.handle('media:embeddedStatus', async event => {
  const frames=embeddedFrames(event);
  return (await Promise.all(frames.map(async frame => {
    const url=frame.url;
    const state=await embeddedEval(frame,EMBEDDED_STATUS_SCRIPT);
    try { return state && frame.url===url ? {...state,url} : null; } catch { return null; }
  }))).filter(Boolean);
});

ipcMain.handle('app:openDataFolder', () => { shell.openPath(dataDir()); return dataDir(); });
ipcMain.handle('app:userDataPath', () => dataDir());

// 退出前的最终保存（渲染端同步调用，防止丢最后一分钟的记录）
ipcMain.on('data:save-sync', (e, data) => { e.returnValue = saveData(data); });

/* ---------------- 皮肤 / 健身照片 / 跟练视频 ----------------
   日常：工程子文件夹「皮肤照片」「健身照片」「跟练视频」。
   隔离测试资料：userData/skin-photos、body-photos、imported-videos。 */
function isolatedProfile() {
  if (process.env.FACE_RESHAPE_PROFILE || process.env.FACE_UX20_TEST) return true;
  try {
    return path.resolve(dataDir()) !== path.resolve(path.join(app.getPath('appData'), app.getName()));
  } catch { return true; }
}
function projectRoot() {
  return PhotoLib.resolveProjectRoot({
    packaged: app.isPackaged,
    unpackagedRoot: __dirname,
    downloadsPath: app.getPath('downloads'),
    homePath: app.getPath('home')
  });
}
function mediaDir(kind) {
  const p = PhotoLib.resolveMediaDir({
    isolated: isolatedProfile(),
    dataDir: dataDir(),
    projectRoot: projectRoot(),
    kind
  });
  fs.mkdirSync(p, { recursive: true });
  return p;
}
function mediaOpts() {
  return { skinDir: mediaDir('skin'), bodyDir: mediaDir('body'), videoDir: mediaDir('video'), photoDir: mediaDir('skin') };
}
function migrateLegacyPhotos() {
  if (isolatedProfile()) return;
  const skin = mediaDir('skin');
  const body = mediaDir('body');
  const video = mediaDir('video');
  PhotoLib.copyLegacyPhotos(path.join(dataDir(), 'skin-photos'), skin);
  try { PhotoLib.copyLegacyPhotos(path.join(app.getPath('pictures'), '面部重塑计划'), skin); } catch {}
  PhotoLib.splitBodyPhotos(db && db.skin && db.skin.photos, skin, body);
  if (db && Array.isArray(db.videos)) {
    const changed = PhotoLib.importExistingVideos(db.videos, video);
    if (changed.length) saveData(db);
  }
}
ipcMain.handle('skinphoto:save', (_e, buf, ext, meta) => {
  const bytes = Buffer.from(buf || []);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) return null;
  const kind = meta && meta.kind === 'body' ? 'body' : 'skin';
  const dir = mediaDir(kind);
  const used = new Set(PhotoLib.listImageFiles(dir));
  const name = PhotoLib.suggestedName({
    date: meta && meta.date,
    kind,
    angle: meta && meta.angle,
    ext: ext === 'png' ? 'png' : 'jpg',
    used
  });
  fs.writeFileSync(path.join(dir, name), bytes);
  return name;
});
/* 照片读取 LRU 缓存（主进程内存，上限约 64MB）：网格每次渲染会重读同批大图，
   base64 解码是主要卡顿源；不改变磁盘格式，PhotoLib 不受影响，删除照片时按名失效 */
const photoReadCache = new Map();
function cachedPhotoRead(kind, name) {
  if (!name || name === '.' || name === '..') return null;
  const key = `${kind}|${name}`;
  const hit = photoReadCache.get(key);
  if (hit) { hit.at = Date.now(); return hit.b64; }
  const p = PhotoLib.locatePhotoFile(name, kind, mediaDir('skin'), mediaDir('body'));
  if (!p) return null;
  let b64;
  try { b64 = fs.readFileSync(p).toString('base64'); } catch { return null; }
  photoReadCache.set(key, { b64, bytes: b64.length, at: Date.now() });
  let total = 0;
  for (const v of photoReadCache.values()) total += v.bytes;
  while (total > 64 * 1024 * 1024) {
    let oldestKey = null, oldestAt = Infinity;
    for (const [k, v] of photoReadCache) if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
    if (!oldestKey) break;
    total -= photoReadCache.get(oldestKey).bytes;
    photoReadCache.delete(oldestKey);
  }
  return b64;
}
ipcMain.handle('skinphoto:read', (_e, name, kind) => cachedPhotoRead(kind === 'body' ? 'body' : 'skin', String(name || '')));
ipcMain.handle('skinphoto:delete', (_e, name, kind) => {
  const p = PhotoLib.locatePhotoFile(name, kind, mediaDir('skin'), mediaDir('body'));
  if (!p || !fs.existsSync(p)) return false;
  fs.rmSync(p, { force: true });
  photoReadCache.delete(`${kind === 'body' ? 'body' : 'skin'}|${String(name)}`);
  return true;
});
ipcMain.handle('skinphoto:openFolder', async (_e, kind) => {
  const dir = mediaDir(kind === 'body' ? 'body' : 'skin');
  const error = await shell.openPath(dir);
  return { path: dir, error: error || null, visible: !isolatedProfile(), kind: kind === 'body' ? 'body' : 'skin' };
});
ipcMain.handle('skinphoto:folderInfo', (_e, kind) => {
  const dir = mediaDir(kind === 'body' ? 'body' : 'skin');
  return { path: dir, visible: !isolatedProfile(), kind: kind === 'body' ? 'body' : 'skin' };
});
ipcMain.handle('skinphoto:list', (_e, known, kind, date) => {
  const k = kind === 'body' ? 'body' : 'skin';
  return PhotoLib.newFiles(mediaDir(k), known || [], k, date || null, { forceKind: true });
});
ipcMain.handle('media:openRoot', async () => {
  const dir = isolatedProfile() ? dataDir() : projectRoot();
  const error = await shell.openPath(dir);
  return { path: dir, error: error || null };
});
ipcMain.handle('video:openFolder', async () => {
  const dir = mediaDir('video');
  const error = await shell.openPath(dir);
  return { path: dir, error: error || null, visible: !isolatedProfile() };
});
ipcMain.handle('video:listNew', (_e, known) => PhotoLib.newVideoFiles(mediaDir('video'), known || []));

/* ---------------- AI 视觉识图（GLM-4V，用户自配密钥，点按才上传） ---------------- */
const SKIN_VISION_PROMPT = [
  '你是皮肤与面部轮廓观察助手。根据照片估算面部状态，只输出一个 JSON 对象，不要任何多余文字：',
  '{"acneTotal":整数0-99,"pores":0-3,"spots":0-3,"redness":0-3,"oil":0-3,"dry":0-3,"barrier":0-3,"eyes":0-3,"overall":1-10,"fullness":0-3,"puffiness":0-3,"definition":0-3,"summary":"40字内","advice":"60字内"}',
  '分级口径（0-3）：0=好，1=轻微，2=明显，3=严重。pores毛孔可见度；spots色斑痘印；redness泛红；oil出油(T区反光)；dry干燥起皮；barrier屏障(泛红血丝刺痛迹象)；eyes眼周暗沉与眼袋；overall整体。fullness面部圆润饱满感(苹果肌/颊部脂肪的视觉印象，0=清瘦,3=很圆润)；puffiness晨起水肿感(眼周/面部胀感,0=无,3=明显)；definition下颌线与轮廓清晰度(0=模糊,3=很清晰)。这三项是主观视觉印象，不是测量。若照片模糊或不是清晰面部，输出 {"error":"无法识别"}。'
].join('\n');
function httpsPostJson(urlStr, headers, body, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers), timeout: timeoutMs || 30000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        /* 响应体上限 8MB：异常/恶意服务器无限回包不再撑爆内存（对齐图片上传上限） */
        if (buf.length > 8 * 1024 * 1024) { req.destroy(); resolve({ status: 0, json: null, error: '响应超过 8MB，已中止' }); }
      });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: '请求超时' }); });
    req.on('error', (e) => resolve({ error: String(e.message || e) }));
    req.write(body);
    req.end();
  });
}
ipcMain.handle('ai:analyzeSkin', async (_e, imageBase64, mime, apiKey, model) => {
  let key; try { key=keys().read(); } catch { return {ok:false,error:'系统安全存储不可用，请重新配置'}; }
  if (!key) return { ok: false, error: '未配置 AI 密钥：先在护肤页「AI 识图设置」里填入' };
  if (!imageBase64 || imageBase64.length > 8 * 1024 * 1024) return { ok: false, error: '图片缺失或过大' };
  const body = JSON.stringify({
    model: model === 'glm-4v-plus' ? 'glm-4v-plus' : 'glm-4v-flash',
    temperature: 0.2,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${mime === 'image/png' ? 'image/png' : 'image/jpeg'};base64,${imageBase64}` } },
      { type: 'text', text: SKIN_VISION_PROMPT }
    ] }]
  });
  const r = await httpsPostJson('https://open.bigmodel.cn/api/paas/v4/chat/completions', { Authorization: `Bearer ${key}` }, body, 60000);
  if (r.error) return { ok: false, error: r.error };
  if (r.status !== 200 || !r.json) {
    const msg = r.json && r.json.error && r.json.error.message ? `：${r.json.error.message}` : '';
    return { ok: false, error: `接口异常（HTTP ${r.status}）${msg}` };
  }
  try {
    let text = String(r.json.choices[0].message.content).replace(/```json|```/g, '').trim();
    const start = text.indexOf('{');
    const data = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, data };
  } catch { return { ok: false, error: '返回内容无法解析' }; }
});

/* ---------------- 大模型计划文本解析（默认 DeepSeek；用户自配密钥，点按才上传） ---------------- */
const PLAN_PARSE_PROMPT = [
  '你是护肤计划结构化助手。把用户粘贴的护肤计划全文转换成结构化 JSON，只输出一个 JSON 对象，不要任何多余文字：',
  '{"cycles":[{"name":"周期名","startDate":"YYYY-MM-DD 或空串","endDate":"YYYY-MM-DD 或空串","steps":{"morning":[{"name":"产品或步骤","detail":"用法说明或空串"}],"day":[],"evening":[]}}]}',
  '规则：morning/day/evening 分别对应晨间/日间/晚间流程；只整理用户文本里写明的内容，不新增、不推荐、不修改任何产品；文本里没有的日期一律留空串；name 不超过 20 字，detail 不超过 40 字；最多 30 个周期，每个流程最多 30 步；用户文本与护肤无关时输出 {"cycles":[]}。'
].join('\n');
ipcMain.handle('ai:parsePlan', async (_e, text, apiKey, model) => {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, error: '未配置 DeepSeek API Key' };
  const body = String(text || '');
  if (!body.trim()) return { ok: false, error: '内容为空' };
  if (body.length > 20000) return { ok: false, error: '文本过长（上限 2 万字），请分段导入' };
  const req = JSON.stringify({
    model: String(model || 'deepseek-chat').slice(0, 60) || 'deepseek-chat',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PLAN_PARSE_PROMPT },
      { role: 'user', content: body.slice(0, 20000) }
    ]
  });
  const r = await httpsPostJson('https://api.deepseek.com/chat/completions', { Authorization: `Bearer ${key}` }, req, 60000);
  if (r.error) return { ok: false, error: r.error };
  if (r.status !== 200 || !r.json) {
    const msg = r.json && r.json.error && r.json.error.message ? `：${r.json.error.message}` : '';
    return { ok: false, error: `接口异常（HTTP ${r.status}）${msg}` };
  }
  try {
    const text2 = String(r.json.choices[0].message.content).replace(/```json|```/g, '').trim();
    const start = text2.indexOf('{');
    const data = JSON.parse(text2.slice(start, text2.lastIndexOf('}') + 1));
    return { ok: true, data };
  } catch { return { ok: false, error: '返回内容无法解析' }; }
});

// 中控提示器 / 个人积累库
ipcMain.handle('lifepivot:importSleep', () => readLifepivotSleep());
ipcMain.handle('hub:exportNow', () => { hubExportCache = ''; writeHubExport(); return true; });

// 中控提示器远程动作：渲染端注册与回执（hub-actions.js ↔ HTTP /hub/action）
ipcMain.on('hub:ready', () => { hubRendererReady = true; });
ipcMain.on('hub:action-done', (e, payload) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) return;
    const actionId = payload && payload.actionId;
    const entry = hubPending.get(actionId);
    if (!entry) return;
    hubPending.delete(actionId);
    clearTimeout(entry.timer);
    const result = payload && typeof payload.result === 'object' && payload.result ? payload.result : { ok: false, error: '渲染端回执无效' };
    entry.respond(result);
  } catch { /* 回执处理异常：让 5 秒超时兜底 */ }
});

/* ---------------- 生命周期 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    loadData();
    migrateLegacyPhotos();
    createWindow();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(isMac?[{role:'appMenu'}]:[]),{role:'editMenu'},
      {label:'导航与保存',submenu:[{label:'保存当前表单',accelerator:'CmdOrCtrl+S',click:()=>sendToRenderer('app:shortcut','s')},...['今日','跟练计划','力量训练','护肤','饮食与睡眠','成就'].map((label,i)=>({label,accelerator:`CmdOrCtrl+${i+1}`,click:()=>sendToRenderer('app:shortcut',String(i+1))}))]}, {role:'windowMenu'}
    ]));
    createTray();
    writeHubExport();
    startHubServer();
    setInterval(() => {
      /* 提醒无异常隔离会互相拖死：一条脏数据（如周期缺 steps）不能停掉其余提醒 */
      try { checkSchedules(); } catch (e) { console.error('checkSchedules failed:', e); }
    }, 15000);
    checkSchedules();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showMainWindow(); });
  });

  app.on('before-quit', () => { quitting = true; });

  app.on('window-all-closed', () => {
    // 托盘常驻：不退出，除非用户选择退出（macOS 亦保持常驻以支持提醒）
  });
}
