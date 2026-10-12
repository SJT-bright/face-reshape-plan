/* 本地视频没有封面时，取出第 0 秒的第一帧做成 JPEG。
   优先用本机 ffmpeg；没有 ffmpeg 时用隐藏窗口解码，避免依赖安装包外的工具。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { ensurePrivatePerms } = require('./file-perms');

const EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const inflight = new Map();

function ffmpegBin() {
  if (process.env.FACE_POSTER_NO_FFMPEG === '1') return null;
  const list = process.platform === 'win32' ? [] : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  const found = list.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } });
  if (found) return found;
  try {
    const { execFileSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = String(execFileSync(cmd, ['ffmpeg'], { encoding: 'utf8', timeout: 2000, windowsHide: true })).split(/\r?\n/).find(Boolean);
    const bin = out && out.trim();
    if (bin && fs.existsSync(bin) && fs.statSync(bin).isFile()) return bin;
  } catch { /* 没有 PATH 里的 ffmpeg 时改用窗口解码 */ }
  return null;
}

function statVideo(input) {
  const requested = path.resolve(String(input || ''));
  if (!EXT.has(path.extname(requested).toLowerCase())) return null;
  let file;
  try { file = fs.realpathSync(requested); } catch { return null; }
  if (!EXT.has(path.extname(file).toLowerCase())) return null;
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile() || st.size < 32) return null;
  return { file, mtimeMs: st.mtimeMs, size: st.size };
}

function cacheFile(dir, video) {
  const key = crypto.createHash('sha256').update([video.file, video.mtimeMs, video.size].join('\0')).digest('hex');
  return path.join(dir, key + '.jpg');
}

function ffmpegFrame(bin, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [
      '-hide_banner', '-loglevel', 'error', '-ss', '0', '-i', file,
      '-frames:v', '1', '-vf', "scale='min(960,iw)':-2", '-q:v', '3',
      '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 15000);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { err = (err + chunk.toString()).slice(-500); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8) resolve(buf);
      else reject(new Error(err || 'ffmpeg 未能取出首帧'));
    });
  });
}

function browserFrame(file) {
  const { BrowserWindow } = require('electron');
  const fileUrl = pathToFileURL(file).href;
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 960,
      height: 540,
      focusable: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });
    win.webContents.setBackgroundThrottling(false);
    let settled = false;
    const finish = (error, buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
      if (error) reject(error); else resolve(buf);
    };
    const timer = setTimeout(() => finish(new Error('首帧解码超时')), 12000);
    win.webContents.once('did-fail-load', (_e, _code, description) => finish(new Error(description || '页面加载失败')));
    win.webContents.once('did-finish-load', async () => {
      try {
        const dataUrl = await win.webContents.executeJavaScript(`(async () => {
          const v = document.getElementById('v');
          await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('decode timeout')), 8000);
            v.onerror = () => { clearTimeout(t); reject(new Error('decode')); };
            const present = () => {
              const done = () => { clearTimeout(t); v.pause(); resolve(); };
              if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(() => done());
              else done();
            };
            v.onloadeddata = () => {
              if (v.currentTime > 0) { v.onseeked = present; try { v.currentTime = 0; } catch (e) { present(); } }
              else present();
            };
            v.src = ${JSON.stringify(fileUrl)};
          });
          if (!v.videoWidth || !v.videoHeight) throw new Error('no frame');
          const scale = Math.min(1, 960 / v.videoWidth);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
          canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', 0.86);
        })()`, true);
        const match = String(dataUrl || '').match(/^data:image\/jpeg;base64,(.+)$/);
        if (!match) throw new Error('没有得到首帧');
        const buf = Buffer.from(match[1], 'base64');
        if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('首帧不是 JPEG');
        finish(null, buf);
      } catch (error) { finish(error); }
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><video id="v" muted playsinline preload="auto"></video>')).catch(error => finish(error));
  });
}

async function capture(file) {
  const bin = ffmpegBin();
  if (bin) {
    try { return await ffmpegFrame(bin, file); } catch (error) { console.error('ffmpeg poster failed:', error.message); }
  }
  return browserFrame(file);
}

async function videoPoster(input, cacheDir) {
  const video = statVideo(input);
  if (!video || !cacheDir) return '';
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(cacheDir, 0o700); } catch {}
  const dest = cacheFile(cacheDir, video);
  try {
    if (fs.statSync(dest).isFile() && fs.statSync(dest).size > 100) return pathToFileURL(dest).href;
  } catch {}
  if (inflight.has(dest)) return inflight.get(dest);
  const job = (async () => {
    const jpeg = await capture(video.file);
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, jpeg, { mode: 0o600 });
    fs.renameSync(tmp, dest);
    ensurePrivatePerms(dest);
    return pathToFileURL(dest).href;
  })().catch(error => {
    console.error('video poster failed:', error.message);
    return '';
  }).finally(() => inflight.delete(dest));
  inflight.set(dest, job);
  return job;
}

module.exports = { videoPoster, statVideo };
