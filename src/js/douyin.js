/* 抖音视频：分享口令解析 / 官方内嵌播放器（open.douyin.com 仅支持 vid_id） */

const Douyin = {
  /* 从任意文本（抖音 App 复制的分享口令，混有大量噪声）提取链接信息。
     命中任一 douyin / iesdouyin 域名链接，或整行 trim 后为 15~21 位纯数字（裸 vid）时返回
     { source:'douyin', vid, url, title, tags, author }，否则 null。
     纯短链（v.douyin.com/xxxx）解析不出 vid → null，由主进程重定向解析。 */
  parse(text) {
    text = String(text || '');
    if (!text.trim()) return null;

    /* 链接：无 scheme 补 https://；路径截到空白/中文标点/引号尖括号/汉字前（短链保留结尾 /） */
    const linkRe = /(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)*(?:douyin\.com|iesdouyin\.com)(?:\/[^\s，。！？、）】"'<>\u4e00-\u9fff]*)?/i;
    const link = text.match(linkRe);

    let vid = null;
    let url = null;
    let before = '';
    if (link) {
      url = link[0];
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      before = text.slice(0, link.index);
      for (const re of [/\/video\/(\d{15,21})/, /\/note\/(\d{15,21})/, /\/share\/video\/(\d{15,21})/, /modal_id=(\d{15,21})/]) {
        const m = url.match(re);
        if (m) { vid = m[1]; break; }
      }
    } else {
      const line = text.split(/\r?\n/).map(l => l.trim()).find(l => /^\d{15,21}$/.test(l));
      if (!line) return null;
      vid = line;
      url = 'https://www.douyin.com/video/' + vid;
    }
    return { source: 'douyin', vid, url, title: this.cleanTitle(before), tags: this.tags(text), author: this.author(text) };
  },

  _pending: new Map(),
  matches(video, parsed) {
    return !!video.douyinId && (parsed.vid ? video.douyinId === parsed.vid : video.douyinUrl === parsed.url);
  },
  async importLocal(parsed, mode, onProgress) {
    let video = Store.videosForMode(mode).find(v => this.matches(v, parsed));
    if (video) return this.ensureLocal(video, onProgress);
    const id = uid('vid');
    const result = await this.download(id, parsed.vid || parsed.url, onProgress);
    // 短链解析之后再查 ID，避免已下载视频重新导入。
    video = Store.videosForMode(mode).find(v => v.douyinId === result.vid);
    if (video) return this.ensureLocal(video, onProgress);
    video = Store.addVideo({
      id, source: 'local', localPath: result.path,
      douyinId: result.vid, douyinUrl: parsed.url,
      title: result.title || parsed.title || '抖音视频', pic: result.pic || '',
      durationSec: result.durationSec || null, author: result.author || '',
      addedAt: new Date().toISOString(), downloadState: 'ready'
    }, mode);
    Store.save(true);
    return video;
  },
  async download(id, input, onProgress) {
    let unsubscribe;
    try {
      unsubscribe = native.onDouyinDownloadProgress?.(data => { if (data.id === id) onProgress?.(data); });
      const result = await native.downloadDouyin(id, input);
      if (!result?.ok || !result.path) throw Error(result?.error || '下载失败，请重试');
      return result;
    } finally { if (typeof unsubscribe === 'function') unsubscribe(); }
  },
  async ensureLocal(video, onProgress) {
    if (video.source === 'local' && video.localPath && await native.videoExists(video.localPath)) return video;
    if (this._pending.has(video.id)) return this._pending.get(video.id);
    const task = (async () => {
      const result = await this.download(video.id, video.douyinId || video.douyinUrl, onProgress);
      const current = Store.videoById(video.id);
      if (!current) throw Error('视频已从库中删除');
      Object.assign(current, { source: 'local', localPath: result.path, douyinId: result.vid,
        downloadState: 'ready', downloadError: null });
      if (result.durationSec) current.durationSec = result.durationSec;
      if (!current.pic && result.pic) current.pic = result.pic;
      delete current.playUrl;
      Store.rememberVideoPath(current);
      Store.save(true);
      return current;
    })().catch(error => {
      const current = Store.videoById(video.id);
      if (current) { current.downloadState = 'error'; current.downloadError = error.message; Store.save(true); }
      throw error;
    }).finally(() => this._pending.delete(video.id));
    this._pending.set(video.id, task);
    return task;
  },
  async prepareLibrary() {
    // 旧在线引用后台补下载；保留原 ID、板块和观看记录。
    for (const video of [...Store.db.videos].filter(v => v.source === 'douyin')) {
      try { await this.ensureLocal(video); } catch { /* 点击视频可查看原因并重试 */ }
    }
  },

  /* 官方分享播放器地址（open.douyin.com）：仅支持 vid_id 播放，不支持进度 seek。
     video.douyinId 缺失返回 null。 */
  embedUrl(video, autoplay) {
    const id = video && video.douyinId ? String(video.douyinId) : '';
    if (!id) return null;
    return `https://open.douyin.com/player/video?vid_id=${encodeURIComponent(id)}&autoplay=${autoplay ? 1 : 0}&mute=0`;
  },

  isVid(s) { return /^\d{15,21}$/.test(String(s || '').trim()); },

  /* 标题清洗：取链接之前的文本（发布者常把文案写在链接前）。
     1) 按“复制此链接 / 复制打开抖音”引导语起截断；
     2) 去掉开头连续的分享噪声 token——纯数字/小数（4.84）、dd/dd 日期（09/10）、
        含 : / @ 的 ≤10 位 ASCII 混合 token（pQK:/ g@b.nQ :2pm）；
     3) 合并空白。结果为空返回 null。标签文本保留在标题里。 */
  cleanTitle(raw) {
    let t = String(raw || '');
    const gi = t.search(/复制此链接|复制打开抖音/);
    if (gi >= 0) t = t.slice(0, gi);
    const noise = token =>
      /^\d+(\.\d+)?$/.test(token) ||
      /^\d{1,2}\/\d{1,2}$/.test(token) ||
      (/^[\x21-\x7E]{1,10}$/.test(token) && /[:/@]/.test(token));
    const parts = t.trim().split(/\s+/).filter(Boolean);
    while (parts.length && noise(parts[0])) parts.shift();
    const out = parts.join(' ').trim();
    return out || null;
  },

  /* #标签 收集：兼容 “#标签” 与 “# 标签”，去尾随标点，最多 10 个 */
  tags(text) {
    const out = [];
    const re = /#\s*([^\s#，。！？、,.!?::：]+)/g;
    let m;
    while (out.length < 10 && (m = re.exec(String(text || ''))) !== null) {
      const tag = m[1].replace(/[~～!！?？;；:：,，.。、…—"'）)】》\]」』\s]+$/g, '');
      if (tag && !/^https?$/i.test(tag) && !out.includes(tag)) out.push(tag);
    }
    return out;
  },

  /* @名称（首个，≥2 字符，允许中文/字母/数字/._-）。
     @ 前须为行首/空白/标点，避免把 g@b.nQ 这类噪声 token 当成作者。尽力而为。 */
  author(text) {
    const m = String(text || '').match(/(?:^|[\s\u3000，。！？、；：）】》"'（【《])[@＠]\s*([\p{Script=Han}A-Za-z0-9._-]{2,30})/u);
    if (!m) return null;
    return m[1].replace(/[._-]+$/g, '') || null;
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = Douyin;
