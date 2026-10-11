/* 计划快捷导入测试：时间解析边界、名称截断、同文本重复导入去重（2026-09-22 审计 P5/P6/P7） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const util = require('../src/js/util');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const StoreCore = require('../src/js/store');

function makeImporter(fetchImpl) {
  const db = { videos: [], sessions: [], settings: {} };
  const sandbox = {
    uid: util.uid, pad2: util.pad2, daysBetween: util.daysBetween, todayKey: util.todayKey,
    Store: Object.assign(Object.create(StoreCore), { db, save() {} }),
    console, window: { native: { fetchBilibiliInfo: fetchImpl || (async bvid => ({ ok: true, title: bvid, cid: 1 })) } }
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'templates.js'), 'utf-8')
    + '\nthis.__out = { PI: PlanImporter };';
  vm.runInContext(code, sandbox);
  sandbox.__out.PI.db = db;
  return sandbox.__out.PI;
}

test('导入时间解析：非法时刻不再被捞成合法尾巴', () => {
  const PI = makeImporter();
  assert.equal(PI.parseLine('测试 25:30').time, null, '25:30 不是合法时刻');
  assert.equal(PI.parseLine('测试 7:30').time, '07:30', '单数字小时保留');
  assert.equal(PI.parseLine('测试 23:59').time, '23:59');
  assert.equal(PI.parseLine('测试 00:00').time, '00:00');
  assert.equal(PI.parseLine('测试 24:00').time, null);
});

test('导入名称截断：超长行截到 60 字', () => {
  const PI = makeImporter();
  const name = PI.parseLine('A'.repeat(10000)).name;
  assert.ok(name.length <= 60, 'name 长度 ' + name.length + ' 应 ≤ 60');
});

test('导入去重：同文本重复导入不再翻倍，新内容照常入库', async () => {
  const PI = makeImporter();
  const text = '哑铃卧推 4组/10 2min\n哑铃飞鸟 3组/10';
  const r1 = await PI.importLines(text);
  assert.equal(r1.sessions, 2);
  const r2 = await PI.importLines(text);
  assert.equal(r2.sessions, 0, '完全相同的行全部跳过');
  assert.equal(r2.skipped, 2);
  const r3 = await PI.importLines('新动作 3组/12');
  assert.equal(r3.sessions, 1, '新内容不受去重影响');
});

test('重复安排里的新视频仍导入；第五个视频不受安排去重限制', async () => {
  const PI = makeImporter();
  const ids = ['BV1xx411c7mA', 'BV1xx411c7mB', 'BV1xx411c7mC', 'BV1xx411c7mD', 'BV1xx411c7mE'];
  for (let i = 0; i < ids.length; i++) {
    const r = await PI.importLines(`晚间跟练 21:30 每天 ${ids[i]}`);
    assert.equal(r.videos, 1, `第 ${i + 1} 个链接应进入视频库`);
    assert.equal(r.sessions, i === 0 ? 1 : 0, '相同安排不重复建立');
  }
  assert.equal(PI.db.videos.length, 5);
  assert.equal(PI.db.sessions.length, 1);
  assert.equal((await PI.importLines(`晚间跟练 21:30 每天 ${ids[4]}`)).videos, 0);
});

test('纯视频链接只加入视频库，不创建默认安排', async () => {
  const PI = makeImporter();
  const r = await PI.importLines('https://www.bilibili.com/video/BV1xx411c7mF');
  assert.equal(r.videos, 1);
  assert.equal(r.sessions, 0);
  assert.equal(PI.db.sessions.length, 0);
});

test('抓取失败仍保存引用，结果标记待核实链接；成功时不标记', async () => {
  const PI = makeImporter(async bvid => bvid === 'BV1s411o776X'
    ? { ok: false, error: '啥都木有' } : { ok: true, title: '标题' + bvid, cid: 9 });
  const r1 = await PI.importLines('晚间跟练 21:30 每天 BV1s411o776X');
  assert.equal(r1.videos, 1, '失败链接仍进入视频库（仅保存引用）');
  assert.deepEqual(Array.from(r1.pendingRefs), ['BV1s411o776X'], '失败链接应出现在 pendingRefs');
  assert.equal(PI.db.videos[0].title, 'BV1s411o776X', '标题回退为 BV 号');
  assert.equal(PI.db.videos[0].cid, null, '无 cid');
  const r2 = await PI.importLines('晚间跟练2 21:30 每天 BV1GJ411x7h7');
  assert.deepEqual(Array.from(r2.pendingRefs), [], '抓取成功不标记');
});

test('待核实标记同样适用于 av 号引用', async () => {
  const PI = makeImporter(async () => ({ ok: false, error: '请求超时' }));
  const r = await PI.importLines('晚间跟练 21:30 每天 av170001');
  assert.equal(r.videos, 1);
  assert.deepEqual(Array.from(r.pendingRefs), ['av170001']);
});

test('resultToasts：成功路径文案不变，有待核实时追加含链接的提示', () => {
  const PI = makeImporter();
  const ok = PI.resultToasts({ sessions: 1, videos: 2, pendingRefs: [] });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].msg, '导入完成：1 个安排、2 个新视频 ✓');
  assert.equal(ok[0].type, 'green');
  /* 旧调用方不传 pendingRefs 时也必须走原文案（兼容；逐字段断言避免 vm realm 原型差异） */
  const legacy = PI.resultToasts({ sessions: 0, videos: 1 });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].msg, '导入完成：0 个安排、1 个新视频 ✓');
  assert.equal(legacy[0].type, 'green');

  const warn = PI.resultToasts({ sessions: 1, videos: 1, pendingRefs: ['BV1s411o776X'] });
  assert.equal(warn.length, 2);
  assert.ok(warn[1].msg.includes('待核实') && warn[1].msg.includes('BV1s411o776X'), warn[1].msg);

  const many = PI.resultToasts({ sessions: 0, videos: 4, pendingRefs: ['BV1a', 'BV1b', 'BV1c', 'BV1d'] });
  assert.ok(many[1].msg.includes('BV1a、BV1b、BV1c') && many[1].msg.includes('等 4 个'), '超过 3 个截断展示');
});
