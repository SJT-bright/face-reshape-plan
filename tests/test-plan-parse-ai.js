/* DeepSeek 计划解析校验测试（Skincare._validateAICycles，纯校验逻辑，不触网）。
   桩环境与 tests/test-ai-flow.js 同风格；独立成文件避免与并行扩展的 ai-flow 用例互相干扰。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const util = require('../src/js/util');
global.todayKey = () => '2026-09-21';
global.uid = (prefix) => (prefix || 'id') + '_t';
global.esc = util.esc;
global.hhmm = () => '08:00';
global.toast = () => {};
global.confirmModal = async () => true;
global.openModal = () => ({ querySelector: () => null });
global.closeModal = () => {};
global.$ = () => null;
global.$$ = () => [];
global.App = { currentView: 'skincare', render() {} };
global.SkinEngine = require('../src/js/skin-engine');
global.Store = { db: { skin: { logs: {}, photos: [], predictions: {}, stats: { seen: 0, hit: 0 } }, rhythm: { meals: [], sleeps: [] }, settings: {} }, settings: () => global.Store.db.settings, save: () => {} };
global.native = {};

const Skincare = require('../src/js/skincare.js');

test('DeepSeek 计划解析校验：合法结构入档、坏字段逐项清洗', () => {
  const cycles = Skincare._validateAICycles({ cycles: [
    { name: '周期一', startDate: '2026-09-21', endDate: '2026-09-27',
      steps: { morning: [{ name: '洁面', detail: '温水' }, { name: '' }, { detail: '无名' }],
               day: [{ name: '防晒补涂' }],
               evening: [{ name: '视黄醇', detail: '隔天用' }, { name: 123 }] } },
    { name: '   ' }, // 无有效步骤 → 整条丢弃
    null, 'x', // 非对象 → 丢弃
    { name: '坏日期', startDate: '2026/09/01', steps: { morning: [{ name: 'A' }] } } // 日期格式不对 → 留空（保存时自动接续）
  ] });
  assert.equal(cycles.length, 2);
  assert.equal(cycles[0].name, '周期一');
  assert.equal(cycles[0].startDate, '2026-09-21');
  assert.equal(cycles[0].endDate, '2026-09-27');
  assert.equal(cycles[0].steps.morning.length, 1);
  assert.equal(cycles[0].steps.day.length, 1);
  assert.equal(cycles[0].steps.evening.length, 1);
  assert.ok(String(cycles[0].steps.morning[0].id).startsWith('st_'));
  assert.equal(cycles[1].name, '坏日期');
  assert.equal(cycles[1].startDate, ''); // 非法日期被清洗为空，保存时按顺序自动接续
});

test('DeepSeek 计划解析校验：30 周期上限、空结构与垃圾输入', () => {
  const many = Skincare._validateAICycles({ cycles: Array.from({ length: 35 }, (_, i) => ({ name: `c${i}`, steps: { morning: [{ name: 'x' }] } })) });
  assert.equal(many.length, 30);
  const capped = Skincare._validateAICycles({ cycles: [{ name: 'c', steps: { morning: Array.from({ length: 40 }, (_, i) => ({ name: `s${i}` })) } }] });
  assert.equal(capped[0].steps.morning.length, 30); // 每流程上限 30 步
  assert.deepEqual(Skincare._validateAICycles(null), []);
  assert.deepEqual(Skincare._validateAICycles({}), []);
  assert.deepEqual(Skincare._validateAICycles({ cycles: [] }), []);
  assert.deepEqual(Skincare._validateAICycles({ cycles: [{ name: '空', steps: {} }] }), []); // 全空流程 → 丢弃
});

test('DeepSeek 日期 sanity：0000-00-00 形式合法但荒谬 → 丢弃日期留空（保存时自动接续）', () => {
  const cycles = Skincare._validateAICycles({ cycles: [
    { name: 'c', startDate: '0000-00-00', endDate: '0000-00-00', steps: { morning: [{ name: '洁面' }] } }
  ] });
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].startDate, '');
  assert.equal(cycles[0].endDate, '');
  const ok = Skincare._validateAICycles({ cycles: [{ name: 'c', startDate: '2026-09-21', steps: { morning: [{ name: '洁面' }] } }] });
  assert.equal(ok[0].startDate, '2026-09-21'); // 真实日期不受影响
});
