# 进步可视化 · 视觉参数规格（progress-visual）

> 范围：力量训练「进步可视化」标签页的分数呈现层——分档、颜色、维度条（新增耐力）、状态区分、暗色模式、微交互。
> 本文是**参数规格**，供实现 agent 照此编码；实现载体为一个新纯函数模块 `src/js/progress-visual.js` + `strength.css` / `dark.css` 的少量追加（见 §5、§4）。
> 证据层级沿用 docs/scoring-parameters.md 约定：**[A] 文献原值 / [B] 文献带内取值 / [C] 设计决策**。
> **本文几乎所有参数均为 [C]**——视觉呈现无文献给定，如实标注；[C] 不得在 UI 里伪装成文献结论。
> 约束：本文不改任何代码；`enduranceScore` / `enduranceChangePercent` 字段由另一设计稿定义，本文按该字段名消费，并让改名成本集中在单一常量（§5 `DIMENSIONS`）。

---

## 0. 现状基线（代码事实，非设计）

| 事实 | 出处 |
| --- | --- |
| 分数→颜色：`confidence==='none'` → `rgba(121,139,130,.28)`；overallScore ≥75 `#3f8f6c`、≥50 `#70aa8a`、≥25 `#c59c58`、其余 `#9aa69f` | `src/js/strength.js` `scoreColor()`（186–192 行） |
| 趋势文案：`formatChange()` null→「数据不足」、0→「持平」、带符号百分比 | 同上（193–197 行） |
| 置信徽标：`confidenceLabel()` none→暂无记录 / limited→样本较少 / good→趋势可参考 | 同上（198–200 行） |
| 维度条：`_meter(label, value, unavailable)`，`role="meter"`，无数据时 `aria-valuenow="0"`、宽 0、填充为紫蓝品牌渐变 `#6d5df1→#4f7cff`（所有维度同色） | 同上（1616–1624 行）+ `src/strength.css` `.st-meter i` |
| 详情卡结构：`st-detail-head`（肌群名+置信徽标）→ `st-scorehero`（56px 综合分）→ 增肌/力量两条 `_meter` → `st-facts`（6 格 3 列）→ 动作行 | `src/js/strength.js` 1564–1581 行 |
| 身体图热区：`--muscle-fill` 着色 + `aria-label="${label}，综合训练指数 ${overallScore}"` | 同上 1551–1561 行 |
| `buildMuscleProgress` 返回含 `strengthScore`（可为 null）、`confidence`（none/limited/good）、各分数均为 0–100 整数；**无任何既有字段叫耐力** | `src/js/strength-core.js` 831–906 行 |
| 暗色：`dark.css` 全部为 `html.dark .选择器 { 字面色 }` 覆盖，**目前没有 `--st-*` 自定义属性**；已有暗色绿 `#4ade80`、暗色灰蓝 `#93a1b5`/`#8b97ab`、暗色暖橙 `#ffb4a1` | `src/dark.css` |
| 减少动态：`src/ux.css` 已有全局 `@media(prefers-reduced-motion:reduce){ transition/animation 全禁 }` | `src/ux.css` |
| 脚本加载：`index.html` 顺序加载普通 `<script>`（CSP `script-src 'self'`，无 ESM）；`strength-core.js` 为 IIFE，浏览器挂 `window.StrengthCore`、Node 走 `module.exports` | `src/index.html` 74–92 行 |

已知偏差（实现时顺带修正，非新设计）：`_meter` 在无数据时写 `aria-valuenow="0"`——把「无数据」读成 0 分。§5 契约要求无数据时**省略** `aria-valuenow`，label 明示「数据不足」。

---

## 1. 分数→视觉参数总表

### 1.1 分档决策：沿用现有 4 档（0–24 / 25–49 / 50–74 / 75–100）

**结论：不采用 5 档，沿用 `scoreColor` 现行 4 档阈值。** 理由：

1. **兼容现状**：身体图 11 个肌群热区已按这套阈值着色上线，5 档会整体改变热区颜色语义，回归面大、收益小；
2. **训练学含义**：75–89 与 90–100 都处于「趋势良好」区间，二者差异不构成新的行为提示，为此新增一个颜色档位属于无信息增量；
3. **色盲安全**：档位颜色越多，红绿色觉障碍用户越难靠色相分辨；档位少 + 明度阶梯大 + 文字冗余（数字、等级词始终同显）更稳；
4. **认知负担**：等级词 4 个（待建立/发展中/稳固/出色）比 5 个更接近「段位」心智，动线是「看数字 → 看词」，不是「读色谱」。

| P1 | 分档参数 | 值 | 层级 | 理由 |
| --- | --- | --- | --- | --- |
| P1.1 | 档位边界 | `≥75` 出色、`≥50` 稳固、`≥25` 发展中、`<25` 待建立（min 闭区间，自上而下 first-match） | [C] | 与 `scoreColor` 现行阈值逐位一致，零迁移成本 |
| P1.2 | 等级标签 | 待建立 / 发展中 / 稳固 / 出色 | [C] | 两字短词与「暂无记录/样本较少/趋势可参考」徽标文风一致；「待建立」比「差/弱」中性，0 分不该被骂 |
| P1.3 | 适用分数 | `overallScore`（综合+热区）与四个维度分（增肌/力量/频率/耐力）共用同一分档 | [C] | 一套段位心智贯穿全页；频率分目前不单独成条，但复用无成本 |
| P1.4 | 越界处理 | `<0` 按 0、`>100` 按 100（clamp）；`NaN/Infinity/undefined/null` 按「无数据」 | [C] | 防御式渲染；无数据绝不落进「待建立」 |

### 1.2 档位颜色 token（明/暗两套）

浅色档色作**填充/描边**用（非文字），等级与分数一律以墨色文字承载（`#2c3a47`，对白底 ≈ 10.9:1），颜色只是冗余通道——这是整体无障碍姿态，见 P2.4。

| P2 | 档位 | 浅色（对白底对比度，估算） | 暗色（对 `#1a2332` 对比度，估算） | 层级 | 理由 |
| --- | --- | --- | --- | --- | --- |
| P2.1 | 出色 | `#3f8f6c`（≈3.9:1） | `#4ade80`（≈9.1:1） | 浅色=现状 [C]；暗色=**复用 dark.css 已有绿** | 暗色 `#4ade80` 已用于 `.pill.ok`、`.ab-tier-cell.got`，不引入新绿 |
| P2.2 | 稳固 | `#70aa8a`（≈2.7:1） | `#8fd8b4`（≈9.5:1） | [C] | 浅色沿用现状；暗色同色相提亮一档拉开明度阶梯 |
| P2.3 | 发展中 | `#c59c58`（≈2.5:1） | `#e2b45c`（≈8.2:1） | [C] | 同上；琥珀在暗面需要明显提亮才可辨 |
| P2.4 | 待建立 | `#9aa69f`（≈2.5:1） | `#8b97ab`（≈5.3:1） | 浅色=现状 [C]；暗色=**复用 dark.css 已有灰蓝** | 灰绿/灰蓝读作「暂未成型」而非「危险」；暗色 `#8b97ab` 已是 nav 文字色 |
| P2.5 | 无数据（null / confidence none） | `rgba(121,139,130,0.28)` | `rgba(147,161,181,0.20)` | 浅色=现状（scoreColor 的 none 分支）[C]；暗色 [C] | 半透明灰=「这里还没有信息」；与「0 分实色灰绿」形成材质差，见 §3 |
| P2.6 | 浅色档色低于 3:1 的说明 | 不加深、不改色 | — | [C] | WCAG 1.4.11 只约束「识别必需」的图形；此处颜色为装饰性冗余（数字+等级词+描边+aria 已四重承载）。追求完全达标可换 `#4e8f6f`/`#a3793a`，但会偏离既有视觉，本文不做 |

### 1.3 耐力维度专属主色（色盲安全）

| P3 | 参数 | 值 | 层级 | 理由 |
| --- | --- | --- | --- | --- |
| P3.1 | 耐力主色（浅） | `#0f7f95`（青色系，≈4.7:1 对白底） | [C] | 选**蓝青轴**：红绿色觉障碍（deutan/protan，占色觉异常绝大多数）保真能力最好的就是蓝黄轴；青色与档位绿（`#3f8f6c`，色相 ≈150°）拉开到 ≈190°，不与「分数档位绿」混淆 |
| P3.2 | 耐力主色（暗） | `#4cc4d9`（≈7.7:1 对 `#1a2332`） | [C] | 暗面提亮同款色相；与暗色档位绿 `#4ade80` 并排可辨 |
| P3.3 | 增肌维度色 | 浅 `#6d5df1` / 暗 `#8f84f5`（暗 ≈5.1:1） | [C] | 即现状 `_meter` 填充渐变的起点色——第一条维度条维持今天的视觉，零迁移 |
| P3.4 | 力量维度色 | 浅 `#4f7cff` / 暗 `#7d9bff`（暗 ≈6.0:1） | [C] | 渐变终点色，与增肌同源（今天两者本就并存于同一渐变）；紫/蓝与青的区分靠色相+明度双通道，另见 P3.6 冗余 |
| P3.5 | 维度条填充 = 维度身份色，**不随分数档变色** | 维度条始终用 P3.3–P3.5 的维度色；档位信息由数字+等级词+综合分承载 | [C] | 同一卡内若出现两套色码（条=档位色、热区=档位色但含义不同）会互相污染语义；条只有 10px 高，档位变色读不出来。备选方案「条填档位色」已否决 |
| P3.6 | 色盲冗余 | 维度条除颜色外必须带**文字维度名**（常显）；耐力条另加唯一图形冗余：条右端 6px 圆点标记（`::after`） | [C] | 紫/蓝/青三色在 tritanopia（极罕见）下趋同，文字维度名是硬保证；圆点让耐力在灰度打印/截图下仍可指认 |

### 1.4 进度条填充百分比换算

| P4 | 参数 | 值 | 层级 | 理由 |
| --- | --- | --- | --- | --- |
| P4.1 | 填充宽度 | `fillPercent = Math.round(clamp(score, 0, 100))`，即分数直映百分比 | [C] | 分数本身是 0–100，与现状 `_meter` 的 `width:${value}%` 一致 |
| P4.2 | 无数据 | `fillPercent = 0`，但轨道加虚线描边（`.st-meter-row--empty`），值显示 `—` | [C] | 「空轨」与「0 分」的视觉差见 §3；只靠宽 0 区分不了 |
| P4.3 | 轨道 | 高 10px、全圆角、`rgba(44,58,71,.1)`（暗色 `rgba(255,255,255,.1)`） | 浅色=现状 [C]；暗色 [C] | 沿用 `.st-meter`，暗色轨道与 `.ab-progress-track` 同款 |
| P4.4 | 填充圆角与过渡 | `border-radius: inherit`；`transition: width 320ms cubic-bezier(0.22,0.61,0.36,1)` | 浅色=现状 [C] | 与现 `.st-meter i` 逐字一致 |

### 1.5 aria 文案模板

| P5 | 元素 | 模板 | 层级 | 理由 |
| --- | --- | --- | --- | --- |
| P5.1 | 维度条（正常） | `aria-label="${维度名} ${分} 分，${等级词}"`；如该维度有趋势且 `delta.tone!=='empty'` 追加 `，较上期${delta.text}`。例：`力量趋势 64 分，稳固，较上期↑ 4%` | [C] | 屏幕阅读器一次读完「是多少/什么水平/在变好还是变坏」，无需逐元素停靠 |
| P5.2 | 维度条（无数据） | `aria-label="${维度名} 数据不足"`，**省略 `aria-valuenow`** | [C] | 修正现状「无数据读作 0 分」；`role="meter"` 允许缺 `aria-valuenow` |
| P5.3 | 维度条（0 分） | `aria-label="${维度名} 0 分，待建立"`，`aria-valuenow="0"` | [C] | 0 是真实测量值，必须与「数据不足」读法分开 |
| P5.4 | 热区 | `${label}，综合训练指数 ${overallScore}`（现状保留，overallScore 恒为数字不存在 null） | [C] | 已上线文案，不动 |
| P5.5 | 趋势箭头文本 | 视觉箭头 `↑/↓` 的 span 加 `aria-hidden="true"`，语义由 P5.1 的完整 label 承载 | [C] | 避免读屏把「箭头+百分号」拆碎 |

---

## 2. 四维呈现布局

### 2.1 详情卡（宽态 >900px）

维度条从 2 条变 3 条，顺序：**增肌刺激 → 力量趋势 → 耐力**（综合分权重里增肌是主驱动 0.6/0.45；耐力是新增、数据积累最慢，放最后）。`st-facts` 6 格保持不动。

```
┌ st-detail ─────────────────────────────────────────────┐
│ 当前肌群                              [趋势可参考]       │  ← st-detail-head（不变）
│ 胸部                                                   │
│                                                        │
│  72  / 100 综合训练指数                  ← st-scorehero（不变；数字墨色，不按档位变色）
│                                                        │
│  增肌刺激                                    72         │  ← 行首：维度名（左）值（右）
│  ██████████████████████████████░░░░░░░  紫 #6d5df1     │     10px 条 = st-meter
│                                                        │
│  力量趋势                          64   ↑ 4%           │  ← 值右侧新增 delta chip（绿色）
│  █████████████████████████░░░░░░░░░░░░  蓝 #4f7cff     │
│                                                        │
│  耐力 ●                              41   持平          │  ← 新维度；● 为耐力专属圆点冗余
│  ██████████████████░░░░░░░░░░░░░░░░░░░  青 #0f7f95     │     「持平」chip 用中性灰、无箭头
│                                                        │
│  ┌───────────┬───────────┬───────────┐                 │
│  │28 天有效组 │ 训练次数   │ 估算 1RM  │                 │  ← st-facts（不变，6 格）
│  ├───────────┼───────────┼───────────┤                 │
│  │力量变化    │ 负重容量   │ 最近训练   │                 │     「力量变化」保留 formatChange 文案
│  └───────────┴───────────┴───────────┘                 │     （与条上 delta 数值一致，冗余强调）
│  关联动作：卧推 · 飞鸟 …                                 │
└────────────────────────────────────────────────────────┘
```

| P6 | 布局参数 | 值 | 层级 | 理由 |
| --- | --- | --- | --- | --- |
| P6.1 | 维度条顺序 | 增肌刺激 / 力量趋势 / 耐力 | [C] | 与综合分权重序（0.6/0.45 主导）和新旧一致 |
| P6.2 | delta chip 位置 | 维度条首行右端、数值右侧，`font-size:12px; font-weight:700` | [C] | 与行内 12.5px 值并排不换行；窄轨上方一行放得下 |
| P6.3 | 条间距 | 维度条行距 `gap:5px`（现状 `.st-meter-row` grid gap），三条之间不再加额外分隔 | [C] | 三条已使 `st-detail` 变高，密度维持现状 |
| P6.4 | st-facts | 完全不变（6 格 3 列；≤560px 2 列） | [C] | 「力量变化」格保留；耐力变化只出现在条上，避免 7 格破网格 |
| P6.5 | 综合分 hero | 不显示综合 delta（数据层无 overallChangePercent），不做假趋势 | [C] | 无数据源就不画，防伪造 |

### 2.2 趋势显示（delta chip）

| P7 | 参数 | 值 | 层级 | 理由 |
| --- | --- | --- | --- | --- |
| P7.1 | 显示阈值 | `\|Δ\| ≥ 3%` 才显示箭头；否则显示「持平」（含 Δ=0） | [C] | e1RM 估算有 ±5% 绝对误差，但同动作前后窗口共享系统性偏差，变化量的噪声远小于绝对误差；3% 以下画箭头多是噪声。低于阈值与 0 合并成「持平」沿用 `formatChange` 语汇 |
| P7.2 | 文案 | `↑ 4%` / `↓ 3%` / `持平` / `数据不足`；百分数取整 | [C] | 与 P5.1 aria 模板同源（`deltaView()` 单一出处） |
| P7.3 | 颜色（浅/暗） | up `#15803d` / `#4ade80`；down `#c2410c` / `#ffb4a1`；flat `rgba(44,58,71,.55)` / `#93a1b5`；empty 同 flat | up/down 浅色=复用现状语义色（已完成 `#15803d`、待补记 `#c2410c`）[C]；暗色=复用 dark.css 已有色 [C] | 「变好=绿、变差=橙红」与周历状态色一致；`#ffb4a1` 暗色对比 ≈9.2:1 |
| P7.4 | 适用维度 | 仅力量（`strengthChangePercent`）与耐力（`enduranceChangePercent`）；增肌刺激无变化字段，不显示 chip | [C] | 数据层现状如此，不虚构 |
| P7.5 | 语义方向 | 正值恒为 up（变好）、负值恒为 down；两个字段都是「越高越好」，不需要方向翻转参数 | [C] | 简化契约；未来若加「退步也奖」类指标再扩参 |

### 2.3 紧凑态

| P8 | 断点 | 行为 | 层级 | 理由 |
| --- | --- | --- | --- | --- |
| P8.1 | ≤900px | `st-progress-grid` 落单列（现状）；三条维度条原样堆叠，不合并、不省略 | [C] | 触屏上维度条是主要可读元素，不做抽屉 |
| P8.2 | ≤560px | `st-scorehero strong` 56px → 44px；维度条首行允许「维度名左、值+delta 右」两端对齐换行为「名上、值下」 | [C] | 320px 宽时 `力量趋势 64 ↑ 4%` 约 200px 仍放得下，换行规则只是兜底 |
| P8.3 | 热区图 | 紧凑态热区颜色逻辑不变（§1.1 同一分档） | [C] | 单列后热区图仍是入口，颜色语义必须与详情卡一致 |

---

## 3. 状态设计：null / limited / 0 三态不可混淆

| 状态 | 判定 | 数字位 | 条填充 | 附加标记 | aria |
| --- | --- | --- | --- | --- | --- |
| **无数据（null）** | `score` 非有限数，或 `confidence==='none'` | `—`（灰色，非 0） | 宽 0 + **轨道虚线描边**（`--st-nodata`），无填充 | 维度名旁不加等级词；整肌群无数据时沿用现有置信徽标「暂无记录」 | `${维度名} 数据不足`，无 `aria-valuenow` |
| **数据有限（limited）** | `score` 有效且 `confidence==='limited'` | 正常显示分数 | 正常维度色填充 | 页头置信徽标「样本较少」（现状灰底徽标，不变）——有限是**置信度**概念，不是分数档概念，不改分数渲染 | `${维度名} N 分，${等级}`（徽标由 `st-confidence` 自行播报） |
| **0 分** | `score === 0` 且 confidence 非 none | `0`（墨色） | 宽 0 + 档 1 色 `--st-tier-foundation` 的 8px 圆头小段（`min-width:8px`），实色 | 等级词「待建立」正常显示 | `${维度名} 0 分，待建立`，`aria-valuenow="0"` |

| P9 | 参数 | 值 | 层级 | 理由 |
| --- | --- | --- | --- | --- |
| P9.1 | null ≠ 0 的材质差 | 虚线空轨 vs 实色小段 | [C] | 单靠「数字位 — vs 0」在扫视时不够；轨道质感是第二通道 |
| P9.2 | 0 分小段 | `min-width:8px` 实色档 1 色 | [C] | 宽 0 的条在视觉上与空轨无法区分，8px 圆头是「确实练过但还没有产出」的可读证据 |
| P9.3 | limited 不变色 | 分数与条照常渲染，只靠现有 `st-confidence` 徽标表达 | [C] | 把「样本少」画进条里会让用户误读分数本身打折；置信度已有专属出口 |

---

## 4. 暗色模式变量对照表

命名遵循 `st-` 前缀（模块内既有类名空间），以**自定义属性**集中管理：token 定义放 `src/strength.css` 的 `:root`，暗色覆盖放 `src/dark.css` 的 `html.dark { … }`（满足 `tests/test-dark-css.js`「每条规则必须作用域化在 html.dark 下」的契约）。组件样式一律消费 token，dark.css 只需要覆盖变量本身，不再逐类写字面色。

| Token（strength.css `:root`） | 浅色值 | `html.dark` 覆盖值 | 用途 |
| --- | --- | --- | --- |
| `--st-tier-foundation` | `#9aa69f` | `#8b97ab` | 档 1（待建立）填充/描边 |
| `--st-tier-developing` | `#c59c58` | `#e2b45c` | 档 2（发展中） |
| `--st-tier-solid` | `#70aa8a` | `#8fd8b4` | 档 3（稳固） |
| `--st-tier-excellent` | `#3f8f6c` | `#4ade80` | 档 4（出色） |
| `--st-nodata` | `rgba(121,139,130,0.28)` | `rgba(147,161,181,0.20)` | 无数据热区/空轨 |
| `--st-dim-hypertrophy` | `#6d5df1` | `#8f84f5` | 增肌维度条填充 |
| `--st-dim-strength` | `#4f7cff` | `#7d9bff` | 力量维度条填充 |
| `--st-dim-endurance` | `#0f7f95` | `#4cc4d9` | 耐力维度条填充（专属主色） |
| `--st-delta-up` | `#15803d` | `#4ade80` | 趋势变好 |
| `--st-delta-down` | `#c2410c` | `#ffb4a1` | 趋势变差 |
| `--st-delta-flat` | `rgba(44,58,71,.55)` | `#93a1b5` | 持平/数据不足 |

对比度说明（估算值，按各档对浅色瓷白面 ≈ 白底、暗色对卡片面 `#1a2332`）：

- **暗色全套 ≥5.3:1**：暗色值承担更多识别职责（暗面下非文字图形同样要求 3:1，本套全部富余），这也是暗色值整体提亮的原因——暗色下「更亮」不等于「更好」，档位语义由色相+文字承载，明度只是可读性。
- **浅色档色 2.5–3.9:1**：见 P2.6，属装饰性冗余通道，文字信息（数字、等级词、置信徽标）全部走墨色 `#2c3a47` / `rgba(44,58,71,*)`，对白底 ≥4.5:1。
- **耐力青色专项**：浅 `#0f7f95` ≈4.7:1、暗 `#4cc4d9` ≈7.7:1，两条都过 WCAG AA 文字线，因此耐力条即使未来要承担「选中态描边」也不需要换色。

---

## 5. 模块契约：`src/js/progress-visual.js`

纯函数模块，**无 DOM 依赖**（不出现 `document`/`window`，颜色只给字符串）。IIFE 结构与导出方式逐字沿用 `strength-core.js` 尾部模式：浏览器挂 `window.ProgressVisual`，Node 走 `module.exports`（测试可纯 require）。`index.html` 中插在 `strength-core.js` 之后、`strength.js` 之前（由实现 agent 添加该 `<script>` 行）。

```js
/* src/js/progress-visual.js —— 进步可视化视觉参数（纯函数、无 DOM 依赖）。
   参数出处分层见 docs/progress-visual-params-design.md（除注明外均为 [C] 设计决策）。 */

/* ---------- 常量 ---------- */

/* 分数档位：min 为闭区间下界，数组顺序即 first-match 顺序（自上而下）。
   浅色四值为 strength.js scoreColor() 现行色，逐字兼容。 */
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

/* ---------- 函数 ---------- */

/* clampScore(score) → number|null
   非有限数（null/undefined/NaN/±Infinity）→ null；否则 clamp 到 [0,100] 并取整。 */
function clampScore(score)

/* levelOf(score, confidence?, theme?) → { tier, key, label, color, token }
   - score 无效（经 clampScore 为 null）或 confidence==='none' →
       { tier: null, key: 'nodata', label: '无数据', color: NODATA 色, token: '--st-nodata' }
     —— 无数据永远不落入「待建立」，这是 0 分与 null 的分界。
   - 否则取 PROGRESS_TIERS 中第一个 min ≤ score 的档：
       tier 为 1..4（数组序），color 按 theme 取 colorLight/colorDark。
   - theme 仅接受 'light' | 'dark'，其余值（含缺省）一律按 'light'。
   - confidence 除 'none' 外的任何值（'limited'/'good'/undefined）不影响分档。 */
function levelOf(score, confidence, theme)

/* deltaView(changePercent) → { arrow, text, tone }
   - changePercent 非有限数 → { arrow: '', text: '数据不足', tone: 'empty' }（对齐 formatChange 的 null 文案）
   - |v| < 3            → { arrow: '',  text: '持平', tone: 'flat' }（含 v===0）
   - v ≥ 3              → { arrow: '↑', text: `↑ ${Math.round(v)}%`, tone: 'up' }
   - v ≤ -3             → { arrow: '↓', text: `↓ ${Math.abs(Math.round(v))}%`, tone: 'down' }
   阈值比较用原始值；显示文本四舍五入取整。3 为趋势显示阈值 [C]。 */
function deltaView(changePercent)

/* toneColor(tone, theme?) → string
   TONE_COLORS[tone][theme]；tone 非法按 'flat'，theme 规则同 levelOf。 */
function toneColor(tone, theme)

/* meterView({ label, score, changePercent?, dimension, confidence?, theme? })
   → { label, state, valueText, fillPercent, fillToken, delta, tierKey, ariaLabel, classes }
   组合级入口：一次给出渲染一条维度条（含趋势 chip）所需的全部字段。
   - state: 'empty' | 'zero' | 'ok'
       'empty'：score 非法或 confidence==='none' →
         valueText '—'，fillPercent 0，fillToken '--st-nodata'，tierKey null，
         ariaLabel `${label} 数据不足`（无 aria-valuenow，由视图层据此省略），
         classes 含 'st-meter-row--empty'
       'zero'：score === 0（confidence 非 none）→
         valueText '0'，fillPercent 0，fillToken '--st-tier-foundation'，tierKey 'foundation'，
         ariaLabel `${label} 0 分，待建立`，classes 含 'st-meter-row--zero'（视图层以 min-width:8px 实色小段渲染）
       'ok'：其余 → valueText 分数字符串，fillPercent = clamp 后整数，
         tierKey 为 levelOf 结果的 key
   - delta = deltaView(changePercent)；ariaLabel 在 'ok' 时为
       `${label} ${valueText} 分，${等级词}`，且 delta.tone !== 'empty' 时追加 `，较上期${delta.text}`；
       'zero' 时固定 `${label} 0 分，待建立`；'empty' 时固定 `${label} 数据不足`。
   - fillToken 为维度条 CSS 变量名（DIMENSIONS 注册表的 token，'empty'/'zero' 例外见上）。
   - classes 恒含 `st-meter-row--${dimension.key}`。
   - label 缺省按 dimension 在 DIMENSIONS 中查 label；dimension 非法返回 null。 */
function meterView(options)

/* ---------- 导出 ---------- */
const api = { PROGRESS_TIERS, NODATA, DIMENSIONS, TONE_COLORS, MOTION,
              clampScore, levelOf, deltaView, toneColor, meterView };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.ProgressVisual = api;
```

实现注意：

1. **视图接线**：`strength.js` 的 `_meter(label, value, unavailable)` 改为接收 `(dimensionKey, progress, theme)`，内部调 `meterView()`；热区颜色改调 `levelOf(p.overallScore, p.confidence, theme).color`（替换 `scoreColor`，后者逻辑由本模块接管，原函数删除或转发）。
2. **暗色判定**：`theme` 由视图层以 `document.documentElement.classList.contains('dark') ? 'dark' : 'light'` 得出；本模块不做任何 DOM 查询。
3. **delta 与 st-facts 并存**：`st-facts` 的「力量变化」保留 `formatChange` 文案（数值一致）；耐力变化只出现在耐力条 chip 上。
4. **测试建议**（供实现方新建 `tests/test-progress-visual.js`，纯 Node）：`levelOf(null)` 不落档、`levelOf(0)` 落档 1、`levelOf(25/50/75)` 边界闭区间、`deltaView(±3)` 边界、`meterView` 三态 ariaLabel 快照、`DIMENSIONS` 字段名与 `buildMuscleProgress` 返回字段一致性断言。

---

## 6. 微交互阈值

全部参数 [C]。全局已有 `ux.css` 的 `prefers-reduced-motion` 兜底（禁所有 transition/animation），JS 侧必须**再查一次** `matchMedia('(prefers-reduced-motion: reduce)').matches`，命中则跳过 rAF 循环直接显示终值——CSS 兜底管不住 JS 逐帧写 `textContent`。

| P10 | 交互 | 触发条件 | 参数 | 减少动态 |
| --- | --- | --- | --- | --- |
| P10.1 | 综合分数字滚动 | 选中肌群 key 与上次渲染不同，且 `\|新分 − 上次同肌群分\| ≥ 5`（`MOTION.countUpMinDelta`）；上次值存 `Strength.ui._lastOverallScores`（视图层内存，不落盘） | 600ms（`MOTION.countUpMs`），缓动 `cubic-bezier(0.22,0.61,0.36,1)`（与条过渡同款），`font-variant-numeric: tabular-nums` 防抖动 | 直接显示终值 |
| P10.2 | 维度条填充过渡 | 每次渲染（现有 CSS transition，无需 JS） | 320ms（`MOTION.meterFillMs`） | CSS 媒体查询自动失效（全局兜底 + strength.css 本地再写一份 `@media (prefers-reduced-motion: reduce) { .st-meter i, .st-scorehero strong { transition: none } }`） |
| P10.3 | 达标徽标 | `levelOf(overallScore).tier === MOTION.badgeTier` 且 `confidence === 'good'` 时，hero 右侧显示静态徽标「出色」：档 4 色 12% 透明底 + 档 4 色文字，12px 圆角胶囊 | 无动画、无音效、一次性不强弹 | 无动画所以天然满足 |
| P10.4 | 不做的事 | 不做 confetti/脉冲/震动；不做「每练一次就庆祝」 | — | 刻意保守：该页是复盘页不是激励游戏页，动效只用于「数字在变」的语义，不做奖励噪声 [C] |

---

## 7. 实现验收清单

- [ ] `progress-visual.js` 无 `document`/`window` 引用，纯 Node 可 require；
- [ ] `scoreColor` 语义由 `levelOf` 接管，身体图热区在旧数据下像素级同色（4 档 + none 半透明灰逐一比对）；
- [ ] `enduranceScore` 为 null 的肌群：耐力条显示 `—` + 虚线空轨 + aria 无 `aria-valuenow`；`strengthScore === null` 同样回归通过；
- [ ] `score === 0` 且 confidence 非 none：显示 `0`、等级「待建立」、8px 实色小段；
- [ ] 切换暗色后 11 个 token 全部来自 `html.dark` 变量覆盖，dark.css 新增选择器均以 `html.dark` 开头（过 `test-dark-css.js`）；
- [ ] 耐力条带圆点冗余标记与常显文字维度名；
- [ ] `matchMedia('(prefers-reduced-motion: reduce)')` 命中时无逐帧动画；
- [ ] delta 阈值 3%：±2.9% 显示持平、±3% 显示箭头。

## 8. 溯源衔接

本文全部参数为 **[C] 设计决策**，不新增 [A]/[B] 结论；训练学依据（组数带、1RM 公式、次数折算）的溯源仍在 docs/scoring-parameters.md §2，本文不重复、不改动。若维护者希望把本页视觉参数收入溯源总表，可在其 §2 末尾追加一行「视觉分档/配色：4 档 + 维度专属色 [C]，见 docs/progress-visual-params-design.md」——该改动不在本文权限内，留给维护者。
