'use strict';

// Main-process adapter for the user's existing, offline Shengji Paraformer worker.
// It reads local models, never starts another application or imports into its library.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ENGINE = 'funasr-paraformer-zh';
const MODEL_NAMES = [
  'iic--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
  'iic--speech_fsmn_vad_zh-cn-16k-common-pytorch',
  'iic--punc_ct-transformer_cn-en-common-vocab471067-large',
];
const MAX_DURATION = 7200;
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set(['.webm', '.mp4', '.mov', '.m4v', '.mkv', '.avi']);

class LocalTranscriptionError extends Error {
  constructor(code, message, stage) {
    super(message);
    this.name = 'LocalTranscriptionError';
    this.code = code;
    if (stage) this.stage = stage;
  }
}

function failure(code, message, stage) { return new LocalTranscriptionError(code, message, stage); }
function aborted(signal) {
  if (signal?.aborted) throw failure('CANCELLED', '本地视频转写已取消');
}

function offlineEnvironment(home, temp, supplied = {}) {
  // Deliberately exclude inherited API keys, service tokens and proxy settings.
  const environment = {
    PATH: process.env.PATH || (process.platform === 'win32' ? '' : '/opt/homebrew/bin:/usr/bin:/bin'),
    HOME: home, USERPROFILE: home, LANG: 'en_US.UTF-8',
    PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1',
    HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1',
    MODELSCOPE_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false',
    OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4', OMP_WAIT_POLICY: 'PASSIVE',
    ...supplied,
  };
  for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key]) environment[key] = process.env[key];
  if (temp) Object.assign(environment, { TMPDIR: temp, TMP: temp, TEMP: temp });
  // These cannot be disabled by a caller's environment override.
  Object.assign(environment, {
    HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', MODELSCOPE_OFFLINE: '1',
  });
  return environment;
}

function runLocalCommand(executable, args, { signal, timeout = 60000, env, stage = 'transcribing' } = {}) {
  return new Promise((resolve, reject) => {
    try { aborted(signal); } catch (error) { reject(error); return; }
    const child = spawn(executable, args, { shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', settled = false, stopError, forceTimer, finishTimer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(finishTimer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(value);
    };
    const stop = error => {
      stopError ||= error;
      child.kill('SIGTERM');
      forceTimer ||= setTimeout(() => {
        child.kill('SIGKILL');
        finishTimer ||= setTimeout(() => finish(stopError), 3000);
      }, 2000);
    };
    const onAbort = () => stop(failure('CANCELLED', '本地视频转写已取消', stage));
    const timer = setTimeout(() => stop(failure('TIMEOUT', '本地视频转写超时，原录像仍保留，可以重试', stage)), timeout);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output, 'utf8') > 262144) stop(failure('PROCESS_OUTPUT_LIMIT', '本地转写进程返回了异常数据', stage));
    });
    // The worker can emit recognised speech in diagnostics; consume without logging it.
    child.stderr.on('data', () => {});
    child.on('error', error => finish(failure(
      error.code === 'ENOENT' ? 'DEPENDENCY_MISSING' : 'PROCESS_START_FAILED',
      error.code === 'ENOENT' ? '缺少本机离线转写工具，请检查转写环境设置' : '无法启动本地视频转写进程', stage,
    )));
    child.on('close', code => {
      if (stopError) return finish(stopError);
      if (code !== 0) return finish(failure('PROCESS_FAILED',
        stage === 'extracting' ? '这段录像的声音无法解码，请检查录像是否完整' : '本地语音识别失败，请检查已安装的模型与 Python 环境', stage));
      finish(null, output);
    });
  });
}

async function regularFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) return false;
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}

async function firstFile(candidates) {
  for (const candidate of candidates.filter(Boolean)) if (await regularFile(candidate)) return candidate;
  return '';
}

async function resolveExecutable(explicit, candidates, name) {
  if (explicit) return await regularFile(explicit) ? explicit : '';
  const found = await firstFile(candidates);
  if (found) return found;
  const executableNames = process.platform === 'win32' ? [`${name}.exe`, name] : [name];
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = await firstFile(executableNames.map(executable => path.join(directory, executable)));
    if (candidate) return candidate;
  }
  return '';
}

function defaultLocations(options) {
  const home = options.home || os.homedir();
  const engineHome = options.engineHome || path.join(home, 'phone-asr-selfhosted');
  const helperCandidates = options.helper ? [options.helper] : [
    options.shengjiHome && path.join(options.shengjiHome, 'native', 'transcribe_audio.py'),
    path.join(home, '录音整理', 'native', 'transcribe_audio.py'),
    process.platform === 'darwin' && '/Applications/声迹.app/Contents/Resources/app/native/transcribe_audio.py',
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Shengji', 'resources', 'app', 'native', 'transcribe_audio.py'),
  ];
  return { home, engineHome, helperCandidates, models: options.models || path.join(engineHome, 'local', 'models') };
}

function normalizeResult(result, expectedDuration) {
  if (!result || typeof result !== 'object' || result.engine !== ENGINE ||
      typeof result.text !== 'string' || !result.text.trim() ||
      !Number.isFinite(result.duration) || result.duration <= 0 || result.duration > MAX_DURATION) {
    throw failure('INVALID_RESULT', '本地转写没有返回完整文字稿，原录像仍保留');
  }
  if (Number.isFinite(expectedDuration) && result.duration + Math.max(1, expectedDuration * 0.01) < expectedDuration) {
    throw failure('INCOMPLETE_RESULT', '本地转写未覆盖整段录像，请检查录像是否完整后重试');
  }
  // An absent/bad timestamp must not discard otherwise complete recognised text.
  const segments = Array.isArray(result.segments) ? result.segments.filter(segment =>
    segment && Number.isFinite(segment.start) && Number.isFinite(segment.end) &&
    segment.start >= 0 && segment.end >= segment.start && segment.end <= result.duration + 1 &&
    typeof segment.text === 'string' && segment.text.trim(),
  ).map(segment => ({ start: segment.start, end: Math.min(segment.end, result.duration), text: segment.text.trim() })) : [];
  return { text: result.text.trim(), segments, engine: ENGINE, duration: result.duration, language: 'zh' };
}

function createLocalVideoTranscriber(options = {}) {
  const locations = defaultLocations(options);
  const command = options.adapters?.command || runLocalCommand;
  const tempRoot = options.tempRoot || os.tmpdir();
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? Math.min(MAX_BYTES, options.maxBytes) : MAX_BYTES;
  let cachedStatus;

  async function dependencies() {
    const [python, helper, ffmpeg, ffprobe] = await Promise.all([
      resolveExecutable(options.python, [path.join(locations.engineHome, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')], 'python3'),
      firstFile(locations.helperCandidates),
      resolveExecutable(options.ffmpeg, ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'], 'ffmpeg'),
      resolveExecutable(options.ffprobe, ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe'], 'ffprobe'),
    ]);
    if (!python || !helper || !ffmpeg || !ffprobe) throw failure('DEPENDENCY_MISSING',
      '未找到本机离线转写环境，需要本地 FFmpeg、FunASR Python 和声迹转写工具；不会自动下载或使用云端识别');
    if (typeof locations.models !== 'string' || !path.isAbsolute(locations.models)) throw failure('MODEL_MISSING', '本机语音模型目录必须是本地绝对路径');
    for (const model of MODEL_NAMES) {
      for (const basename of ['config.yaml', 'model.pt']) {
        if (!await regularFile(path.join(locations.models, 'modelscope', 'models', model, 'snapshots', 'master', basename))) {
          throw failure('MODEL_MISSING', '本机 Paraformer、VAD 或标点模型不完整，请检查已有离线模型；不会自动下载');
        }
      }
    }
    return { python, helper, ffmpeg, ffprobe, models: locations.models };
  }

  async function getStatus({ force = false, signal } = {}) {
    aborted(signal);
    if (!force && cachedStatus && Date.now() - cachedStatus.time < 30000) return { ...cachedStatus.value };
    let value;
    try {
      const environment = await dependencies();
      const raw = await command(environment.python, [environment.helper, '--models', environment.models, '--check'],
        { signal, timeout: options.statusTimeout || 60000, env: offlineEnvironment(locations.home, null, options.environment), stage: 'checking' });
      let result;
      try { result = JSON.parse(raw.trim()); } catch { throw failure('INVALID_STATUS', '本机语音识别环境检查返回异常数据'); }
      if (result.available !== true || result.engine !== ENGINE) throw failure('INVALID_STATUS', '本机语音识别环境尚不可用');
      value = { available: true, engine: ENGINE, offline: true, error: '', code: '' };
    } catch (error) {
      if (error.code === 'CANCELLED') throw error;
      value = { available: false, engine: ENGINE, offline: true,
        error: error instanceof LocalTranscriptionError ? error.message : '本机离线语音识别环境尚不可用，请检查设置',
        code: error instanceof LocalTranscriptionError ? error.code : 'DEPENDENCY_UNAVAILABLE' };
    }
    cachedStatus = { time: Date.now(), value };
    return { ...value };
  }

  async function transcribeVideo(file, { signal, onProgress } = {}) {
    aborted(signal);
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0') || !VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      throw failure('INVALID_PATH', '请选择本机保存的护肤录像文件');
    }
    let stat, canonical;
    try { [stat, canonical] = await Promise.all([fs.stat(file), fs.realpath(file)]); }
    catch { throw failure('FILE_MISSING', '这段护肤录像不存在或无法读取'); }
    if (!stat.isFile() || stat.size === 0) throw failure('INVALID_FILE', '这段护肤录像为空或不是普通文件');
    if (stat.size > maxBytes) throw failure('FILE_TOO_LARGE', '这段护肤录像超过本地转写的 4 GB 上限，请分段后重试');
    if (Array.isArray(options.allowedRoots)) {
      const roots = await Promise.all(options.allowedRoots.map(async root => {
        if (typeof root !== 'string' || !path.isAbsolute(root)) return '';
        try { return await fs.realpath(root); } catch { return ''; }
      }));
      if (!roots.some(root => root && (canonical === root || (!path.relative(root, canonical).startsWith(`..${path.sep}`) &&
          path.relative(root, canonical) !== '..' && !path.isAbsolute(path.relative(root, canonical)))))) {
        throw failure('PATH_OUTSIDE_LIBRARY', '这段录像不在本应用保存录像的目录中');
      }
    }
    const progress = stage => { try { onProgress?.({ stage, engine: ENGINE }); } catch {} };
    progress('checking');
    const environment = await dependencies();
    aborted(signal);
    let probe;
    try {
      const raw = await command(environment.ffprobe, [
        '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', canonical,
      ], { signal, timeout: options.probeTimeout || 30000, env: offlineEnvironment(locations.home, null, options.environment), stage: 'checking' });
      probe = JSON.parse(raw);
    } catch (error) {
      if (error.code === 'CANCELLED' || error.code === 'TIMEOUT' || error.code === 'DEPENDENCY_MISSING') throw error;
      throw failure('INVALID_MEDIA', '这段护肤录像无法读取，请检查文件是否完整');
    }
    if (!Array.isArray(probe.streams) || !probe.streams.some(stream => stream.codec_type === 'video')) {
      throw failure('NO_VIDEO', '这不是可读取的护肤录像文件');
    }
    if (!probe.streams.some(stream => stream.codec_type === 'audio')) {
      throw failure('NO_AUDIO', '这段旧录像没有声音，无法转写；请重新录制晚间护肤');
    }
    const audio = probe.streams.find(stream => stream.codec_type === 'audio');
    const duration = Number(audio.duration || probe.format?.duration);
    if (Number.isFinite(duration) && duration > MAX_DURATION) throw failure('TOO_LONG', '录像的声音超过两小时，请分段后转写');
    aborted(signal);
    const temp = await fs.mkdtemp(path.join(tempRoot, 'life-reshape-video-asr-'));
    try {
      const wav = path.join(temp, 'audio.wav'), output = path.join(temp, 'result.json');
      const env = offlineEnvironment(locations.home, temp, options.environment);
      progress('extracting');
      await command(environment.ffmpeg, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
        '-i', canonical, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-t', String(MAX_DURATION + 1), '-c:a', 'pcm_s16le', '-y', wav,
      ], { signal, timeout: options.extractTimeout || 180000, env, stage: 'extracting' });
      aborted(signal);
      progress('transcribing');
      await command(environment.python, [environment.helper, '--models', environment.models, '--audio', wav, '--output', output], {
        signal, timeout: options.transcribeTimeout || Math.max(180000, Math.min(2700000, (Number.isFinite(duration) && duration > 0 ? duration : MAX_DURATION) * 1000 + 120000)),
        env, stage: 'transcribing',
      });
      aborted(signal);
      const outputStat = await fs.stat(output).catch(() => null);
      if (!outputStat?.isFile() || outputStat.size === 0 || outputStat.size > 8 * 1024 * 1024) {
        throw failure('INVALID_RESULT', '本地转写没有返回可读取的完整文字稿，原录像仍保留');
      }
      let result;
      try { result = normalizeResult(JSON.parse(await fs.readFile(output, 'utf8')), duration); }
      catch (error) {
        if (error instanceof LocalTranscriptionError) throw error;
        throw failure('INVALID_RESULT', '本地转写文字稿格式异常，原录像仍保留');
      }
      progress('complete');
      return result;
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }

  return { getStatus, transcribeVideo };
}

module.exports = { createLocalVideoTranscriber, LocalTranscriptionError, ENGINE, MODEL_NAMES, runLocalCommand };
