/* 成分混搭知识引擎测试：显式豁免 / 冲突 / 正向搭配 / 时段 / 健壮性
   关键断言依据（cite 写在注释里）：
   - docs/ingredient-kb-retinoid-acid-research.md   §2（阿达帕林×BPO 稳定，Epíduo 复方）、§3（维A×酸、壬二酸例外）、§5（光稳定性）
   - docs/ingredient-kb-sensitivity-research.md     §1（早C晚A）、§5（光敏精油/酸类日间）、§6（活性物过载）
   - docs/ingredient-kb-product-mapping-research.md §2（映射与防误判）、§3（踩坑清单：双A/多酸/氢醌） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/js/skin-knowledge');

const mix = (morning, evening, day) => ({
  steps: {
    morning: (morning || []).map(n => ({ name: n })),
    day: (day || []).map(n => ({ name: n })),
    evening: (evening || []).map(n => ({ name: n }))
  }
});
const sev = (r, s) => r.findings.filter(f => f.severity === s);

test('阿达帕林 + 班赛：不报 avoid，报可同场 info（维A研究§2：Epíduo 固定复方 + Br J Dermatol 稳定性）', () => {
  const r = K.analyzeMix(mix([], ['阿达帕林凝胶', '班赛']));
  assert.equal(sev(r, 'avoid').length, 0);
  const f = r.findings.find(x => x.rule === 'R-VA-BPO-ADAP');
  assert.ok(f, '应命中显式豁免 info 规则');
  assert.equal(f.severity, 'info');
});

test('维A酸乳膏 + 水杨酸棉片同晚 → avoid（维A研究§3 规则5/6），且同对组合只报一条、取最严', () => {
  const r = K.analyzeMix(mix([], ['维A酸乳膏', '水杨酸棉片']));
  assert.equal(sev(r, 'avoid').length, 1);
  assert.equal(sev(r, 'avoid')[0].rule, 'R-VA-ACID');
  const pair = r.findings.filter(f => f.products.length === 2 && f.products.includes('维A酸乳膏') && f.products.includes('水杨酸棉片'));
  assert.equal(pair.length, 1, '药膏×功效护肤 caution 应被同对 avoid 去重');
});

test('早VC晚A → info 正向（敏感研究§1：VC 晨间+防晒协同 [A]；维A研究§5：维A 夜间）', () => {
  const r = K.analyzeMix(mix(['修丽可CE精华'], ['阿达帕林凝胶']));
  assert.equal(sev(r, 'avoid').length, 0);
  assert.equal(sev(r, 'caution').length, 0);
  const f = r.findings.find(x => x.rule === 'R-AMPM-VCVA');
  assert.ok(f && f.severity === 'info');
});

test('维A类白天 → caution；阿达帕林措辞和缓、维A酸措辞严格（维A研究§5 规则12/13）', () => {
  const a = K.analyzeMix(mix(['阿达帕林凝胶'], []));
  assert.equal(sev(a, 'caution').length, 1);
  assert.equal(sev(a, 'caution')[0].rule, 'R-VA-DAY');
  assert.ok(sev(a, 'caution')[0].reason.includes('光稳定'), '阿达帕林应走和缓措辞');
  const t = K.analyzeMix(mix(['维A酸乳膏'], []));
  assert.equal(sev(t, 'caution')[0].rule, 'R-VA-DAY');
  assert.ok(sev(t, 'caution')[0].reason.includes('降解'), '维A酸应提示光降解');
});

test('柑橘精油晨间 → avoid（敏感研究§5 R15：呋喃香豆素光毒）', () => {
  const r = K.analyzeMix(mix(['柠檬精油'], []));
  assert.equal(sev(r, 'avoid').length, 1);
  assert.equal(sev(r, 'avoid')[0].rule, 'R-ESSENTIAL-DAY');
});

test('壬二酸 + 阿达帕林 → 不报冲突，报兼容 info（维A研究§3 证据6：联用耐受良好）', () => {
  const r = K.analyzeMix(mix([], ['壬二酸凝胶', '阿达帕林凝胶']));
  assert.equal(sev(r, 'avoid').length, 0);
  assert.equal(sev(r, 'caution').length, 0, '「多种药膏叠加」通用 caution 应对显式兼容对豁免');
  assert.ok(r.findings.some(f => f.rule === 'R-VA-AZELAIC'));
});

test('产品无匹配不误报；productClassOf 契约（映射研究§2#35 宁缺勿错）', () => {
  const r = K.analyzeMix(mix(['某某精华液'], ['神秘面霜']));
  assert.deepEqual(r.findings, []);
  const unk = K.productClassOf('神秘面霜');
  assert.deepEqual(unk.classes, []);
  const kn = K.productClassOf('宝拉2%水杨酸');
  assert.ok(kn.classes.includes('acid') && kn.matched.includes('水杨酸'));
  assert.equal(K.productClassOf('阿达帕林凝胶').isDrug, true);
  assert.ok(K.productClassOf('阿达帕林凝胶').subs.includes('adapalene'));
  assert.ok(!K.productClassOf('适乐肤C乳').classes.includes('vc'), '适乐肤「C」防误判为VC（映射研究§2）');
  assert.ok(K.productClassOf('适乐肤C乳').classes.includes('niacinamide'));
});

test('同场 ≥3 个活性类 → 过载 avoid（敏感研究§6 R19：同流程活性物上限）', () => {
  const r = K.analyzeMix(mix([], ['水杨酸棉片', '修丽可CE', 'A醇精华']));
  const f = r.findings.find(x => x.rule === 'R-OVERLOAD');
  assert.ok(f && f.severity === 'avoid');
  assert.equal(f.products.length, 3);
});

test('同一活性早晚重复 → info（映射研究§3#15 推论：功效品分早晚/隔天）', () => {
  const r = K.analyzeMix(mix(['水杨酸棉片'], ['水杨酸棉片']));
  const f = r.findings.find(x => x.rule === 'R-DUP-ACTIVE');
  assert.ok(f && f.severity === 'info');
  assert.ok(f.phases.includes('morning') && f.phases.includes('evening'));
});

test('维A类早晚双时段 → 双A avoid（映射研究§3#4：早A晚A 属双维A误区）', () => {
  const r = K.analyzeMix(mix(['A醇精华'], ['阿达帕林凝胶']));
  assert.ok(r.findings.some(f => f.rule === 'R-VA-VA' && f.severity === 'avoid'));
});

test('氢醌 × 酸 → avoid（映射研究§1 氢醌行 / §3#10：红肿脱皮风险）', () => {
  const r = K.analyzeMix(mix([], ['氢醌乳膏', '果酸面膜']));
  assert.ok(r.findings.some(f => f.rule === 'R-HQ-IRRIT' && f.severity === 'avoid'));
});

test('药膏 × 功效护肤同场 → caution（映射研究§1 编码要点）', () => {
  const r = K.analyzeMix(mix([], ['克林霉素凝胶', '果酸面膜']));
  assert.ok(r.findings.some(f => f.rule === 'R-DRUG-ACTIVE' && f.severity === 'caution'));
});

test('analyzeMix 对缺字段/空周期安全：不抛错、findings 为空数组', () => {
  [undefined, null, {}, { steps: {} }, { steps: { morning: null, evening: [] } },
    { steps: { morning: [null, {}, { name: '' }, 'abc'] } }, 'junk'].forEach(input => {
    const r = K.analyzeMix(input);
    assert.deepEqual(r.findings, []);
    assert.equal(typeof r.stats.checked, 'number');
  });
  const r = K.analyzeMix({ steps: { morning: [{ name: 'A醇精华' }] } });
  assert.equal(r.stats.checked, 1);
});

test('findings 排序：avoid > caution > info', () => {
  const r = K.analyzeMix(mix(['柠檬精油'], ['维A酸乳膏', '水杨酸棉片', '修丽可CE']));
  const ranks = r.findings.map(f => ({ avoid: 3, caution: 2, info: 1 }[f.severity]));
  for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i - 1] >= ranks[i], '应按等级降序排列');
});

test('VC × 酸同场才报 R-VC-ACID；维A × VC 不冒用这条', () => {
  const acidVc = K.analyzeMix(mix([], ['修丽可CE精华', '果酸面膜']));
  assert.ok(acidVc.findings.some(f => f.rule === 'R-VC-ACID'), '晚间维C + 果酸应出现 R-VC-ACID');
  const vaVc = K.analyzeMix(mix([], ['修丽可CE精华', 'A醇精华']));
  assert.ok(!vaVc.findings.some(f => f.rule === 'R-VC-ACID'), '晚间维C + A醇不应出现 R-VC-ACID');
});
