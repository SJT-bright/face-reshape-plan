/* Background evidence registry. Never rendered as an article or a health score. */
(function (root) {
  const evidence = {
    version: '2026-09-26.1', reviewedAt: '2026-09-26',
    sources: {
      sleep: { url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/', type: 'adult consensus', scope: '18–60 岁；经常每夜至少 7 小时；时段记录不能测量睡眠质量。' },
      lateEating: { url: 'https://pubmed.ncbi.nlm.nih.gov/36198293/', type: 'short randomized crossover', scope: '等热量延迟进食的代谢机制；不能预测个人脂肪增减。' },
      lateDinner: { url: 'https://pubmed.ncbi.nlm.nih.gov/32525525/', type: 'randomized crossover, n=20', scope: '固定睡眠下 18 点与 22 点晚餐的急性代谢差异；不是普适的钟点界线。' },
      reflux: { url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8754510/', type: 'conditional guideline, low evidence', scope: 'GERD 人群建议避免睡前 2–3 小时进餐；仅在有反酸时提供条件性建议。' },
      regularMeals: { url: 'https://pubmed.ncbi.nlm.nih.gov/27305952/', type: 'randomized crossover, n=11', scope: '餐次规律的短期试验；不能导出个人时刻波动的临床阈值。' },
      regularSleep: { url: 'https://pubmed.ncbi.nlm.nih.gov/39603689/', type: 'prospective observational cohort', scope: '设备测量的睡眠规律与心血管事件相关；本产品不是 SRI，也不移植风险比。' },
      calorieRestriction: { url: 'https://pubmed.ncbi.nlm.nih.gov/35443107/', type: '12-month randomized trial, n=139', scope: '限时进食叠加热量限制未显示额外体脂改善；时间记录不能估算体脂。' },
      visceralFat: { url: 'https://www.nature.com/articles/s41591-024-03375-y', type: '12-week randomized trial, n=197', scope: '不同限时进食方案未显示额外内脏脂肪改善；不设置空腹奖励。' },
      breakfast: { url: 'https://pubmed.ncbi.nlm.nih.gov/24898236/', type: '16-week randomized trial, n=309', scope: '吃或不吃早餐的建议未产生可辨别的减重差异；不起床后固定分钟数的风险规则。' },
      muscle: { url: 'https://pubmed.ncbi.nlm.nih.gov/25926415/', type: '12-week randomized trial, n=44', scope: '年轻男性训练期间睡前蛋白补充；总蛋白不匹配，不可归因于时间本身，更不可外推到面部肌肉。' },
      skin: { url: 'https://pubmed.ncbi.nlm.nih.gov/25266053/', type: 'observational study, n=60 women', scope: '睡眠质量与皮肤屏障相关；不能由就寝时刻计算皮肤损伤。' },
      postMealWalk: { url: 'https://pubmed.ncbi.nlm.nih.gov/23761134/', type: 'randomized crossover, n=10', scope: '三餐后各 15 分钟步行对 24 小时血糖优于集中一次步行；样本小，是习惯提示不是降糖处方。' },
      postMealWalkDinner: { url: 'https://pubmed.ncbi.nlm.nih.gov/27747394/', type: 'randomized crossover, n=41', scope: '每餐后 10 分钟步行：餐后血糖约降 12%，晚餐后约降 22%；不预测个人血糖。' },
      mealTimingGuide: { url: 'https://www.mayoclinic.org/healthy-lifestyle/fitness/in-depth/exercise/art-20045506', type: 'clinical consumer guidance', scope: '正餐后 2–3 小时、大餐后 3–4 小时再运动的一般建议；共识口径，不是个体试验阈值。' },
      etap: { url: 'https://pubmed.ncbi.nlm.nih.gov/25178498/', type: 'systematic review', scope: '岔气机制：餐后状态与高渗饮料加重症状；运动前约 2 小时避免大量进食饮水是预防建议。' },
      eveningSleep: { url: 'https://pubmed.ncbi.nlm.nih.gov/30374942/', type: 'meta-analysis, 23 studies', scope: '晚间运动总体不损害睡眠；剧烈运动在睡前 ≤1 小时结束可能损害入睡。不是逐人处方。' },
      eveningDose: { url: 'https://www.nature.com/articles/s41467-025-58271-x', type: 'observational wearable, n=14,689', scope: '睡前 ≥4 小时结束的运动与睡眠指标无关联；观察性，不证明因果。默认 2 小时取两条证据线的折中。' },
      bedOnset: { url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9708010/', type: 'UK Biobank cohort, n=103,712', scope: '22:00–22:59 入睡者心血管事件最低、≥0:00 升高（U 型）；观察性相关，不作「晚睡致病」因果表述。' },
      performanceClock: { url: 'https://pubmed.ncbi.nlm.nih.gov/34431827/', type: 'meta-analysis, 29 studies', scope: '无氧功率与跳跃峰值 13:00–20:00、握力峰值 14:00–21:00；人群均值，不决定个人最佳时段。' },
      preWorkoutFuel: { url: 'https://pubmed.ncbi.nlm.nih.gov/26891166/', type: 'joint position stand (ACSM/AND/DC)', scope: '练前 1–4 小时按 1–4 g/kg 碳水进食的营养建议；本应用不记录食物量，仅用于文字提示。' }
    },
    rules: {
      shortSleep: { minutes: 420, minimumDays: 3, repeatedDays: 3, sources: ['sleep'], threshold: '7 小时来自成人共识；至少 3 个完整日且 3 日偏短是产品提醒门槛，不是诊断。' },
      nearBed: { minutes: 120, minimumPairs: 3, repeatedPairs: 3, sources: ['lateDinner', 'lateEating', 'reflux', 'muscle'], threshold: '2 小时作为描述性贴近睡前窗口；不据此认定肥胖、反流或肌肉受损。' },
      variability: { minutes: 60, minimumDays: 5, sources: ['regularMeals', 'regularSleep'], threshold: '环形标准差超过 60 分钟仅用于提示记录波动；非临床界线。' },
      /* 2026-09-26 增补：餐别分类与餐后锻炼时机（消费方 rhythm-engine / strength-core，文档 docs/meal-timing-workout-design.md） */
      mealType: { windows: { breakfast: [300, 570], morningSnack: [570, 660], lunch: [660, 840], afternoonSnack: [840, 1020], dinner: [1020, 1200], eveningSnack: [1200, 1350], supper: [1350, 1740] }, sources: [], threshold: '餐别分类带为设计取值：早餐 5:00–9:30、上午加餐 9:30–11:00、午餐 11:00–14:00、下午加餐 14:00–17:00、晚餐 17:00–20:00、晚上加餐 20:00–22:30、夜宵 22:30–次日 5:00（左闭右开）。覆盖膳食指南推荐用餐时刻，只用于展示和餐后锻炼时机，不是营养评估。' },
      postMealWorkout: { walkStartMinutes: 10, walkBestMinutes: 30, moderateGapMealMinutes: 120, vigorousGapMealMinutes: 120, moderateGapSnackMinutes: 30, vigorousGapSnackMinutes: 60, sources: ['postMealWalk', 'postMealWalkDinner', 'mealTimingGuide', 'etap', 'preWorkoutFuel'], threshold: '餐后 10–15 分钟即可低强度步行（30 分钟内开始收益最大）；中高强度距正餐 ≥2 小时、距加餐 ≥30–60 分钟为保守下限（指南口径 2–3 小时）。' },
      eveningWorkout: { vigorousBeforeBedMinutes: 120, moderateBeforeBedMinutes: 60, defaultBedMinutes: 1380, sources: ['eveningSleep', 'eveningDose', 'bedOnset'], threshold: '剧烈运动默认就寝前 ≥2 小时结束（证据带 1–4 小时）；中等强度 ≥1 小时；默认就寝锚点 23:00（22:00–23:00 入睡人群风险最低）。' },
      performanceWindow: { startMinutes: 840, endMinutes: 1140, sources: ['performanceClock'], threshold: '14:00–19:00 为人群表现峰值窗（无氧功率/跳跃峰值 13:00–20:00）；只作排序参考，不否定任何时段的锻炼价值。' }
    },
    prohibitedOutputs: ['健康分数', '疾病概率', '脸部或身体脂肪预测', '肌肉增长预测', '皮肤风险预测', '通用早餐期限', '最佳空腹时长', '推荐跳餐', '餐后血糖预测', '锻炼效果保证']
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = evidence;
  else root.RhythmEvidence = evidence;
})(typeof window !== 'undefined' ? window : globalThis);
