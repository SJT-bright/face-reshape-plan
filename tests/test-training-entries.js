/* 跟练记录账本测试：新增 / 修改（秒数与完播标记）/ 删除，日累计同步扣减（计时记错的弥补路径） */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* util 在 store 之前加载（与 index.html 一致）；Store.save 在测试里为空操作 */
global.window = undefined;
const util = require('../src/js/util');
global.followCompletion = util.followCompletion;
global.todayKey = () => '2026-09-15';
global.addDays = util.addDays;
global.daysBetween = util.daysBetween; /* stats() 新实现用于相邻日判断 */
global.RhythmEngine = { normalize: (d) => d };
const Store = require('../src/js/store');

function freshStore() {
  const s = Object.create(Store);
  s.db = {
    videos: [{ id: 'v1', title: '瘦脸操', durationSec: 600 }],
    logs: { training: {}, skincare: {} },
    skincare: { cycles: [] },
    settings: {}
  };
  s.save = () => { s._statsVersion = (s._statsVersion || 0) + 1; }; /* 桩保留缓存失效契约 */
  return s;
}

test('新增→修改→删除：日累计秒数全程一致', () => {
  const s = freshStore();
  s.addTrainingEntry('2026-09-15', { id: 'e1', videoId: 'v1', seconds: 600 });
  assert.equal(s.dayTraining('2026-09-15').seconds, 600);
  s.updateTrainingEntry('2026-09-15', 'e1', { seconds: 120 });
  assert.equal(s.dayTraining('2026-09-15').seconds, 120, '修改应按差值扣减');
  s.removeTrainingEntry('2026-09-15', 'e1');
  assert.equal(s.dayTraining('2026-09-15').seconds, 0);
  assert.equal(s.dayTraining('2026-09-15').entries.length, 0);
  /* 删除不存在的条目：静默安全 */
  s.removeTrainingEntry('2026-09-15', 'nope');
});

test('完播标记：修改时长后按视频时长重算，manual 不计', () => {
  const s = freshStore();
  s.addTrainingEntry('2026-09-15', { id: 'e1', videoId: 'v1', seconds: 100, completed: false });
  s.updateTrainingEntry('2026-09-15', 'e1', { seconds: 500, completed: util.followCompletion(500, 600).completed });
  assert.equal(s.dayTraining('2026-09-15').entries[0].completed, true, '500s ≥ 600s*80% 应计完整');
  s.updateTrainingEntry('2026-09-15', 'e1', { seconds: 200, completed: util.followCompletion(200, 600).completed });
  assert.equal(s.dayTraining('2026-09-15').entries[0].completed, false, '改小后应取消完整');
  /* videoStats 聚合 */
  s.addTrainingEntry('2026-09-14', { id: 'e2', videoId: 'v1', seconds: 550, completed: true });
  const st = s.videoStats('v1');
  assert.equal(st.total, 2);
  assert.equal(st.completed, 1);
  assert.equal(st.days, 2);
  const totals = s.followTotals();
  assert.equal(totals.completed, 1);
  assert.equal(totals.total, 2); // e2 + e1（两条都非 manual）
});

test('stats：最长连续/达标天数/缓存失效（单遍 O(N) 实现）', () => {
  const s = freshStore();
  s.db.settings.dailyTargetMinutes = 15; /* 900 秒达标 */
  for (const d of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-07', '2026-09-08']) {
    s.db.logs.training[d] = { seconds: 900, entries: [] };
  }
  const st = s.stats();
  assert.equal(st.metDays, 7);
  assert.equal(st.bestStreak, 5); /* 01–05 连续；07–08 只有 2 天 */
  /* 同帧重复调用命中缓存；save 后失效 */
  const first = s.stats();
  assert.equal(s.stats(), first, '同版本内应命中缓存');
  s.db.logs.training['2026-09-09'] = { seconds: 900, entries: [] };
  s.save();
  assert.notEqual(s.stats(), first, 'save 后缓存应失效');
  assert.equal(s.stats().bestStreak, 5); /* 07-08-09 连 3 天，仍短于 01–05 的 5 天 */
  s.db.logs.training['2026-09-06'] = { seconds: 900, entries: [] };
  s.save();
  assert.equal(s.stats().bestStreak, 9); /* 01–09 全部相邻 → 9 天 */
  /* 首个用例把 todayKey 固定为 2026-09-15，今天与昨天未达标 → streak 0 */
  assert.equal(s.stats().streak, 0);
});
