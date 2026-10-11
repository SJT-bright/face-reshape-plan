/* P1-4 导入测试：明确结构、整体校验、原子应用、注入样本、合成 SQLite 转换脚本 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const python = process.platform === 'win32' ? 'python' : 'python3';
function createSqlite(file, schema) { const db = new DatabaseSync(file); try { db.exec(schema); } finally { db.close(); } }
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Core = require('../src/js/strength-core');

const NOW = new Date('2026-09-13T01:00:00.000Z');

function validPayload() {
  return {
    templates: [{
      id: 'tpl_old1', name: '练三腹一', currentRevision: 1,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      versions: [{
        revision: 1, effectiveFrom: '2026-09-01', changeNote: '初始版本', createdAt: '2026-09-01T00:00:00.000Z',
        days: [{ dayKey: 'push', name: '第一天·胸+三头', bodyPart: '胸', isRest: false, note: '', ordinal: 0,
          actions: [{ actionKey: 'act-1-1', name: '上斜卧推', plannedSets: 5, plannedRepsText: '10', plannedWeightText: '', targetText: '', note: '', ordinal: 0 }] }]
      }]
    }],
    cycle: { tpl_old1: { currentDayKey: 'push', revision: 1, updatedAt: '2026-09-01T00:00:00.000Z' } },
    days: {
      '2026-09-06': {
        date: '2026-09-06', templateId: 'tpl_old1', templateRevision: 1, dayKey: 'push', name: '第一天·胸+三头',
        bodyPart: '', isRest: false, status: 'completed', totalSeconds: 1800, startedAt: null, pausedAt: null,
        revision: 1, supplements: { creatineTaken: true, proteinPowderTaken: null, note: '' },
        confirmedDurationMinutes: null, note: '', completionText: '',
        actions: [{ actionKey: 'act-1-1', name: '上斜卧推', plannedSets: 5, plannedRepsText: '10', plannedWeightText: '', targetText: '', setsDone: 5, repsText: '10', weightKg: 13.3, durationMinutes: null, note: '' }],
        resolution: { outcome: 'completed', note: '', cycleAdvanced: true, resolvedAt: '2026-09-06T00:00:00.000Z' },
        createdAt: '2026-09-06T00:00:00.000Z'
      }
    },
    events: [], progress: []
  };
}

test('合法负载导入成功；重复导入跳过已存在项', () => {
  const state = Core.normalize({});
  const r = Core.importFrom(state, validPayload());
  assert.ok(r.ok, r.error);
  assert.equal(r.templates, 1);
  assert.equal(r.days, 1);
  const again = Core.importFrom(state, validPayload());
  assert.ok(again.ok);
  assert.equal(again.templates, 0);
  assert.equal(again.days, 0);
  assert.equal(state.templates.length, 1);
  assert.equal(Object.keys(state.days).length, 1);
});

test('原子性：一条坏数据导致整体拒绝，state 完全不变', () => {
  const state = Core.normalize({});
  const payload = validPayload();
  payload.days['2026-09-07'] = { date: '2026-09-07', actions: [], status: 'completed', totalSeconds: 0 };
  payload.days['2026-09-07'].actions = [{ actionKey: 'a', name: 'x', setsDone: 'many' }]; // setsDone 非法
  const before = JSON.stringify(state);
  const r = Core.importFrom(state, payload);
  assert.equal(r.ok, false);
  assert.match(r.error, /字段无效/);
  assert.equal(JSON.stringify(state), before); // 坏数据不部分落库
});

test('注入样本被拒绝：日期键、模板 id、超大文本', () => {
  const state = Core.normalize({});
  const p1 = validPayload();
  p1.days['"><img src=x onerror=alert(1)>'] = p1.days['2026-09-06'];
  assert.equal(Core.importFrom(state, p1).ok, false);

  const p2 = validPayload();
  p2.templates[0].id = 'tpl" onmouseover="alert(1)';
  assert.equal(Core.importFrom(state, p2).ok, false);

  const p3 = validPayload();
  p3.days['2026-09-06'].note = 'x'.repeat(4001);
  assert.equal(Core.importFrom(state, p3).ok, false);

  const p4 = validPayload();
  p4.days['2026-09-06'].actions[0].weightKg = -5;
  assert.equal(Core.importFrom(state, p4).ok, false);
});

test('非对象/数组/拼接 JSON 拒绝', () => {
  const state = Core.normalize({});
  assert.equal(Core.importFrom(state, null).ok, false);
  assert.equal(Core.importFrom(state, [validPayload()]).ok, false);
  assert.equal(Core.importFrom(state, 'not json').ok, false);
  assert.equal(Core.importFrom(state, {}).ok, false); // 空对象：无 templates 无 days
});

test('convertLegacyRows：旧应用表行结构转换为原生结构并可导入', () => {
  const state = Core.normalize({});
  const legacy = {
    templates: [{ id: 'tpl_old1', name: '练三腹一', currentRevision: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }],
    templateVersions: [{ id: 'ver1', templateId: 'tpl_old1', revision: 1, effectiveFrom: '2026-09-01', changeNote: '', createdAt: '2026-09-01T00:00:00.000Z' }],
    templateDays: [{ id: 'tday1', templateVersionId: 'ver1', dayKey: 'push', name: '第一天·胸+三头', bodyPart: '胸', isRest: 0, note: '', ordinal: 0 }],
    templateActions: [{ id: 'tact1', templateDayId: 'tday1', actionKey: 'act-1-1', name: '上斜卧推', plannedSets: 5, plannedRepsText: '10', plannedWeightText: '', targetText: '', note: '', ordinal: 0 }],
    trainingDays: [{ id: 'day1', businessDate: '2026-09-06', templateId: 'tpl_old1', templateVersionId: 'ver1', dayKey: 'push', dayName: '第一天·胸+三头', status: 'completed', durationMinutes: 30, createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z' }],
    trainingActions: [{ id: 'da1', dayId: 'day1', actionKey: 'act-1-1', name: '上斜卧推', plannedSets: 5, actualSets: 5, actualRepsText: '10', actualWeightText: '13.3kg' }],
    dayResolutions: [{ dayId: 'day1', outcome: 'completed', note: '', resolvedAt: '2026-09-06T00:00:00.000Z' }]
  };
  const conv = Core.convertLegacyRows(legacy);
  assert.ok(conv.ok, conv.error);
  const r = Core.importFrom(state, conv.native);
  assert.ok(r.ok, r.error);
  assert.equal(r.templates, 1);
  assert.equal(r.days, 1);
  const day = state.days['2026-09-06'];
  assert.equal(day.actions[0].weightKg, 13.3);
  assert.equal(day.resolution.outcome, 'completed');
});

test('导出脚本：不存在的路径被拒绝且不创建文件（真只读）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strength-ro-'));
  const missing = path.join(tmp, 'no-such-db.sqlite');
  const script = path.join(__dirname, '..', 'scripts', 'export-strength-from-life-pivot.py');
  let exitCode = 0;
  try {
    execFileSync(python, [script, missing], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    exitCode = err.status;
  }
  assert.notEqual(exitCode, 0, '不存在的路径应以非零退出码失败');
  assert.equal(fs.existsSync(missing), false, '绝不静默创建空库文件');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('合成 SQLite → 导出脚本 → 导入：端到端', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strength-import-'));
  const db = path.join(tmp, 'synthetic.sqlite');
  const schema = `
    create table manual_exercise_templates (id text primary key, name text, current_revision integer, created_at text, updated_at text);
    create table manual_exercise_template_versions (id text primary key, template_id text, revision integer, effective_from text, change_note text, created_at text);
    create table manual_exercise_template_days (id text primary key, template_version_id text, day_key text, name text, body_part text, is_rest integer, note text, ordinal integer);
    create table manual_exercise_template_actions (id text primary key, template_day_id text, action_key text, name text, planned_sets integer, planned_reps_text text, planned_weight_text text, target_text text, note text, ordinal integer);
    create table manual_exercise_cycle_state (template_id text primary key, current_day_key text, revision integer, updated_at text);
    create table manual_exercise_days (id text primary key, business_date text, template_version_id text, day_key text, day_name text, is_rest integer, status text, started_at text, created_at text, updated_at text, confirmed_duration_minutes integer, calculated_duration_minutes integer, manual_duration_minutes integer);
    create table manual_exercise_day_actions (id text primary key, day_id text, action_key text, name text, planned_sets integer, planned_reps_text text, planned_weight_text text, actual_sets integer, actual_reps_text text, actual_weight_text text, ordinal integer);
    create table manual_exercise_day_resolutions (id text primary key, day_id text, outcome text, note text, resolved_at text, reopened_at text);
    insert into manual_exercise_templates values ('tpl_1', '练三腹一', 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    insert into manual_exercise_template_versions values ('ver_1', 'tpl_1', 1, '2026-09-01', '初始版本', '2026-09-01T00:00:00.000Z');
    insert into manual_exercise_template_days values ('tday_1', 'ver_1', 'push', '第一天·胸+三头', '胸', 0, '', 0);
    insert into manual_exercise_template_actions values ('tact_1', 'tday_1', 'act-1-1', '上斜卧推', 5, '10', '', '', '', 0);
    insert into manual_exercise_cycle_state values ('tpl_1', 'push', 1, '2026-09-01T00:00:00.000Z');
    insert into manual_exercise_days values ('day_1', '2026-09-06', 'ver_1', 'push', '第一天·胸+三头', 0, 'completed', null, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z', null, 30, null);
    insert into manual_exercise_day_actions values ('da_1', 'day_1', 'act-1-1', '上斜卧推', 5, '10', '', 5, '10', '13.3kg', 0);
    insert into manual_exercise_day_resolutions values ('res_1', 'day_1', 'completed', '', '2026-09-06T00:00:00.000Z', null);
  `;
  createSqlite(db, schema);
  const script = path.join(__dirname, '..', 'scripts', 'export-strength-from-life-pivot.py');
  const out = execFileSync(python, [script, db], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  const payload = JSON.parse(out); // 导出必须是单个合法 JSON
  assert.ok(payload.templates.length === 1);
  assert.ok(payload.days['2026-09-06']);
  const state = Core.normalize({});
  const r = Core.importFrom(state, payload);
  assert.ok(r.ok, r.error);
  assert.equal(r.templates, 1);
  assert.equal(r.days, 1);
  assert.equal(state.days['2026-09-06'].actions[0].weightKg, 13.3);
  // 注入样本走同一管道必须被拒
  const badDb = path.join(tmp, 'injection.sqlite');
  const badSchema = schema.replace("'2026-09-06', 'ver_1'", "'\"><img src=x onerror=alert(1)>', 'ver_1'");
  createSqlite(badDb, badSchema);
  const badOut = execFileSync(python, [script, badDb], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  const badPayload = JSON.parse(badOut);
  const state2 = Core.normalize({});
  const r2 = Core.importFrom(state2, badPayload);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /训练日期无效/);
  assert.equal(Object.keys(state2.days).length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
