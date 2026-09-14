# 面部重塑计划 — Mac 运行与打包

环境要求：macOS 13 或更高；Node.js 22.12.0 或更高，推荐 Node 24 LTS。源码包会在目标 Mac 上安装与当前芯片匹配的 Electron，不包含 Windows 的 `node_modules`。

## 安装、测试和运行

先在 Finder 中进入解压后的顶层文件夹，右键选择“在终端中打开”。也可以在终端输入 `cd `（末尾保留空格），把解压后的文件夹拖到终端窗口，再按回车。随后先确认当前目录确实包含 `package.json`：

```bash
pwd
test -f package.json || { echo "当前目录不是项目根目录，请先进入解压后的项目文件夹"; exit 1; }
node -v
npm -v
npm ci
npx electron --version
npm test
npm start
```

`npx electron --version` 必须输出 `v44.3.0`，这才表示当前 Mac 对应的 Electron 二进制已下载完成。`npm test` 包含领域测试和 Electron 集成测试，需要图形桌面环境；仅运行领域测试可使用 `npm run test:unit`。`npm start` 运行正常后，可执行 `npm run dist:mac`，产物位于 `dist/`，默认匹配当前 Mac 的 arm64 或 x64 架构。

## 国内网络临时加速

若官方下载失败，可仅对本次命令使用镜像：

```bash
npm_config_registry=https://registry.npmmirror.com ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm ci
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist:mac
```

镜像不可用时，取消这些临时环境变量并直接重新运行 `npm ci`，即可回到压缩包默认的 npm 官方源与 Electron 官方下载源。

## 首次打开与正式分发

未签名应用首次打开时，可在 Finder 中按住 Control 点击应用并选择“打开”。这只适合个人测试；若要公开分发并正常双击安装，需要 Apple Developer 的 Developer ID 签名、公证与 stapling。
