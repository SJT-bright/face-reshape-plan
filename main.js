/**
 * 人生重塑计划 —— 主进程
 * 窗口 / 托盘 / 系统通知 / 定时提醒引擎 / 数据持久化
 */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, dialog, shell, nativeImage, safeStorage, systemPreferences, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { ensurePrivatePerms } = require('./src/js/file-perms');
const { backupFileName, isBackupFileName, pruneBackupList } = require('./src/js/backup-util');
const { parseHHmm, reminderDue } = require('./src/js/reminder-util');

const PortableBackup = require('./src/js/portable-backup');
const PhotoLib = require('./src/js/photo-library');
const HubPhotoStore = require('./src/js/hub-photo-store');
const makeKeyStore = require('./src/js/secure-key');
const Reminders = require('./src/js/reminders-v2');
const keys = () => makeKeyStore(dataDir(), safeStorage);
let pendingRestore = null;

const APP_NAME = '人生重塑计划';
// 改名只改变展示名称；旧资料、Chromium 草稿与媒体根目录继续沿用原位置。
const LEGACY_USER_DATA = path.join(app.getPath('appData'), '面部重塑计划');
const initialUserData = app.getPath('userData');
const initialDefaultUserData = path.join(app.getPath('appData'), app.getName());
const configuredUserData = process.env.FACE_RESHAPE_PROFILE
  ? path.resolve(process.env.FACE_RESHAPE_PROFILE)
  : path.resolve(initialUserData) !== path.resolve(initialDefaultUserData)
    ? initialUserData // 保留调用方已用 app.setPath 指定的隔离资料。
    : LEGACY_USER_DATA;
fs.mkdirSync(configuredUserData, { recursive: true });
app.setName(APP_NAME);
// HTTP 头只能使用字节字符；显示名保持中文，UA 只替换应用产品名，保留 Chromium 平台信息。
app.userAgentFallback = app.userAgentFallback.replaceAll(APP_NAME, 'LifeReshapePlan');
app.setPath('userData', configuredUserData);
app.setPath('sessionData', configuredUserData);
if (process.env.FACE_RESHAPE_PROFILE) app.setPath('cache', path.join(configuredUserData, 'cache'));

const isMac = process.platform === 'darwin';
if (process.platform === 'win32') app.setAppUserModelId('com.faceshape.plan');
let mainWindow = null;
let tray = null;
let db = null;              // 内存中的数据副本（渲染端每次保存后同步）
let firedToday = new Set(); // 会话提醒去重：`${date}|${sessionId}`
let firedEveningReview = null; // 晚间复盘提醒去重：date string
let quitting = false;
let routineRendererReady = false;

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
      videoMode: 'face',         // 当前视频板块；旧资料仍进入瘦脸护理。
      // 护肤时段分界（到点提醒对应时段的护肤流程）
      skincareTimes: { morning: '09:00', noon: '12:00', evening: '20:00' }
    },
    videos: [],
    sessions: [],
    skincare: { cycles: [] },
    logs: { training: {}, skincare: {}, videoWatching: {} },
    reminderState: {}
  };
}
function loadData() {
  try {
    /* recover 失败只记日志：不得因此改名或清空仍然完好的数据文件 */
    try {
      PortableBackup.recover(dataDir());
    } catch (e) {
      console.error('portable backup recover failed:', e);
    }
    const raw = fs.readFileSync(dataFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    /* 必须是 plain object：数组/字符串等能通过 JSON.parse 的畸形文件同样走损坏隔离，不带病运行 */
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('数据文件结构损坏');
    db = parsed;
    // 简单的结构兜底
    db.settings = Object.assign(defaultData().settings, db.settings || {});
    db.settings.skincareTimes = Object.assign({ morning: '09:00', noon: '12:00', evening: '20:00' }, db.settings.skincareTimes || {});
    db.logs = db.logs || { training: {}, skincare: {}, videoWatching: {} };
    db.logs.training = db.logs.training || {};
    db.logs.skincare = db.logs.skincare || {};
    db.logs.videoWatching = db.logs.videoWatching || {};
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
    /* 损坏或缺失后写入的默认空库：已有当天快照不得被覆盖 */
    saveData(db, { protectExistingDailyBackup: true });
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
function saveData(data, options) {
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
    autoBackupData(options); // 每天首次保存时做一份本地快照，防数据损坏/误操作
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
function autoBackupData(options) {
  try {
    const today = dateKey(new Date());
    if (today === lastAutoBackupDay) return;
    const dir = path.join(dataDir(), 'auto-backups');
    const dest = path.join(dir, backupFileName(today));
    /* 仅空库重建带这个标志。普通保存仍是本进程当天第一次写快照，已有文件也会更新。 */
    if (options && options.protectExistingDailyBackup && fs.existsSync(dest)) {
      lastAutoBackupDay = today;
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
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
          tasks.push({ id: 'strength', time: null, title: '休息日 · 恢复为主', source: APP_NAME, note: '今天没有安排力量训练，睡好吃好' });
        } else {
          const acts = d.actions || [];
          const first = acts[0];
          const note = `${acts.length} 个动作` + (first ? ` · 首个：${first.name} ${first.plannedSets || ''}组 ${first.plannedRepsText || ''}`.trim() : '') + (info.preview ? ' · 按计划预览' : '');
          tasks.push({ id: 'strength', time: '19:00', title: `力量训练 · ${d.name}`, source: APP_NAME, note });
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
        source: APP_NAME, note: '沉浸式跟练 · 打开应用开始'
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
        tasks.push({ id: `skincare-${key}`, time: /^\d{1,2}:\d{2}$/.test(time || '') ? time : null, title: label, source: APP_NAME, note: `当前周期「${cyc.name}」${steps.length} 步 · ${names}` });
      }
    }

    // 4) 睡前复盘 + 晨间睡眠补记
    if (db.settings.eveningReviewTime && /^\d{1,2}:\d{2}$/.test(db.settings.eveningReviewTime)) {
      tasks.push({ id: 'review', time: db.settings.eveningReviewTime, title: '睡前复盘', source: APP_NAME, note: '瘦脸操做了多久？护肤打卡了吗？' });
    }
    /* 与应用内睡眠提醒同口径：读取设置时间，留空=关闭（不再固定 10:00 无视设置） */
    if (db.settings.sleepLogReminderTime && /^\d{1,2}:\d{2}$/.test(db.settings.sleepLogReminderTime)) {
      tasks.push({ id: 'sleep', time: db.settings.sleepLogReminderTime, title: '记录昨晚睡眠', source: APP_NAME, note: '记录入睡和起床时间；有手环数据也可补充' });
    }

    const payload = { app: APP_NAME, date: today, generatedAt: now.toISOString(), tasks };
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
 * POST /hub/meal    → 仅本机生活日报的带令牌、幂等餐食同步。
 * POST /hub/photo   → 带令牌同步原始照片、时间和分类，逐张核验 SHA-256。
 * 只绑定 127.0.0.1；照片原文件限25MB，其他请求64KB；令牌仅在本机0600文件。
 * 主进程不直接改数据文件（渲染端内存副本会在下次保存时覆盖外部改动）：
 * 动作经 webContents.send 转发给渲染端执行，渲染端走应用自身保存链路后经 IPC 回执。
 * 任何异常只打日志，绝不影响应用本身。 */
const http = require('http');
// Isolated test profiles may use another loopback port without disturbing the
// installed app. Production always keeps its existing, fixed local endpoint.
const profileHubPort = Number(process.env.FACE_HUB_PORT);
const HUB_PORT = process.env.FACE_RESHAPE_PROFILE
  ? (Number.isInteger(profileHubPort) && profileHubPort >= 1024 && profileHubPort <= 65535 ? profileHubPort : 0)
  : 18466;
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

function hubMealToken() {
  const file = path.join(dataDir(), 'hub-meal-token');
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { encoding:'ascii', flag:'wx', mode:0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  ensurePrivatePerms(file);
  const token = fs.readFileSync(file, 'ascii').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('meal sync token invalid');
  return token;
}

function hubDispatchMeal(req, res, raw) {
  let token;
  try { token = hubMealToken(); } catch { return hubRespond(res, 503, {ok:false,error:'餐食同步令牌不可用'}); }
  const given = String(req.headers['x-life-meal-token'] || '');
  if (!/^[a-f0-9]{64}$/.test(given) || !crypto.timingSafeEqual(Buffer.from(given),Buffer.from(token))) {
    return hubRespond(res, 403, {ok:false,error:'餐食同步未授权'});
  }
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { return hubRespond(res,400,{ok:false,error:'请求体必须是 JSON'}); }
  const valid = input && /^[a-f0-9]{64}$/.test(input.sourceKey) &&
    Number.isSafeInteger(input.revision) && input.revision > 0 && input.revision < 100000000 &&
    typeof input.local === 'string' && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.local) &&
    typeof input.at === 'string' && input.at.startsWith(input.local + ':') && input.at.endsWith('+08:00') &&
    Number.isFinite(Date.parse(input.at)) && Date.parse(input.at) <= Date.now() + 60000 &&
    ['started','finished'].includes(input.timeKind) && ['active','cancelled'].includes(input.state) &&
    typeof input.foodText === 'string' && input.foodText.length <= 180 &&
    Number.isSafeInteger(input.photoCount) && input.photoCount >= 0 && input.photoCount <= 1000;
  if (!valid) return hubRespond(res,400,{ok:false,error:'餐食字段无效'});
  if (!hubRendererAvailable()) return hubRespond(res,503,{ok:false,error:'应用数据未就绪'});
  const meal = {sourceKey:input.sourceKey,revision:input.revision,local:input.local,
                at:input.at,timeKind:input.timeKind,state:input.state,
                foodText:input.foodText,photoCount:input.photoCount};
  const actionId = `meal-${Date.now().toString(36)}-${(++hubActionSeq).toString(36)}`;
  hubPending.set(actionId, {
    respond: (result) => hubRespond(res,result && result.ok ? 200 : result && result.conflict ? 409 : result && result.retryable ? 503 : 400,result),
    timer: setTimeout(() => { if (hubPending.delete(actionId)) hubRespond(res,504,{ok:false,error:'餐食写入超时'}); },5000)
  });
  try { mainWindow.webContents.send('hub:action',{actionId,op:'meal-import',meal}); }
  catch { const pending=hubPending.get(actionId); if (pending) {clearTimeout(pending.timer);hubPending.delete(actionId);} hubRespond(res,503,{ok:false,error:'餐食转发失败'}); }
}

function hubPhotoAuthorized(req) {
  const given=String(req.headers['x-life-meal-token'] || '');
  return /^[a-f0-9]{64}$/.test(given) && crypto.timingSafeEqual(Buffer.from(given),Buffer.from(hubMealToken()));
}

function hubDispatchPhoto(req,res,raw) {
  if(!hubPhotoAuthorized(req))return hubRespond(res,403,{ok:false,error:'照片同步未授权'});
  let validated;
  try {validated=HubPhotoStore.validate(JSON.parse(raw));}
  catch {return hubRespond(res,400,{ok:false,error:'照片字段或摘要无效'});}
  if(!hubRendererAvailable())return hubRespond(res,503,{ok:false,error:'应用数据未就绪'});
  let photo;
  try {photo=HubPhotoStore.save(validated,mediaDir(validated.photo.kind));}
  catch {return hubRespond(res,503,{ok:false,error:'照片文件暂时无法保存'});}
  const actionId=`photo-${Date.now().toString(36)}-${(++hubActionSeq).toString(36)}`;
  hubPending.set(actionId,{
    respond:result=>hubRespond(res,result?.ok ? 200 : result?.conflict ? 409 : result?.retryable ? 503 : 400,result),
    timer:setTimeout(()=>{if(hubPending.delete(actionId))hubRespond(res,504,{ok:false,error:'照片记录写入超时'});},5000)
  });
  try {mainWindow.webContents.send('hub:action',{actionId,op:'photo-import',photo});}
  catch {const pending=hubPending.get(actionId);if(pending){clearTimeout(pending.timer);hubPending.delete(actionId);}hubRespond(res,503,{ok:false,error:'照片转发失败'});}
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
    return hubRespond(res, 200, { ok: true, app: APP_NAME });
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
  if (req.method === 'POST' && ['/hub/action','/hub/meal','/hub/photo'].includes(url.pathname)) {
    const photoRoute=url.pathname==='/hub/photo';
    if(photoRoute && !hubPhotoAuthorized(req))return hubRespond(res,403,{ok:false,error:'照片同步未授权'});
    const chunks = [];
    let size = 0;
    let tooLarge=false;
    req.on('data', (c) => {
      size += c.length;
      if (size > (photoRoute ? Math.ceil(HubPhotoStore.MAX_BYTES/3)*4+8192 : 64*1024)) {
        if(!tooLarge){tooLarge=true;hubRespond(res,413,{ok:false,error:'请求体过大'});}
        return;
      }
      if(!tooLarge)chunks.push(c);
    });
    req.on('end', () => {
      if(tooLarge)return;
      try { (photoRoute ? hubDispatchPhoto : url.pathname === '/hub/meal' ? hubDispatchMeal : hubDispatchAction)(req, res, Buffer.concat(chunks).toString('utf8')); } catch (e) { hubRespond(res, 500, { ok: false, error: '服务器内部错误' }); }
    });
    req.on('error', () => { /* 客户端中断：无需应答 */ });
    return;
  }
  hubRespond(res, 404, { ok: false, error: 'not found' });
}

function startHubServer() {
  try {
    hubMealToken();
    const server = http.createServer((req, res) => {
      try { hubHandle(req, res); } catch (e) { console.error('hub request failed:', e); try { hubRespond(res, 500, { ok: false, error: '服务器内部错误' }); } catch {} }
    });
    server.on('error', (e) => console.error(`hub server error（端口 ${HUB_PORT}，不影响应用本身）:`, e.message));
    server.listen(HUB_PORT, '127.0.0.1', () => console.log(`hub server listening on http://127.0.0.1:${HUB_PORT}`));
  } catch (e) {
    console.error('hub server failed to start（不影响应用本身）:', e);
  }
}

/* ---------------- 从「个人积累库」只读导入睡眠记录 ---------------- */
function readLifepivotSleep() {
  return Promise.resolve(require('./src/js/lifepivot-sleep').readSleep(app.getPath('appData')));
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
    title: APP_NAME,
    backgroundColor: '#eef4fb',
    autoHideMenuBar: true,
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  const cameraRequestAllowed = (wc, details = {}) => {
    const expected = require('url').pathToFileURL(path.join(__dirname, 'src', 'index.html')).href;
    const types = details.mediaTypes || (details.mediaType ? [details.mediaType] : []);
    return wc === mainWindow?.webContents && (details.requestingUrl || wc?.getURL()) === expected && details.isMainFrame !== false && types.every(type => type === 'video');
  };
  const permissionAllowed = (wc, permission, details = {}) => {
    if (permission === 'media') return cameraRequestAllowed(wc, details);
    if (['clipboard-read', 'clipboard-sanitized-write', 'clipboard-read-write'].includes(permission)) return cameraRequestAllowed(wc, { ...details, mediaTypes: [], mediaType: undefined });
    if (permission !== 'fullscreen' || wc !== mainWindow?.webContents) return false;
    try { const url = new URL(details.requestingUrl || wc.getURL()); return url.protocol === 'file:' || url.origin === 'https://player.bilibili.com'; } catch { return false; }
  };
  mainWindow.webContents.session.setPermissionCheckHandler((wc, permission, origin, details) => permissionAllowed(wc, permission, details));
  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => callback(permissionAllowed(wc, permission, details)));

  // 抖音视频流/封面直连需要 Referer（部分还需移动端 UA）：<video> 标签请求经此补头
  try {
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders({
      urls: ['*://*.douyin.com/*', '*://*.douyinpic.com/*', '*://*.douyinvod.com/*', '*://*.iesdouyin.com/*', '*://*.zjcdn.com/*', '*://*.bytecdn.cn/*', '*://*.snssdk.com/*']
    }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'Referer': 'https://www.douyin.com/', 'User-Agent': DOUYIN_UA } });
    });
  } catch (e) { /* 老版本 Electron 无 webRequest 时降级为不带 Referer */ }

  // 中控提示器远程动作依赖渲染端就绪：窗口重新加载/渲染进程崩溃时先置为不可用，
  // 等新页面里 hub-actions.js 通过 hub:ready 重新登记
  mainWindow.webContents.on('did-start-loading', () => { hubRendererReady = false; routineRendererReady = false; });
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
  tray.setToolTip(APP_NAME);
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
  const locked = powerMonitor?.getSystemIdleState?.(1) === 'locked';
  const automatic = pending.filter(x => x.autoStart && routineRendererReady && !locked);
  const notices = pending.filter(x => !x.autoStart && (process.env.FACE_UX20_TEST==='1'||Notification.isSupported()));
  const deliver = [...automatic, ...notices]; if(!deliver.length)return;
  const next=JSON.parse(JSON.stringify(db));for(const x of deliver)Reminders.action(next,x.id,'fired');
  if(!saveData(next))return;
  for(const item of automatic) sendToRenderer('routine-activate',item);
  if(notices.length)notifyNow(notices.length>1?`今日待办（${notices.length} 项）`:notices[0].title,notices.map(x=>x.title).join(' · '),notices.length===1?notices[0].sessionId:null);
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

/* ---------------- 抖音视频信息抓取（短链重定向 + 分享页解析，主进程无 CORS 限制） ---------------- */
// 单次 https.get 收集 body，供重定向跟随与分享页抓取复用；永不 reject，错误放 error 字段
function httpsGetOnce(url, headers) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const req = https.get(url, { headers, timeout: 8000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done({
        status: res.statusCode || 0,
        headers: res.headers || {},
        body: Buffer.concat(chunks).toString('utf8'),
        error: null
      }));
    });
    req.on('timeout', () => { req.destroy(); done({ status: 0, headers: {}, body: '', error: '请求超时' }); });
    req.on('error', (e) => done({ status: 0, headers: {}, body: '', error: String((e && e.message) || e) }));
  });
}

const DOUYIN_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// 从链接或纯数字串中提取抖音视频 id（15~21 位）
function extractDouyinVid(s) {
  const str = String(s || '');
  const m = str.match(/\/video\/(\d{15,21})/) || str.match(/\/note\/(\d{15,21})/) ||
            str.match(/\/share\/video\/(\d{15,21})/) || str.match(/modal_id=(\d{15,21})/);
  if (m) return m[1];
  return /^\d{15,21}$/.test(str.trim()) ? str.trim() : null;
}

function decodeDouyinHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");
}

/* ---------------- 抖音直链 SSRF 防护：分享页/短链里的跳转地址都可能被指向内网 ---------------- */
// 只允许抖音系域名（含 v.douyin.com 短链、aweme.snssdk.com 等全称比较：等于或以 . 后缀结尾）
const DOUYIN_ALLOWED_HOST_SUFFIXES = ['douyin.com', 'iesdouyin.com', 'douyinpic.com', 'douyinvod.com', 'snssdk.com', 'zjcdn.com', 'bytecdn.cn'];

// 环回 / 私有 / 保留段 IP 字面量与 localhost、*.local 一律视为危险主机
function isForbiddenDouyinHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const m4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const o = m4.slice(1).map(Number);
    if (o.some(n => n > 255)) return true;
    const [a, b] = o;
    if (a === 0 || a === 10 || a === 127) return true;   // 本网段 / 私有 / 环回
    if (a === 169 && b === 254) return true;             // 链路本地
    if (a === 172 && b >= 16 && b <= 31) return true;    // 私有
    if (a === 192 && b === 168) return true;             // 私有
    if (a === 100 && b >= 64 && b <= 127) return true;   // 运营商级 NAT
    if (a >= 224) return true;                           // 组播与保留段
    return false;
  }
  if (h.includes(':')) {                                 // IPv6 字面量（URL.hostname 带 []，已剥）
    if (!/^[0-9a-f:.]+$/.test(h)) return true;
    const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mapped) return isForbiddenDouyinHost(mapped[1]); // IPv4 映射地址按 IPv4 规则判
    if (h === '::' || h === '::1') return true;          // 未指定 / 环回
    const first = parseInt(h.split(':')[0] || '0', 16);
    if (Number.isFinite(first)) {
      if ((first & 0xfe00) === 0xfc00) return true;      // fc00::/7 私有
      if ((first & 0xffc0) === 0xfe80) return true;      // fe80::/10 链路本地
      if (first === 0 || (first & 0xff00) === 0xff00) return true; // 未指定 / 组播
    }
    return false;
  }
  return false;
}

/* 每一跳（含重定向 Location 解析出的新地址）请求前调用；不安全直接终止 */
function assertSafeDouyinUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (isForbiddenDouyinHost(host)) return false;
    return DOUYIN_ALLOWED_HOST_SUFFIXES.some(sfx => host === sfx || host.endsWith('.' + sfx));
  } catch { return false; }
}

/* 截取 marker 之后的第一个花括号平衡 JSON 串（字符串/转义感知）并 parse */
function balancedJsonAfter(text, marker) {
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const start = text.indexOf('{', idx);
  if (start < 0) return null;
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function douyinItemFromRouterData(data) {
  const loader = (data && data.loaderData) || {};
  const key = Object.keys(loader).find(k => /^(video|note)_\(\d+\)\/page$/.test(k)) ||
              Object.keys(loader).find(k => /^(video|note)_\d+\/page$/.test(k)) ||
              Object.keys(loader).find(k => k.indexOf('/page') >= 0);
  const node = key ? loader[key] : null;
  return node && node.videoInfoRes && Array.isArray(node.videoInfoRes.item_list) ? node.videoInfoRes.item_list[0] : null;
}

function douyinMetaFromItem(item) {
  const meta = { title: '', pic: '', author: '', durationSec: null, playUrl: '' };
  if (!item) return meta;
  meta.title = String(item.desc || '');
  meta.author = item.author ? String(item.author.nickname || '') : '';
  if (item.video) {
    const cover = item.video.cover;
    if (cover && Array.isArray(cover.url_list) && cover.url_list.length) meta.pic = String(cover.url_list[0] || '');
    const dur = Number(item.video.duration);
    if (Number.isFinite(dur) && dur > 0) meta.durationSec = Math.round(dur / 1000);
    const play = item.video.play_addr || item.video.play_addr_h264 || item.video.download_addr;
    if (play && Array.isArray(play.url_list) && play.url_list.length) {
      /* playwm 是带水印端点，换成 play 同源同签名，观看时无水印 */
      meta.playUrl = String(play.url_list[0] || '').replace('/playwm/', '/play/');
    }
  }
  return meta;
}

/* 隐藏窗口加载分享页：服务端直连会被抖音 JS 风控挑战拦住，真实浏览器环境会自动放行，
   之后 window._ROUTER_DATA 才会出现。窗口与 persist 分区复用（风控 cookie 保活，越用越快）。 */
let douyinFetchWin = null;
let douyinBrowserQueue = Promise.resolve();
function douyinRouterDataViaBrowser(vid) {
  // 同一个隐藏窗口不能并发导航到不同视频。
  const task = douyinBrowserQueue.then(() => readDouyinRouterData(vid));
  douyinBrowserQueue = task.catch(() => {});
  return task;
}
async function readDouyinRouterData(vid) {
  if (!douyinFetchWin || douyinFetchWin.isDestroyed()) {
    douyinFetchWin = new BrowserWindow({
      show: false, width: 400, height: 720,
      webPreferences: { partition: 'persist:douyin-fetch', javascript: true, nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    douyinFetchWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    /* 分享页会把页面交给抖音 App（snssdk1128:// 等唤端跳转，在 Electron 里表现为 ERR_ABORTED），
       拦下非 http(s) 导航，页面才会留在网页版继续水合出 item_list */
    douyinFetchWin.webContents.on('will-navigate', (e, url) => {
      if (!/^https?:/i.test(String(url || ''))) e.preventDefault();
    });
  }
  const wc = douyinFetchWin.webContents;
  /* 冷启动时先出现的是空 item_list 的 _ROUTER_DATA，客户端水合后才填满：拿到 item 才算成功 */
  const once = async () => {
    try {
      let timer;
      try {
        await Promise.race([
          wc.loadURL(`https://www.iesdouyin.com/share/video/${vid}/`, { userAgent: DOUYIN_UA }),
          new Promise((_, reject) => { timer = setTimeout(() => { wc.stop(); reject(Error('分享页加载超时')); }, 12000); })
        ]);
      } finally { clearTimeout(timer); }
    } catch (e) { /* 唤端跳转会中断 loadURL，属预期，继续轮询 */ }
    let last = null;
    for (let i = 0; i < 12; i++) {
      const raw = await wc.executeJavaScript('(function(){try{return window._ROUTER_DATA?JSON.stringify(window._ROUTER_DATA):""}catch(e){return ""}})()').catch(() => '');
      if (raw) {
        try {
          last = JSON.parse(raw);
          if (douyinItemFromRouterData(last)) return last;
        } catch { last = null; }
      }
      await new Promise(r => setTimeout(r, 450));
    }
    return last;
  };
  const first = await once();
  if (first && douyinItemFromRouterData(first)) return first;
  /* 首次访问常落在「唤端中转态」（_ROUTER_DATA 只有空壳），cookie 备好后重载一次即是网页版 */
  const second = await once();
  return second || first;
}

/* 探测播放直链的最终地址：跟随 302，遇到 200 立即断开（不下载视频正文） */
function httpsProbeRedirect(url, headers) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let req;
    try {
      req = https.get(url, { headers, timeout: 8000 }, (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          return done({ redirect: String(res.headers.location) });
        }
        req.destroy();
        done({ final: true });
      });
    } catch (e) { return done({}); }
    req.on('timeout', () => { req.destroy(); done({}); });
    req.on('error', () => done({}));
  });
}

async function resolveDouyinPlayUrl(playUrl) {
  let url = String(playUrl || '');
  for (let hops = 0; hops < 5 && /^https?:/i.test(url); hops++) {
    if (!assertSafeDouyinUrl(url)) return ''; // 每一跳都必须落在抖音系域名，否则视为失败
    const r = await httpsProbeRedirect(url, { 'User-Agent': DOUYIN_UA, 'Referer': 'https://www.douyin.com/' });
    if (r.redirect) { try { url = new URL(r.redirect, url).href; continue; } catch { return ''; } }
    if (r.final) return url;
    return hops ? url : '';
  }
  return /^https?:/i.test(url) ? url : '';
}

/* 播放地址有时效（抖音签名 URL 数小时失效）：内存缓存 30 分钟，过期重解析 */
const douyinPlayCache = new Map();
const douyinInfoCache = new Map();

async function fetchDouyinInfo(input) {
  const raw = String(input || '').trim();
  try {
    if (!raw) return { ok: false, vid: null, url: '', error: '无法识别链接' };
    let vid = extractDouyinVid(raw);

    // 短链：手动跟随 301/302/303/307/308（最多 5 次），从最终 URL 提取 vid
    if (!vid && /v\.douyin\.com/i.test(raw)) {
      let target = raw, lastErr = null;
      for (let hops = 0; hops < 5; hops++) {
        if (!assertSafeDouyinUrl(target)) { lastErr = '直链域名不被允许'; break; } // 短链跳转目标同样受限
        const res = await httpsGetOnce(target, { 'User-Agent': DOUYIN_UA });
        if (res.error) { lastErr = res.error; break; }
        if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
          try {
            const next = new URL(res.headers.location, target).href;
            if (!assertSafeDouyinUrl(next)) { lastErr = '直链域名不被允许'; break; }
            target = next; continue;
          } catch { break; }
        }
        break;
      }
      vid = extractDouyinVid(target);
      if (!vid) return { ok: false, vid: null, url: raw, error: lastErr || '无法识别链接' };
    } else if (!vid) {
      return { ok: false, vid: null, url: raw, error: '无法识别链接' };
    }

    const vidFail = (error) => ({ ok: false, vid: String(vid), url: 'https://www.douyin.com/video/' + vid, error });
    let meta = { title: '', pic: '', author: '', durationSec: null, playUrl: '' };

    // 首选：隐藏窗口加载分享页（可过 JS 风控，且能拿到播放直链）
    let viaBrowser = false;
    try {
      const data = await douyinRouterDataViaBrowser(vid);
      if (data) {
        const m = douyinMetaFromItem(douyinItemFromRouterData(data));
        if (m.title || m.pic || m.durationSec !== null) { meta = m; viaBrowser = true; }
      }
    } catch (e) { /* 回退服务端直连 */ }

    // 兜底：服务端直连分享页（常被风控挑战页拦住，尽力而为）
    if (!viaBrowser) {
      const shareUrl = `https://www.iesdouyin.com/share/video/${vid}/`;
      if (!assertSafeDouyinUrl(shareUrl)) return vidFail('直链域名不被允许');
      const page = await httpsGetOnce(shareUrl, { 'User-Agent': DOUYIN_UA });
      if (page.error) return vidFail(page.error);
      const data = balancedJsonAfter(page.body, 'window._ROUTER_DATA');
      meta = douyinMetaFromItem(data && douyinItemFromRouterData(data));
      if (!meta.title) {
        const m = page.body.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i) ||
                  page.body.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
        if (m) meta.title = decodeDouyinHtml(m[1]);
      }
      if (!meta.pic) {
        const m = page.body.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']*)["']/i) ||
                  page.body.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:image["']/i);
        if (m) meta.pic = decodeDouyinHtml(m[1]);
      }
      if (!meta.title) {
        const m = page.body.match(/"desc":"((?:[^"\\]|\\.)*)"/);
        if (m) { try { meta.title = JSON.parse('"' + m[1] + '"'); } catch { meta.title = m[1]; } }
      }
    }

    if (meta.playUrl) {
      meta.playUrl = await resolveDouyinPlayUrl(meta.playUrl);
      douyinPlayCache.set(String(vid), { playUrl: meta.playUrl, at: Date.now() });
    }
    if (!meta.title && !meta.pic && meta.durationSec === null) return vidFail('资料解析失败');
    const info = { ok: true, vid: String(vid), url: 'https://www.douyin.com/video/' + vid, title: meta.title, pic: meta.pic, durationSec: meta.durationSec, author: meta.author, playUrl: meta.playUrl };
    if (info.playUrl) douyinInfoCache.set(String(vid), { info, at: Date.now() });
    return info;
  } catch (e) {
    return { ok: false, vid: null, url: raw, error: String((e && e.message) || e) };
  }
}

/* 播放前取直链：缓存新鲜直接返回，否则重新解析（顺带刷新资料） */
async function fetchDouyinPlayUrl(vid) {
  const id = extractDouyinVid(String(vid || ''));
  if (!id) return { ok: false, vid: null, error: '无法识别视频 id' };
  const cached = douyinPlayCache.get(id);
  if (cached && cached.playUrl && Date.now() - cached.at < 30 * 60 * 1000) {
    return { ok: true, vid: id, playUrl: cached.playUrl };
  }
  const info = await fetchDouyinInfo(id);
  if (info.ok && info.playUrl) return { ok: true, vid: id, playUrl: info.playUrl };
  return { ok: false, vid: id, error: info.error || '获取播放地址失败' };
}

/* ---------------- 抖音视频下载到本地媒体库 ---------------- */

/* 标题 → 安全文件名：剔除文件系统非法字符与控制符、合并空白、截 40 字、去尾空格点；空则“视频” */
function douyinSafeFileName(s) {
  /* 与 PhotoLib.safeBase 的文件夹收编规则保持一致（空白→-、剔除非文字字符），
     否则目录扫描会把文件改名，库里记录的 localPath 就失配了 */
  const t = String(s || '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/^[-.]+|[-.]+$/g, '');
  return t || '视频';
}

// 同 vid 并发去重：同一视频同时只下载一次，其余调用复用进行中的 Promise，结束后清除
const douyinDownloadInflight = new Map();

// 只接受完整的 MP4；HTML 错误页和中断文件不能变成已下载状态。
function validDouyinFile(file) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    if (size < 32) return false;
    fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    if (header.toString('ascii', 4, 8) !== 'ftyp') return false;
    let offset = 0, moov = false, mdat = false;
    while (offset + 8 <= size) {
      fs.readSync(fd, header, 0, Math.min(16, size - offset), offset);
      let length = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      if (length === 1) { if (offset + 16 > size) return false; length = Number(header.readBigUInt64BE(8)); }
      if (length === 0) length = size - offset;
      if (!Number.isSafeInteger(length) || length < 8 || offset + length > size) return false;
      moov ||= type === 'moov'; mdat ||= type === 'mdat';
      offset += length;
    }
    return offset === size && moov && mdat;
  } catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function cachedDouyinFile(vid) {
  const dir = mediaDir('video');
  const name = fs.readdirSync(dir).find(n => n.startsWith('抖音-') && n.endsWith('-' + vid + '.mp4') && validDouyinFile(path.join(dir, n)));
  return name ? path.join(dir, name) : null;
}
const douyinDownloadListeners = new Map();
async function downloadDouyinVideo(id, input) {
  const raw = String(input || '').trim();
  const vid = extractDouyinVid(raw);
  const key = vid || raw;
  if (!key || (!vid && !assertSafeDouyinUrl(raw))) return { ok: false, error: '无法识别视频链接' };
  const listeners = douyinDownloadListeners.get(key) || new Set();
  listeners.add(String(id || '')); douyinDownloadListeners.set(key, listeners);
  const running = douyinDownloadInflight.get(key);
  if (running) return running;
  const task = doDouyinDownload(key, raw, vid).finally(() => {
    douyinDownloadInflight.delete(key); douyinDownloadListeners.delete(key);
  });
  douyinDownloadInflight.set(key, task);
  return task;
}
async function doDouyinDownload(key, input, vid) {
  // 本地缓存必须在任何联网解析之前检查，重启后也可离线复用。
  const existing = vid && cachedDouyinFile(vid);
  if (existing) return { ok: true, vid, path: existing, bytes: fs.statSync(existing).size, existed: true };
  const cached = vid && douyinInfoCache.get(vid);
  const info = cached && Date.now() - cached.at < 30 * 60 * 1000 ? cached.info : await fetchDouyinInfo(input);
  if (!info.ok || !info.playUrl) return { ok: false, vid: info.vid || vid, error: info.error || '未能取得视频直链，请重试' };
  vid = info.vid;
  const oldFile = cachedDouyinFile(vid);
  if (oldFile) return { ...info, path: oldFile, bytes: fs.statSync(oldFile).size, existed: true };
  const dest = path.join(mediaDir('video'), '抖音-' + douyinSafeFileName(info.title) + '-' + vid + '.mp4');

  // SSRF：直链必须落在抖音系域名
  if (!assertSafeDouyinUrl(info.playUrl)) return { ok: false, vid, error: '直链域名不被允许' };

  // 流式下载到 .part 临时文件，完成后同目录原子改名；8 分钟总上限，60 秒无数据按超时
  const part = dest + '.part';
  try {
    const bytes = await new Promise((resolve, reject) => {
      let settled = false, hops = 0, out = null, request = null, response = null, received = 0, total = 0, sentBytes = 0, sentAt = 0;
      const hardTimer = setTimeout(() => settle(new Error('下载超时')), 8 * 60 * 1000);
      // 节流进度：每累积 ≥256KB 或每 500ms 发一次；完成时强制再发一次
      const sendProgress = (force) => {
        const now = Date.now();
        if (!force && received - sentBytes < 256 * 1024 && now - sentAt < 500) return;
        sentBytes = received; sentAt = now;
        if (mainWindow && !mainWindow.isDestroyed()) {
          for (const id of douyinDownloadListeners.get(key) || []) mainWindow.webContents.send('douyin:download-progress', { id, received, total });
        }
      };
      const settle = (err, n) => {
        if (settled) return;
        settled = true; clearTimeout(hardTimer);
        if (err) { try { request?.destroy(); response?.destroy(); out?.destroy(); } catch {} reject(err); }
        else resolve(n);
      };
      const start = (url) => {
        if (hops++ > 5) return settle(new Error('重定向次数过多'));
        if (!assertSafeDouyinUrl(url)) return settle(new Error('直链域名不被允许'));
        let req;
        try {
          req = https.get(url, { headers: { 'User-Agent': DOUYIN_UA, 'Referer': 'https://www.douyin.com/' }, timeout: 60000 }, (res) => {
            response = res;
            const status = res.statusCode || 0;
            if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
              res.resume();
              let next;
              try { next = new URL(String(res.headers.location), url).href; } catch { return settle(new Error('重定向地址无效')); }
              return start(next);
            }
            if (status !== 200) { res.resume(); return settle(new Error('下载失败（HTTP ' + status + '）')); }
            const len = parseInt(res.headers['content-length'] || '', 10);
            total = Number.isFinite(len) && len > 0 ? len : 0;
            received = 0;
            out = fs.createWriteStream(part);
            out.on('error', (e) => { try { req.destroy(); } catch {} settle(e); });
            res.on('data', (c) => {
              received += c.length;
              if (!out.write(c)) { res.pause(); out.once('drain', () => res.resume()); } // 背压：写满暂停读取
              sendProgress(false);
            });
            res.on('aborted', () => settle(new Error('下载中断，请重试')));
            res.on('end', () => {
              if (!received || (total && total !== received)) return settle(new Error('视频下载不完整，请重试'));
              out.end(() => { sendProgress(true); settle(null, received); });
            });
            res.on('error', (e) => { try { req.destroy(); } catch {} settle(e); });
          });
        } catch (e) { return settle(e); }
        request = req;
        req.on('timeout', () => { req.destroy(); settle(new Error('下载超时')); }); // socket 60 秒无数据
        req.on('error', (e) => settle(e));
      };
      start(info.playUrl);
    });
    if (!validDouyinFile(part)) throw Error('返回的内容不是完整视频，请重试');
    fs.renameSync(part, dest); // 同目录原子替换
    douyinPlayCache.set(vid, { playUrl: info.playUrl, at: Date.now() }); // info.playUrl 已是直链，顺带刷新缓存
    return { ...info, path: dest, bytes, existed: false };
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch {}
    return { ok: false, vid, error: String((e && e.message) || e) };
  }
}

/* ---------------- IPC ---------------- */
ipcMain.handle('data:load', () => rendererData());
ipcMain.handle('key:status', () => keys().status());
ipcMain.handle('key:save', (_e,key) => { try {keys().save(String(key || '').trim());delete db.settings.aiApiKey;saveData(db);return {ok:true};}catch(e){return {ok:false,error:e.message};} });
ipcMain.handle('backup:status', () => ({lastSuccess:lastAutoBackupDay || null,scope:'每日 JSON 记录快照；不包含照片和视频',key:keys().status()}));
ipcMain.handle('backup:export', async (_e,includeVideos) => {
  try {const r=await dialog.showSaveDialog(mainWindow,{title:'导出完整备份',defaultPath:APP_NAME+'-'+dateKey()+'.frbackup',filters:[{name:'完整备份',extensions:['frbackup']}]});
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

ipcMain.handle('notify', (_e, { title, body }) => !!notifyNow(title || APP_NAME, body || ''));
ipcMain.handle('reminder:list',()=>Reminders.timeline(db,new Date()));
ipcMain.handle('reminder:action',(_e,id,act)=>{if(!['later','skip'].includes(act)||!Reminders.timeline(db).some(x=>x.id===id))return false;const next=JSON.parse(JSON.stringify(db));Reminders.action(next,id,act);return saveData(next);});

ipcMain.handle('app:fullscreen', (_e, on) => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!!on);
  return true;
});
ipcMain.handle('app:isFullscreen', () => (mainWindow ? mainWindow.isFullScreen() : false));
function isAppFrame(event) {
  return !!mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame;
}
ipcMain.handle('routine:ready', event => { if (!isAppFrame(event)) return false; routineRendererReady = true; return true; });
ipcMain.handle('routine:enter', event => {
  if (!isAppFrame(event)) return false;
  showMainWindow(); mainWindow.setFullScreen(true); return true;
});
ipcMain.handle('camera:permission', async event => {
  if (!isAppFrame(event)) return { granted:false };
  if (process.platform === 'win32') {
    const status = systemPreferences.getMediaAccessStatus('camera');
    return { granted: status !== 'denied' && status !== 'restricted', status };
  }
  if (!isMac) return { granted:true };
  const status = systemPreferences.getMediaAccessStatus('camera');
  const granted = status === 'granted' || (status === 'not-determined' && await systemPreferences.askForMediaAccess('camera'));
  return { granted:!!granted, status:systemPreferences.getMediaAccessStatus('camera') };
});
ipcMain.handle('camera:settings', event => {
  if (!isAppFrame(event)) return false;
  if (process.platform === 'win32') return shell.openExternal('ms-settings:privacy-webcam');
  if (!isMac) return false;
  return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
});

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
ipcMain.handle('douyin:fetchInfo', async (_e, input) => fetchDouyinInfo(input));
ipcMain.handle('douyin:playUrl', async (_e, vid) => fetchDouyinPlayUrl(vid));
ipcMain.handle('douyin:download', async (_e, id, vid) => downloadDouyinVideo(id, vid));

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
    return path.resolve(dataDir()) !== path.resolve(LEGACY_USER_DATA);
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
    isolated: isolatedProfile() || process.platform === 'win32',
    dataDir: dataDir(),
    projectRoot: projectRoot(),
    kind
  });
  fs.mkdirSync(p, { recursive: true });
  return p;
}
function mediaOpts() {
  return { skinDir: mediaDir('skin'), bodyDir: mediaDir('body'), mealDir: mediaDir('meal'), videoDir: mediaDir('video'), photoDir: mediaDir('skin') };
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
  const p = PhotoLib.locatePhotoFile(name, kind, mediaDir('skin'), mediaDir('body'),mediaDir('meal'));
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
ipcMain.handle('skinphoto:read', (_e, name, kind) => cachedPhotoRead(['body','meal'].includes(kind) ? kind : 'skin', String(name || '')));
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
  const dir = isolatedProfile() || process.platform === 'win32' ? dataDir() : projectRoot();
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
