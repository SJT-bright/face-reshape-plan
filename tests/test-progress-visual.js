/* progress-visual 契约测试（纯 node:test + assert/strict，无 DOM / 无 electron）。
   覆盖 docs/progress-visual-params-design.md §5 契约与 §7 验收要点：
   - levelOf 分档与 nodata（null 不落「待建立」、confidence none 优先、theme 规则）
   - deltaView 阈值（±2.9 持平、±3 出箭头、null → 数据不足）
   - clampScore 边界（非有限数 → null、越界 clamp、取整）
   - meterView 三态（empty 无 aria-valuenow 语义 / zero 8px 小段参数 / ok 的 ariaLabel 拼接）
   - toneColor 非法入参回退
   - 常量表与 strength.css token、DIMENSIONS 字段名一致性 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const PV = require('../src/js/progress-visual');

/* ---------- 模块形态 ---------- */

test('纯函数模块：无 document/window 引用，双通道导出齐全', () => {
  const src = fs.readFileSync(path.join(rootDir, 'src', 'js', 'progress-visual.js'), 'utf8');
  assert.doesNotMatch(src, /\bdocument\b/, '不得引用 document');
  assert.doesNotMatch(src, /\bwindow\b/, '不得引用 window');
  for (const name of ['PROGRESS_TIERS', 'NODATA', 'DIMENSIONS', 'TONE_COLORS', 'MOTION',
    'clampScore', 'levelOf', 'deltaView', 'toneColor', 'meterView']) {
    assert.ok(name in PV, `缺少导出 ${name}`);
  }
  assert.equal(typeof PV.clampScore, 'function');
  assert.equal(typeof PV.levelOf, 'function');
  assert.equal(typeof PV.deltaView, 'function');
  assert.equal(typeof PV.toneColor, 'function');
  assert.equal(typeof PV.meterView, 'function');
});

/* ---------- 常量契约 ---------- */

test('契约常量：档位表 / NODATA / 维度注册表 / MOTION 与设计文档逐字一致', () => {
  assert.deepEqual(PV.PROGRESS_TIERS.map((t) => [t.key, t.min, t.label, t.colorLight, t.colorDark, t.token]), [
    ['foundation', 0, '待建立', '#9aa69f', '#8b97ab', '--st-tier-foundation'],
    ['developing', 25, '发展中', '#c59c58', '#e2b45c', '--st-tier-developing'],
    ['solid', 50, '稳固', '#70aa8a', '#8fd8b4', '--st-tier-solid'],
    ['excellent', 75, '出色', '#3f8f6c', '#4ade80', '--st-tier-excellent']
  ]);
  assert.deepEqual(
    [PV.NODATA.key, PV.NODATA.label, PV.NODATA.colorLight, PV.NODATA.colorDark, PV.NODATA.token],
    ['nodata', '无数据', 'rgba(121,139,130,0.28)', 'rgba(147,161,181,0.20)', '--st-nodata']
  );
  assert.deepEqual(PV.DIMENSIONS.map((d) => [d.key, d.label, d.scoreField, d.changeField, d.token]), [
    ['hypertrophy', '增肌刺激', 'hypertrophyScore', null, '--st-dim-hypertrophy'],
    ['strength', '力量趋势', 'strengthScore', 'strengthChangePercent', '--st-dim-strength'],
    ['endurance', '耐力', 'enduranceScore', 'enduranceChangePercent', '--st-dim-endurance']
  ]);
  assert.deepEqual(PV.MOTION, { countUpMs: 600, countUpMinDelta: 5, meterFillMs: 320, badgeTier: 4 });
});

test('token 落地：全部变量在 strength.css :root 声明、在 dark.css html.dark 覆盖', () => {
  const light = fs.readFileSync(path.join(rootDir, 'src', 'strength.css'), 'utf8');
  const dark = fs.readFileSync(path.join(rootDir, 'src', 'dark.css'), 'utf8');
  const tokens = [
    ...PV.PROGRESS_TIERS.map((t) => t.token),
    PV.NODATA.token,
    ...PV.DIMENSIONS.map((d) => d.token),
    '--st-delta-up', '--st-delta-down', '--st-delta-flat'
  ];
  assert.equal(tokens.length, 11, '设计文档 §4 共 11 个 token');
  for (const token of tokens) {
    assert.ok(light.includes(`${token}:`), `strength.css 缺 ${token}`);
    assert.ok(new RegExp(`--${token.replace(/^--/, '')}\\s*:`).test(light), `strength.css :root 缺 ${token} 声明`);
    assert.ok(light.indexOf(':root') < light.indexOf(token), `${token} 应在 :root 块`);
    assert.ok(dark.includes(token), `dark.css 缺 ${token} 暗色覆盖`);
  }
});

/* ---------- clampScore ---------- */

test('clampScore：非有限数 → null；越界 clamp；取整', () => {
  assert.equal(PV.clampScore(null), null);
  assert.equal(PV.clampScore(undefined), null);
  assert.equal(PV.clampScore(NaN), null);
  assert.equal(PV.clampScore(Infinity), null);
  assert.equal(PV.clampScore(-Infinity), null);
  assert.equal(PV.clampScore('64'), null, '非数值类型按无数据');
  assert.equal(PV.clampScore(-5), 0);
  assert.equal(PV.clampScore(150), 100);
  assert.equal(PV.clampScore(0), 0);
  assert.equal(PV.clampScore(100), 100);
  assert.equal(PV.clampScore(73.6), 74, '四舍五入取整');
});

/* ---------- levelOf ---------- */

test('levelOf：null/NaN/confidence none 一律 nodata，绝不落「待建立」', () => {
  for (const bad of [null, undefined, NaN]) {
    const level = PV.levelOf(bad);
    assert.equal(level.key, 'nodata');
    assert.equal(level.tier, null);
    assert.equal(level.label, '无数据');
    assert.equal(level.token, '--st-nodata');
    assert.equal(level.color, 'rgba(121,139,130,0.28)');
  }
  const none = PV.levelOf(80, 'none');
  assert.equal(none.key, 'nodata', 'confidence none 优先于分数');
  assert.equal(PV.levelOf(0, 'none').tier, null);
  assert.equal(PV.levelOf(null, undefined, 'dark').color, 'rgba(147,161,181,0.20)', 'nodata 也吃 theme');
});

test('levelOf：4 档边界闭区间与 tier 序号', () => {
  assert.deepEqual([PV.levelOf(0).key, PV.levelOf(0).tier], ['foundation', 1]);
  assert.equal(PV.levelOf(24).key, 'foundation');
  assert.equal(PV.levelOf(25).key, 'developing', '25 为闭区间下界');
  assert.equal(PV.levelOf(49).key, 'developing');
  assert.deepEqual([PV.levelOf(50).key, PV.levelOf(50).tier], ['solid', 3]);
  assert.equal(PV.levelOf(74).key, 'solid');
  assert.deepEqual([PV.levelOf(75).key, PV.levelOf(75).tier], ['excellent', 4]);
  assert.equal(PV.levelOf(100).key, 'excellent');
  assert.equal(PV.levelOf(150).key, 'excellent', '越界 clamp 后分档');
  assert.equal(PV.levelOf(-5).key, 'foundation', '越界 clamp 到 0 落档 1');
});

test('levelOf：limited/good 不影响分档；theme 仅认 light/dark', () => {
  assert.equal(PV.levelOf(80, 'limited').key, 'excellent');
  assert.equal(PV.levelOf(80, 'good').key, 'excellent');
  assert.equal(PV.levelOf(80).key, 'excellent');
  assert.equal(PV.levelOf(80, 'good', 'dark').color, '#4ade80');
  assert.equal(PV.levelOf(80, 'good', 'light').color, '#3f8f6c');
  assert.equal(PV.levelOf(80, 'good', 'bogus').color, '#3f8f6c', '非法 theme 按 light');
  assert.equal(PV.levelOf(80, 'good').color, '#3f8f6c', '缺省 theme 按 light');
});

/* ---------- deltaView ---------- */

test('deltaView：null → 数据不足；±2.9 持平；±3 出箭头；文本取整', () => {
  assert.deepEqual(PV.deltaView(null), { arrow: '', text: '数据不足', tone: 'empty' });
  assert.deepEqual(PV.deltaView(undefined), { arrow: '', text: '数据不足', tone: 'empty' });
  assert.deepEqual(PV.deltaView(0), { arrow: '', text: '持平', tone: 'flat' });
  assert.deepEqual(PV.deltaView(2.9), { arrow: '', text: '持平', tone: 'flat' });
  assert.deepEqual(PV.deltaView(-2.9), { arrow: '', text: '持平', tone: 'flat' });
  assert.deepEqual(PV.deltaView(3), { arrow: '↑', text: '↑ 3%', tone: 'up' });
  assert.deepEqual(PV.deltaView(-3), { arrow: '↓', text: '↓ 3%', tone: 'down' });
  assert.deepEqual(PV.deltaView(4.6), { arrow: '↑', text: '↑ 5%', tone: 'up' });
  assert.deepEqual(PV.deltaView(-12.34), { arrow: '↓', text: '↓ 12%', tone: 'down' });
});

/* ---------- toneColor ---------- */

test('toneColor：非法 tone 回退 flat；theme 规则同 levelOf', () => {
  assert.equal(PV.toneColor('up', 'light'), '#15803d');
  assert.equal(PV.toneColor('up', 'dark'), '#4ade80');
  assert.equal(PV.toneColor('down', 'light'), '#c2410c');
  assert.equal(PV.toneColor('down', 'dark'), '#ffb4a1');
  assert.equal(PV.toneColor('flat', 'dark'), '#93a1b5');
  assert.equal(PV.toneColor('empty'), 'rgba(44,58,71,0.55)');
  assert.equal(PV.toneColor('nope'), 'rgba(44,58,71,0.55)', '非法 tone 按 flat');
  assert.equal(PV.toneColor(null, 'dark'), '#93a1b5');
  assert.equal(PV.toneColor('up', 'nope'), '#15803d', '非法 theme 按 light');
});

/* ---------- meterView 三态 ---------- */

test('meterView empty：值 —、空轨参数、aria「数据不足」、无 aria-valuenow 依据', () => {
  const empty = PV.meterView({ dimension: 'strength', score: null, changePercent: null, confidence: 'good' });
  assert.equal(empty.state, 'empty');
  assert.equal(empty.valueText, '—');
  assert.equal(empty.fillPercent, 0);
  assert.equal(empty.fillToken, '--st-nodata');
  assert.equal(empty.tierKey, null);
  assert.equal(empty.ariaLabel, '力量趋势 数据不足');
  assert.ok(empty.classes.includes('st-meter-row--empty'));
  assert.ok(empty.classes.includes('st-meter-row--strength'));
  assert.equal(empty.delta.tone, 'empty');
  /* 并行引擎未就绪：progress 行上没有 enduranceScore 字段（undefined）→ 同样按 empty 防御 */
  const notReady = PV.meterView({ dimension: 'endurance', confidence: 'good' });
  assert.equal(notReady.state, 'empty');
  assert.equal(notReady.ariaLabel, '耐力 数据不足');
  assert.equal(notReady.fillToken, '--st-nodata');
  assert.ok(notReady.classes.includes('st-meter-row--endurance'));
  /* confidence none 优先：0 分也按无数据渲染 */
  assert.equal(PV.meterView({ dimension: 'hypertrophy', score: 0, confidence: 'none' }).state, 'empty');
});

test('meterView zero：0 分不与无数据混淆——「0 / 待建立 / 档 1 小段」', () => {
  const zero = PV.meterView({ dimension: 'hypertrophy', score: 0, changePercent: 6, confidence: 'limited' });
  assert.equal(zero.state, 'zero');
  assert.equal(zero.valueText, '0');
  assert.equal(zero.fillPercent, 0);
  assert.equal(zero.fillToken, '--st-tier-foundation', '视图层据此渲染 8px 实色小段');
  assert.equal(zero.tierKey, 'foundation');
  assert.equal(zero.ariaLabel, '增肌刺激 0 分，待建立', '固定文案，不追加趋势');
  assert.ok(zero.classes.includes('st-meter-row--zero'));
  assert.ok(zero.classes.includes('st-meter-row--hypertrophy'));
  assert.equal(PV.meterView({ dimension: 'strength', score: 0, confidence: 'good' }).ariaLabel, '力量趋势 0 分，待建立');
});

test('meterView ok：ariaLabel 拼接、维度 token、delta 追加规则', () => {
  const ok = PV.meterView({ dimension: 'strength', score: 64, changePercent: 4, confidence: 'good' });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.valueText, '64');
  assert.equal(ok.fillPercent, 64);
  assert.equal(ok.fillToken, '--st-dim-strength');
  assert.equal(ok.tierKey, 'solid');
  assert.equal(ok.ariaLabel, '力量趋势 64 分，稳固，较上期↑ 4%');
  assert.ok(ok.classes.includes('st-meter-row--strength'));
  /* 增肌无变化字段（undefined → empty tone）→ 不追加趋势 */
  const quiet = PV.meterView({ dimension: 'hypertrophy', score: 72, confidence: 'good' });
  assert.equal(quiet.ariaLabel, '增肌刺激 72 分，稳固');
  assert.equal(quiet.fillToken, '--st-dim-hypertrophy');
  /* 耐力 + down 趋势 */
  const down = PV.meterView({ dimension: 'endurance', score: 41, changePercent: -3, confidence: 'good' });
  assert.equal(down.ariaLabel, '耐力 41 分，发展中，较上期↓ 3%');
  assert.equal(down.tierKey, 'developing');
  assert.equal(down.fillToken, '--st-dim-endurance');
  /* 越界分数 clamp 后呈现 */
  assert.equal(PV.meterView({ dimension: 'strength', score: 150, confidence: 'good' }).valueText, '100');
  /* label 可覆盖；dimension 非法返回 null */
  assert.equal(PV.meterView({ dimension: 'strength', score: 10, label: '力量', confidence: 'good' }).label, '力量');
  assert.equal(PV.meterView({ dimension: 'nope', score: 10 }), null);
  assert.equal(PV.meterView(), null);
});

/* ---------- 与领域核心的对齐（并行引擎字段防御性校验） ---------- */

test('DIMENSIONS 与 buildMuscleProgress 输出对齐：已有字段校验值域，未就绪字段不致命', () => {
  const Core = require('../src/js/strength-core');
  const rows = Core.buildMuscleProgress([], '2026-09-01');
  assert.ok(Array.isArray(rows) && rows.length > 0);
  /* 现网已有维度字段必然存在 */
  assert.ok('hypertrophyScore' in rows[0]);
  assert.ok('strengthScore' in rows[0]);
  for (const dim of PV.DIMENSIONS) {
    if (dim.scoreField in rows[0]) {
      const v = rows[0][dim.scoreField];
      assert.ok(v === null || (Number.isInteger(v) && v >= 0 && v <= 100), `${dim.scoreField} 值域异常: ${v}`);
    }
    /* 尚未由引擎提供的字段（如 enduranceScore）允许缺失——视图层按 empty 态防御，不报错 */
  }
});
