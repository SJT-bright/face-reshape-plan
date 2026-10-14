# 晚间护肤口述复盘流水线

本模块在 Electron 主进程中运行。右键动作只允许已保存并明确归属 `evening` 的护肤录像；主进程集成处必须从自己的录像目录和记录查出路径、日期与时段，不接收网页自行指定的路径。

录像按内容 SHA-256 建立一个任务。同一视频改名、复制、重复点击或重启后重试，仍使用同一任务。依次执行本地转写、口水词清理、向个人积累库追加复盘。每阶段将状态写入用户数据目录的独立 JSON，POSIX 权限为 `0600`；原转写稿、时间段、清稿、来源与提交回执保留，不写入前端全量保存的主记录。

```js
const { createEveningReviewPipeline } = require('./src/js/evening-review-pipeline');
const { createLocalVideoTranscriber } = require('./src/js/local-video-transcription');
const asr = createLocalVideoTranscriber({ allowedRoots: [skinVideoDirectory] });
const pipeline = createEveningReviewPipeline({
  jobsDir: path.join(appDataDirectory, 'evening-review-jobs'),
  transcribe: (file, options) => asr.transcribeVideo(file, options),
});
const job = await pipeline.run({
  file: '护肤-20261014-220000.webm',
  videoPath: verifiedLocalPath,
  date: '2026-10-14',
  phase: 'evening',
}, { signal, onProgress: event => notifyView(event) });
```

`run()` 返回完整 `job`，失败时抛出带 `code` 的中文 `Error`，任务中的 `error` 也持久化。界面查询使用 `getJobById(id)` 或 `listJobs()`；异步 `getJob(video)` 以视频内容查询。向网页公开前，由集成处选择可展示的字段，避免把内部本地路径、冻结的请求正文或模型配置直接放入产品界面。

任务状态为 `queued → transcribing → transcribed → cleaning → cleaned → syncing → completed`，错误为 `failed`。`job.raw.text` 与 `segments` 是原稿；`job.cleaned.text` 是删除口水词后的全文；`job.receipt` 包含 `noteId/date/revision/url/duplicate`。进度事件为 `{id,stage,detail?}`，ASR 或清稿的细分进度在 `detail`。重试从已保存的原稿或清稿继续，不重复完成的耗时阶段；完成的任务不会再次写复盘。

## 清稿

默认使用本机 `http://127.0.0.1:11434` 的 `qwen3:14b`。可以通过 `createOllamaTranscriptCleaner({endpoint,model})` 配置已安装的本地模型；禁止非本机端点和 `:cloud` 模型。模型只返回可以删除的口水词候选编号。程序把候选与原文的实际位置对齐后应用删除，模型无法改写整段正文、添加事实、改数字、调序或删除否定。

长原文逐段覆盖全部字符，不以摘要代替原稿。模糊的“那个文件”“额头”“啊Q”等实词保留。模型失败、格式错误、陌生删除编号或部分处理失败会停止导入并保留原稿；不把未完成清稿伪装成成功。语义上不确定的口水词可能保留，这是保留事实的有意取舍。用户可以在应用中查看原稿与清稿。

## 个人积累库连接

2026-10-14 已实时核实安装中的个人积累库在 `http://127.0.0.1:3216`，健康接口 `/api/v1/health` 返回 schema 33；未修改正式复盘或其数据库。连接使用现有接口：

- `GET /api/v1/personal-notes?date=YYYY-MM-DD`，返回 `{note:null|{id,businessDate,content,revision,...}}`。
- `POST /api/v1/personal-notes`，JSON 为 `{type:"save-personal-daily-note",noteId,businessDate,content,expectedRevision}`，带 `idempotency-key`。接口要求内容最长 20,000 字符。
- 复盘实际页面为 `/daily-review?date=YYYY-MM-DD`。

读取当前复盘后，只向 `daily-review-template-v1.completed`（“今天做了什么”）追加文字及录像来源链接，保留 `effective`、`tomorrow` 与其他已有字段。旧版整段备注完整保留在 `completed`。不截断超长内容，不覆盖原复盘。录像链接中的任务标记用于来源关联与目标去重。

首次 POST 前先持久化完整请求正文和幂等键。网络中断、服务器错误或无法核实响应时，下次重试原请求，避免重复追加或覆盖后续编辑。明确收到 `409` 时重读最新内容并重新合并；并发冲突持续发生会保留清稿等待重试。收到 `200` 仍要核对 noteId、日期、预期新 revision 与完整内容，核对通过才完成。换端点时，不把未确认的旧请求发送到新目标。

测试可注入 `transcribe(file,{signal,onProgress})`、`cleanup(text,{signal,onProgress})` 和 `sync(job,{signal,checkpoint})`。自定义同步器要实现幂等追加，并在外部写入前通过 `checkpoint(state)` 持久化重试状态。正式集成使用模块自带的 `createLifepivotReviewAppender()`，也可配置一个经过核实的本机端点。

## 验证边界

- `node --test tests/test-evening-review-pipeline.js`：16 项通过，覆盖原稿保留、失败续处理、取消、内容去重、并发与重启、损坏记录、LLM 删除边界、全文分段、真实 HTTP 契约、CAS 冲突、未知结果重放与错误回执。
- 本机 Ollama 实际调用：合成文本 `嗯，今天学习了三十分钟英语。我没有去跑步。呃，晚上做了护肤。` 输出 `今天学习了三十分钟英语。我没有去跑步。晚上做了护肤。`，模型返回并经过程序验证的删除为“嗯”“呃”。这不是用户的个人记录。
- 未运行原生 UI，未写正式个人积累库复盘，未发布或安装。完整录像 → ASR → 清稿 → 页面与隔离复盘服务的验收由主进程集成测试负责。
