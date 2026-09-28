# 肌肉耐力评分设计（v2）

> **版本说明**：v2（2026-09-25）：绝对常模分 + 峰值取最优。
> 相对 v1 的根本变化：耐力分从「相对自身趋势的比值分」改为「绝对 0–100 常模分」，录入任何一次「次数（+重量）」当天即有分，不依赖历史趋势；肌群分 = 各动作分的**最高值**（峰值），容量/组数累加彻底退出耐力合成；趋势降级为独立 chip 字段（enduranceChangePercent），不进分数。
> 实现位置不变：`strength-core.js` 纯函数；下游消费 `progress-visual.js` / `strength.js` 字段名不变。
> 证据基础：`docs/endurance-norms-research.md`（常模表）、`docs/endurance-scoring-conventions-research.md`（积分制惯例）、`docs/endurance-v2-impact-audit.md`（现状审计）。层级口径：**[A] 文献原值 / [B] 文献带内取值 / [C] 设计决策**。

## 0. 决策表（v2 定稿结论一览）

| # | 决策 | 结论 | 层级 |
| --- | --- | --- | --- |
| 1 | 分数语义 | 绝对水平分：单次表现对照动作常模/标准 → 0–100，首窗即有效 | [C]（结构借军队计分制 [A/B]） |
| 2 | 肌群合成 | max(动作分)，峰值代表肌群；辅助肌群权重 mw **不**打折动作分 | [C]（惯例依据：1RM/举重取最佳试举 [A]） |
| 3 | 动作得分路径 | L1 锚点相对负荷 → L2 动作常模表 → L3 家族负荷档曲线 → L4 通用宽档 | [C] |
| 4 | 动作内取最优 | 取**最佳单组**得分（不取 top-2 均值） | [C] |
| 5 | 抗疲劳保持率 | 退出合成、不做修正项；字段保留为展示统计 | [C] |
| 6 | 耐力带占比 | 退出合成；字段保留为展示统计 | [C] |
| 7 | 容量（repVolume） | 退出合成；`repVolumeChangePercent` 保留为信息字段 | [C] |
| 8 | 趋势 chip | `enduranceChangePercent` 独立字段：峰值动作的比值趋势（优先）或绝对分差（回退） | [C] |
| 9 | 性别/年龄 | 取 `bmiProfile.sex/age`；缺省用「性别合并宽松档 + 20–29 岁」 | [C]（常模切点 [A/B]） |
| 10 | 体重 | **v2 不消费**（reps 曲线计分不需要用户体重；与审计 §3.3 的预期不同，见 §2.4） | [C] |
| 11 | overallScore | 四分支公式一字不动，绝对耐力分替换原耐力因子位 | [C] |
| 12 | confidence 规则 | 与 v1 完全一致（pairedActions + 有数据天数），路径等级改由新字段 `endurancePath` 表达 | [C] |

## 1. 设计目标与背景

用户要求（原话转译）：①「从不练一开始就有参数、有积分、知道自己肌肉耐力分数」；②「不是累加，取最高值——俯卧撑能做 50 个，就用俯卧撑评价胸部，而不是跟卧推 10 次平均」。

v1 的两个结构性缺陷（审计 §1.4）：四因子中 65% 权重的趋势腿在无前窗时给 50 基线，新手首窗分数无意义；容量/趋势全部肌群级累加，多动作互相稀释。v2 以「绝对常模分 + 峰值合成」替换整层语义。

积分制惯例依据（`endurance-scoring-conventions-research.md`）：评「能力」用峰值（NSCA/ACSM 1RM 取最好一次成功试举、举重三试举取最佳 [A]）、追「训练量」才累加；「单次表现 → 0–100」的成熟结构为军队分段计分表（60 分起步锚点、前陡后平 [A/B]）与 Strength Level 五档标准带（单一输入查表即定级 [B]）。v2 采用「**五档标准带为骨、分段线性计分表为形**」：各动作各建常模/曲线、共用同一 0–100 刻度实现跨动作可比（百分位归一思路 [B]）。

## 2. 证据基础与来源

### 2.1 可用常模表（详见 norms-research）

| 表 | 覆盖 | 层级 | 用途 |
| --- | --- | --- | --- |
| Golding/YMCA 俯卧撑七档 | 男/女 × 20-29~60-69 | [B·上线前须人工复核原文] | L2 俯卧撑 |
| FitnessGram 俯卧撑健康区间 | 男 20-29：20–40；女：10–25 | [A·直抓] | 交叉校验，不作直接参数 |
| ACSM 部分卷腹五档 | 男/女 20-29 | [B·需复核] | L2 卷腹 |
| 中国标准女生仰卧起坐 | 60 分=26 次…100 分=56 次（大一大二） | [B·较可信] | L2 仰卧起坐（女） |
| 引体百分位表 | 男/女 | **[C·低置信占位]**（来源 URL 未能定位） | L2 引体 |
| AFT 计分结构 | 60 分单项底线、每项 0–100 | [A/B] | 只借结构，不借切点 |
| Ebben 2011 自重有效负荷 | 标准俯卧撑 ≈64%BW、跪姿 ≈49%BW | [B] | L3 家族分档 |

### 2.2 检索缺口（如实声明）

APFT 逐行计分表、YMCA 卧推百分位表、ACSM 卷腹 20-29 以外年龄段、中国标准引体表（两版矛盾）、双杠/臀桥 %BW 文献值均**未检索到**。缺口处一律 [C] 取值并在 `docs/scoring-parameters.md` 登记，不虚构文献结论。

### 2.3 常模表入库约束

norms-research 的硬约束有效：标 [B] 的表（俯卧撑 Golding、ACSM 卷腹、中国仰卧起坐）**上线前须人工打开来源原文复核一次**；复核前以 [B] 身份入库但源码注释标注「待复核」。引体表按 [C] 占位处理。

### 2.4 与审计的一处分歧：体重不进 v2

审计 §3.3 建议 L2 用「体重 × 自重系数」折算有效负荷。定稿时否决：把有效负荷换算成 %1RM 需要「该动作对该用户人群的 1RM 常模」（Strength Level 式数据），本应用没有该资产；用 Epley 正推会陷入循环恒等（有效负荷 × (1+次数/30) 反推的 %1RM 恒使比值 =1）。**reps 曲线计分只需要「动作家族的负荷档」**（俯卧撑级/引体级），它是动作属性而非用户属性——因此 `bmiProfile.weightKg` 在 v2 耐力中不消费，只有 `sex/age` 参与（性别×年龄选常模表列）。UI 中「基础数值参与耐力评分」的文案只提性别与年龄。

## 3. 动作得分路径（L1→L4 回退阶梯）

> 路径编号与审计 §3.3 不同（审计的「体重折算」被否决合并），以本节为准。

每条路径都是「单组表现 → 0–100」，动作分 = 该动作本窗内**最佳单组**的得分（§4.1）。

### 3.1 L1 负重动作：次数 × %1RM 分段线性映射（锚点相对负荷）

条件：该动作本窗存在锚点（≤10 次负重组的 top-2 e1RM，沿用 v1 `collapseTop2` 链路）且有负重的高次组。

- `pct = weightKg / anchorE1rmKg`，L1 受理域 **pct ∈ [0.40, 0.833]**：>0.833 的组接近 1RM（Epley 反解预测 <5 次，属力量区间、是锚点原料），<0.40 的组 Epley 反解系统性高估预测次数（文献已知，norms-research §2），两端都排除出 L1 计分；受理域外且无其他受理组的动作走 L4。
- 预测次数（人群在该 %1RM 下的平均力竭次数）：`r_pred = 30 × (1/pct − 1)` [A·Epley 反解]（沿用 `estimateEnduranceReps`）。
- 耐力倍数 `m = 实际次数 / r_pred`，**m=1 即人群平均 → 50 分**，分段线性（军队计分表形态、前陡后平）：

| m | 0 | 0.5 | 1.0 | 1.5 | 2.0 | 2.5 | >2.5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 分 | 0 | 20 | 50 | 75 | 92 | 100 | 100 |

`SCORE_RATIO_ANCHORS = [[0,0],[0.5,20],[1,50],[1.5,75],[2,92],[2.5,100]]`，段内线性、四舍五入取整。整体 [C]：形状参照 AFT「前 10 次每次约 6 分」的凸形结构，锚点无文献唯一解。

### 3.2 L2 动作常模表：经典测试动作 次数 → 性别×年龄分档

条件：动作名匹配常模表家族（关键词匹配，复用 `inferMuscleWeights` 的关键词思路）。**有表必走 L2（优先于 L1？否——L1 优先，见 §3.5 路径裁决）**。

- 档位 → 分数带（[C]，对齐现有 4 档 UI 的细分）：很差 0–15 / 差 20–34 / 中下 35–44 / 中等 45–59 / 中上 60–74 / 良好 75–89 / 优秀 90–100。
- 每档取「次数下限 → 分数带下限」为锚点做**段内线性插值**（档内次数连续，不跳档）；优秀档用「下限 →90，+15 次 →100」封顶。实现为通用转换器 `tierAnchorsToCurve(tierTable)`。
- `REP_NORMS` 初版入库表（次数为「单组最大次数」口径，自由速度 vs 节拍测试的口径差异如实标注）：
  - **俯卧撑**（Golding 20-29 [B·待复核]）：
    - 男：很差 8 / 差 20 / 中下 25 / 中等 30 / 中上 35 / 良好 45 / 优秀 54
    - 女：很差 1 / 差 5 / 中下 10 / 中等 15 / 中上 21 / 良好 34 / 优秀 48
  - **卷腹**（ACSM 20-29 [B·待复核]）：男 需改进≤16/一般 17/良好 26/很好 34/优秀 40 → 映射到 bands（需改进 0–15、一般 35–44? 不对——ACSM 五档直接对齐：需改进→0–15、一般→45–59、良好→75–89、很好→85–94? 简化：需改进 16→15 分锚、一般 17→35、良好 26→60、很好 34→80、优秀 40→92、+15 次→100。**实现按「锚点数组」直接给**：男 [[0,0],[16,15],[17,35],[26,60],[34,80],[40,92],[55,100]]，女 [[0,0],[14,15],[15,35],[23,60],[30,80],[36,92],[50,100]]（女切点 = ACSM 女 20-29：>35 优秀、30–35 很好、23–29 良好、15–22 一般、≤14 需改进 [B·待复核]）。
  - **仰卧起坐**：女用中国标准大一大二表 [B·较可信]：[[0,0],[25,55],[26,60],[36,65],[39,70],[42,75],[45,80],[48,85],[52,90],[56,100]]（60 分=26、逐行锚点）；男**无检索到可靠表** → 走 L4（不挪用卷腹表冒充）。
  - **引体向上**：百分位占位表 [C·低置信]：男 [[0,0],[2,15],[5,35],[8,45],[10,59],[12,75],[15,90],[20,100]]；女 [[0,0],[1,20],[2,45],[3,60],[5,75],[7,90],[10,100]]。源码注释必须保留「占位，来源未定位」。
- 性别：`bmiProfile.sex`（'男'/'女'/''）。缺省 **性别合并宽松档** = 男/女锚点逐点取中值（norms-research §9 方案 A，[C]），并使 confidence 封顶 limited（§5.3）。年龄缺省 20–29 [C]；其余年龄段本版不建表（缺口 §2.2），任何年龄都按 20–29 表处理并在源码注释声明。

### 3.3 L3 家族负荷档曲线：其余自重动作

条件：动作识别为自重家族（关键词命中 BW_COEF 表）但不匹配 L2 常模表。

- `BW_COEF`（有效负荷 %BW）：标准俯卧撑 0.64 [B·Ebben 2011]、跪姿俯卧撑 0.49 [B]、引体向上 1.0 [C·算术]、双杠臂屈伸 0.70 [C·设计初值，文献缺口]。变式匹配：动作名含「跪姿」→ 0.49 档；含「俯卧撑」→ 0.64 档；含「引体/悬垂」→ 1.0 档；含「双杠/臂屈伸」→ 0.70 档。
- 负荷档曲线（次数→分，锚点 [C]，形态对齐 L2：50 分≈对应家族人群平均）：
  - 高负荷档（coef ≥ 0.85，引体级）：[[1,25],[5,50],[10,75],[15,92],[20,100]]
  - 中负荷档（0.5–0.84，俯卧撑级）：[[5,25],[18,50],[30,75],[42,92],[55,100]]
  - 低负荷档（<0.5，跪姿级）：[[6,25],[25,50],[40,72],[55,88],[70,100]]
- **用户体重不参与**（§2.4）：coef 决定动作落在哪条曲线，与用户多重无关。

### 3.4 L4 通用宽档：无锚、无常模、无家族

条件：以上全部不命中（如未识别的器械动作且无锚点、仰卧起坐-男）。

- 通用曲线 `GENERIC_REPS_CURVE`（[C]）：[[3,20],[8,35],[15,50],[25,68],[35,82],[50,93],[65,100]]，段内线性。
- 语义如实：50 分 = 「普通成人单组 15 次左右」的宽档中心，只表达「这组做了多少次」，跨动作可比性最弱 → 置信度 limited（§5.3）。大重量低次数组在此曲线得低分是**正确语义**（耐力分测的就是耐力表现，力量型训练者耐力分低不是 bug）。

### 3.5 路径裁决（同一动作的优先级）

1. 有锚点且存在 pct ∈ [0.40, 0.833] 的受理组 → **L1**（受理组逐组计分；锚点组本身也在受理域内时同样参与——它展示的相对耐力同样有效）。
2. 否则命中 L2 常模家族 → **L2**。
3. 否则命中 BW_COEF 家族 → **L3**。
4. 否则有任何已知次数组 → **L4**。
5. 无任何已知次数（只记组数）→ 动作分 null，不进 max。

> L1 优先于 L2 的理由：俯卧撑在 L2 有表，但若用户给俯卧撑额外负重记录且同窗有锚点，L1 的个体化锚定优于人群表。路径整体按「信息量」排序：个体锚点 > 人群常模 > 家族曲线 > 宽档。

## 4. 动作内取最优与修正项

### 4.1 逐组 vs 均值：最佳单组

- 逐组记录（`setLoads`）：每组独立计分，动作分 = **最佳单组**得分（峰值原则的字面语义；top-2 均值会拉低峰值、且单组偶然性已由窗口聚合与置信度吸收）。
- 汇总记录（`setLoads = null`）：按均值组计分（`averageWeightKg × averageReps`），`degraded = true`——均值不可能超过真实最佳组，系统性低估如实标注（沿 v1 §5.7）；汇总文本可解析出逐组序列时（`perSetRepsFromText`），按序列最佳组计分、`degraded = false`。

### 4.2 抗疲劳保持率：退出合成（不做修正项）

设计期间否决了审计 §2.5 的「×(0.9+0.1×retention)」修正项：峰值原则下动作分取最佳组，组间衰减不改变峰值本身；修正项会引入「多组记录反而可能被扣分」的反直觉行为。`fatigueRetentionPercent` 字段保留 v1 计算（样本均值），定位为展示统计（「组间保持 x%」），不进分数。

### 4.3 「耐力带占比」处置结论

`enduranceZoneSharePercent` 退出合成、保留 v1 计算作为展示统计。L4 不设「≥12 次资格线」：通用曲线本身对低次数组给低分，资格线冗余。

## 5. 肌群耐力分 = max(动作分)

### 5.1 峰值合成

`muscleEndurance(period) = max over actions( actionScore )`。同一动作表现对每个命中肌群同值（双杠臂屈伸的同一组同时进三头与胸的候选），辅助权重 mw 不打折——峰值原则的字面语义（审计 §1.4 第 3 点采纳）。

### 5.2 并列与仲裁

同分动作的 tie-break 依次：① 路径信息量高者（L1 > L2 > L3 > L4）；② 贡献最佳组的次数多者（更能代表耐力容量）；③ 动作名升序（稳定性保证）。仲裁产出即 `enduranceBestAction`。

### 5.3 路径 → 置信度

`confidence` 字段整体规则**与 v1 完全一致**（有数据天数 + pairedActions），路径等级不并入 confidence（避免双重降级与测试面扩大），改由新字段 `endurancePath` 表达。唯一下调：**峰值动作的性别为缺省合并档时**（bmiProfile.sex 未填且峰值走 L2/L3），`confidence` 在原规则结果上封顶 'limited'（缺省假设必须可见，沿 rhythm-engine「缺省 + 披露」先例）。

## 6. 趋势 chip：enduranceChangePercent

对**峰值动作**（argmax）计算，肌群峰值换了代表，趋势自动跟随：

1. 优先：峰值动作近/前窗都有 L1 比值配对 → 比值跨窗变化率（复用 v1 `enduranceRatioByAction` + `weightedTrend`，仅限该动作；公式偏差跨窗抵消，统计上最干净）。
2. 回退：峰值动作近/前窗都有动作分（同路径）→ `(recentScore − previousScore) / previousScore × 100`，clamp ±50（分数封顶 100 后进步会饱和，如实允许 null）。
3. 都没有 → null。

## 7. overallScore 四分支的 v2 适配

公式一字不动（0.35/0.35/0.2/0.1 双数据；0.45/0.45/0.1 仅力量；0.5/0.3/0.2 仅耐力；0.85/0.15 双 null）。enduranceScore 仍为 0–100 整数、null 时机不变，分支无需感知口径变化。分数连续性见 §13。

## 8. API 契约

### 8.1 函数签名（全部纯函数，加入 module.exports）

```js
/* 比值 → 绝对分（L1），SCORE_RATIO_ANCHORS 分段线性 */
function enduranceScoreFromRatio(m)          // number → integer 0..100；m<0 → 0
/* 通用锚点曲线插值：anchors = [[x,y],...] 升序，段内线性、两端 clamp */
function scoreFromAnchors(anchors, x)        // (number, Array) → number
/* L2：常模表 → 曲线。norm = { male: anchors, female: anchors }（锚点已按 §3.2 展开为 [次数,分]），
   sex '男'→male、'女'→female、其他→mergedAnchors（逐点中值）；返回 curve 供 scoreFromAnchors 使用 */
function normCurveFor(norm, sex)             // (norm, string) → Array<[number, number]>
/* 动作名 → 自重家族：{ coef, curveKey } | null（关键词匹配 §3.3） */
function bodyweightFamilyOf(actionName)      // string → object|null
/* L4 通用宽档 */
function genericRepsScore(reps)              // number → integer
/* 单组计分主入口 */
function scoreEnduranceSet({ weightKg, reps }, anchorE1rmKg, profile)
// → { score, path: 'L1'|'L3'|'L4', pct?, ratio? } | null（reps 非正数 → null）
//   L1：weightKg>0 且 anchor>0 且 pct ∈ [0.40,0.833] → enduranceScoreFromRatio(reps/estimateEnduranceReps(pct))
//   否则 bodyweightFamilyOf（weightKg 为 null/0）→ L3 曲线；否则 L4
//   注：weightKg>0 但无锚/pct 出域 → 直接走 L4（次数宽档），不冒充 L1
/* 动作计分（本窗） */
function scoreEnduranceAction(actionStats, anchorE1rmKg, profile)
// actionStats = { setLoads: Array|null, sets, repsText, weightText, exactMetrics?, summary }
// → { score, path, degraded, bestSet: {weightKg|null, reps} } | null（无已知次数 → null）
//   setLoads 逐组计分取最佳；否则 perSetRepsFromText 可解析 → 序列逐组（degraded=false）；
//   否则均值组（degraded=true）
```

`buildMuscleProgress(observations, asOfDate, profile?)` —— **扩第三可选参** `profile = { sex, age }`（来自 `state.bmiProfile`，只在 muscleProgress/trendsSnapshot 两个调用点传入）；缺省 `{ sex: '', age: null }`，既有两参调用完全兼容。

### 8.2 ENDURANCE_CONFIG v2 常量表

```js
const ENDURANCE_CONFIG = {
  /* —— v1 保留（趋势 chip 与展示统计链路继续用）—— */
  ANCHOR_MAX_REPS: 10,       // [A] LeSuer 1997：锚点只取 ≤10 次的组
  RATIO_REP_MIN: 11,         // [C] L1 受理组下限（与趋势 chip 口径一致）
  RATIO_REP_MAX: 30,
  EPLEY_REP_CONSTANT: 30,    // [A] Epley 反解
  ZONE_REP_MIN: 12,          // [A] ACSM 耐力带（展示统计用）
  ZONE_LOAD_MAX_PCT: 0.67,
  FATIGUE_MIN_SETS: 2,       // 展示统计：保持率最少组数
  /* —— v2 新增 —— */
  L1_PCT_MIN: 0.4,           // [C] L1 受理域下界（Epley 反解轻负荷端失真）
  L1_PCT_MAX: 0.833,         // [C] L1 受理域上界（r_pred ≥ 5）
  SCORE_RATIO_ANCHORS: [[0, 0], [0.5, 20], [1, 50], [1.5, 75], [2, 92], [2.5, 100]],  // [C]
  AGE_BAND_DEFAULT: '20-29', // [C] 年龄缺省档（本版唯一档）
  REP_NORMS: { /* §3.2 各家族：{ male: anchors, female: anchors }，层级注释逐条保留 */ },
  BW_COEF: { /* §3.3：俯卧撑 0.64 / 跪姿俯卧撑 0.49 / 引体 1.0 / 双杠 0.70 */ },
  FAMILY_CURVES: { high: [...], mid: [...], low: [...] },  // [C] §3.3
  GENERIC_REPS_CURVE: [[3,20],[8,35],[15,50],[25,68],[35,82],[50,93],[65,100]]  // [C]
};
```

（WEIGHTS 键**删除**——四因子合成不复存在；test-muscle-endurance 的 CONFIG deepEqual 同步重写。）

### 8.3 buildMuscleProgress 输出字段语义（5 字段去留）

| 字段 | v2 语义 | null 时机 |
| --- | --- | --- |
| `enduranceScore` | **绝对水平分**：recent 窗峰值动作分 | ⟺ 近窗无任何已知次数组（与 v1 判据一致：repVolume=0） |
| `enduranceChangePercent` | 峰值动作趋势（§6） | 峰值动作无近/前窗可配对 → null（首窗必 null） |
| `repVolumeChangePercent` | 展示统计，v1 计算不变 | 前窗 repVolume = 0 |
| `fatigueRetentionPercent` | 展示统计，v1 计算不变 | 近窗无有效样本 |
| `enduranceZoneSharePercent` | 展示统计，v1 计算不变 | 近窗无已知次数组 |
| `enduranceBestAction`（新增） | 峰值动作名 | 同 enduranceScore |
| `endurancePath`（新增） | 'L1'/'L2'/'L3'/'L4' | 同 enduranceScore |

## 9. 管线伪代码（v2 全景）

```text
第一遍（v1 core 946-1002 结构保留）：观测 × 肌群 → windows[muscle][period].enduranceByAction[action]
  暂存 setLoads / 汇总文本；repVolume、fatigueSamples、zones 照旧累计（展示统计用）
  锚点照旧：collapseTop2(≤10 次负重组 e1rmByAction)

第二遍（重写 v1 core 1005-1033）：
for muscle, period:
  for action, stats in enduranceByAction:
    actionScore = scoreEnduranceAction(stats, anchorE1rm[period].get(action), profile)
  winner = argmax(actionScores, tie-break §5.2)
  muscleEnduranceScore[period] = winner?.score ?? null

输出：
enduranceScore          = muscleEnduranceScore.recent
enduranceChangePercent  = §6（比值趋势优先，绝对分差回退，clamp ±50）
repVolumeChangePercent / fatigueRetentionPercent / enduranceZoneSharePercent = v1 公式不变
enduranceBestAction / endurancePath = winner 元数据
overallScore / confidence / strengthScore / hypertrophyScore / frequencyScore = v1 公式不变
  （confidence 唯一下调：峰值动作走性别合并档 → 封顶 limited，§5.3）
```

## 10. UI 改动需求清单

1. **必改**：`strength.js`「我的基础数值」卡免责声明（约 1628 行）——现文案「……均不参与训练进步评分」改为如实表述：**性别与年龄参与耐力常模分档，身高体重仍不参与**；未填性别时使用合并档（分数置信度降低）。
2. **可选（低优先，本版不做亦可）**：耐力维度条下加 subtext「峰值：俯卧撑 · 常模档 L2」——`enduranceBestAction`/`endurancePath` 字段已就绪；若做，仅加一行展示，不动 `meterView` 契约。
3. **明确不改**：`progress-visual.js` 的 DIMENSIONS/meterView/levelOf 全部不动（字段名未变，chip 三态照旧）；维度条顺序、颜色 token、动画参数不变。

## 11. 测试基线变更清单

### 11.1 tests/test-muscle-endurance.js

| 用例 | v2 预期 |
| --- | --- |
| ENDURANCE_CONFIG deepEqual | **重写**（WEIGHTS 删除、新增 v2 键） |
| estimateEnduranceReps / perSetRepsFromText / fatigueRetention / enduranceRatioForSet / enduranceZoneSetCount | **保留**（链路仍用于锚点/趋势/展示统计） |
| 新增 | enduranceScoreFromRatio 锚点断言（m=1→50、0.5→20、2.5→100、2.0→92）；scoreFromAnchors 插值与两端 clamp；normCurveFor 性别三态（男/女/合并中值）；scoreEnduranceSet 路径裁决（有锚出域 → L4、自重家族 → L3、卷腹 → L2）；scoreEnduranceAction 最佳单组/degraded/逐组序列 |
| 两窗口卧推（原 score=76） | **重写**：L1 路径、绝对分非 50 基线、enduranceChangePercent > 0（比值趋势）、endurancePath='L1'、enduranceBestAction 断言 |
| 纯自重 15×4（原 69） | **重写**：v2 验收核心用例——**单次观测（首窗无历史）即得非 null 绝对分**、路径按俯卧撑家族判定 |
| 未记次数 → null + 0.85/0.15 | 保留 |
| 缺项归一（原 69） | **重写**：归一机制消失，改为「峰值动作只有一个可用路径」场景 |
| >30 次（原 50） | **重写**：>30 次按对应路径曲线照常计分（L2/L3/L4 曲线上限即封顶），断言按曲线值 |
| pct>1（原 31） | **重写**：pct>1 不在 L1 受理域 → 走 L4（次数宽档），断言新分值 |
| 单组/区间无保持率 | 保留（展示统计 null 语义不变） |
| 端到端 82.5 | fatigueRetentionPercent 部分保留；enduranceScore 断言按新口径 |

### 11.2 tests/test-muscle-progress.js

- 「纯自重 → 0.5/0.3/0.2 分支」（76-86 行）：**保留**——断言为关系式现算，enduranceScore 变绝对分后自动成立；`enduranceScore !== null` 与 confidence 'limited' 继续成立。
- 「未记次数 → null + 0.85/0.15」：保留。
- 其余不受影响。test-progress-visual.js：字段名未变，**全部保留**。

## 12. 边界情况处置

| 场景 | 处置 |
| --- | --- |
| 只记组数不记次数 | 动作分 null；肌群全无已知次数 → enduranceScore null（v1 语义不变） |
| 单组 | 照常计分（最佳组就是它）；保持率统计 null |
| >30 次组 | 不入 L1（RATIO_REP_MAX 之上 Epley 反解失真）；按 L2/L3/L4 曲线计分 |
| 磅/公斤 | 沿用 `summarizeTrainingSet` 统一换算，路径层只见 kg |
| 多动作只有其一有数据 | max 天然免疫：有数据者参选，缺数据者不进候选 |
| bmiProfile 全空 | sex/age 缺省（合并档 + 20-29），confidence 封顶 limited；分数仍可用 |
| 负重动作无锚点 | L4 宽档（不冒充 L1），limited |
| 锚点组 pct 出受理域 | 该组不计分；动作无其他受理组 → L4 |
| 同一动作混重组与高次组 | L1 受理组逐组计分取最佳——这正是设计场景 |
| 汇总记录 | 均值组计分 + degraded；confidence 不额外降级（v1 规则统一），degraded 语义留在返回结构供未来 UI 用 |

## 13. 迁移与发布说明

分数渲染时现算、无存储迁移。上线即全局重算，发布说明要点：

1. 耐力分口径变更：从「跨窗趋势为主」改为「单次表现对照动作常模的**绝对水平**（0–100）」，历史回看按新口径重算，升级点前后跳变属预期且幅度可能大于上次（趋势腿 65% 权重被整体替换）。
2. 同肌群多动作改取**最佳动作**为代表，不再把各动作容量平均/累加。
3. 耐力趋势 chip 含义不变（仍为与上一 28 天窗对比）。
4. 「我的基础数值」的**性别与年龄**现在参与耐力常模分档；未填性别走合并宽松档、分数置信度降低。身高体重仍不参与耐力评分。
5. 综合分随耐力维度联动；力量、增肌维度口径不变。

## 14. 剩余问题与开放项

1. **[B] 表人工复核**（上线前必办）：Golding 俯卧撑女性表（两版本矛盾）、ACSM 卷腹切点、中国仰卧起坐表原文。复核后只需改 REP_NORMS 数值，不影响结构。
2. 引体常模为 [C] 占位，待可定位来源后替换。
3. 年龄仅 20-29 一档；收集到更多年龄分布数据后按 norms-research 缺口补表。
4. `endurancePath`/`enduranceBestAction` 的 UI 展示（§10.2）留待下版。
5. 体重参与耐力评分（按体重分层的常模）依赖未来引入动作 1RM 人群常模，v2 明确不做。

## 15. 来源索引

- 常模表与检索台账：`docs/endurance-norms-research.md`（Golding/YMCA、FitnessGram、ACSM 卷腹、中国学生标准、AFT 结构、Ebben 2011 %BW；含逐表溯源警告）。
- 积分制惯例：`docs/endurance-scoring-conventions-research.md`（Strength Level 五档、军队分段计分、1RM best-lift 惯例、百分位归一）。
- 现状审计与改动面：`docs/endurance-v2-impact-audit.md`（管线图、兼容性约束、测试影响清单）。
- v1 设计（被本版取代，纯函数语义部分保留）：`docs/muscle-endurance-design.md` v1 版（git 历史）。
- 结构性文献：LeSuer 1997（1RM 公式效度域）；Epley 公式；ACSM 耐力带（≤67% 1RM、≥12 次）；Schoenfeld 2017 / Baz-Valle 2022（展示统计的组数带，未变）。
