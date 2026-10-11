/* 视频链接统一解析入口：B 站优先（兼容存量行为），其次抖音分享口令。
   Bilibili / Douyin 由浏览器 script 标签提供；Node 测试里由测试文件挂 global。 */

const VideoLink = {
  parse(text) {
    const bi = (typeof Bilibili !== 'undefined') && Bilibili.parse ? Bilibili.parse(text) : null;
    if (bi) return { source: 'bilibili', bvid: bi.bvid, aid: bi.aid, page: bi.page };
    if (typeof Douyin !== 'undefined' && Douyin.parse) {
      const dy = Douyin.parse(text);
      if (dy) return dy;
    }
    return null;
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = VideoLink;
