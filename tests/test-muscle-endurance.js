/* 肌肉耐力评分测试（v2）—— 用例对应 docs/muscle-endurance-design.md §8 API 契约、§11 测试基线与 §12 边界 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/strength-core');

const DAY = '2026-09-12'; // recent = 08-16..09-12，previous = 07-19..08-15
const MALE = { sex: '男', age: 28 };

function obs(date, name, sets, reps, weight, dayLabel = '推日') {
  return { businessDate: date, dayLabel, actionName: name, sets, repsText: reps, weightText: weight };
}

test('ENDURANCE_CONFIG 常量表与设计文档 §8.2 一致（v2：绝对常模分，WEIGHTS 删除）', () => {
  assert.deepEqual(Core.ENDURANCE_CONFIG, {
    ANCHOR_MAX_REPS: 10, RATIO_REP_MIN: 11, RATIO_REP_MAX: 30, EPLEY_REP_CONSTANT: 30,
    ZONE_REP_MIN: 12, ZONE_LOAD_MAX_PCT: 0.67, FATIGUE_MIN_SETS: 2,
    L1_PCT_MIN: 0.4, L1_PCT_MAX: 0.833,
    SCORE_RATIO_ANCHORS: [[0, 0], [0.5, 20], [1, 50], [1.5, 75], [2, 92], [2.5, 100]],
    AGE_BAND_DEFAULT: '20-29',
    REP_NORMS: {
      俯卧撑: {   // [B·待复核] Golding 20-29，「档位次数下限 → 分数带下限」展开，优秀档 +15 次封顶
        male: [[0, 0], [8, 0], [20, 20], [25, 35], [30, 45], [35, 60], [45, 75], [54, 90], [69, 100]],
        female: [[0, 0], [1, 0], [5, 20], [10, 35], [15, 45], [21, 60], [34, 75], [48, 90], [63, 100]]
      },
      卷腹: {     // [B·待复核] ACSM 20-29
        male: [[0, 0], [16, 15], [17, 35], [26, 60], [34, 80], [40, 92], [55, 100]],
        female: [[0, 0], [14, 15], [15, 35], [23, 60], [30, 80], [36, 92], [50, 100]]
      },
      仰卧起坐: { // 女=中国标准大一大二 [B·较可信]；男无可靠表 → null（走 L4）
        male: null,
        female: [[0, 0], [25, 55], [26, 60], [36, 65], [39, 70], [42, 75], [45, 80], [48, 85], [52, 90], [56, 100]]
      },
      引体: {     // [C·占位，来源未定位]
        male: [[0, 0], [2, 15], [5, 35], [8, 45], [10, 59], [12, 75], [15, 90], [20, 100]],
        female: [[0, 0], [1, 20], [2, 45], [3, 60], [5, 75], [7, 90], [10, 100]]
      }
    },
    BW_COEF: [
      { keywords: ['跪姿'], coef: 0.49, curveKey: 'low' },
      { keywords: ['俯卧撑'], coef: 0.64, curveKey: 'mid' },
      { keywords: ['引体', '悬垂'], coef: 1.0, curveKey: 'high' },
      { keywords: ['双杠', '臂屈伸'], coef: 0.7, curveKey: 'mid' }
    ],
    FAMILY_CURVES: {
      high: [[1, 25], [5, 50], [10, 75], [15, 92], [20, 100]],
      mid: [[5, 25], [18, 50], [30, 75], [42, 92], [55, 100]],
      low: [[6, 25], [25, 50], [40, 72], [55, 88], [70, 100]]
    },
    GENERIC_REPS_CURVE: [[3, 20], [8, 35], [15, 50], [25, 68], [35, 82], [50, 93], [65, 100]]
  });
});

test('estimateEnduranceReps：Epley 反解，域 (0,1]，预测 <1 次为 null（趋势 chip 链路沿用）', () => {
  assert.equal(Core.estimateEnduranceReps(0.6), 20);
  assert.equal(Core.estimateEnduranceReps(0.67), 15);
  assert.equal(Core.estimateEnduranceReps(1.0), null); // pct=1 → 0 次
  assert.equal(Core.estimateEnduranceReps(0), null);
  assert.equal(Core.estimateEnduranceReps(1.2), null);
  assert.equal(Core.estimateEnduranceReps(-0.5), null);
});

test('perSetRepsFromText：剥「组数×次数」前缀，连字符区间与组数不符返回空数组', () => {
  assert.deepEqual(Core.perSetRepsFromText('12, 10, 8', 3), [12, 10, 8]);
  assert.deepEqual(Core.perSetRepsFromText('3x12, 10, 8', 3), [12, 10, 8]);
  assert.deepEqual(Core.perSetRepsFromText('10-12', 2), []); // 区间写法从保守，不产生保持率样本
  assert.deepEqual(Core.perSetRepsFromText('10', 3), []);    // 单值 ×3 组是复制不是逐组
  assert.deepEqual(Core.perSetRepsFromText('15', 1), []);    // 单组无保持率
  assert.deepEqual(Core.perSetRepsFromText('12, 10, 8', 4), []); // 数字个数 ≠ 组数
});

test('fatigueRetention：mean(r_i/r_1)，后组更多不奖励（clamp 0–1）——展示统计沿用', () => {
  assert.equal(Core.fatigueRetention([12, 10, 8]), 0.75);
  assert.equal(Core.fatigueRetention([12, 12]), 1);
  assert.equal(Core.fatigueRetention([12, 15, 12]), 1); // clamp(1.125) = 1
  assert.equal(Core.fatigueRetention([10]), null);
  assert.equal(Core.fatigueRetention([0, 10, 10]), null); // r_1 ≤ 0
});

test('enduranceRatioForSet：比值 = 实际次数 / Epley 反解预测次数；锚点无效或 pct > 1 为 null（chip 链路沿用）', () => {
  assert.deepEqual(Core.enduranceRatioForSet(35, 15, 60), { percent1rm: 0.583, predictedReps: 21, ratio: 0.714 });
  assert.equal(Core.enduranceRatioForSet(35, 15, 0), null);   // 锚点 ≤ 0
  assert.equal(Core.enduranceRatioForSet(70, 15, 60), null);  // pct > 1（数据噪声）
  assert.equal(Core.enduranceRatioForSet(null, 15, 60), null); // 自重无重量 → 无比值
});

test('enduranceZoneSetCount：≥12 次且（有锚点 ? ≤67% 锚点 : true）——展示统计沿用', () => {
  assert.equal(Core.enduranceZoneSetCount([{ weightKg: 30, reps: 12 }, { weightKg: 60, reps: 12 }, { weightKg: null, reps: 15 }], 50), 2);
  assert.equal(Core.enduranceZoneSetCount([{ weightKg: null, reps: 12 }, { weightKg: 80, reps: 11 }], null), 1); // 无锚点退化为仅次数
  assert.equal(Core.enduranceZoneSetCount([{ weightKg: 10, reps: 10 }], null), 0);
  assert.equal(Core.enduranceZoneSetCount([], 60), 0);
  assert.equal(Core.enduranceZoneSetCount(null, 60), 0);
});

test('enduranceScoreFromRatio：锚点映射 m=1（人群平均）→50，前陡后平，两端 clamp（§3.1）', () => {
  assert.equal(Core.enduranceScoreFromRatio(0), 0);
  assert.equal(Core.enduranceScoreFromRatio(0.5), 20);
  assert.equal(Core.enduranceScoreFromRatio(1), 50);
  assert.equal(Core.enduranceScoreFromRatio(1.5), 75);
  assert.equal(Core.enduranceScoreFromRatio(2), 92);
  assert.equal(Core.enduranceScoreFromRatio(2.5), 100);
  assert.equal(Core.enduranceScoreFromRatio(3), 100);  // 上端 clamp
  assert.equal(Core.enduranceScoreFromRatio(-1), 0);   // m<0 → 0
  assert.equal(Core.enduranceScoreFromRatio(1.25), 63); // 段内线性 62.5 → 四舍五入
});

test('scoreFromAnchors：段内线性插值与两端 clamp', () => {
  const curve = [[0, 0], [10, 100]];
  assert.equal(Core.scoreFromAnchors(curve, 5), 50);
  assert.equal(Core.scoreFromAnchors(curve, -3), 0);    // 下端 clamp
  assert.equal(Core.scoreFromAnchors(curve, 15), 100);  // 上端 clamp
  const gapped = [[0, 0], [8, 35], [15, 50]];
  assert.equal(Core.scoreFromAnchors(gapped, 8), 35);
  assert.equal(Core.scoreFromAnchors(gapped, 4), 17.5); // 非均匀段内插值
});

test('normCurveFor：性别三态（男/女直取；未填取男/女锚点逐点中值合并档；单侧缺表 → null）', () => {
  const norms = Core.ENDURANCE_CONFIG.REP_NORMS;
  assert.equal(Core.normCurveFor(norms.俯卧撑, '男'), norms.俯卧撑.male);
  assert.equal(Core.normCurveFor(norms.俯卧撑, '女'), norms.俯卧撑.female);
  assert.deepEqual(Core.normCurveFor(norms.俯卧撑, ''), [
    [0, 0], [4.5, 0], [12.5, 20], [17.5, 35], [22.5, 45], [28, 60], [39.5, 75], [51, 90], [66, 100]
  ]);
  assert.equal(Core.normCurveFor(norms.仰卧起坐, '男'), null); // 男无表 → 不命中 L2
  assert.equal(Core.normCurveFor(norms.仰卧起坐, ''), null);   // 合并档需两侧齐备 → 回退 L4
  assert.equal(Core.normCurveFor(norms.仰卧起坐, '女'), norms.仰卧起坐.female);
});

test('bodyweightFamilyOf：关键词匹配（跪姿先于俯卧撑），未命中返回 null（§3.3）', () => {
  assert.deepEqual(Core.bodyweightFamilyOf('跪姿俯卧撑'), { coef: 0.49, curveKey: 'low' });
  assert.deepEqual(Core.bodyweightFamilyOf('俯卧撑'), { coef: 0.64, curveKey: 'mid' });
  assert.deepEqual(Core.bodyweightFamilyOf('引体向上'), { coef: 1.0, curveKey: 'high' });
  assert.deepEqual(Core.bodyweightFamilyOf('悬垂举腿'), { coef: 1.0, curveKey: 'high' });
  assert.deepEqual(Core.bodyweightFamilyOf('双杠臂屈伸'), { coef: 0.7, curveKey: 'mid' });
  assert.equal(Core.bodyweightFamilyOf('卧推'), null);
});

test('genericRepsScore：L4 通用宽档（15 次 → 50 宽档中心，两端 clamp）', () => {
  assert.equal(Core.genericRepsScore(15), 50);
  assert.equal(Core.genericRepsScore(3), 20);
  assert.equal(Core.genericRepsScore(8), 35);
  assert.equal(Core.genericRepsScore(65), 100);
  assert.equal(Core.genericRepsScore(1), 20);   // 下端 clamp
  assert.equal(Core.genericRepsScore(100), 100);
});

test('scoreEnduranceSet 路径裁决：pct 受理域内 → L1；出域/无锚负重 → L4；自重家族 → L3（§3.5/§8.1）', () => {
  // 35@60kg、锚点 60：pct 0.583 ∈ [0.40, 0.833]，预测 21 次 → 比值 0.714 → 33 分
  assert.deepEqual(Core.scoreEnduranceSet({ weightKg: 35, reps: 15 }, 60, MALE),
    { score: 33, path: 'L1', pct: 0.583, ratio: 0.714 });
  // 有锚但 pct 出域（15@70 vs 锚点 62.1 → pct 1.127）→ L4 次数宽档，不冒充 L1
  const outOfDomain = Core.scoreEnduranceSet({ weightKg: 70, reps: 15 }, 62.1, MALE);
  assert.equal(outOfDomain.path, 'L4');
  assert.equal(outOfDomain.score, 50);
  // 无锚负重 → L4
  const noAnchor = Core.scoreEnduranceSet({ weightKg: 40, reps: 12, actionName: '卧推' }, null, MALE);
  assert.equal(noAnchor.path, 'L4');
  assert.equal(noAnchor.score, 44);
  // 自重（weightKg null）+ 家族命中 → L3 中负荷档：50 + (20-18)/12×25 = 54.2
  const dip = Core.scoreEnduranceSet({ weightKg: null, reps: 20, actionName: '双杠臂屈伸' }, null, MALE);
  assert.equal(dip.path, 'L3');
  assert.equal(dip.score, 54);
  // 非正次数 / 空组 → null
  assert.equal(Core.scoreEnduranceSet({ weightKg: 40, reps: 0 }, 60, MALE), null);
  assert.equal(Core.scoreEnduranceSet(null, 60, MALE), null);
});

test('scoreEnduranceAction：动作内取最佳单组（峰值，不取 top-2 均值），degraded 随最佳组来源（§4.1）', () => {
  // 最佳单组：男 30 次（L2 45）压过 12 次（L2 7）；最佳组来自均值候选 → degraded=true
  const pushup = Core.scoreEnduranceAction({
    actionName: '俯卧撑',
    candidates: [
      { weightKg: null, reps: 12, degraded: false },
      { weightKg: null, reps: 30, degraded: true }
    ]
  }, null, MALE);
  assert.deepEqual(pushup, { score: 45, path: 'L2', degraded: true, bestSet: { weightKg: null, reps: 30 } });
  // L1：有锚点时受理组逐组计分取最佳（8@40 pct 0.805 → 57 压过 12@35 的 45；锚点 49.7）
  const bench = Core.scoreEnduranceAction({
    actionName: '卧推',
    candidates: [
      { weightKg: 40, reps: 8, degraded: false },
      { weightKg: 35, reps: 12, degraded: false }
    ]
  }, 49.7, MALE);
  assert.deepEqual(bench, { score: 57, path: 'L1', degraded: false, bestSet: { weightKg: 40, reps: 8 } });
  // 无已知次数 → null
  assert.equal(Core.scoreEnduranceAction({ actionName: '卧推', candidates: [] }, null, MALE), null);
  assert.equal(Core.scoreEnduranceAction({ actionName: '卧推', candidates: [{ weightKg: 40, reps: 0 }] }, null, MALE), null);
});

test('首日单次录入即有绝对分（v2 验收①）：男 30 次俯卧撑 → 中等带；未填性别 → 合并档 + limited', () => {
  const male = Core.buildMuscleProgress([obs(DAY, '俯卧撑', 1, '30', '')], DAY, MALE).find((m) => m.key === 'chest');
  assert.equal(male.endurancePath, 'L2');
  assert.equal(male.enduranceBestAction, '俯卧撑');
  assert.ok(male.enduranceScore >= 45 && male.enduranceScore <= 59, `中等带 45-59，实际 ${male.enduranceScore}`);
  assert.equal(male.enduranceScore, 45); // 男 20-29：30 次 = 中等档下限锚点
  assert.equal(male.enduranceChangePercent, null); // 首窗无配对
  const merged = Core.buildMuscleProgress([obs(DAY, '俯卧撑', 1, '30', '')], DAY).find((m) => m.key === 'chest');
  assert.equal(merged.enduranceScore, 63); // 合并宽松档（男/女锚点中值）30 次 ≈ 62.6
  assert.equal(merged.endurancePath, 'L2');
  assert.equal(merged.confidence, 'limited'); // 合并档 + 峰值 L2 → 封顶 limited
});

test('峰值取最优（v2 验收②）：同肌群俯卧撑（L2 高分）压过卧推（L1 低分）', () => {
  const rows = [obs(DAY, '俯卧撑', 1, '50', ''), obs(DAY, '卧推', 1, '10', '40kg')];
  const chest = Core.buildMuscleProgress(rows, DAY, MALE).find((m) => m.key === 'chest');
  assert.equal(chest.enduranceScore, 83); // 男 50 次：75 + 5/9×15 = 83.3
  assert.equal(chest.enduranceBestAction, '俯卧撑');
  assert.equal(chest.endurancePath, 'L2');
  /* 卧推 10@40：锚点 53.3（10 次 Brzycki/Epley 均值），pct 0.750 在受理域 → 比值 1.0 → 50 分 */
  const triceps = Core.buildMuscleProgress(rows, DAY, MALE).find((m) => m.key === 'triceps');
  assert.equal(triceps.enduranceBestAction, '俯卧撑'); // 俯卧撑对三头同值进候选（mw 不打折，§5.1）
  assert.equal(triceps.enduranceScore, 83);
});

test('两窗口卧推（v2 重写）：L1 绝对分非基线、比值趋势 chip 为正、峰值元数据齐全（§11.1）', () => {
  const rows = [];
  for (const date of ['2026-08-05', '2026-08-08']) {
    rows.push(obs(date, '卧推', 1, '7', '50kg'), obs(date, '卧推', 1, '15', '35kg')); // 7@50 → 锚点 60
  }
  for (const date of ['2026-09-01', '2026-09-05', '2026-09-08', '2026-09-11']) {
    rows.push(obs(date, '卧推', 1, '7', '50kg'), obs(date, '卧推', 1, '18', '35kg'));
  }
  const chest = Core.buildMuscleProgress(rows, DAY, MALE).find((m) => m.key === 'chest');
  assert.equal(chest.endurancePath, 'L1');
  assert.equal(chest.enduranceBestAction, '卧推');
  /* 18@35：pct 0.583 → 预测 21 次 → 比值 0.857 → 41 分（7@50 pct 0.8333 出受理域，不参与 L1） */
  assert.equal(chest.enduranceScore, 41);
  assert.ok(chest.enduranceChangePercent > 0); // 比值 0.714 → 0.857，约 +20%（chip 走比值趋势）
  assert.equal(chest.enduranceChangePercent, 20);
  assert.equal(chest.fatigueRetentionPercent, null); // 单组汇总记录无保持率样本
  assert.equal(chest.confidence, 'good'); // L1 不受合并档下调；近 4 天/前 2 天 + 配对 1
});

test('L1 受理域边界（§12 重写 pct>1 用例）：锚点组在域内同样参与；全部出域 → 走 L4 宽档（§3.5）', () => {
  /* 验收③：8@40 为锚点（49.7）且自身 pct 0.805 在受理域内 → 参与：57 分压过 12@35 的 45 分 */
  const within = Core.buildMuscleProgress(
    [obs('2026-09-10', '卧推', 1, '8', '40kg'), obs('2026-09-11', '卧推', 1, '12', '35kg')], DAY, MALE
  ).find((m) => m.key === 'chest');
  assert.equal(within.enduranceScore, 57);
  assert.equal(within.endurancePath, 'L1');
  assert.equal(within.enduranceBestAction, '卧推');
  /* 6@40（锚点 46.5，自身 pct 0.860 出域）+ 15@50（pct 1.075 出域）→ 无受理组 → L4 次数宽档 */
  const outside = Core.buildMuscleProgress(
    [obs('2026-09-10', '卧推', 1, '6', '40kg'), obs('2026-09-11', '卧推', 1, '15', '50kg')], DAY, MALE
  ).find((m) => m.key === 'chest');
  assert.equal(outside.enduranceScore, 50); // L4：15 次 = 宽档中心 50
  assert.equal(outside.endurancePath, 'L4');
  assert.equal(outside.enduranceChangePercent, null); // 无可比对
  assert.equal(outside.enduranceZoneSharePercent, 0); // 15@50 的 pct 1.075 > 0.67 不落带（展示统计）
});

test('>30 次的组（§12 重写）：不入 L1；无锚时按 L4 宽档曲线照常计分', () => {
  const alone = Core.buildMuscleProgress([obs('2026-09-10', '卧推', 1, '35', '20kg')], DAY, MALE).find((m) => m.key === 'chest');
  assert.equal(alone.enduranceScore, 82);  // L4 曲线 35 次锚点值
  assert.equal(alone.endurancePath, 'L4');
  const mixed = Core.buildMuscleProgress(
    [obs('2026-09-10', '卧推', 1, '8', '50kg'), obs('2026-09-11', '卧推', 1, '35', '20kg')], DAY, MALE
  ).find((m) => m.key === 'chest');
  assert.equal(mixed.enduranceScore, 57); // 8@50 pct 0.805 在域内 → L1；35@20 不入 L1（>30 次）
  assert.equal(mixed.endurancePath, 'L1');
  assert.equal(mixed.enduranceBestAction, '卧推');
});

test('纯自重高次（v2 重写）：首窗无历史即得常模绝对分，overall 走 0.5/0.3/0.2 分支（§11.1）', () => {
  const chest = Core.buildMuscleProgress([obs(DAY, '俯卧撑', 4, '15', '')], DAY).find((m) => m.key === 'chest');
  assert.equal(chest.strengthScore, null);
  assert.equal(chest.enduranceScore, 28); // 合并档（未填性别）：15 次 ≈ 27.5 → 28
  assert.equal(chest.endurancePath, 'L2');
  assert.equal(chest.enduranceBestAction, '俯卧撑');
  /* 综合分关系式按 ±1 舍入容差断言（引擎内部频率未取整 12.5，输出字段取整为 13） */
  const expectedOverall = 0.5 * chest.hypertrophyScore + 0.3 * chest.enduranceScore + 0.2 * chest.frequencyScore;
  assert.ok(Math.abs(chest.overallScore - expectedOverall) <= 1);
});

test('近窗完全未记次数：动作无候选 → 三个耐力字段全 null，overall 维持 0.85/0.15（§12）', () => {
  const chest = Core.buildMuscleProgress([obs('2026-09-10', '卧推', 4, '', '40kg')], DAY, MALE).find((m) => m.key === 'chest');
  assert.equal(chest.enduranceScore, null);
  assert.equal(chest.endurancePath, null);
  assert.equal(chest.enduranceBestAction, null);
  assert.equal(chest.strengthScore, null);
  assert.equal(chest.overallScore, Math.round(0.85 * chest.hypertrophyScore + 0.15 * chest.frequencyScore));
});

test('单动作单路径（原「缺项归一」重写）：汇总均值组走 L4；展示统计字段 null 语义不变（§11.1）', () => {
  const chest = Core.buildMuscleProgress([obs('2026-09-10', '卧推', 3, '15', '35kg')], DAY).find((m) => m.key === 'chest');
  assert.equal(chest.enduranceScore, 50); // 无锚 → L4：15 次 = 宽档中心
  assert.equal(chest.endurancePath, 'L4');
  assert.equal(chest.enduranceBestAction, '卧推');
  assert.equal(chest.enduranceChangePercent, null);
  assert.equal(chest.repVolumeChangePercent, null); // 前窗无基线
  assert.equal(chest.fatigueRetentionPercent, null); // 「15」×3 组是复制，非逐组
  assert.equal(chest.enduranceZoneSharePercent, 100); // 15 次 ≥12 且无锚点 → 全部落带（展示统计口径不变）
  /* 汇总文本可解析逐组序列 → 按序列最佳组计分且不降级（§4.1，直接验证 scoreEnduranceAction） */
  const seq = Core.scoreEnduranceAction({
    actionName: '双杠臂屈伸',
    candidates: [{ weightKg: null, reps: 18, degraded: false }, { weightKg: null, reps: 10, degraded: false }]
  }, null, MALE);
  assert.deepEqual(seq, { score: 50, path: 'L3', degraded: false, bestSet: { weightKg: null, reps: 18 } });
});

test('L2 常模家族分性别取档：仰卧起坐女表/男走 L4；引体占位表（§3.2/§3.4）', () => {
  const female = Core.buildMuscleProgress([obs(DAY, '仰卧起坐', 1, '26', '', '核心日')], DAY, { sex: '女', age: 20 }).find((m) => m.key === 'core');
  assert.equal(female.enduranceScore, 60); // 中国标准：26 次 = 60 分锚点
  assert.equal(female.endurancePath, 'L2');
  const maleSitup = Core.buildMuscleProgress([obs(DAY, '仰卧起坐', 1, '26', '', '核心日')], DAY, MALE).find((m) => m.key === 'core');
  assert.equal(maleSitup.endurancePath, 'L4'); // 男无可靠表 → 走宽档，不挪用女表冒充
  assert.equal(maleSitup.enduranceScore, 69);  // L4：26 次 → 68 + 1/10×14 = 69.4
  const pullup = Core.buildMuscleProgress([obs(DAY, '引体向上', 1, '10', '')], DAY, MALE).find((m) => m.key === 'back');
  assert.equal(pullup.enduranceScore, 59); // [C·占位] 男表：10 次 → 59
  assert.equal(pullup.endurancePath, 'L2');
});

test('趋势 chip 的绝对分差回退（§6.2）：无比值配对时用峰值动作同路径分差，clamp ±50', () => {
  const build = (recentReps, previousReps) => {
    const rows = [];
    for (const date of ['2026-08-05', '2026-08-08']) rows.push(obs(date, '俯卧撑', 1, previousReps, ''));
    for (const date of ['2026-09-01', '2026-09-05', '2026-09-08', '2026-09-11']) rows.push(obs(date, '俯卧撑', 1, recentReps, ''));
    return Core.buildMuscleProgress(rows, DAY, MALE).find((m) => m.key === 'chest');
  };
  const normal = build('30', '25');
  assert.equal(normal.enduranceScore, 45);           // 男 30 次 → 45
  assert.equal(normal.enduranceChangePercent, 28.6); // (45−35)/35 = +28.57%，L2 同路径分差回退（chip 保留 1 位小数）
  const capped = build('54', '20');
  assert.equal(capped.enduranceChangePercent, 50);   // (90−20)/20 → clamp +50
});

test('置信度唯一下调（§5.3）：峰值走合并档 L2 时封顶 limited；性别已知或峰值 L1 不受影响', () => {
  const rows = [];
  for (const date of ['2026-08-05', '2026-08-08']) rows.push(obs(date, '卧推', 1, '7', '50kg'), obs(date, '卧推', 1, '15', '35kg'));
  for (const date of ['2026-09-01', '2026-09-05', '2026-09-08', '2026-09-11']) {
    rows.push(obs(date, '卧推', 1, '7', '50kg'), obs(date, '卧推', 1, '18', '35kg'), obs(date, '俯卧撑', 1, '50', ''));
  }
  const merged = Core.buildMuscleProgress(rows, DAY).find((m) => m.key === 'chest'); // 未填性别 → 合并档
  assert.equal(merged.enduranceBestAction, '俯卧撑'); // 合并档 50 次 ≈ 89 > 卧推 41
  assert.equal(merged.endurancePath, 'L2');
  assert.equal(merged.confidence, 'limited'); // 基础规则本可达 good（4 天/2 天/配对 1），合并档封顶 limited
  const male = Core.buildMuscleProgress(rows, DAY, MALE).find((m) => m.key === 'chest');
  assert.equal(male.confidence, 'good'); // 性别已知 → 不下调
  /* 峰值 L1（个体锚点）即使用合并档（sex 缺省）也不下调 */
  const l1Rows = [];
  for (const date of ['2026-08-05', '2026-08-08']) l1Rows.push(obs(date, '卧推', 1, '7', '50kg'), obs(date, '卧推', 1, '15', '35kg'));
  for (const date of ['2026-09-01', '2026-09-05', '2026-09-08', '2026-09-11']) l1Rows.push(obs(date, '卧推', 1, '7', '50kg'), obs(date, '卧推', 1, '18', '35kg'));
  assert.equal(Core.buildMuscleProgress(l1Rows, DAY).find((m) => m.key === 'chest').confidence, 'good');
});

test('峰值并列仲裁（§5.2）：同分先比路径（L1>L2>L3>L4），再比最佳组次数，最后动作名升序', () => {
  /* 卧推 10@40 → L1 50 分；哑铃飞鸟 15 次@10kg（无锚负重 → L4）也是 50 分 → 路径高者胜出 */
  const rows = [obs(DAY, '卧推', 1, '10', '40kg'), obs(DAY, '哑铃飞鸟', 1, '15', '10kg')];
  const chest = Core.buildMuscleProgress(rows, DAY, MALE).find((m) => m.key === 'chest');
  assert.equal(chest.enduranceScore, 50);
  assert.equal(chest.enduranceBestAction, '卧推');
  assert.equal(chest.endurancePath, 'L1');
  /* 同分同路径同次数 → 动作名升序：跪姿俯卧撑与俯卧撑同走俯卧撑常模，30 次同分 → 「俯卧撑」在前 */
  const tie = [obs(DAY, '跪姿俯卧撑', 1, '30', ''), obs(DAY, '俯卧撑', 1, '30', '')];
  assert.equal(Core.buildMuscleProgress(tie, DAY, MALE).find((m) => m.key === 'chest').enduranceBestAction, '俯卧撑');
});

test('单组与区间写法不产生保持率样本（展示统计 null 语义不变）', () => {
  const rows = [obs('2026-09-10', '卧推', 1, '12', '30kg'), obs('2026-09-11', '弹力带划船', 3, '10-12', '20kg')];
  const result = Core.buildMuscleProgress(rows, DAY);
  assert.equal(result.find((m) => m.key === 'chest').fatigueRetentionPercent, null);
  assert.equal(result.find((m) => m.key === 'back').fatigueRetentionPercent, null);
  assert.ok(result.find((m) => m.key === 'back').enduranceScore !== null); // 均值组照常计分（L1：pct 0.749 在受理域）
});

test('逐组记录端到端：setLoads 观测字段、保持率样本按窗平均、汇总记录 setLoads 为 null', () => {
  const state = Core.normalize({});
  const now = new Date('2026-09-12T02:00:00.000Z');
  const tpl = Core.replaceTemplate(state, {
    name: '推日模板', days: [{ dayKey: 'd1', name: '推日', actions: [{ name: '卧推', plannedSets: 4, plannedRepsText: '10' }] }]
  }, now);
  assert.ok(tpl.ok, tpl.error);
  Core.startTraining(state, { date: '2026-09-10' }, now);
  Core.saveTraining(state, { date: '2026-09-10', actions: [{ actionKey: 'act-1-1', sets: [
    { reps: 10, weightKg: 60, done: true },
    { reps: 10, weightKg: 60, done: true },
    { reps: 8, weightKg: 55, done: true },
    { reps: 8, weightKg: 55, done: false } // 未完成组不进 setLoads
  ] }] }, now);
  Core.startTraining(state, { date: '2026-09-11' }, now);
  Core.saveTraining(state, { date: '2026-09-11', actions: [{ actionKey: 'act-1-1', setsDone: 3, repsText: '12, 10, 8', weightKg: 40 }] }, now);

  const observations = Core.collectObservations(state, '2026-09-12');
  assert.deepEqual(observations[0].setLoads, [
    { weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }, { weightKg: 55, reps: 8 }
  ]);
  assert.equal(observations[1].setLoads, null); // 汇总记录 → null

  const chest = Core.muscleProgress(state, '2026-09-12').find((m) => m.key === 'chest');
  assert.equal(chest.fatigueRetentionPercent, 82.5); // mean(0.9, 0.75)：逐组样本 + 文本逐组列表样本（展示统计不变）
  /* L1：锚点 = top-2 e1RM 均值 (80+53.3)/2 = 66.65；55@8 pct 0.825 在域内 → 比值 8/6 → 67 分 */
  assert.equal(chest.enduranceScore, 67);
  assert.equal(chest.endurancePath, 'L1');
  assert.equal(chest.enduranceBestAction, '卧推');
  assert.equal(chest.enduranceChangePercent, null); // 无前窗

  const snap = Core.trendsSnapshot(state, '2026-09-12', 4);
  assert.equal(snap.muscleProgress.find((m) => m.key === 'chest').fatigueRetentionPercent, 82.5);
  assert.equal(snap.muscleProgress.find((m) => m.key === 'chest').endurancePath, 'L1'); // 快照链路同口径
});

test('自重记 0 不冒充 L1 相对负荷：有锚点也走自重家族档，与留空同分', () => {
  const bw = Core.scoreEnduranceSet({ reps: 20, weightKg: 0, actionName: '俯卧撑' }, 100, MALE);
  assert.equal(bw.path, 'L3');
  const blank = Core.scoreEnduranceSet({ reps: 20, weightKg: null, actionName: '俯卧撑' }, 100, MALE);
  assert.deepEqual({ score: bw.score, path: bw.path }, { score: blank.score, path: blank.path });
  const loaded = Core.scoreEnduranceSet({ reps: 20, weightKg: 50, actionName: '俯卧撑' }, 100, MALE);
  assert.equal(loaded.path, 'L1');
  assert.equal(loaded.pct, 0.5); // 只有真实负重才进相对负荷腿
});
