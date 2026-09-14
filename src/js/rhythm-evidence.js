/* Background evidence registry. Never rendered as an article or a health score. */
(function (root) {
  const evidence = {
    version: '2026-09-12.1', reviewedAt: '2026-09-12',
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
      skin: { url: 'https://pubmed.ncbi.nlm.nih.gov/25266053/', type: 'observational study, n=60 women', scope: '睡眠质量与皮肤屏障相关；不能由就寝时刻计算皮肤损伤。' }
    },
    rules: {
      shortSleep: { minutes: 420, minimumDays: 3, repeatedDays: 3, sources: ['sleep'], threshold: '7 小时来自成人共识；至少 3 个完整日且 3 日偏短是产品提醒门槛，不是诊断。' },
      nearBed: { minutes: 120, minimumPairs: 3, repeatedPairs: 3, sources: ['lateDinner', 'lateEating', 'reflux', 'muscle'], threshold: '2 小时作为描述性贴近睡前窗口；不据此认定肥胖、反流或肌肉受损。' },
      variability: { minutes: 60, minimumDays: 5, sources: ['regularMeals', 'regularSleep'], threshold: '环形标准差超过 60 分钟仅用于提示记录波动；非临床界线。' }
    },
    prohibitedOutputs: ['健康分数', '疾病概率', '脸部或身体脂肪预测', '肌肉增长预测', '皮肤风险预测', '通用早餐期限', '最佳空腹时长', '推荐跳餐']
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = evidence;
  else root.RhythmEvidence = evidence;
})(typeof window !== 'undefined' ? window : globalThis);
