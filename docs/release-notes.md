人生重塑计划 1.8.5 同步最新 macOS 功能，并提供 Windows x64 安装包和免安装完整 ZIP。两个平台的源码均在同一公开仓库，采用 MIT 许可证。

- 包含认知唤醒、自定义视频板块、独立早晚视频槽位、跟练与护肤连续流程、力量训练、拍照档案、饮食睡眠、成就月历和完整备份。
- 修复 Windows 盘符和网络共享视频地址；睡眠旧库导入改用 Electron 自带 SQLite 的只读模式；摄像头设置可直接打开 Windows 隐私页面。
- Windows 记录和媒体放在 `%APPDATA%\面部重塑计划\`，安装和卸载保留用户资料；Mac 原资料位置兼容旧版。
- Windows CI 通过后才发布附件，包括逻辑与界面测试、默认资料目录、打包 EXE 的真实启动与视频播放、保存与重启恢复、静默安装和安装后启动。

安装版下载 `*Setup.exe`；免安装版完整解压 `*Windows-x64.zip` 后双击「人生重塑计划.exe」。`SHA256SUMS.txt` 提供校验值，`windows-validation.json` 提供打包程序检查记录。

Windows 安装包未配置 Authenticode 签名。自动测试使用合成照片与视频，不代表真实摄像头、在线视频或付费 AI 服务验收。Mac 本次发布更新源码，未替换用户本机正在使用的应用。

详见 [Windows 使用说明](https://github.com/SJT-bright/face-reshape-plan/blob/v1.8.5/WINDOWS-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md)。
