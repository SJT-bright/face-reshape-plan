/* B 站视频：链接解析 / 官方内嵌播放器 */

const Bilibili = {
  /* 从任意文本中提取 BV 号 / av 号 / 分P */
  parse(text) {
    text = String(text || '').trim();
    const out = { bvid: null, aid: null, page: 1 };
    const bv = text.match(/BV[0-9A-Za-z]{10}/);
    if (bv) out.bvid = bv[0];
    const av = text.match(/av(\d{3,})/i);
    if (av) out.aid = av[1];
    const p = text.match(/[?&]p=(\d+)/);
    if (p) out.page = parseInt(p[1], 10);
    if (!out.bvid && !out.aid) return null;
    return out;
  },

  isBvid(s) { return /^BV[0-9A-Za-z]{10}$/.test(String(s || '').trim()); },

  /* 官方内嵌播放器地址（合法合规，支持全屏）。
     参数只用官方文档集合：bvid/aid、cid、autoplay、muted、t（秒）、p。
     startSec>0 只携带 t 恢复进度，不自动播放；autoplay=true 强制自动播放。
     cid 强烈建议携带（分P 定位依赖），无 cid 时尽力而为。
     （此前的 high_quality/enable_api/page 并非官方参数，已移除） */
  embedUrl(v, startSec, autoplay) {
    const resume = Number(startSec) > 0 ? `&t=${Math.floor(Number(startSec))}` : '';
    const ap = autoplay ? 1 : 0;
    let params = `autoplay=${ap}&mute=0&p=${Math.max(1,Number(v.page)||1)}`;
    if (v.cid) params += `&cid=${v.cid}`;
    params += resume;
    if (v.bvid) return `https://player.bilibili.com/player.html?bvid=${v.bvid}&${params}`;
    if (v.aid) return `https://player.bilibili.com/player.html?aid=${v.aid}&${params}`;
    return null;
  },

  /* 本地文件 → file:// 播放地址；路径逐段 URL 编码，文件名里的 # ? 空格不会截断地址 */
  localUrl(path) {
    let p = String(path || '').replace(/\\/g, '/');
    if (p.startsWith('file://')) return p;
    if (p.startsWith('//')) {
      const [host, ...parts] = p.slice(2).split('/');
      return 'file://' + host + '/' + parts.map(encodeURIComponent).join('/');
    }
    const drive = p.match(/^([a-zA-Z]:)\//);
    if (drive) return 'file:///' + drive[1] + '/' + p.slice(3).split('/').map(encodeURIComponent).join('/');
    return 'file:///' + p.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  },

  /* 生成播放节点（iframe 或 video）；startSec>0 恢复到该秒；autoplay=true 自动播放 */
  playerNode(video, startSec, autoplay) {
    if (!video) return null;
    if (video.source === 'douyin') return null; // 下载成功转为 local 后才能播放。
    if (video.source === 'local') {
      const vd = document.createElement('video');
      vd.src = this.localUrl(video.localPath);
      vd.controls = true;
      vd.autoplay = !!autoplay;
      if (Number(startSec) > 0) {
        const s = Math.floor(Number(startSec));
        vd.addEventListener('loadedmetadata', () => { try { vd.currentTime = s; } catch {} });
      }
      return vd;
    }
    const url = this.embedUrl(video, startSec, autoplay);
    if (!url) return null;
    const fr = document.createElement('iframe');
    fr.src = url;
    fr.setAttribute('allowfullscreen', 'true');
    if (autoplay) fr.setAttribute('allow', 'autoplay; fullscreen');
    fr.setAttribute('scrolling', 'no');
    fr.setAttribute('frameborder', '0');
    return fr;
  }
};

/* 媒体-计时同步桥：统一控制页面本地 <video> 与 B 站内嵌播放器（跨域部分经主进程 IPC）。
   所有 native 调用均为可选（node 测试环境 / preload 未就绪时不报错）。 */
const MediaSync = {
  /* 暂停页面所有本地视频 + B 站内嵌播放器 */
  pauseAll() {
    let n = 0;
    try {
      for (const v of document.querySelectorAll('video:not([data-camera-preview])')) {
        if (!v.paused && !v.ended) { try { v.pause(); n++; } catch (e) {} }
      }
    } catch (e) {}
    try { window.native && window.native.pauseEmbeddedMedia && window.native.pauseEmbeddedMedia().catch(() => {}); } catch (e) {}
    return n;
  },

  /* 恢复播放（readyState=0 的视频尚未加载，跳过避免 NotSupportedError） */
  playAll() {
    let n = 0;
    try {
      for (const v of document.querySelectorAll('video:not([data-camera-preview])')) {
        if (v.paused && !v.ended && v.readyState > 0) {
          try { const p = v.play(); if (p && p.catch) p.catch(() => {}); n++; } catch (e) {}
        }
      }
    } catch (e) {}
    try { window.native && window.native.resumeEmbeddedMedia && window.native.resumeEmbeddedMedia().catch(() => {}); } catch (e) {}
    return n;
  },

  /* 探测跟练舞台内的视频是否在播：true=在播 / false=已暂停 / null=不可知
     本地视频同源直接读；B 站 iframe 跨域，经主进程枚举 OOPIF webContents 读取。 */
  async probePlaying() {
    try {
      const stage = document.getElementById('stage');
      if (!stage || !stage.querySelector) return null;
      const local = stage.querySelector('video');
      if (local) {this.lastState={currentTime:local.currentTime,paused:local.paused,ended:local.ended,readyState:local.readyState,seeking:local.seeking}; return !local.paused && !local.ended && !local.seeking && local.readyState >= 3;}
      if (stage.querySelector('iframe')) {
        const native = (typeof window !== 'undefined') ? window.native : null;
        const st = native && native.embeddedMediaStatus ? await native.embeddedMediaStatus() : null;
        const src = stage.querySelector('iframe')?.src;
        const current = Array.isArray(st) ? st.filter(x => x && x.url === src) : [];
        this.lastState=current[0]||null;
        if (current.length) return current.some(x => !x.paused && !x.ended && !x.seeking && x.readyState >= 3);
        return null;
      }
      return null;
    } catch (e) { return null; }
  }
};

/* 挂到 Bilibili 上供 Views/App 使用；导出保持向后兼容 */
Bilibili.MediaSync = MediaSync;

if (typeof module !== 'undefined' && module.exports) module.exports = Bilibili;
