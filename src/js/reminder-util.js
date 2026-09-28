/* 提醒到期判定（纯函数，可独立测试）：
   与 main.js checkSchedules 四段提醒的既有行为逐字对齐。

   已知口径（刻意保留、勿“修复”，否则行为改变）：
   - 原实现只查 Number.isNaN，不校验 0-23 / 0-59 范围，'25:00' 会被当作
     25 点（target = 1500 分钟）处理；parseHHmm 同样不拦，只在 Tests 里锁定。
   - 缺分钟段的输入（如 ''、'21'）原实现得到 m = undefined，target = NaN，
     diff = NaN，永不触发；parseHHmm 返回 { h, m: undefined }，调用方算
     target 同样得 NaN，结果一致（永不触发），不额外收紧为 null。

   reminderDue 不负责 reminderState / firedToday 的持久化与读写，那在调用方；
   调用方把「是否已提醒过」合并成 alreadyFired 传入即可。 */
'use strict';

/**
 * 解析 HH:mm（允许个位，如 '9:05'）。
 * 返回 { h, m } 或 null（任一段为 NaN 时，与原 Number+isNaN 行为一致；
 * 额外的冒号段如 '21:30:45' 与原实现一样被忽略，取前两段）。
 */
function parseHHmm(str) {
  const parts = String(str || '').split(':').map(Number);
  const h = parts[0];
  const m = parts[1];
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m };
}

/**
 * 到期判定：diff = curMinutes - targetMinutes，
 * 返回 diff >= 0 && diff <= graceMinutes && !alreadyFired。
 * 与原判定 `diff >= 0 && diff <= grace && !fired && state !== today` 中的
 * 时间窗 + 未提醒部分等价（fired/state 由调用方折算进 alreadyFired）。
 */
function reminderDue({ curMinutes, targetMinutes, graceMinutes, alreadyFired }) {
  const diff = curMinutes - targetMinutes;
  return diff >= 0 && diff <= graceMinutes && !alreadyFired;
}

module.exports = { parseHHmm, reminderDue };
