# 播放器与计时同步修复（2026-09-17）

进入跟练先载入暂停的视频和等待中的计时器；播放按钮仅请求视频播放，只有实际播放状态成立才开始计时。视频暂停、结束、缓冲、跳转或状态不可读取时不累计；点击下方按钮同样控制播放器。离开跟练页停止累计，重新进入保持暂停。

根因：旧实现将跨域 iframe 当作独立 WebContents 枚举，未找到播放器；进入会话又先于播放启动计时。

实现：使用主窗口 `mainFrame.framesInSubtree` 查找 HTTPS `player.bilibili.com` 子框架，借助 `WebFrameMain.executeJavaScript` 读取媒体状态。IPC 仅允许应用主框架调用。约每 250ms 同步，异步结果必须匹配当前会话、节点和控制代次。保留跨域隔离，不开放第三方页面 Node 权限。本地视频额外使用媒体事件。

依据：[Electron WebFrameMain API](https://www.electronjs.org/docs/latest/api/web-frame-main)。

验证：
- `node --test tests/test-bilibili-embed.js`（7 项）。
- `npm run test:unit`（153 项）。
- `electron tests/test-media-sync-ui.js`：真实跨域框架与真实 HTML 视频，独立临时数据目录。
- `electron tests/test-media-sync-ui.js --live`：实际 B 站在线播放器通过相同的暂停载入、双向播放/暂停与断开后停表检查。

同步存在约一个采样周期的延迟；B站网络不可用时不虚计时。测试使用临时资料，不写入用户训练记录。
