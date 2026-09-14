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

  /* 官方内嵌播放器地址（合法合规，支持全屏） */
  embedUrl(v) {
    const page = v.page || 1;
    const params = `page=${page}&high_quality=1&danmaku=0&autoplay=0&enable_api=1&mute=0`;
    if (v.bvid) return `https://player.bilibili.com/player.html?bvid=${v.bvid}&${params}`;
    if (v.aid) return `https://player.bilibili.com/player.html?aid=${v.aid}&${params}`;
    return null;
  },

  /* 本地文件 → file:// 播放地址 */
  localUrl(path) {
    let p = String(path || '').replace(/\\/g, '/');
    if (!p.startsWith('file://')) p = 'file:///' + p.replace(/^\/+/, '');
    return p;
  },

  /* 生成播放节点（iframe 或 video） */
  playerNode(video) {
    if (!video) return null;
    if (video.source === 'local') {
      const vd = document.createElement('video');
      vd.src = this.localUrl(video.localPath);
      vd.controls = true;
      vd.autoplay = false;
      return vd;
    }
    const url = this.embedUrl(video);
    if (!url) return null;
    const fr = document.createElement('iframe');
    fr.src = url;
    fr.setAttribute('allowfullscreen', 'true');
    fr.setAttribute('scrolling', 'no');
    fr.setAttribute('frameborder', '0');
    return fr;
  }
};
