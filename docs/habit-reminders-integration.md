# 周期桌面提醒接入

本模块不修改既有护肤/睡眠/跟练提醒账本。喝水默认 10 分钟、运动默认 60 分钟，两项都默认关闭，用户保存启用后开始计时。名称、完成按钮文字、分钟间隔均可更改，可添加其他提醒。

`db.habitReminders` 是单一持久化状态：`version`、递增 `revision`、`configs`、各提醒 `runtime`、待处理 `queue`、当前 `activeId`、以 occurrenceId 为键的 `completions`。完成账本保留完成时的本地日期及当时名称；删除提醒保留已确认记录。每个提醒最多有一个待处理事件，电脑睡眠后只补一条，不补弹每个错过的间隔。

右上关闭、点击“稍等一下”都将同一事件推迟 5 分钟，不记次数；确认完成才增加一次并从确认时开始计算下一间隔。队列、稍后时间和事件标识均落盘，应用重启继续当前待处理事件。旧弹窗、重复点击和并发调用不会重复记数。保存失败会保留当前弹窗并提示重试。

## 主进程

在 main.js 依赖区导入：

```js
const HabitReminderCore = require('./src/js/habit-reminder-core');
const { registerHabitReminders } = require('./src/js/habit-reminder-host.cjs');
let habitRemindersHost;
```

在 `saveData()` 写盘前合并原状态，避免 renderer 的旧全库保存丢掉主进程刚记的次数或稍后状态。不要在落盘后才合并：

```js
if (db?.habitReminders || next.habitReminders) {
  next.habitReminders = HabitReminderCore.mergeState(db?.habitReminders, next.habitReminders);
}
```

注意：正式备份恢复需遵守用户已确认的“替换当前记录”语义。该恢复入口应显式跳过这项旧状态保护或在真正恢复后重建 host；普通 renderer 保存需要保护。`loadData` 不必添加默认字段，core 能识别未初始化资料。

在 `app.whenReady` 完成 `loadData` 和 `createWindow` 后注册；不要给 popup 指定 mainWindow 作为 parent，主窗口隐藏时仍要显示提醒。`getSuspended` 保持原总开关与勿扰规则，同时锁屏时不抢窗口：

```js
habitRemindersHost = registerHabitReminders({
  BrowserWindow, ipcMain,
  getData: () => db,
  saveData,
  isAppFrame,
  getSuspended: () => db.settings?.remindersEnabled === false ||
    Reminders.quiet(db.settings || {}, new Date()) ||
    powerMonitor.getSystemIdleState(1) === 'locked',
  onChanged: state => sendToRenderer('habit:changed', state)
});
habitRemindersHost.tick().catch(console.error);
```

host 默认每秒检查，用自己单独的队列与窗口，不替代原 `checkSchedules()`。可传 `now`、`timers`、`intervalMs` 注入测试时钟。退出时调用 `habitRemindersHost?.dispose()`，它停止计时、解除 IPC、销毁自身弹窗。

## preload.js

给现有 `native` 增加三个请求与刷新订阅：

```js
habitReminderState: () => ipcRenderer.invoke('habit:state'),
habitReminderSave: (config, revision) => ipcRenderer.invoke('habit:save', config, revision),
habitReminderRemove: (id, revision) => ipcRenderer.invoke('habit:remove', id, revision),
onHabitReminderChanged: callback => {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('habit:changed', listener);
  return () => ipcRenderer.removeListener('habit:changed', listener);
},
```

主窗口的配置 IPC 使用现有 `isAppFrame` 验证；弹窗 action IPC 仅允许自己的主 frame。弹窗用独立 sandbox preload，不向提醒窗口暴露应用全库、密钥或其他 native 能力。网页文本使用 textContent，设置字段转义；禁止额外导航和新窗口。

## renderer

src/index.html 加入 `habit-reminders.css` 和 `js/habit-reminders.js`。`HabitRemindersUI` 只通过 IPC 保存配置，不修改 `Store.db`。

在 `UX.settings(root)` 完成现有设置 DOM 后，显式调用：

```js
void HabitRemindersUI.mount(root);
```

它把独立设置卡片挂到现有 `#ux-reminders`，各提醒单独保存，有今天次数与下次时间。原“保存设置”仍只保存旧字段。可在今日视图 afterRender 调用 `void HabitRemindersUI.mountToday(root)`，展示已启用/今日已完成的各提醒计数。挂载是幂等的，主进程刷新只更新次数与状态，不丢当前输入。

主窗口本地 `Store.db.habitReminders` 可能暂旧；普通保存由主进程 `mergeState` 保护。不要把 IPC snapshot（只含配置与派生摘要）当成完整 ledger 覆盖 Store 或 DB。

## 验证

```sh
node --test tests/test-habit-reminders.js tests/test-habit-reminder-host.js
```

包含实际纯状态流和模拟主进程存储/窗口的测试：到期、睡眠后去重、稍后 5 分钟、重启、同到点排队、非当前事件/重复点击、午夜计数、删除保留账本、旧全库合并、写盘失败、窗口关闭、勿扰暂停、frame 来源校验。真实 Electron 及 Windows 弹窗的集成验收由主线串行执行，测试此处没有启动正式 App 或使用正式资料。
