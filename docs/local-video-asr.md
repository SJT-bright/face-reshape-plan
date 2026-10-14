# 晚间录像的本地语音转写

`src/js/local-video-transcription.js` 是主进程模块。它复用声迹的离线 `transcribe_audio.py` 工具，读取本机已经安装的 FunASR Paraformer、VAD 和标点模型。它不会打开声迹、修改声迹资料库、连接学习工作台服务、自动下载模型或使用云端语音识别。

模块只负责视频转文字。晚间录像的资格校验、去口水词及个人积累库每日复盘写入，由上层复盘流程处理。原录像、转写原稿、清稿应分别保留。

```js
const { createLocalVideoTranscriber } = require('./src/js/local-video-transcription');
const asr = createLocalVideoTranscriber({ allowedRoots: [skincareVideoDirectory] });
const status = await asr.getStatus();
const transcript = await asr.transcribeVideo(savedVideoPath, {
  signal: controller.signal,
  onProgress: ({ stage }) => updateProgress(stage),
});
// transcript: { text, segments: [{ start, end, text }], engine, duration, language }
// start/end/duration 均为秒；时间戳缺失时 segments 为 []，完整正文仍保留。
```

进度阶段依次为 `checking`、`extracting`、`transcribing`、`complete`。健康检查返回 `{ available, engine, offline, error, code }`，结果短暂缓存 30 秒，`getStatus({ force: true })` 可以重新检查。所有进程均以参数数组启动，不经过 shell；取消与超时只终止本次启动的子进程。

默认查找本机 `~/phone-asr-selfhosted/venv` 与 `~/phone-asr-selfhosted/local/models`、`~/录音整理/native/transcribe_audio.py`，以及 macOS 已安装声迹中的同名工具。FFmpeg/FFprobe 优先使用已安装的 Homebrew 工具，然后查找系统 PATH。可注入绝对路径配置 `python`、`helper`、`models`、`ffmpeg`、`ffprobe`；另可设置 `engineHome` 或 `shengjiHome`。Windows 使用已有本地 Python 环境的 `venv/Scripts/python.exe` 和 FFmpeg，没有找到依赖时明确提示，不切换到云端。

每次转写使用独立临时目录，抽取 16 kHz、单声道、16-bit PCM 音频，完成、失败或取消时清理临时音频和结果文件。只接受本地普通视频文件，默认上限 4 GB、音频最长两小时。配置 `allowedRoots` 时使用真实路径检查，符号链接不能逃出录像目录。没有音轨的旧录像会提示“这段旧录像没有声音，无法转写；请重新录制晚间护肤”，不会保存虚构文字或空成功。

本地 Python 工具来自用户已有的声迹环境，模型与 Python 依赖没有打包到本应用。换机需要先配置这些已有离线依赖。模型包括：

- `speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch`
- `speech_fsmn_vad_zh-cn-16k-common-pytorch`
- `punc_ct-transformer_cn-en-common-vocab471067-large`

本次验证（2026-10-14）：`node --test tests/test-local-video-transcription.js` 的 8 项检查通过，覆盖无声录像、非法路径、目录外符号链接、超长录像、不完整结果、取消、超时、失败清理和原文件保留。Apple Silicon macOS 上用系统 Tingting 合成一句公开测试文字并封装为视频，调用真实离线 Paraformer 后，去标点文字逐字一致；4.94 秒视频返回 20 字、1 个时间段，约 50.8 秒完成。原视频哈希未变，临时抽音已删除。没有使用私人录像；这项验证不代表真人录音识别质量、清稿/复盘联动或 Windows 原生运行已经验收。
