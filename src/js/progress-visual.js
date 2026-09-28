/* src/js/progress-visual.js —— 进步可视化视觉参数（纯函数、无 DOM 依赖）。
   参数出处分层见 docs/progress-visual-params-design.md（除注明外均为 [C] 设计决策）。 */
(function (root) {
  'use strict';

  /* ---------- 常量 ---------- */

  /* 分数档位：min 为闭区间下界，判定自高向低 first-match（≥75 出色 → ≥50 稳固 → ≥25 发展中 → 其余待建立）；
     tier 为 1..4（数组序）。浅色四值为 strength.js scoreColor() 现行色，逐字兼容。 */
  const PROGRESS_TIERS = [
    { key: 'foundation',  min: 0,  label: '待建立', colorLight: '#9aa69f', colorDark: '#8b97ab', token: '--st-tier-foundation' },
    { key: 'developing',  min: 25, label: '发展中', colorLight: '#c59c58', colorDark: '#e2b45c', token: '--st-tier-developing' },
    { key: 'solid',       min: 50, label: '稳固',   colorLight: '#70aa8a', colorDark: '#8fd8b4', token: '--st-tier-solid' },
    { key: 'excellent',   min: 75, label: '出色',   colorLight: '#3f8f6c', colorDark: '#4ade80', token: '--st-tier-excellent' }
  ];

  /* 无数据态：score 非法或 confidence==='none' 时的视觉参数。
     浅色半透明灰 = scoreColor() 现行 none 分支色，逐字兼容。 */
  const NODATA = { key: 'nodata', label: '无数据', colorLight: 'rgba(121,139,130,0.28)', colorDark: 'rgba(147,161,181,0.20)', token: '--st-nodata' };

  /* 维度注册表：顺序即渲染顺序。字段名集中在 scoreField/changeField，
     enduranceScore / enduranceChangePercent 若最终定名不同，只改这一处。 */
  const DIMENSIONS = [
    { key: 'hypertrophy', label: '增肌刺激', scoreField: 'hypertrophyScore',     changeField: null,                     token: '--st-dim-hypertrophy', colorLight: '#6d5df1', colorDark: '#8f84f5' },
    { key: 'strength',    label: '力量趋势', scoreField: 'strengthScore',        changeField: 'strengthChangePercent',  token: '--st-dim-strength',    colorLight: '#4f7cff', colorDark: '#7d9bff' },
    { key: 'endurance',   label: '耐力',     scoreField: 'enduranceScore',       changeField: 'enduranceChangePercent', token: '--st-dim-endurance',   colorLight: '#0f7f95', colorDark: '#4cc4d9' }
  ];

  /* 趋势 tone → 颜色（浅/暗）。键与 deltaView().tone 一一对应。 */
  const TONE_COLORS = {
    up:    { light: '#15803d',              dark: '#4ade80' },
    down:  { light: '#c2410c',              dark: '#ffb4a1' },
    flat:  { light: 'rgba(44,58,71,0.55)',  dark: '#93a1b5' },
    empty: { light: 'rgba(44,58,71,0.55)',  dark: '#93a1b5' }
  };

  /* 微交互参数（见设计文档 §6）。视图层消费，禁止散落魔法数。 */
  const MOTION = {
    countUpMs: 600,        /* 综合分数字滚动时长 */
    countUpMinDelta: 5,    /* 分数变化 ≥5 才滚动，否则直接显示 */
    meterFillMs: 320,      /* 维度条 width 过渡（与现 .st-meter i 一致） */
    badgeTier: 4           /* 达标徽标：等级达到「出色」且 confidence==='good' 时显示 */
  };

  /* 趋势显示阈值 [C]（P7.1）：|Δ| ≥ 3% 才画箭头，以下（含 0）并入「持平」 */
  const DELTA_THRESHOLD = 3;

  /* ---------- 函数 ---------- */

  /* clampScore(score) → number|null
     非有限数（null/undefined/NaN/±Infinity/非数值类型）→ null；否则 clamp 到 [0,100] 并取整。 */
  function clampScore(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return null;
    return Math.round(Math.min(100, Math.max(0, score)));
  }

  /* theme 仅接受 'light' | 'dark'，其余值（含缺省）一律按 'light' */
  function normalizeTheme(theme) {
    return theme === 'dark' ? 'dark' : 'light';
  }

  /* levelOf(score, confidence?, theme?) → { tier, key, label, color, token }
     - score 无效（clampScore 为 null）或 confidence==='none' → nodata（无数据永远不落「待建立」，
       这是 0 分与 null 的分界）；tier 为 null。
     - 否则取 PROGRESS_TIERS 中 min ≤ score 的最高档；tier 为 1..4（数组序）。
     - confidence 除 'none' 外的任何值不影响分档。 */
  function levelOf(score, confidence, theme) {
    const t = normalizeTheme(theme);
    const clamped = clampScore(score);
    if (clamped === null || confidence === 'none') {
      return { tier: null, key: NODATA.key, label: NODATA.label,
        color: t === 'dark' ? NODATA.colorDark : NODATA.colorLight, token: NODATA.token };
    }
    for (let i = PROGRESS_TIERS.length - 1; i >= 0; i--) {
      if (clamped >= PROGRESS_TIERS[i].min) {
        const tier = PROGRESS_TIERS[i];
        return { tier: i + 1, key: tier.key, label: tier.label,
          color: t === 'dark' ? tier.colorDark : tier.colorLight, token: tier.token };
      }
    }
    /* 不可达（clamped ≥ 0 恒命中 foundation），防御兜底 */
    const fallback = PROGRESS_TIERS[0];
    return { tier: 1, key: fallback.key, label: fallback.label,
      color: t === 'dark' ? fallback.colorDark : fallback.colorLight, token: fallback.token };
  }

  /* deltaView(changePercent) → { arrow, text, tone }
     - 非有限数 → { arrow: '', text: '数据不足', tone: 'empty' }（对齐 formatChange 的 null 文案）
     - |v| < 3   → { arrow: '',  text: '持平', tone: 'flat' }（含 v===0）
     - v ≥ 3     → { arrow: '↑', text: `↑ ${Math.round(v)}%`, tone: 'up' }
     - v ≤ -3    → { arrow: '↓', text: `↓ ${Math.abs(Math.round(v))}%`, tone: 'down' }
     阈值比较用原始值；显示文本四舍五入取整。 */
  function deltaView(changePercent) {
    if (typeof changePercent !== 'number' || !Number.isFinite(changePercent)) {
      return { arrow: '', text: '数据不足', tone: 'empty' };
    }
    if (Math.abs(changePercent) < DELTA_THRESHOLD) return { arrow: '', text: '持平', tone: 'flat' };
    if (changePercent >= DELTA_THRESHOLD) {
      return { arrow: '↑', text: `↑ ${Math.round(changePercent)}%`, tone: 'up' };
    }
    return { arrow: '↓', text: `↓ ${Math.abs(Math.round(changePercent))}%`, tone: 'down' };
  }

  /* toneColor(tone, theme?) → string
     TONE_COLORS[tone][theme]；tone 非法按 'flat'，theme 规则同 levelOf。 */
  function toneColor(tone, theme) {
    const t = normalizeTheme(theme);
    const entry = Object.prototype.hasOwnProperty.call(TONE_COLORS, tone) ? TONE_COLORS[tone] : TONE_COLORS.flat;
    return entry[t];
  }

  /* meterView({ label, score, changePercent?, dimension, confidence?, theme? })
     → { label, state, valueText, fillPercent, fillToken, delta, tierKey, ariaLabel, classes }
     组合级入口：一次给出渲染一条维度条（含趋势 chip）所需的全部字段。
     - state 'empty'：score 非法或 confidence==='none' → 值 —、宽 0、nodata token、
         ariaLabel「${label} 数据不足」（视图层据此省略 aria-valuenow）、classes 含 st-meter-row--empty
     - state 'zero'：score === 0（confidence 非 none）→ 值 0、宽 0 + 档 1 色小段（视图层 min-width:8px）、
         ariaLabel「${label} 0 分，待建立」、classes 含 st-meter-row--zero
     - state 'ok'：其余 → 值为 clamp 后整数字符串、fillPercent 即该整数、tierKey 为 levelOf 的 key；
         ariaLabel「${label} N 分，${等级词}」，delta.tone 非 'empty' 时追加「，较上期${delta.text}」
     - classes 恒含 st-meter-row--${dimension.key}；dimension 非法返回 null；label 缺省按注册表查。 */
  function meterView(options) {
    const opts = options || {};
    const dim = DIMENSIONS.find((d) => d.key === opts.dimension);
    if (!dim) return null;
    const label = opts.label != null ? String(opts.label) : dim.label;
    const delta = deltaView(opts.changePercent);
    const classes = [`st-meter-row--${dim.key}`];
    const clamped = clampScore(opts.score);
    if (clamped === null || opts.confidence === 'none') {
      classes.push('st-meter-row--empty');
      return { label, state: 'empty', valueText: '—', fillPercent: 0,
        fillToken: NODATA.token, delta, tierKey: null,
        ariaLabel: `${label} 数据不足`, classes };
    }
    if (clamped === 0) {
      classes.push('st-meter-row--zero');
      const foundation = PROGRESS_TIERS[0];
      return { label, state: 'zero', valueText: '0', fillPercent: 0,
        fillToken: foundation.token, delta, tierKey: foundation.key,
        ariaLabel: `${label} 0 分，${foundation.label}`, classes };
    }
    const level = levelOf(clamped, opts.confidence, opts.theme);
    const suffix = delta.tone !== 'empty' ? `，较上期${delta.text}` : '';
    return { label, state: 'ok', valueText: String(clamped), fillPercent: clamped,
      fillToken: dim.token, delta, tierKey: level.key,
      ariaLabel: `${label} ${clamped} 分，${level.label}${suffix}`, classes };
  }

  /* ---------- 导出 ---------- */
  const api = { PROGRESS_TIERS, NODATA, DIMENSIONS, TONE_COLORS, MOTION,
                clampScore, levelOf, deltaView, toneColor, meterView };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProgressVisual = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
