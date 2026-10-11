/* 用户媒体：日常放在工程子文件夹，JSON 只记文件名或复制后的视频路径。
   皮肤照片 / 健身照片 / 跟练视频。测试隔离资料写 userData 下对应英文目录。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const KINDS = {
  skin: { project: '皮肤照片', isolated: 'skin-photos', archive: 'skin-photos' },
  body: { project: '健身照片', isolated: 'body-photos', archive: 'body-photos' },
  meal: { project: '饮食照片', isolated: 'meal-photos', archive: 'meal-photos' },
  video: { project: '跟练视频', isolated: 'imported-videos', archive: 'imported-videos' }
};
const PHOTO_SUBFOLDER = KINDS.skin.project;
const ANGLE = { front: '正面', left: '左侧', right: '右侧' };
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const VIDEO_COPY_LIMIT = 2 * 1024 * 1024 * 1024;

function mediaKind(kind) {
  if (kind === 'body' || kind === 'video' || kind === 'meal') return kind;
  return 'skin';
}

function spec(kind) {
  return KINDS[mediaKind(kind)];
}

function safeBase(name, exts) {
  const base = String(name || '').split(/[/\\]/).pop() || '';
  const n = base.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, 80);
  if (!n || n === '.' || n === '..' || n.startsWith('.')) return null;
  if (!exts.has(path.extname(n).toLowerCase())) return null;
  return n;
}

function safePhotoName(name) {
  return safeBase(name, IMAGE_EXTS);
}

function safeVideoName(name) {
  return safeBase(name, VIDEO_EXTS);
}

function isBundleRelPath(p) {
  const parts = String(p || '').split('/');
  if (parts.length !== 2) return false;
  if (['skin-photos','body-photos','meal-photos'].includes(parts[0])) return !!safePhotoName(parts[1]);
  return parts[0] === 'imported-videos' && !!safeVideoName(parts[1]);
}

function suggestedName({ date, kind, angle, ext, used } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : 'photo';
  const k = kind === 'body' ? '健身' : '皮肤';
  const a = ANGLE[angle] ? '-' + ANGLE[angle] : '';
  const e = ext === 'png' ? 'png' : 'jpg';
  const taken = used instanceof Set ? used : new Set(used || []);
  const stem = `${day}-${k}${a}`;
  const first = `${stem}.${e}`;
  if (!taken.has(first)) return first;
  for (let i = 2; i < 1000; i++) {
    const n = `${stem}-${i}.${e}`;
    if (!taken.has(n)) return n;
  }
  return `${stem}-${Date.now()}.${e}`;
}

function guessDate(name, fallback = null) {
  const m = String(name || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : fallback;
}

function guessKind(name, fallback = 'skin') {
  if (/健身|体型|-body/i.test(name || '')) return 'body';
  if (/皮肤|-skin/i.test(name || '')) return 'skin';
  return fallback;
}

function looksLikeProject(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg.name === 'face-reshape-plan' || pkg.productName === '面部重塑计划';
  } catch { return false; }
}

function resolveProjectRoot({ packaged, unpackagedRoot, downloadsPath, homePath } = {}) {
  if (!packaged && unpackagedRoot) return unpackagedRoot;
  const named = (parent) => parent ? path.join(parent, '面部重塑计划') : null;
  const candidates = [named(downloadsPath), named(homePath && path.join(homePath, 'Downloads')), unpackagedRoot].filter(Boolean);
  for (const c of candidates) {
    if (looksLikeProject(c)) return c;
  }
  return named(downloadsPath) || unpackagedRoot || null;
}

function resolveMediaDir({ isolated, dataDir, projectRoot, kind } = {}) {
  const s = spec(kind);
  if (isolated) return path.join(dataDir, s.isolated);
  if (!projectRoot) throw new Error('缺少工程目录，无法保存文件');
  return path.join(projectRoot, s.project);
}

function resolvePhotoDir(opts = {}) {
  return resolveMediaDir({ ...opts, kind: opts.kind === 'body' ? 'body' : 'skin' });
}

function assertMediaDest(dir, dest, kind) {
  const resolved = path.resolve(dest);
  const s = spec(kind);
  if (resolved === path.resolve(path.join(dir, s.isolated))) return resolved;
  if (path.basename(resolved) === s.project) return resolved;
  throw new Error('恢复媒体目录无效');
}

function assertPhotoDest(dir, photoDest) {
  return assertMediaDest(dir, photoDest, 'skin');
}

function adoptLooseFiles(dir, exts) {
  if (!dir || !fs.existsSync(dir)) return [];
  const names = [];
  for (const name of fs.readdirSync(dir)) {
    const src = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(src); } catch { continue; }
    if (!st.isFile() || st.isSymbolicLink()) continue;
    /* 目录里已有的普通媒体保持原名。安全改名只用于从外部复制进来。 */
    if (!name || name.startsWith('.') || /[/\\]/.test(name)) continue;
    if (!exts.has(path.extname(name).toLowerCase())) continue;
    names.push(name);
  }
  return names;
}

function listImageFiles(dir) {
  return adoptLooseFiles(dir, IMAGE_EXTS);
}

function listVideoFiles(dir) {
  return adoptLooseFiles(dir, VIDEO_EXTS);
}

function uniqueName(dir, name, listed) {
  const used = new Set(listed || []);
  if (!used.has(name)) return name;
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 2; i < 1000; i++) {
    const n = `${stem}-${i}${ext}`;
    if (!used.has(n)) return n;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function newFiles(dir, known, fallbackKind = 'skin', fallbackDate = null, opts = {}) {
  const have = new Set(known || []);
  const forced = opts.forceKind ? fallbackKind : null;
  return listImageFiles(dir).filter((n) => !have.has(n)).map((name) => ({
    name,
    date: guessDate(name, fallbackDate),
    kind: forced || guessKind(name, fallbackKind)
  }));
}

function newVideoFiles(dir, knownPaths) {
  const have = new Set((knownPaths || []).map((p) => path.basename(String(p || ''))));
  const root = path.resolve(dir);
  return listVideoFiles(dir).filter((n) => !have.has(n)).map((name) => ({
    name,
    path: path.join(root, name)
  }));
}

function copyLegacyPhotos(oldDir, newDir) {
  if (!oldDir || !newDir || path.resolve(oldDir) === path.resolve(newDir)) return { copied: 0 };
  if (!fs.existsSync(oldDir)) return { copied: 0 };
  fs.mkdirSync(newDir, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(oldDir)) {
    const safe = safePhotoName(name);
    if (!safe) continue;
    const src = path.join(oldDir, name);
    const dst = path.join(newDir, safe);
    try {
      if (!fs.statSync(src).isFile() || fs.existsSync(dst)) continue;
      fs.copyFileSync(src, dst);
      copied++;
    } catch { /* 单张失败不阻断其余 */ }
  }
  return { copied };
}

function splitBodyPhotos(photos, skinDir, bodyDir) {
  let moved = 0;
  fs.mkdirSync(bodyDir, { recursive: true });
  for (const p of photos || []) {
    if (p.kind !== 'body' || !safePhotoName(p.file)) continue;
    const src = path.join(skinDir, p.file);
    const dst = path.join(bodyDir, p.file);
    try {
      if (!fs.existsSync(src) || fs.existsSync(dst) || !fs.statSync(src).isFile()) continue;
      fs.copyFileSync(src, dst);
      moved++;
    } catch { /* 单张失败不阻断 */ }
  }
  return { moved };
}

function importVideoFile(src, destDir) {
  if (!src || !destDir) return { error: '缺少视频路径' };
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return { error: '找不到视频文件' };
  fs.mkdirSync(destDir, { recursive: true });
  const base = safeVideoName(path.basename(src));
  if (!base) return { error: '不是支持的视频格式' };
  const resolvedSrc = path.resolve(src);
  const destRoot = path.resolve(destDir);
  if (path.dirname(resolvedSrc) === destRoot) {
    return { path: resolvedSrc, name: path.basename(resolvedSrc), copied: false };
  }
  const name = uniqueName(destDir, base, listVideoFiles(destDir));
  const dest = path.join(destDir, name);
  const size = fs.statSync(src).size;
  if (size > VIDEO_COPY_LIMIT) {
    return { path: resolvedSrc, name: path.basename(resolvedSrc), copied: false, skippedCopy: true };
  }
  fs.copyFileSync(src, dest);
  return { path: dest, name, copied: true };
}

function importExistingVideos(videos, destDir) {
  const changed = [];
  for (const v of videos || []) {
    if (v.source !== 'local' || !v.localPath) continue;
    const r = importVideoFile(v.localPath, destDir);
    if (r.path && r.path !== v.localPath) {
      v.localPath = r.path;
      changed.push(v.id);
    }
  }
  return changed;
}

function archiveForPhoto(kind) {
  return spec(['body','meal'].includes(kind) ? kind : 'skin').archive;
}

function locatePhotoFile(file, kind, skinDir, bodyDir,mealDir) {
  const safe = safePhotoName(file);
  if (!safe) return null;
  const primary = kind==='meal' ? mealDir : kind === 'body' ? bodyDir : skinDir;
  if(kind==='meal')return primary ? path.join(primary,safe) : null;
  const secondary = kind === 'body' ? skinDir : bodyDir;
  for (const dir of [primary, secondary]) {
    if (!dir) continue;
    const p = path.join(dir, safe);
    if (fs.existsSync(p)) return p;
  }
  return path.join(primary || skinDir, safe);
}

module.exports = {
  KINDS, PHOTO_SUBFOLDER, VIDEO_COPY_LIMIT,
  mediaKind, spec, safePhotoName, safeVideoName, isBundleRelPath, suggestedName,
  guessDate, guessKind, looksLikeProject, resolveProjectRoot, resolveMediaDir,
  resolvePhotoDir, assertMediaDest, assertPhotoDest, listImageFiles, listVideoFiles,
  uniqueName, newFiles, newVideoFiles, copyLegacyPhotos, splitBodyPhotos,
  importVideoFile, importExistingVideos, archiveForPhoto, locatePhotoFile
};
