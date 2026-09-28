# 餐别分类与餐后锻炼时机 —— 调研与设计

> 功能（2026-09-26 新增）：
> ① 记餐时增加「餐别」（早餐 / 午餐 / 晚餐 / 夜宵），按用餐时刻自动分类、可手动改；
> ② 力量训练页新增「🍽️ 餐后锻炼时机」卡：根据当天最后一餐推算何时能散步、何时能练、今晚最晚几点结束，并给出就寝锚点与高表现窗。
> 实现：分类标准在 `rhythm-engine.js`（`MEAL_TYPE_WINDOWS` / `classifyMealType` / `mealTypeLabel`）；推荐编排是纯函数 `strength-core.js` 的 `postMealTimingAdvice(meals, now, options)`；UI 在 `rhythm.js`（`mealModal` / `mealTypeText`）与 `strength.js`（`_mealTimingCard`）。
> 阈值统一登记在运行时证据注册表 `rhythm-evidence.js`（规则版本 2026-09-26.1），文档版见 `docs/饮食与睡眠-证据与计算规则.md`。

## 1. 调研结论（每条标注出处与可信度）

调研于 2026-09-26 完成（PubMed / Europe PMC / 期刊原文 / 权威临床机构，4 路并行检索）。

### 1.1 餐后多久能练：按「餐型 × 强度」分层
- 权威共识口径（Mayo Clinic《Eating and exercise》）：**大餐后 3–4 小时、普通正餐后 2–3 小时、加餐后约 1 小时**再运动；Cleveland Clinic 患者教育：剧烈运动前至少等 2 小时。本应用不记录食物量，取**保守下限**：正餐 2 小时、加餐 30–60 分钟。
- 机制：运动使内脏血流转向骨骼肌、胃排空延迟（能量密度越高越慢，Hunt & Stubbs 1975 *J Physiol*）；餐后饱腹加倒岔气（ETAP）风险（约 70% 跑者每年经历；Morton & Callister 2015 *Sports Med* 综述：餐后状态与高渗饮料是最强可控诱因）。
- **低强度是例外**：餐后步行不需要等 2 小时，反而越早越好——三餐后各 15 分钟步行对 24 小时血糖优于集中一次（DiPietro 2013 *Diabetes Care*，RCT 交叉 n=10）；每餐后 10 分钟步行使餐后血糖约降 12%、**晚餐后约降 22%**（Reynolds 2016 *Diabetologia*，RCT 交叉 n=41）；轻强度步行打断久坐的餐后血糖效应 Δ=−0.72（Buffey 2022 *Sports Med* meta）。→ 引擎把「散步」与「训练」两条线分开编排。

### 1.2 什么时间锻炼最科学：人群峰值在午后，但「能坚持」优先
- 无氧功率与跳跃峰值 **13:00–20:00**、握力峰值 **14:00–21:00**，傍晚显著优于早晨（Knaier 2022 *Med Sci Sports Exer* meta，29 项研究）；自行车计时赛全天相差 2.9%–7.1%（Bommasamudram 2022 综述）。→ 高表现窗取 **14:00–19:00** 作排序参考。
- 分目标：血糖控制人群下午训练更优（Savikj 2019 *Diabetologia*；van der Velde 2023：下午/晚间 MVPA 与胰岛素抵抗 −18%/−25% 相关）；代谢综合征人群早晨更优（Morales-Palomo 2024 *J Physiol*，n=139）；减脂按时段差异小、依从性优先（Schoenfeld 2014：空腹晨练不减脂；Arciero 2022 *Front Physiol*：女性晨练多减腹脂、男性晚练降压更多）。力量/增肌长期增益时段差异可忽略，但建议固定时段（Sedliak 2018；ACSM 2026 抗阻处方立场声明未把时段列为关键变量）。
- 观察性数据（UK Biobank：肥胖人群晚间 17:00–24:00 MVPA 全因死亡 HR 0.39 最低，Sabag 2024 *Diabetes Care*；普通人群午后最优，Feng 2023 *Nat Commun*）互相不完全一致，**只作洞察文案，不作引擎规则**。首要结论：任何时段运动都优于不动。

### 1.3 最晚几点不该练：按强度对就寝倒推
- **剧烈运动在睡前 ≤1 小时结束**会损害入睡潜伏期、总睡眠与效率（Stutz 2019 *Sports Med* meta，23 项研究；晚间运动总体不损害睡眠、慢波睡眠反而 +1.3pp）。
- 大样本可穿戴数据：无论负荷，**睡前 ≥4 小时结束的运动与睡眠指标无关联**；4 小时内高负荷与入睡延迟、HRV 降低相关（Leota 2025 *Nat Commun*，14,689 人 / 408 万夜，观察性）。
- 运动后核心体温约 30–120 分钟回到基线（Kim 2023 综述）——「至少留 1–2 小时缓冲」的生理依据。
- → 引擎默认：**剧烈运动就寝前 ≥2 小时结束（两条证据线的折中）、中等强度 ≥1 小时**；就寝锚点优先取「今晚入睡建议」（`sleepAdvice`）的实际值。

### 1.4 最晚几点睡：就寝锚点的依据
- 22:00–22:59 入睡者心血管事件发生率最低；≥0:00 显著升高（HR 1.25），<22:00 也升高（U 型，不宣传「越早越好」）（Nikbakhtian 2021 *Eur Heart J-Digital Health*，UK Biobank n=103,712，观察性）。中国口径一致：全国爱卫办《睡眠健康核心信息及释义》（2025）建议成人 22:00–23:00 入睡、7–8 小时。
- 训练恢复角度：成人约 70% 睡眠期生长激素脉冲与上半夜慢波睡眠同步（Van Cauter 1996 *J Pediatr*）——晚睡会推迟/压缩合成代谢窗口；睡眠建议本体由 `sleepAdvice` 承担（见 `docs/sleep-advice-design.md`），本卡只把它当锚点引用。

## 2. 餐别分类标准

分类带为**设计取值 [C]**：覆盖中国居民膳食指南推荐用餐时段（早 6:30–8:30 / 午 11:30–13:30 / 晚 18:00–20:00），全天无缝划分，夜宵跨午夜。记录时按时刻自动预选、可手动改；旧记录无 `mealType` 字段时展示层按时刻即时分类兜底（不回写数据，编辑保存后自然补全）。

| 餐别 | id | 记录类型 | 分类带（本地墙钟，左闭右开） | 指南推荐用餐时段（参考，不参与分类） |
| --- | --- | --- | --- | --- |
| 早餐 | `breakfast` | 正餐 | 05:00–09:30 | 6:30–8:30 |
| 上午加餐 | `morning-snack` | 加餐 | 09:30–11:00 | —— |
| 午餐 | `lunch` | 正餐 | 11:00–14:00 | 11:30–13:30 |
| 下午加餐 | `afternoon-snack` | 加餐 | 14:00–17:00 | —— |
| 晚餐 | `dinner` | 正餐 | 17:00–20:00 | 18:00–20:00 |
| 晚上加餐 | `evening-snack` | 加餐 | 20:00–22:30 | —— |
| 夜宵 | `supper` | 加餐 | 22:30–次日 05:00 | ——（越晚越贴近就寝） |

- 数据模型：`db.rhythm.meals[]` 新增可选字段 `mealType`（四选一字符串），与既有 `local`（本地墙钟）/`kind`（正餐/加餐）并存。属于向后兼容的加列，`normalize` 不做强约束，旧数据零迁移。
- 分类只用于**展示与推荐编排**：不是营养评估，不评判「该不该吃夜宵」；用户手选餐别仅影响展示文案，推荐编排始终按实际时刻计算（改了时间推荐自动跟随）。
- 校验：`validateMeal` 对 `mealType` 做白名单校验；非法值拦截，缺省放行（兼容旧数据与外部导入）。

## 3. 餐后锻炼时机决策表（对应 `postMealTimingAdvice`）

输入：所选日期的进餐记录 + 参考时刻 + `bedMinutes`（今晚入睡锚点，缺省 23:00）。输出：最后一餐之后三条活动线的最早时刻与截止时刻。

| 步骤 | 规则 | 数值 | 出处 |
| --- | --- | --- | --- |
| 1 取最后一餐 | 所选日期内按 `local` 排序取末条；`local` 非法（正则+时分越界）的脏记录忽略 | —— | 录入口径同 rhythm |
| 2 低强度（散步/拉伸） | 餐后 ≥10 分钟可开始，建议 10–15 分钟、30 分钟内开始收益最大 | `walkStartMinutes: 10` | DiPietro 2013；Reynolds 2016（[A] RCT） |
| 3 中等强度（快走/慢跑） | 距正餐 ≥2 小时、距加餐 ≥30 分钟；今晚须就寝前 ≥1 小时结束 | `moderateGapMeal: 120 / moderateGapSnack: 30 / moderateBeforeBed: 60` | Mayo Clinic；Stutz 2019（[B] 指南+meta） |
| 4 中高强度（力量/HIIT） | 距正餐 ≥2 小时、距加餐 ≥60 分钟；今晚须就寝前 ≥2 小时结束；最早时刻到截止时刻不足 30 分钟判「今晚改期」 | `vigorousGapMeal: 120 / vigorousGapSnack: 60 / vigorousBeforeBed: 120` | Mayo/Cleveland Clinic；Stutz 2019；Leota 2025（[B]） |
| 5 大餐提示 | 正餐附提示：高脂大餐再多等约 1 小时（定性，不改变时刻计算） | —— | Mayo 口径 3–4h（[C] 定性映射） |
| 6 就寝锚点 | 视图层优先传 `sleepAdvice().bedtime`（`bedSource:'advice'`），无睡眠数据回退 23:00（`bedSource:'default'`）；锚点 <06:00 视为次日就寝 | `defaultBedMinutes: 1380` | Nikbakhtian 2021（[B] 观察性） |
| 7 高表现窗 | 14:00–19:00，改期建议与空态文案引用；只作排序参考 | `performanceWindow: 840–1140` | Knaier 2022 meta（[A]） |

展示：力量训练页顶部给出钟点（例如「14:00 之后开始」），不跑倒计时。今天还没有进餐时，用上一次进食（可以是昨天）。仅当天谈「现在可以开始」，历史日期只回放那天的时刻。加餐（含晚上加餐）的力量训练等待取 1 小时，正餐取 2 小时。

## 4. 边界与诚实性

- 全部为**习惯编排参考，不是运动处方**；不测量血糖、不预测睡眠表现，不构成「餐后血糖预测」「锻炼效果保证」（已加入 `prohibitedOutputs`）。
- 间隔与截止是**人群共识/证据带取保守下限**，个体差异真实存在；文案允许用户自行调整，不用「必须/禁止」。
- 就寝锚点的健康关联为**观察性证据**：文案用「相关/建议」，不用「晚睡导致疾病」式因果表述；不宣传「越早睡越好」（U 型）。
- 大餐提示是定性引导——应用刻意不记食物构成（见 `docs/nutrition-advice-design.md`），不虚构热量精度。
- 糖尿病用药（胰岛素/磺脲类）、胃轻瘫等人群不适用默认间隔，免责声明提示遵医嘱。
- 时段研究多为小样本 RCT 或观察性队列：本功能只引用「高表现窗」作排序参考，不判定用户的「最佳时段」。

## 5. 代码映射

| 内容 | 位置 |
| --- | --- |
| 阈值与来源注册表（`mealType` / `postMealWorkout` / `eveningWorkout` / `performanceWindow` 规则 + 9 个新来源） | `src/js/rhythm-evidence.js` |
| 餐别分类带、`classifyMealType` / `mealTypeLabel`、`validateMeal` 白名单 | `src/js/rhythm-engine.js` |
| `postMealTimingAdvice` 纯函数（依赖 evidence + engine，双通道加载同 rhythm-engine） | `src/js/strength-core.js` |
| 记餐弹窗（餐别下拉、改时间自动跟随、手动覆盖标记）、列表餐别文案、保存 toast | `src/js/rhythm.js`（`mealModal` / `mealTypeText`） |
| 「餐后锻炼时机」卡、就寝锚点获取（`sleepAdvice` 复用）、「去记一餐」跳转 | `src/js/strength.js`（`_mealTimingCard` / `_mealTimingBedMinutes`，挂在今日训练页建议卡之后） |
| 测试 | `tests/test-meal-type.js`（分类边界/白名单）；`tests/test-post-meal-timing.js`（间隔、截止、改期、加餐、倒计时、脏数据） |

## 6. 主要来源

**餐后时机**
- DiPietro L et al. 2013, 三餐后 15 分钟步行与 24h 血糖, *Diabetes Care*. [PubMed 23761134](https://pubmed.ncbi.nlm.nih.gov/23761134/)
- Reynolds AN et al. 2016, 每餐后 10 分钟步行, *Diabetologia*. [PubMed 27747394](https://pubmed.ncbi.nlm.nih.gov/27747394/)
- Buffey AJ et al. 2022, 轻强度活动打断久坐的餐后血糖 meta, *Sports Med*. [PubMed 35147898](https://pubmed.ncbi.nlm.nih.gov/35147898/)
- Morton D & Callister R 2015, 岔气（ETAP）机制综述, *Sports Med*. [PubMed 25178498](https://pubmed.ncbi.nlm.nih.gov/25178498/)
- Hunt JN & Stubbs DF 1975, 胃排空与能量密度, *J Physiol*. [PubMed 1127608](https://pubmed.ncbi.nlm.nih.gov/1127608/)
- Mayo Clinic, Eating and exercise: 5 tips to maximize your workouts. [原文](https://www.mayoclinic.org/healthy-lifestyle/fitness/in-depth/exercise/art-20045506)
- Thomas DT et al. 2016, ACSM/AND/DC 营养与运动立场声明, *MSSE*. [PubMed 26891166](https://pubmed.ncbi.nlm.nih.gov/26891166/)

**锻炼时段与晚间截止**
- Knaier R et al. 2022, 昼夜变化与最大耐力/力量 meta, *MSSE*. [PubMed 34431827](https://pubmed.ncbi.nlm.nih.gov/34431827/)
- Stutz J et al. 2019, 晚间运动与睡眠 meta, *Sports Med*. [PubMed 30374942](https://pubmed.ncbi.nlm.nih.gov/30374942/)
- Leota J et al. 2025, 晚间运动与睡眠的剂量-反应, *Nat Commun*. [原文](https://www.nature.com/articles/s41467-025-58271-x)
- Kim N et al. 2023, 运动时机/强度与生理节律综述, *Phys Act Nutr*. [DOI](https://doi.org/10.20463/pan.2023.0029)
- Savikj M et al. 2019, T2D 下午 vs 早晨 HIIT, *Diabetologia*. [PubMed 30426166](https://pubmed.ncbi.nlm.nih.gov/30426166/)
- Morales-Palomo F et al. 2024, 代谢综合征晨练更优 RCT, *J Physiol*. [PubMed 38015017](https://pubmed.ncbi.nlm.nih.gov/38015017/)
- Sabag A et al. 2024, 肥胖人群 MVPA 时段与死亡风险, *Diabetes Care*. [PubMed 38592034](https://pubmed.ncbi.nlm.nih.gov/38592034/)
- Schoenfeld BJ et al. 2014, 空腹 vs 餐后有氧与体成分 RCT, *JISSN*. [PubMed 25429252](https://pubmed.ncbi.nlm.nih.gov/25429252/)

**就寝锚点**
- Nikbakhtian S et al. 2021, 入睡时刻与心血管事件（UK Biobank）, *Eur Heart J-Digit Health*. [PMC9708010](https://pmc.ncbi.nlm.nih.gov/articles/PMC9708010/)
- Van Cauter E & Plat L 1996, 睡眠中的生长激素分泌, *J Pediatr*. [PubMed 8627466](https://pubmed.ncbi.nlm.nih.gov/8627466/)
- 全国爱卫办《睡眠健康核心信息及释义》2025（成人 7–8 小时、22:00–23:00 入睡）；AASM/SRS 2015 共识（≥7 小时）. [PubMed 25979105](https://pubmed.ncbi.nlm.nih.gov/25979105/)
