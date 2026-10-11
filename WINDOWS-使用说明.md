# Windows 使用与构建

适用于 Windows 10 / 11 的 x64 电脑。Mac 和 Windows 使用本仓库同一套 MIT 源码，当前版本为 **1.8.5**。

## 下载与打开

在 [v1.8.5 发布页](https://github.com/SJT-bright/face-reshape-plan/releases/tag/v1.8.5) 选择：

- `Life-Reshape-Plan-1.8.5-Windows-x64-Setup.exe`：安装向导，可选择安装位置，创建桌面与开始菜单快捷方式。
- `Life-Reshape-Plan-1.8.5-Windows-x64.zip`：完整解压后双击「人生重塑计划.exe」。保留整个目录，不能只拷贝 EXE。
- `SHA256SUMS.txt`：上述文件的 SHA-256 校验值；`windows-validation.json` 记录打包程序的启动检查。

安装包尚未配置 Windows Authenticode 证书。Windows 可能显示未知发布者，下载时核对本仓库发布地址与校验值。

## 数据、媒体与权限

应用始终将记录保存在兼容旧名称的 `%APPDATA%\面部重塑计划\`。Windows 的照片与复制的视频也放在这个可写目录中，不写入安装目录：

```text
%APPDATA%\面部重塑计划\
├── face-reshape-data.json
├── ai-key.enc
├── auto-backups\
├── skin-photos\
├── body-photos\
├── meal-photos\
└── imported-videos\
```

关闭窗口默认留在系统托盘，提醒需要应用持续运行。托盘菜单可重新显示窗口或退出；勿扰和提醒时间在设置中调整。

摄像头需要在「设置 → 隐私和安全性 → 摄像头」允许桌面应用访问。拒绝权限后，应用提供系统设置入口。照片只在本机保存，AI 识图在主动点击或自行开启自动模式后才请求第三方服务。

跨电脑或跨系统迁移：在「设置 → 数据与备份」导出 `.frbackup`，需要带走本地视频时勾选包含视频。恢复会重新生成当前系统路径；只有视频引用的备份需要另行复制视频并重新定位。API Key 不包含在备份中，迁移后重新填写。

## 从源码运行与构建

安装 Node.js 22.16+（建议 24 LTS）；运行应用和打包不需要 Python 或独立 sqlite3。Python 3 仅用于旧库力量训练导出脚本及对应开发测试。

```powershell
git clone https://github.com/SJT-bright/face-reshape-plan.git
cd face-reshape-plan
npm ci
npm start
npm test
npm run dist:win
npm run test:release -- "dist/win-unpacked/人生重塑计划.exe"
```

Windows CI 会在原生 Windows runner 上运行逻辑、Electron 界面、默认资料路径、打包程序、静默安装和安装后程序检查。测试视频与照片是合成资料；在线 B 站、抖音、真实硬件摄像头和付费 AI 调用不在自动验收范围内。
