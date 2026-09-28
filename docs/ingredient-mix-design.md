# 成分混搭检查 · 设计文档（skin-knowledge.js）

> 实现文件：`src/js/skin-knowledge.js`（纯函数模块，双通道导出：`module.exports` / `window.SkinKnowledge`）
> 测试：`tests/test-skin-knowledge.js`（14 条，已并入 `npm run test:unit`）
> 依据文档：`ingredient-kb-product-mapping-research.md`（简称「映射研究」）、`ingredient-kb-retinoid-acid-research.md`（「维A研究」）、`ingredient-kb-sensitivity-research.md`（「敏感研究」）。证据层级 [A]指南文献 / [B]权威转述 / [C]设计决策，沿研究文档标注。

## 1. 功能定位

护肤页「成分混搭检查卡」的知识引擎：用户在护肤流程（晨/日/晚三时段）里填的是产品名（如「阿达帕林凝胶」「宝拉2%水杨酸」），本模块把名称映射到成分类别，再按规则表输出冲突/提示/正向搭配 findings。不做 UI、无 DOM 依赖、可同步调用。

## 2. 算法管线

```
cycle = {steps:{morning:[{name}], day:[], evening:[]}}
  → 1. 解析：容忍缺字段/字符串步项/空周期；同时段同名去重
  → 2. productClassOf(name)：小写去空格后做词面子串/正则匹配
       （CLASSES 通用词 + PRODUCT_MAP 药品14条/品牌系列 并成一张 MATCHERS 表；
        一个产品可命中多类别；含 not 负面词守卫（无酒精/苯氧乙醇不误判酒精））
       无词面证据 → classes=[]，不猜（映射研究§2#35 宁缺勿错）
  → 3. 规则执行：同场(同时段)组合 → 跨时段 → 时段建议 → 类别内/药品
  → 4. 去重排序：同一产品组合只报一次、取最严等级（pair 键）；
       avoid > caution > info 排序；输出 stats{checked,avoid,caution,info}
```

显式兼容对（`isCompatSet`，绝不能报冲突）：
- 壬二酸 × 维A类（维A研究§3 证据6，联用耐受良好）→ info「可同流程」；
- 阿达帕林 × 过氧化苯甲酰（维A研究§2，Epíduo 固定复方为证）→ info「可同场」；
  二者同时豁免「多种药膏叠加 / 药膏×功效护肤」通用 caution。
- 壬二酸是独立类别（非 acid），天然不进「维A×酸」「多酸」「过载」规则。

## 3. 规则表全文（24 条）

| id | severity | 组合/条件 | 依据 | cite |
|---|---|---|---|---|
| R-VA-ACID | avoid | 维A类 × 酸类（AHA/BHA）同场 | B | 维A研究§3 规则5/6 |
| R-VA-VA | avoid | 双A：两种维A类同场，或同一日跨时段两次维A（早A晚A） | B | 维A研究§1；映射研究§3#4 |
| R-MULTI-ACID | avoid | 同场 ≥2 种酸 | B | 映射研究§3#2；维A研究§4 |
| R-VA-BPO | avoid | 维A酸(tretinoin/tazarotene) × BPO 同场 | A | 维A研究§2 规则3/4 |
| R-VA-BPO-ADAP | info | 阿达帕林 × BPO 同场（显式豁免） | A | 维A研究§2（Epíduo） |
| R-TRIO | avoid | VC + 酸 + 维A 同场三重叠加 | B | 敏感研究§1/§7 R2–R4 |
| R-OVERLOAD | avoid | 同场 ≥3 个活性类（酸/维A/BPO/VC） | B | 敏感研究§6 R19；映射研究§3#15 |
| R-SCRUB-ACID | avoid | 酸类 × 物理去角质（磨砂/洁面仪）同场 | B | 映射研究§3#3；维A研究§4 规则10 |
| R-SCRUB-VA | caution | 维A类 × 物理去角质同场 | B | 维A研究§4 规则11 |
| R-VC-ACID | caution | VC × 酸类同场 | B | 敏感研究§7 R2 |
| R-BPO-IRRIT | caution | BPO × 酸/VC 同场（推论级） | C | 映射研究§3#16 |
| R-ALCOHOL-ACTIVE | caution | 含酒精产品 × 维A/酸/BPO 同场 | C | 敏感研究§7 R9 |
| R-NIA-LOWPH | caution | 烟酰胺 × ≥2 个低pH活性物（酸/VC）同场 | C | 敏感研究§7 R7 |
| R-HQ-IRRIT | avoid | 氢醌 × BPO/酸/维A/VC | B | 映射研究§1（氢醌行）；§3#10 |
| R-DRUG-STACK | caution | 同场 ≥2 个药字号（兼容对豁免） | B | 映射研究§1 总原则 |
| R-DRUG-ACTIVE | caution | 药字号 × 功效护肤（酸/维A/VC/磨砂）同场（兼容对豁免；被同对更严规则去重） | C | 映射研究§1 编码要点 |
| R-STEROID | caution | 「XX松/XX他索」激素药膏（单品强提示） | B | 映射研究§3#8 |
| R-VA-DAY | caution | 维A类出现在晨/日间（阿达帕林措辞和缓，tretinoin 提示光降解） | A | 维A研究§5 规则12/13 |
| R-ESSENTIAL-DAY | avoid | 柑橘类精油（柠檬/青柠/佛手柑/葡萄柚）晨/日间 | B | 敏感研究§5 R15 |
| R-ACID-DAY | info | 酸类晨/日间 → 加强防晒 | B | 敏感研究§5 R16/R17 |
| R-ABX-COURSE | info | 外用抗生素（克林霉素/夫西地酸/莫匹罗星/甲硝唑）疗程提醒 | B | 映射研究§3#9 |
| R-DUP-ACTIVE | info | 同一活性类（酸/BPO/VC/壬二酸）早晚重复出现 | C | 映射研究§3#15 |
| R-AMPM-VCVA | info | VC 晨 + 维A 晚 →「早C晚A 经典搭配」 | A | 敏感研究§1；维A研究§5 |
| R-VA-AZELAIC | info | 壬二酸 × 维A类同场（显式兼容） | A | 维A研究§3 证据6 |

severity 分布：avoid 9 / caution 9 / info 6。每条 finding：`{severity,title,products,phases,reason,advice,evidence,cite,rule}`。

## 4. 导出 API

- `analyzeMix(cycle)` → `{findings, stats:{checked,avoid,caution,info}}`；容忍 `undefined/null/{}/缺 steps/空数组`，异常输入返回空 findings 不抛错。
- `productClassOf(name)` → `{classes:[key], matched:[关键词], subs:['adapalene'|'tretinoin'|…], isDrug, conf:'高'|'中'|'低'|null}`；无匹配 classes=[]。
- `CLASSES` / `PRODUCT_MAP` / `RULES` / `PHASES` / `ACTIVE_CLASSES`：数据表原样导出，供 UI 展示与后续维护。

## 5. 已知限制（如实）

1. **名称匹配的误报/漏报**：子串匹配无法读成分表——「适乐肤SA」按系列名给中置信映射；同名不同配方（如 DUO 乳美版含 BPO）无法区分；「修丽可EF」未检索到官方对应，**不映射不编造**（映射研究§2#34）。
2. **套装/复方产品不拆内部成分冲突**：一个产品命中多类别（如理肤泉K乳=酸+维A酯）不算「同场叠加」，配方内冲突不在检查范围。
3. **[B] 待复核清单**（承接研究文档待办）：小白瓶/DUO 乳/适乐肤SA 成分表抽样核对；他克莫司/吡美莫司条目为限流整理 [B→C]；柑橘精油光毒与 BPO×酸组合证据来源受限。
4. **未编码的研究规则**：敏感肌/孕期状态检测（R15/R20）、MIT/甲醛释放体防腐剂、VC×维A 同场对（R3，仅在「三重叠加」与「早C晚A」两端编码）。
5. **不构成医疗建议**：所有措辞限于「刺激/泛红/屏障受损风险」与可操作动作（隔夜交替、酸早维A晚、保湿之后上药等），药品类一律提示「遵医嘱」。

## 6. 与研究文档的关系

三份研究草稿（映射 36 条映射规则 + 维A 16 条规则 + 敏感 21 条规则）去重合并为本模块 24 条规则 + 25 组映射条目。合并取舍：同一组合在多文档出现时取更严等级、cite 双列；仅研究文档有、任务范围外的（孕期、敏感肌状态、防腐剂致敏原）未编码并在上节声明。偏离点：
- tretinoin/tazarotene × BPO 同场定为 **avoid**（维A研究规则表为「谨慎」；按任务要求取更保守档，advice 保留「光稳定配方可咨询医生后同场」的降级出口）；
- 「药膏×功效护肤」对已命中更严具体规则的组合不重复报（取最严等级去重）。
