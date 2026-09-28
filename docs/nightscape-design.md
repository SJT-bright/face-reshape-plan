# 月光夜间界面

2026-09-16。对应原有日间光学雕塑背景的夜间版本。

- 原图：`src/assets/img/optical-sculpture-bg.png`
- 夜图：`src/assets/img/optical-sculpture-night.png`
- 生成方式：内置 imagegen，以原图为参考进行编辑。
- 设计：灰银月光、低饱和薰衣草反光、半透明深灰卡片；保持原雕塑和器物构图。
- 入口：训练计划 → 提醒中枢 → 夜间模式（沿用原有设置与持久化）。
- 播放器外围：54 个低亮度星点，12–28 秒缓动。星点在视频下层且不接收点击；减少动态效果时静止，应用隐藏时暂停，离开跟练页时自动清理监听器。未增加网络请求。

## Imagegen prompt

Create a NIGHT VERSION of this exact background for a calming desktop wellness app. Preserve the same landscape composition, right-side translucent sculpted face profile, glass frame, jade gua sha, pearl and metal ornaments, orchids, round stone base, distant water and mountains, and spacious empty left side. Re-light the entire scene as true nighttime: predominantly neutral charcoal GREY, soft silver moonlight, smoky glass, muted slate, very subtle desaturated lavender reflections. Low luminance and gentle highlight rolloff, readable sculptural contours, no bright white surfaces, no saturated blue or neon. Left 60 percent remains quiet dark grey negative space for light UI typography. Elegant photorealistic 3D still life, serene and comfortable for evening use. A few extremely subtle distant stars above the horizon only; no galaxies, no fantasy swirls. No text, no UI, no logos. Keep the original composition and objects; change lighting and palette to a beautiful nighttime counterpart.

## 验证

`./node_modules/.bin/electron tests/test-night-ui.js`

测试使用空白临时数据目录，不读取个人健康记录。检查六栏目渲染、日夜切换、视频点击命中、全屏、减少动态效果、980px 窗口与视图清理。截图在 `.impeccable/review/night-*.png`（不提交个人界面）。
