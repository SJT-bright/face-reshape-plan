'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const NAME_RE = /^护肤-\d{8}-\d{6}(?:-\d{1,2})?\.webm$/;

function asDate(startedAt) {
  if (startedAt instanceof Date) {
    return Number.isNaN(startedAt.getTime()) ? new Date() : new Date(startedAt.getTime());
  }
  if (typeof startedAt === 'number' && Number.isFinite(startedAt)) {
    const date = new Date(startedAt);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof startedAt === 'string') {
    const date = new Date(startedAt);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

// 上海无夏令时；Intl 不可用或零件异常时回退到固定东八区。
function shanghaiStamp(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const pick = (type) => {
      const part = parts.find((item) => item.type === type);
      return part ? part.value : '';
    };
    let hour = pick('hour');
    if (hour === '24') hour = '00';
    const stamp = `${pick('year')}${pick('month')}${pick('day')}-${hour}${pick('minute')}${pick('second')}`;
    if (/^\d{8}-\d{6}$/.test(stamp)) return stamp;
  } catch { /* 使用下面的固定偏移 */ }
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}-${pad(shifted.getUTCHours())}${pad(shifted.getUTCMinutes())}${pad(shifted.getUTCSeconds())}`;
}

function nameTaken(usedNames, name) {
  if (usedNames == null) return false;
  if (Array.isArray(usedNames)) return usedNames.includes(name);
  if (typeof usedNames.has === 'function') return usedNames.has(name) === true;
  return false;
}

function videoFileName(startedAt, usedNames) {
  const stamp = shanghaiStamp(asDate(startedAt));
  const base = `护肤-${stamp}.webm`;
  if (!nameTaken(usedNames, base)) return base;
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const name = `护肤-${stamp}-${suffix}.webm`;
    if (!nameTaken(usedNames, name)) return name;
  }
  return null;
}

function isExactVideoName(file) {
  if (typeof file !== 'string') return false;
  const matched = NAME_RE.exec(file);
  return !!matched && matched[0] === file;
}

function resolveVideo(dir, file) {
  if (typeof dir !== 'string' || !isExactVideoName(file)) return null;
  const root = path.resolve(dir);
  const target = path.resolve(root, file);
  const rel = path.relative(root, target);
  if (rel !== file || path.isAbsolute(rel) || rel.split(path.sep).includes('..')) return null;
  return target;
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (!bytes || typeof bytes !== 'object' || !(bytes instanceof Uint8Array)) return null;
  try {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch {
    return Buffer.from(bytes);
  }
}

function openRegular(target, flags) {
  const listed = fs.lstatSync(target);
  if (!listed.isFile() || listed.isSymbolicLink()) return null;
  const fd = fs.openSync(target, flags);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== listed.dev || opened.ino !== listed.ino) {
      fs.closeSync(fd);
      return null;
    }
    return { fd, size: opened.size };
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* 保留原始错误 */ }
    throw error;
  }
}

function createFile(dir, startedAt) {
  try {
    if (typeof dir !== 'string' || dir.length === 0) return null;
    fs.mkdirSync(dir, { recursive: true });
    const used = new Set(fs.readdirSync(dir));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const file = videoFileName(startedAt, used);
      if (!file || resolveVideo(dir, file) === null) return null;
      const target = path.resolve(dir, file);
      try {
        const fd = fs.openSync(target, 'wx', 0o600);
        try {
          try { fs.fchmodSync(fd, 0o600); } catch { /* Windows 使用用户目录 ACL */ }
        } finally {
          fs.closeSync(fd);
        }
        return { file };
      } catch (error) {
        if (error && error.code === 'EEXIST') {
          used.add(file);
          continue;
        }
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function appendChunk(dir, file, bytes) {
  let fd;
  try {
    const target = resolveVideo(dir, file);
    if (!target) return null;
    const buf = toBuffer(bytes);
    if (!buf) return null;
    if (buf.length === 0) {
      const listed = fs.lstatSync(target);
      if (!listed.isFile() || listed.isSymbolicLink()) return null;
      return { file, bytes: listed.size };
    }
    const opened = openRegular(target, 'a');
    if (!opened) return null;
    fd = opened.fd;
    if (opened.size > MAX_BYTES || buf.length > MAX_BYTES - opened.size) return null;
    let offset = 0;
    while (offset < buf.length) {
      const wrote = fs.writeSync(fd, buf, offset, buf.length - offset);
      if (wrote <= 0) return null;
      offset += wrote;
    }
    try { fs.fchmodSync(fd, 0o600); } catch { /* Windows 使用用户目录 ACL */ }
    const size = fs.fstatSync(fd).size;
    fs.closeSync(fd);
    fd = undefined;
    try { fs.chmodSync(target, 0o600); } catch { /* Windows 使用用户目录 ACL */ }
    return { file, bytes: size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function finishFile(dir, file) {
  let fd;
  try {
    const target = resolveVideo(dir, file);
    if (!target) return null;
    const opened = openRegular(target, 'r');
    if (!opened) return null;
    fd = opened.fd;
    try { fs.fsyncSync(fd); } catch { /* 失败可忽略 */ }
    const size = fs.fstatSync(fd).size;
    fs.closeSync(fd);
    fd = undefined;
    try { fs.chmodSync(target, 0o600); } catch { /* Windows 使用用户目录 ACL */ }
    return { file, bytes: size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function listFiles(dir) {
  try {
    if (typeof dir !== 'string' || !fs.existsSync(dir)) return [];
    const items = [];
    for (const name of fs.readdirSync(dir)) {
      if (!isExactVideoName(name)) continue;
      let listed;
      try {
        listed = fs.lstatSync(path.join(dir, name));
      } catch {
        continue;
      }
      if (!listed.isFile() || listed.isSymbolicLink()) continue;
      items.push({ file: name, bytes: listed.size, mtimeMs: listed.mtimeMs });
    }
    items.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    return items;
  } catch {
    return [];
  }
}

module.exports = { MAX_BYTES, videoFileName, createFile, appendChunk, finishFile, listFiles };
