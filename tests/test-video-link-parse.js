/* 抖音/视频链接解析契约：分享口令噪声清洗、vid/url/tags/author 提取、内嵌播放器地址与 B 站优先级。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

global.Bilibili = require('../src/js/bilibili');
global.Douyin = require('../src/js/douyin');
const VideoLink = require('../src/js/video-link');
const Douyin = require('../src/js/douyin');

const SHARE = '4.84 09/10 pQK:/ g@b.nQ :2pm 清醒雄竞的爽感>迷茫中娱乐 雄竞男必经四阶段 # 男性成长 # 男性力量 https://v.douyin.com/qGQhF_tho00/ 复制此链接，打开Dou音搜索，直接观看视频！';

test('真实分享口令：短链 url 保留结尾斜杠，标题保留文案，兼容 “# 标签” 写法', () => {
  const r = Douyin.parse(SHARE);
  assert.ok(r, '命中 douyin 短链');
  assert.equal(r.source, 'douyin');
  assert.equal(r.vid, null, '纯短链不出 vid，由主进程重定向解析');
  assert.equal(r.url, 'https://v.douyin.com/qGQhF_tho00/');
  assert.ok(r.title, '标题清洗后非空');
  assert.ok(r.title.includes('清醒雄竞的爽感'));
  assert.ok(r.title.includes('雄竞男必经四阶段'), '噪声 token 被剔除，文案保留');
  assert.ok(r.tags.includes('男性成长'));
  assert.ok(r.tags.includes('男性力量'), '# 与标签文字间的空格可兼容');
  assert.ok(r.author === null || typeof r.author === 'string', 'author 尽力而为，不抛错');
});

test('完整视频页链接：提取 vid 与含 query 的完整 url', () => {
  const r = Douyin.parse('https://www.douyin.com/video/7412345678901234567?previous_page=app');
  assert.equal(r.vid, '7412345678901234567');
  assert.equal(r.url, 'https://www.douyin.com/video/7412345678901234567?previous_page=app');
});

test('iesdouyin 分享页链接：提取 vid', () => {
  const r = Douyin.parse('https://www.iesdouyin.com/share/video/7412345678901234567/');
  assert.equal(r.vid, '7412345678901234567');
  assert.equal(r.url, 'https://www.iesdouyin.com/share/video/7412345678901234567/');
});

test('纯短链无文案口令：vid 为 null，url 正确，标题为空不报错', () => {
  const r = Douyin.parse('5.43 H@x.x :3 复制打开抖音，看看【xx的作品】标题 https://v.douyin.com/iRNBho6u/');
  assert.ok(r);
  assert.equal(r.source, 'douyin');
  assert.equal(r.vid, null);
  assert.equal(r.url, 'https://v.douyin.com/iRNBho6u/');
  assert.ok(r.title === null || r.title === '', '引导语前的噪声清洗后为空');
});

test('带正文标题与标签的口令：标题清洗后保留文案与标签文本', () => {
  const r = Douyin.parse('看看xx的作品 清晨面部唤醒操 # 瘦脸 # 面部锻炼 https://v.douyin.com/abc123_/ 复制此链接，打开Dou音搜索，直接观看视频！');
  assert.ok(r);
  assert.equal(r.url, 'https://v.douyin.com/abc123_/');
  assert.ok(r.title && r.title.includes('清晨面部唤醒操'));
  assert.ok(r.tags.includes('瘦脸'));
  assert.ok(r.tags.includes('面部锻炼'));
});

test('个人主页 modal_id 链接：提取 vid', () => {
  const r = Douyin.parse('https://www.douyin.com/user/MS4wLjABAAAA?modal_id=7412345678901234567');
  assert.equal(r.vid, '7412345678901234567');
});

test('裸数字行：视为 vid 并合成标准 url', () => {
  const r = Douyin.parse('7412345678901234567');
  assert.equal(r.vid, '7412345678901234567');
  assert.equal(r.url, 'https://www.douyin.com/video/7412345678901234567');
});

test('note 页链接与 isVid 判定', () => {
  const r = Douyin.parse('https://www.douyin.com/note/7412345678901234567');
  assert.equal(r.vid, '7412345678901234567');
  assert.equal(Douyin.isVid('7412345678901234567'), true);
  assert.equal(Douyin.isVid('12345'), false);
  assert.equal(Douyin.isVid('BV1xx411c7mD'), false);
});

test('VideoLink：B 站优先，返回 bilibili 形状', () => {
  const full = VideoLink.parse('https://www.bilibili.com/video/BV1xx411c7mD?p=3');
  assert.deepEqual(full, { source: 'bilibili', bvid: 'BV1xx411c7mD', aid: null, page: 3 });
  const bare = VideoLink.parse('BV1xx411c7mD');
  assert.equal(bare.source, 'bilibili');
  assert.equal(bare.bvid, 'BV1xx411c7mD');
  assert.equal(bare.page, 1);
});

test('未命中返回 null', () => {
  assert.equal(VideoLink.parse('完全无关文本'), null);
  assert.equal(Douyin.parse(''), null);
  assert.equal(Douyin.parse(null), null);
});

test('embedUrl：vid_id/autoplay 精确拼接，缺 douyinId 返回 null', () => {
  assert.equal(Douyin.embedUrl({ douyinId: '7412345678901234567' }, false),
    'https://open.douyin.com/player/video?vid_id=7412345678901234567&autoplay=0&mute=0');
  assert.equal(Douyin.embedUrl({ douyinId: '7412345678901234567' }, true),
    'https://open.douyin.com/player/video?vid_id=7412345678901234567&autoplay=1&mute=0');
  assert.equal(Douyin.embedUrl({}, true), null);
  assert.equal(Douyin.embedUrl(null, true), null);
});

test('url 截断：链接后紧跟中文逗号或引导语不吞后续文本', () => {
  const a = Douyin.parse('看看这个 https://v.douyin.com/abc123/，复制此链接，打开Dou音搜索，直接观看视频！');
  assert.equal(a.url, 'https://v.douyin.com/abc123/');
  const b = Douyin.parse('看看这个 https://v.douyin.com/abc123/复制此链接，打开Dou音搜索，直接观看视频！');
  assert.equal(b.url, 'https://v.douyin.com/abc123/');
});

test('@作者提取与标签上限 10 个', () => {
  const r = Douyin.parse('@晨练打卡 每天五分钟面部唤醒操 https://v.douyin.com/abc123/');
  assert.equal(r.author, '晨练打卡');
  const many = Douyin.parse('#t1 #t2 #t3 #t4 #t5 #t6 #t7 #t8 #t9 #t10 #t11 #t12 https://v.douyin.com/abc123/');
  assert.equal(many.tags.length, 10);
});
