# 今晚入睡建议 —— 调研与设计

> 触发时机：早上录入手环的入睡/起床时间后，自动生成「今晚几点上床」建议（睡眠板块卡片 + 保存提示）。
> 纯函数实现：`rhythm-engine.js` 的 `sleepAdvice(raw, now)`；UI 在 `rhythm.js` 的 `sleepAdviceHtml()`。
> 同时：睡眠时长改为按入睡→起床时间自动计算，不再提供手动时长输入（个人积累库导入的历史记录仍保留其自带手环时长）。

## 1. 调研结论（每条标注出处与可信度）

### 1.1 时长是第一位的：成人推荐 7–9 小时
NSF 2015 专家共识（两轮 Delphi / RAND-UCLA 法）：18–64 岁成人推荐**每晚 7–9 小时**；65 岁以上 7–8 小时（Hirshkowitz et al. 2015, *Sleep Health*）。AASM 与睡眠研究学会的推荐是**不少于 7 小时**。→ 引擎的目标时长一律夹在 7–9h（延长场景最多到 9.5h 卧床）。

### 1.2 规律性的证据不弱于时长：建议必须锚定个人习惯
- NSF 2023 睡眠时长与 variability 共识声明（Sletten et al. 2023）：一致的睡眠日程本身是推荐项。
- Windred et al. 2023（*SLEEP*）：睡眠规律性预测全因死亡率，**预测力可能强于时长本身**（观察性研究，关联而非因果）。
- 系统综述（2021，PubMed 33054339）：一致的入睡/起床时刻与有利健康结局相关。
→ 引擎设计：起床锚点取近 3 次起床时刻；计算出的入睡时刻与「昨晚之前的习惯入睡时刻」差超过 60 分钟时，向习惯时刻折半靠拢，并在理由里说明。

### 1.3 「今晚几点睡明早精神最好」的机制框架：两过程模型
Borbély 两过程模型（Process S 睡眠压力 + Process C 昼夜节律；2022 年综述）：清醒时腺苷（睡眠压力）累积、睡眠中消散；昼夜节律决定困倦的时间窗口。推论：
- **昨晚睡得短 → 今晚睡眠压力更高，可以更早上床、给更长的卧床机会**（引擎：偏短 → +30 分钟）。
- 入睡潜伏期按 **15 分钟**预留（健康成人正常约 10–20 分钟，Sleep Foundation；Cleveland Clinic）。睡得极快反而提示睡眠负债。

### 1.4 「90 分钟周期对齐」只是启发式——如实标注，不宣称精确
- 睡眠周期平均约 90 分钟，但**个体与夜间波动大（约 70–120 分钟）**，前半夜深睡占比高、REM 向清晨增多（Sleep Foundation；NIH 教科书章节）。
- 从慢波睡眠（深睡）中被唤醒的睡眠惰性更重（PMC5337178；Sleep Foundation「Sleep inertia: current insights」）；不过由于深睡集中在上半夜，**按足量时长睡到早晨的人自然多在浅睡/REM 醒来**。
- 澳大利亚 Sleep Health Foundation 直言基于周期计算的「睡眠计算器」是**不科学的噱头**：无法提前数小时预测你处于哪个分期。
→ 引擎只把目标时长换算成「约 N 个周期」作展示性参考（cycles = round(目标/90)，下限 4），**不做周期对齐宣称**；免责声明写明「睡眠分期无法提前精确预测」。

### 1.5 质量信号：夜醒与晨起感受
昨晚夜醒 ≥3 次或晨起感受 ≤2 分（或时长正常范围内综合分偏低）→ 今晚多留 30 分钟卧床机会。注意：**时长与质量不双重计分**——综合分含时长罚分，长睡眠者会因此被误判为「质量低」而继续加量，故质量判定排除该路径（引擎注释有说明）。

## 2. 决策表（对应 `sleepAdvice`）

输入：已完成的主睡眠记录（起床时刻、时长、质量成分）；输出：今晚入睡时刻 + 卧床时长 + 理由列表。

| 步骤 | 规则 | 出处 |
| --- | --- | --- |
| 1 目标时长 | 记录 ≥3 次：近 7 次均值夹在 420–540 分钟、按 15 分钟取整；否则通用 450 分钟（7.5h） | NSF 7–9h |
| 2 偏短延长 | 昨晚 < 目标 − 45 分钟 → +30 分钟（上限 570） | 睡眠压力（两过程模型） |
| 3 质量延长 | 夜醒 ≥3 或晨起感受 ≤2 或（时长 390–540 且综合分 <60）→ +30 分钟 | 夜醒/惰性研究 |
| 4 起床锚点 | 「明早定时起床」覆盖优先（如次日需早起，仅当天有效）；否则近 3 次起床时刻的**圆环 medoid**（抗离群值：某晚晚起不会拉偏锚点；circular 均值会被跨午夜离群值拉偏） | 规律性 |
| 5 入睡时刻 | 锚点 − 目标 − 15 分钟潜伏期 | 潜伏期 10–20 分钟 |
| 6 规律性靠拢 | 与「昨晚之前」的习惯入睡时刻（同为 medoid）差 >60 分钟 → 折半靠拢 | NSF 2023；Windred 2023 |
| 7 展示 | 「≈N 个周期」仅作参考；免责声明必带 | Sleep Health Foundation |

展示位置：睡眠板块建议卡（含「明早定时起床」输入）+ 首页「今日」顶部的紧凑建议条（点「看依据」跳转睡眠板块）。

## 3. 边界与诚实性

- 全部为**启发式参考、非医疗建议**；不诊断失眠/睡眠呼吸暂停等（持续困倦提示就医，与既有 short-sleep 提醒一致）。
- 规律性/时长的健康关联多为**观察性证据**，文案用「相关/推荐」而非「证明/保证」。
- 不做唤醒时刻干预、不假装能预测睡眠分期；无 RIR 类超范围功能。

## 4. 主要来源

- Hirshkowitz M et al. 2015, *National Sleep Foundation's sleep time duration recommendations*, Sleep Health. [PubMed 29073412](https://pubmed.ncbi.nlm.nih.gov/29073412/) · [NSF 页面](https://www.thensf.org/how-many-hours-of-sleep-do-you-really-need/)
- Sletten TL et al. 2023, *The importance of sleep regularity: a consensus statement*, Sleep Health. [PubMed 37684151](https://pubmed.ncbi.nlm.nih.gov/37684151/) · [NSF 说明](https://www.thensf.org/sleep-schedules-sleep-timing-guideline/)
- Windred DP et al. 2023/2024, *Sleep regularity is a stronger predictor of mortality risk than sleep duration*, SLEEP. [Oxford Academic](https://academic.oup.com/sleep/article/47/1/zsad285/7344663)
- 睡眠时刻/一致性系统综述（2021）: [PubMed 33054339](https://pubmed.ncbi.nlm.nih.gov/33054339/)
- Borbély A 2022, *The two-process model of sleep regulation: Beginnings*, [PMC9540767](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540767/)；腺苷与睡眠压力: [PMC9541543（Reichert 2022）](https://pmc.ncbi.nlm.nih.gov/articles/PMC9541543/)
- 睡眠惰性与深睡唤醒: [PMC5337178](https://pmc.ncbi.nlm.nih.gov/articles/PMC5337178/) · [Sleep Foundation: Sleep inertia](https://www.sleepfoundation.org/how-sleep-works/sleep-inertia)
- 睡眠周期与分期: [Sleep Foundation](https://www.sleepfoundation.org/stages-of-sleep) · [NIH Bookshelf](https://www.ncbi.nlm.nih.gov/books/NBK10996/)
- 对「睡眠计算器」的批评: [Sleep Health Foundation (AU)](https://www.sleephealthfoundation.org.au/news-and-articles/the-sleep-calculator-is-just-scientific-hype)
- 入睡潜伏期正常值: [Sleep Foundation: Sleep latency](https://www.sleepfoundation.org/how-sleep-works/sleep-latency) · [AASM 7h+ 声明](https://aasm.org/seven-or-more-hours-of-sleep-per-night-a-health-necessity-for-adults/)
