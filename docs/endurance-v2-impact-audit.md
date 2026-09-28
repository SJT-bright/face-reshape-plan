# 耐力评分 v2 改造 —— 现状审计与影响分析

> 审计对象：现有肌肉耐力评分（enduranceScore）实现，规格来源 docs/muscle-endurance-design.md（下称「v1 设计」）。
> v2 目标（本审计的对照基准）：① 绝对分、从第一天就有（单次表现对照常模/标准 → 绝对 0–100）；② 跨动作取最高、不累加（肌群分 = max(动作分)，峰值代表肌群）。
> 本文档只读代码、不改实现；行号以当前 HEAD 为准（src/js/strength-core.js 简写 core，src/js/strength.js 简写 ui，src/js/progress-visual.js 简写 pv）。
> 仅供 v2 设计 agent 定稿参考；参数取值（常模表、修正系数）不在本审计权限内。

## 0. 结论速览

1. **v1 的四个因子全部是「肌群级聚合量」**：累加（容量 968、组数 957、带占比 920-931）、加权平均（跨动作趋势 774-784）、样本均值（保持率 1017-1019）。**不存在「动作分」这个中间层**——v2 的「动作分 → 肌群取 max」不是改一个聚合函数，而是要在聚合之前新增一层逐动作计分。好消息：`(窗口, 动作)` 粒度的暂存结构 `enduranceByAction` 已存在（core 752, 969-1000），收集循环基本不用动，改的是二遍处理（core 1005-1033）。
2. **无前窗配对时趋势腿给 50 基线**（`trendScore(null, hasCurrent)` core 785-788），四因子中两条趋势腿（A 相对负荷 0.4、B 容量 0.25）占 65% 权重——新手首窗 65% 的分数是「持平基线」而非表现。v2 绝对锚定直接替换这一层的语义。
3. **体重/性别/年龄数据存在**：`state.bmiProfile`（`Store.db.strength.bmiProfile`，镜像 `Store.db.profile`）存 `heightCm / weightKg / age / sex('男'/'女') / activity`，已随导入/备份持久化（core 60, 1304-1305, 1457）。自重动作折算有效负荷可行；另有 skincare 体型照的逐日期体重（稀疏、选填）可作历史体重参考。唯一障碍是文案：BMI 卡片明示「不参与训练进步评分」（ui 1628），v2 需更新该声明与发布说明。
4. **对外字段名 5 个全部建议保留**，其中 `enduranceScore` / `enduranceChangePercent` 被 pv DIMENSIONS（pv 26）→ ui `_meter`（ui 1663-1665）→ 三处测试硬性消费；`repVolumeChangePercent` / `fatigueRetentionPercent` / `enduranceZoneSharePercent` 无 src 消费者（仅引擎输出 + 测试），语义可改、名字建议沿用。
5. **推荐：绝对分为主、趋势只做 chip 不进分数**（§5.4 论证）。`enduranceChangePercent` 保留为独立字段，用「产出肌群分的那个动作」的比值趋势或新旧分差计算。

---

## 1. 现状管线图（v1，逐点标注）

### 1.1 数据流总览

```text
state.days（逐组或汇总录入）
  │
  ├─ collectObservations(state, asOfDate)          core 880-904（入口一；ui 1545 调用）
  │    每动作 → 观测 {businessDate, dayLabel, actionName, sets, repsText,
  │                   weightText, exactMetrics, setLoads}
  │    setLoads = doneSetLoads(a)                  core 874-878【逐组→已完成组 {weightKg,reps}[]；
  │                                                   汇总→ null】（构造点 core 899）
  ├─ trendsSnapshot(...)                           core 1161-1222（入口二；内联构造观测 core 1186，
  │    └ muscleProgress(...)                            末尾调 buildMuscleProgress core 1221）
  │         = buildMuscleProgress(collectObservations(...))   core 1090-1092
  ▼
buildMuscleProgress(observations, asOfDate)        core 941-1089
  │
  ├─【窗口划分】recent = asOf−27..asOf；previous = asOf−55..asOf−28   core 942-944, 947-951
  │    sets ≤ 0 的观测丢弃                            core 952
  │
  ├─【首遍：逐 (观测 × 肌群) 累加 / 暂存】core 946-1002
  │    inferMuscleWeights(动作名, 训练日名)          core 723-745（主 1 / 辅 0.5）
  │    stats.sets        += 观测.sets × mw           core 957  ← 累加
  │    stats.stimSets    += 组数 × mw × repStimMultiplier  core 958  ← 累加
  │    stats.loadVolumeKg+= loadVolumeKg × mw        core 961  ← 累加
  │    recordBest(e1rmByAction, 动作, bestE1rmKg)    core 964  ← 动作内取 top-2（跨动作后加权平均）
  │    recordBest(loadByAction,  动作, maxWeightKg)  core 965  ← 同上
  │    stats.repVolume  += totalReps × mw            core 968  ← 累加 ★跨动作次数容量相加（v2 目标②的冲突点）
  │    enduranceByAction[动作] 暂存：                 core 969-1000
  │       zones: 逐组 count:1（core 977）；汇总按均值组 count:sets（core 990）   ← 暂存，非累加
  │       ratios: 11–30 次且有负重的组                core 978-981（逐组）/ 991-994（汇总均值对）
  │       fatigueSamples: ≥2 组可解析 → fatigueRetention(seq)  core 983-986, 995-999  ← 样本数组
  │
  ├─【二遍：锚点齐备后计算】core 1005-1024
  │    recent/previousE1rm = collapseTop2(...)       core 1005-1006  ← 各窗锚点独立（top-2 平均）
  │    enduranceRatioByAction(窗, 本窗锚点)          core 907-918   ← 逐动作、逐组比值 → recordBest top-2
  │    weightedTrend(recentRatios, previousRatios)   core 1013-1015 ← 趋势 ★跨动作为加权平均而非取最优
  │    repVolumeChange = 近/前 repVolume 环比 ±50%    core 1016      ← 累加量的趋势
  │    fatigueValue = mean(fatigueSamples)           core 1017-1019 ← 累加（样本均值）
  │    zoneShare = Σ落带×mw / Σ已知×mw               core 920-931, 1020 ← 累加（和之比）★跨动作混算
  │
  ├─【四因子 → 分数】core 1021-1033
  │    enduranceTrendScore = trendScore(enduranceChange, recentRatios.size>0)  core 1021
  │      └ trendScore(null, hasCurrent) → hasCurrent ? 50 : 0  core 785-788 ★首窗无配对 → 50 基线（v2 目标①的冲突点）
  │    repVolumeScore      = trendScore(repVolumeChange, repVolume>0)          core 1022 ★同上
  │    fatigueScore        = fatigueValue × 100                                core 1023（绝对值）
  │    zoneScore           = zoneShare × 100                                   core 1024（绝对值）
  │    enduranceScore = Σ(可用腿分 × w) / Σw        core 1027-1033 ← 加权累加合成（缺项归一）
  │      WEIGHTS = { relativeLoad:.4, volume:.25, fatigue:.2, zoneShare:.15 }  core 817
  │      null ⟺ 近窗 repVolume = 0（无任何已知次数）  core 1033
  │
  ├─【周边合成】
  │    strengthScore = 0.7·e1RM趋势 + 0.2·重量趋势 + 0.1·频率     core 1044-1047
  │    overallScore 四分支（0.35/0.35/0.2/0.1 等）                  core 1050-1056
  │    confidence：pairedActions = max(e1RM 配对数, 耐力比值配对数) core 1061-1069
  │
  └─【输出 5 个耐力字段】core 1079-1083
       enduranceScore / enduranceChangePercent / repVolumeChangePercent /
       fatigueRetentionPercent / enduranceZoneSharePercent
```

### 1.2 累加 / 取最优 / 趋势 逐点标注表

| 位置 | 操作 | 粒度 | v2 目标②（取 max）下的命运 |
| --- | --- | --- | --- |
| core 957-961（sets/stimSets/loadVolume） | 累加 | 肌群×窗 | 不属耐力四因子，保留（增肌/力量用） |
| core 964-965 + 756-773（recordBest/collapseTop2） | 动作内取 top-2 平均 | 动作 | e1rm 锚点继续用（力量分依赖）；耐力比值链路视 §2 取舍 |
| **core 968（repVolume +=）** | **累加** | 肌群×窗 | **与峰值原则直接冲突**：俯卧撑 50 次 + 卧推 10 次相加成「容量」，v2 应取俯卧撑的表现。退出合成（§2.5） |
| core 977/990（zones 暂存） | 暂存 | 动作×窗 | 结构保留，改语义：逐动作绝对判据的原料 |
| core 907-918（比值二遍） | 逐组→动作内 top-2 | 动作 | 结构可复用为「逐动作得分」的原料；产出从比值改为绝对分 |
| **core 1013-1015 + 774-784（weightedTrend）** | **跨动作加权平均** | 肌群 | **被 max 替换**：动作 A 退步 + 动作 B 进步在 v1 里互相稀释，v2 峰值原则下互不影响 |
| core 1016（repVolumeChange） | 累加量环比 | 肌群 | 退出合成；字段保留为信息（§2.4） |
| core 1017-1019（保持率均值） | 样本算术平均 | 肌群×窗 | 降级为动作内指标后按动作平均，再做修正项（§2.5） |
| core 920-931（带占比） | 和之比 | 肌群×窗 | 跨动作累加，与峰值原则冲突；退出合成或降为动作内修正 |
| **core 1027-1033（加权合成）** | 累加合成 | 肌群 | 被 `max(动作分)` 替换；「缺项权重归一」机制随之消失 |

### 1.3 null 语义（v2 须继承或显式改约）

- `enduranceScore = null ⟺ 近窗 repVolume = 0`（core 1033；v1 设计 §3.5）——只记组数不记次数、或肌群 28 天未练。**建议 v2 原样继承**（下游 empty 态、测试 §4.2 都依赖它）。
- `enduranceChangePercent = null ⟺ 近/前窗无可配对比值`（core 1080；首窗必 null）。
- `repVolumeChangePercent = null ⟺ 前窗 repVolume = 0`（core 1016, 1081）。
- `fatigueRetentionPercent = null ⟺ 近窗无有效样本`（单组、区间写法「10-12」、未逐组；core 828-845, 1082）。
- `enduranceZoneSharePercent = null ⟺ 近窗无已知次数组`（core 920-931, 1083）。
- 汇总记录 `setLoads = null` → 走均值对（core 987-999），精度损失是 v1 已知项（v1 设计 §5.7）。

### 1.4 与 v2 目标的结构性冲突（审计核心发现）

1. **冲突①（首窗无意义）**：趋势腿（A 0.4 + B 0.25 = 65% 权重）在无前窗时给 50（core 786, 1021-1022, 1029-1030）。两条绝对腿（C 保持率、D 带占比）量纲是「训练质量」而非「耐力水平」——保持率 75 分只说明组间衰减不大，不说明绝对耐力强。v1 设计自己承认「不承诺百分位」（v1 设计 §3.5）。v2 的绝对常模替换的是**整层因子语义**，不是调权重。
2. **冲突②（累加稀释峰值）**：`repVolume`（core 968）与 `zoneShare`（core 920-931）把同肌群多动作的量混算；`weightedTrend`（core 774-784）把多动作的趋势加权平均。俯卧撑 50 个的胸部耐力信号被卧推 10 次摊薄。v1 中唯一按动作隔离的环节是比值暂存（core 969-1000）与动作内 top-2（core 907-918）——**v2 的骨架应当是：保留收集与暂存，重写「从暂存到分数」的后半段**。
3. **辅助权重在 max 语义下退场**：v1 里 mw（主 1/辅 0.5）参与一切加权（core 957-968, 774-784, 920-931）。v2 的动作分是「该动作的表现测量」，对它命中的每个肌群同值（双杠臂屈伸的同一表现同时进三头与胸的 max 候选）。mw 是否还参与（如辅助动作打折后进 max）是 v2 设计要显式决策的点——本审计倾向：动作分不打折进 max（峰值原则的字面语义），mw 仅保留给组数/增肌/力量链路。

---

## 2. v2 改动面清单（函数级）

### 2.1 保留（语义不变或近不变）

| 函数/常量 | 位置 | 保留理由 |
| --- | --- | --- |
| `doneSetLoads` | core 874-878 | 观测层管道，动作分的原料 |
| `perSetRepsFromText` | core 828-834 | 汇总文本 → 逐组序列，保持率修正项与「最优组」提取仍需要 |
| `fatigueRetention` | core 837-845 | 降级为动作分的修正项后原函数照用 |
| `setInEnduranceZone` / `enduranceZoneSetCount` | core 858-872 | 若保留「耐力带」作为动作内判据（如回退路径的资格线）则照用 |
| `estimateE1rmKg` / `summarizeTrainingSet` / `repStimMultiplier` / `trendScore` / `collapseTop2` / `weightedTrend` | core 691-716, 799-804, 767-788 | v1 设计 §6 的「不得改动」清单；strengthScore 仍依赖，v2 不得触碰 |
| `inferMuscleWeights` / `collectObservations` / `trendsSnapshot` 观测构造 | core 723-745, 880-904, 1186 | 观测层不动；`setLoads` 已够用 |
| `createWindowStats` | core 746-754 | 结构保留；`enduranceByAction` 暂存粒度正是 v2 需要的 |
| `recordBest` / `collapseTop2` | core 756-773 | 动作内 top-2 抗噪在 v2 的「组→动作分」聚合中可复用 |

### 2.2 改写

| 函数/常量 | 位置 | v2 改写内容 |
| --- | --- | --- |
| `ENDURANCE_CONFIG` | core 809-818 | `WEIGHTS` 语义从「四因子合成权重」变为「动作分内部修正权重」（或删除）；`RATIO_REP_*` 视比值趋势是否保留而取舍；**新增常模表**（动作类别 → 次数常模 / 自重负荷系数）。注意 tests/test-muscle-endurance.js L12-18 对本表做 deepEqual，改表即改测试（预期变更） |
| `buildMuscleProgress` | core 941-1089 | 核心改写点（仅 core 1005-1033 的二遍与合成段）：从「肌群聚合 → 四因子加权」改为「逐 (窗, 动作) 绝对计分 → 肌群取 max」。首遍（946-1002）基本不动；core 968 的 repVolume 若退役则删一行。新增入参：profile（体重/性别/年龄）——`buildMuscleProgress(observations, asOfDate)` 签名将扩参，`muscleProgress`（core 1090-1092）与 `trendsSnapshot`（core 1221）两个调用点同步传 `state.bmiProfile` |
| `enduranceRatioByAction` | core 907-918 | 同一「逐动作、按本窗锚点」骨架，产出从比值改为绝对分（`scoreAction`）：有锚点动作走 %1RM 常模，无锚点自重走体重折算或纯次数常模 |
| `enduranceZoneShareForWindow` | core 920-931 | 肌群级和之比废弃；若带占比降为动作内修正项，改为逐动作版本 |
| 输出字段语义 | core 1079-1083 | `enduranceScore` 从「趋势+质量合成」变为「绝对水平」；`enduranceChangePercent` 改由「产出 max 的动作」计算（见 §2.4）；三个次要字段语义见 §2.5 |

### 2.3 废弃 / 退出合成

| 现状构件 | 位置 | 处理建议 |
| --- | --- | --- |
| 容量因子 B（repVolume 腿） | core 968, 1016, 1022, 1030 | **退出合成**。理由：容量累加是肌群级总量，与「每动作各自算分、取峰值」在构造上不可调和（50 个俯卧撑 + 10 次卧推的容量和不代表任何单动作表现）。`repVolumeChangePercent` 字段可保留为信息展示（训练量的方向感），但不得回流进分数 |
| 肌群级加权平均趋势合成 | core 1013-1015, 1021, 1029 | **退出合成**。绝对分接管「分数」职责；趋势降级为 chip（§2.4） |
| 「缺项权重归一」机制 | core 1027-1032 | 随四因子合成一起消失。动作级缺项改为**置信度降级**（§5），不再把缺席因子折算成 50 |
| `trendScore(null, true) → 50` 在耐力内的使用 | core 1021-1022 | 耐力内不再出现 50 基线；`trendScore` 函数本身保留（力量分在用） |

### 2.4 `enduranceChangePercent` 独立保留论证（建议：保留）

1. **UI 已消费**：pv DIMENSIONS 注册 `changeField: 'enduranceChangePercent'`（pv 26）→ ui `_meter` 读取（ui 1665）→ `deltaView` 渲染 chip（pv 93-102，ui 1671-1675），aria 文案追加「较上期↑ x%」（pv 144-147）。删除字段 = chip 永远「数据不足」（meterView 对 undefined 防御为 empty tone，ui 不崩但功能消失）。
2. **测试已锁定**：test-progress-visual.js L50 断言 DIMENSIONS 逐字含该字段名，L207-210 断言耐力 chip 的 down 渲染。保留字段则这三个测试文件中视觉契约全部不动。
3. **信息价值独立于分数**：绝对分回答「我现在什么水平」，趋势回答「我在变好还是变坏」——后者正是 v1 设计 §2.5 证明过统计有效的量（比值跨窗变化率，公式偏差同向抵消）。绝对锚定引入常模表的模型误差，趋势链路（同动作、同公式、跨窗作商）不受其影响，两者误差来源正交，值得并存。
4. **计算口径建议**：用「产出肌群分的那个动作」（argmax 动作）的因子 A 比值跨窗趋势（复用 core 907-918 链路，只对该动作算），而非全肌群加权平均——与峰值原则自洽：峰值动作换了，趋势自动跟着换代表。null 语义沿用「近/前窗无可配对比值」。

### 2.5 四因子去留总表

| 因子 | v1 角色（权重） | v2 建议 | 理由 |
| --- | --- | --- | --- |
| A 相对负荷耐力（比值趋势） | 合成主腿（0.4） | **退出合成**；比值公式保留，供趋势 chip 与「有锚点动作」的常模插值用 | 趋势不是水平；但其「负荷参照」结构是常模路径的原料 |
| B 容量耐力 | 合成腿（0.25） | **退出合成**；`repVolumeChangePercent` 留作信息字段 | 与峰值原则构造性冲突（§2.3） |
| C 抗疲劳保持率 | 合成腿（0.2） | **降级为动作分修正项**（如 `×(0.9 + 0.1×retention)`，系数 [C] 待 v2 定），动作级计算；`fatigueRetentionPercent` 字段保留（无 src 消费者、成本为零） | 保持率是单次训练的质量属性，天然属于动作；保留字段可继续支撑「递减金字塔误读」等 v1 遗留问题的观察 |
| D 耐力带占比 | 合成腿（0.15） | **退出合成**。两个去向：① 废弃；② 降为回退路径的资格线（纯次数回退时要求 ≥12 次才算「耐力表现」，防 5 次大重量组刷分）。倾向 ②，`enduranceZoneSharePercent` 字段去留由 v2 定（无 UI 消费） | 和之比跨动作混算；但「≥12 次且 ≤67%1RM」的判据（core 858-864）本身是常模判分的合法原料 |

---

## 3. 绝对锚定的数据可行性

### 3.1 体重：存在（可直接使用）

- **存储**：`state.bmiProfile`，运行时 `Store.db.strength.bmiProfile`，镜像副本 `Store.db.profile`。
  - 写入：ui `_bindProgress.saveProfile`（ui 1719-1735）——进步可视化页「我的基础数值」卡片（ui 1610-1628）的五个输入：身高/体重/年龄/性别/活动水平，随 `Store.save()` 持久化。
  - 读取方：ui 1552-1553（BMI 卡）、rhythm-engine.js 329-336（BMR/营养目标）、rhythm.js 134、skincare.js 623、778。
  - 持久化完整性：`normalize` 保留（core 60：`if (db.profile || src.bmiProfile) s.bmiProfile = ...`）、导入清洗（core 1304-1305）、导入恢复（core 1457）、ux 侧镜像（ux-core.js 10、ux.js 170）。备份/换机不丢。
- **历史体重**：skincare 体型照逐张可带选填 `weightKg` + 拍摄日期（skincare.js 633-634 输入、648/650 存储显示），构成稀疏的体重时间序列。可用于「训练日附近的体重」，但选填、稀疏，只能作增强不能作依赖；回退用 `bmiProfile.weightKg` 单点值。
- **结论**：自重动作折算有效负荷（体重 × 动作系数，如俯卧撑 ≈ 0.64×体重 [B-文献带内，表待 v2 定]）在数据上可行。**注意 core 1224-1251 已有 `bmi`/`bmrMifflin`/`healthyWeightRange` 对 profile 的合法消费先例**，v2 读 profile 不算越界；但 ui 1628 的免责声明「……均……不参与训练进步评分」必须同步改写。

### 3.2 性别 / 年龄：存在

- `sex`：'男' / '女' / ''（未填，ui 1616, 1730）；`age`：整数（ui 1615, 1729；bmrMifflin 校验 10–100，core 1243）。
- rhythm-engine 已有缺省约定（age→30、sex→男，rhythm-engine.js 331-335 并如实提示「缺省估算」）——v2 若做性别分层的常模（俯卧撑等上肢自重推的性别差异显著 [A-方向性]），可沿用同一「缺省 + 披露」模式，或对缺省者只走不分层常模并降置信度。建议后者（分数页不是估算页，宁可低置信不假设）。

### 3.3 无体重 / 无锚点的回退阶梯（供 v2 定稿）

| 层级 | 条件 | 锚定方式 | 置信度 |
| --- | --- | --- | --- |
| L1 | 有负重组 + 同窗锚点（≤10 次重组 e1RM） | pct = 负荷/锚点 → 动作类别次数常模插值 → 预期次数 → 组分 | 高 |
| L2 | 无锚点、自重、**有体重** | 有效负荷 = 体重 × 动作系数 → 与 L1 同一常模；或动作类别「该体重预期次数」直接查表 | 中 |
| L3 | 无锚点、无体重（未填或纯未知负荷） | **纯次数常模**：动作类别 → 次数分档（如俯卧撑 40+ 优秀…），不给负荷参照 | 低 |
| L4 | 动作识别不出类别 | 无分；该动作不进 max，肌群分由其他动作承担；全无 → null | — |

- L3 是 v1 设计 §8.1 预留的「按动作类别的实测次数常模（Hoeger 路线）」，数据上零依赖、当天可用；代价是跨动作不可比、个体体型差异未修正——用置信度表达，不虚构精度。
- 组级数据形态映射：逐组记录（`setLoads`）逐组判分取最优/top-2；汇总记录只有均值对（core 987-999），按 v1 设计 §5.7 同款精度损失处理，标记 degraded；**只记组数不记次数**（totalReps=0）→ 无表现可测 → 不产出动作分。

### 3.4 缺口与风险

1. 常模表本身不存在，是 v2 最大的新增资产（动作类别 × 性别 × 次数档，[B/C] 取值需溯源登记 docs/scoring-parameters.md）。
2. `bmiProfile.weightKg` 是单点现值：回填历史日期的训练会用今天的体重折算当时的自重表现。误差方向已知（减脂用户的历史分被低估），v1 设计 §8 的「如实披露」姿态适用；skincare 稀疏体重序列可作为可选增强。
3. 未填体重是常态（字段全部选填）：自重为主的用户大概率落在 L3。v2 的「从第一天就有绝对分」目标在 L3 下仍成立（纯次数常模），但分数含义最弱——置信度必须如实降级。

---

## 4. 兼容性约束

### 4.1 必须保持的对外字段名（UI / 测试在用）

| 字段 | 消费者 | 结论 |
| --- | --- | --- |
| `enduranceScore` | pv DIMENSIONS.scoreField（pv 26）→ ui `_meter`（ui 1663）；test-progress-visual L50, L171, L231；test-muscle-endurance L70-81 等多处；test-muscle-progress L83 | **必须保持**（或改 pv 注册表一处 + 全部测试，收益为零） |
| `enduranceChangePercent` | pv DIMENSIONS.changeField → ui 1665 chip；test-progress-visual L50, L207-210 | **必须保持**（§2.4 建议保留语义） |
| `overallScore` / `confidence` / `strengthScore` / `hypertrophyScore` / `frequencyScore` | ui 热区着色（ui 1578）、徽标（ui 1649-1650）、hero（ui 1594）、`_meter`（ui 1661-1668） | **必须保持**；overall 四分支（core 1050-1056）建议不动——enduranceScore 仍为 0–100 整数、null 语义不变，分支无需感知口径变化 |
| `repVolumeChangePercent` / `fatigueRetentionPercent` / `enduranceZoneSharePercent` | **无 src 消费者**（仅 core 输出 + test-muscle-endurance 断言） | 名字建议沿用；语义可改（§2.5）；改动只需同步 test-muscle-endurance |

另外两个隐性契约：`buildMuscleProgress` 输出行含 `key/label` 供 ui map（ui 1547）；观测的 `setLoads` 结构被 test-muscle-endurance L143-146 深比较——收集层不动则都不受影响。

### 4.2 测试逐条影响（v2 下预期变更清单）

**tests/test-muscle-endurance.js**

| 用例 | 行 | v2 预期 |
| --- | --- | --- |
| ENDURANCE_CONFIG deepEqual | L12-18 | **变**：WEIGHTS 语义变化/新增常模键 → 断言重写 |
| estimateEnduranceReps 六断言 | L20-27 | **保留**（若比值/常模插值链路沿用 Epley 反解） |
| perSetRepsFromText | L29-36 | 保留 |
| fatigueRetention | L38-44 | 保留 |
| enduranceRatioForSet | L46-51 | 保留（趋势 chip 链路复用）；若彻底废弃比值则随之删除 |
| enduranceZoneSetCount | L53-59 | 保留（若带判据降为资格线） |
| 两窗口卧推 → score=76 | L61-75 | **变**：76 = (70.03×0.4+100×0.25+50×0.15)/0.8 的趋势合成不复存在；enduranceChangePercent>0 与 confidence good 的断言口径可保留（chip 语义不变） |
| 纯自重 15×4 → score=69 | L77-83 | **变**：69 = (50×0.25+100×0.15)/0.4；v2 应得常模绝对分且首日非基线——这正是 v2 的验收用例 |
| 未记次数 → null + 0.85/0.15 | L85-90 | **保留**（v2 建议继承 null 语义） |
| 缺项归一 → 69 | L92-99 | **变**：归一机制消失；字段 null 断言（L95-97）口径需按新语义复核 |
| >30 次 → 50 | L101-107 | **变**：新分数口径下重写（>30 次的常模处理是 v2 边界决策） |
| pct>1 → 31 | L109-115 | **变**：pct>1 剔除逻辑若保留，分数值变 |
| 单组/区间无保持率 | L117-123 | 保留（修正项不改变 null 时机） |
| 端到端 82.5 | L125-153 | **部分变**：fatigueRetentionPercent=82.5 保留；涉及 enduranceScore 的断言（如有）随新口径 |
| setLoads 深比较 | L143-146 | 保留 |

**tests/test-muscle-progress.js**

| 用例 | 行 | v2 预期 |
| --- | --- | --- |
| 纯自重 → 0.5/0.3/0.2 分支 | L76-86 | **保留**：overallScore 断言是从行字段现算的等式（L84），enduranceScore 值变它自动成立；`enduranceScore !== null`（L83）与 confidence 'limited'（L85）保留 |
| 未记次数 → null + 0.85/0.15 | L88-95 | 保留 |
| 其余（e1rm/窗口/肌群规则） | 全文其余 | 不受耐力改造影响 |

**tests/test-progress-visual.js**：字段名保持则**全部保留**（这正是 §4.1 主张不改名的依据）；L231 的值域断言（0–100 整数或 null）对新口径自动适用。

---

## 5. v2 管线草图（伪代码级，供设计 agent 定稿）

### 5.1 主流程

```text
INPUT: observations, asOfDate, profile = state.bmiProfile, NORMS（动作类别常模表）, BW_COEF（自重负荷系数表）

# ---- 第一遍（与 v1 core 946-1002 同构，仅 zones/ratios 暂存保留，repVolume 视取舍）----
for obs in observations:
  period = windowOf(obs, asOfDate)            # recent / previous，core 947-951 口径
  for (muscle, mw) in inferMuscleWeights(obs):
    setsByAction[muscle][period][obs.actionName] += obs 的已完组序列
      # 逐组记录 → setLoads 逐组；汇总记录 → [均值对]，标 degraded（v1 §5.7 同款）

# ---- 第二遍：逐 (窗, 动作) 绝对计分 → 肌群取 max ----
for muscle:
  for period in {recent, previous}:
    for action, setLoads in setsByAction[muscle][period]:
      actionScore = scoreAction(action, setLoads, profile, anchors[period])

scoreAction(action, setLoads, profile):
  sets = 可解析组（逐组原样；汇总均值对=1 条 degraded；只记组数不记次数 → 返回 null）
  load  = 有负重 ? weightKg
        : 是已知自重动作 && profile.weightKg ? BW_COEF[类别] × 体重      # L2
        : null                                                          # L3
  anchor = 该动作本窗 ≤10 次负重组 top-2 e1RM（沿用 core 1005-1006 链路）
  if anchor && load:      expected = NORMS.插值(类别, pct=load/anchor);  tier='L1'
  else if load:           expected = NORMS.插值(类别, pct=load/估计1RM(体重)) 或直接查表;  tier='L2'
  else if 次数可测:        expected = NORMS.repsOnly(类别);  tier='L3'     # 无负荷参照，宽档
  else:                   return null                                     # L4
  setScores = [f(组次数 / expected) for 组 in sets]      # f: 比值→0-100 映射（形状 [C] 待定）
  best = top2mean(setScores)                              # 动作内取最优，抗单组波动（复用 recordBest/collapseTop2 思路）
  ret = fatigueRetention(逐组次数序列)                     # 可为 null（单组/区间）
  score = ret !== null ? best × (0.9 + 0.1×ret) : best    # 修正项系数 [C] 待定
  return { score: clamp(round(score)), tier, degraded, ret }

muscleScore(period) = max over actions(actionScore)       # ★峰值原则；同分取组数多者（代表性 tie-break）
# 辅助肌群权重 mw 不打折动作分（§1.4 第 3 点），mw 仅留在组数/增肌/力量链路

# ---- 输出（字段名全部沿用 §4.1）----
enduranceScore = recent 有任何已知次数组 ? muscleScore(recent) : null    # null 语义与 v1 对齐（core 1033）
confidence    = f(bestAction.tier, recent.dates, pairedActions)
  # L1 才可到 good；L2 ≤ limited；L3 封顶 limited；degraded（汇总均值对）降一级
enduranceChangePercent = ratioTrend(argmaxAction, recent, previous)      # §2.4：复用 core 907-918 比值链路，仅对峰值动作；无可配对 → null
repVolumeChangePercent / fatigueRetentionPercent / enduranceZoneSharePercent  # 信息字段：口径按 §2.5 调整或置 null，名字不动
overallScore   # 四分支公式一字不动（core 1050-1056）
```

### 5.2 边界与 null 处理对照

| 场景 | v1 现状（行号） | v2 草案 |
| --- | --- | --- |
| 只记组数不记次数 | repVolume 不计 → enduranceScore null（core 968, 1033） | 同：无表现可测 → 动作分 null → 肌群无任何动作分 → null。**语义不变** |
| 纯自重 | 容量腿 + 带占比腿（≥12 次代理），首窗 ≈ 55-69（test L77-83） | L2/L3 常模绝对分，首日有效；有体重走 L2，无体重走 L3（置信度区分） |
| 多动作只有其一有完整数据 | 缺锚点动作按权重归一，不拖累也不贡献（core 1027-1032） | max 天然免疫：有数据者给分，缺数据者仅不参选；置信度按获分动作的 tier |
| >30 次组 | 不进比值、进容量与落带（core 978, v1 §5.4） | v2 待决策：常模表是否覆盖 >30 档；建议照常判分（纯次数档）但标低置信 |
| 汇总记录 | 均值对（core 987-999），已知精度损失 | 同构处理 + degraded 标记降置信 |
| 递减金字塔误读 | 不处理（v1 §5.8） | 若做保持率修正项，可顺带采用「逐组重量递减 >10% 不计保持率」候选修复 |

### 5.3 绝对分与 trendScore 的关系（推荐）

**绝对分为主、趋势只做 chip、不进分数；不做成「绝对分 × 趋势系数」的混合。** 论证：

1. **目标正交**：v2 目标①要求首窗即有效，任何含 trendScore 的合成在首窗都退化为 50 基线（core 786）——混合方案会重新引入 v2 要消灭的问题，只是幅度变小。
2. **误差正交**：趋势量（同动作比值跨窗作商）的公式偏差同向抵消（v1 设计 §2.5），是全链路中统计上最干净的信号；绝对常模的误差来自常模表与体重折算。两者相乘会把两类误差耦合进一个数，且 chip 的「变好」与分数的「水平低」并存本来就是正确语义（新手水平低但在进步）。
3. **消费面最小**：chip 链路（pv deltaView → ui span.st-delta）只读 `enduranceChangePercent`，保留该字段即可，不触碰 meterView 三态与 aria 契约（test-progress-visual 全绿）。
4. **反方案否决**：「绝对分 + 小比例趋势项」——首窗趋势 null 时要么归一抬分要么扣分，两者都让「第一天绝对分」失真；「趋势作为 overall 的独立加权腿」——overall 四分支是显式枚举（core 1050-1056，v1 设计 §4 特意不做通用归一），加腿即重开迁移话题，收益不成比例。

---

## 6. 迁移与分数连续性

**机制前提**：分数每次渲染从原始观测现算，无任何存储迁移（v1 设计 §4 已确立；本次同样成立）。v2 上线即全局重算，老用户耐力相关分数在升级点一次性跳变。

1. **谁会变**：
   - 有耐力数据的肌群（近窗 repVolume > 0）：`enduranceScore` 全部重算——趋势腿 65% 权重的「50 基线 + 容量环比」被常模绝对分替换。典型方向：v1 首窗用户（现约 55-69，test L77-99 的 69/76 都在此带）会按真实水平重新落位，**可能升也可能降**；长期双窗用户若真实水平高于新手常模则普遍上升。
   - `overallScore`：随 enduranceScore 通过 0.2（双数据分支）/ 0.3（仅耐力分支）权重传导；四分支公式本身不动（§4.1），无耐力数据的肌群一个都不动（与 v1 迁移承诺同款）。
   - 身体图热区颜色、维度条、达标徽标：随 overall 联动变化，属预期。
2. **跳变幅度预估**：无历史跳变数据可引用（本审计不做运行时实验）；量级参考 v1 迁移时的 ±4-10 分（v1 设计 §4 表）。v2 改变的是分数语义而非增量权重，跳变**不设上界保证**——发布说明应按「可能更明显」表述。
3. **发布说明必须包含**（草案）：
   - 耐力分口径变更：从「跨窗趋势为主」改为「单次表现对照动作常模的绝对水平（0–100）」，历史回看按新口径重算，升级点前后出现跳变属预期；
   - 同肌群多动作改取「最佳动作」为代表，不再把各动作容量平均/累加；
   - 趋势 chip（耐力 ↑/↓ x%）含义不变，仍为与上一 28 天窗的对比；
   - 「我的基础数值」中的体重/性别/年龄现在参与耐力评分（自重动作折算），此前「不参与训练进步评分」的说明已更新；未填写者走纯次数常模、分数置信度降低（徽标照常提示「样本较少」）；
   - 综合分（综合训练指数）因耐力维度重算而联动变化；力量、增肌维度口径不变。
4. **回滚性**：纯函数改造、无 schema 变更（观测层不动），回滚 = 还原代码即可，无数据遗留风险。若 v2 新增常模表等纯数据常量，同样无迁移负担。

## 7. 交接备注（给 v2 设计 agent 的三个必答题）

1. 常模表的来源与档距（§3.4 第 1 条）——这是 v2 唯一无法从现有代码推导的资产，需独立溯源登记。
2. 辅助权重 mw 在 max 语义下的去留（§1.4 第 3 点）——影响 ACTION_RULES 命中的每个复合动作。
3. 三个次要字段（repVolumeChangePercent / fatigueRetentionPercent / enduranceZoneSharePercent）的最终口径——无 UI 消费者，v2 可自由定义，但 test-muscle-endurance 的对应断言需同步（§4.2）。
