/* 成分混搭知识引擎 —— 产品名 → 成分类别 → 冲突规则 → findings（纯函数，无 DOM；node 可测 / 浏览器双通道）
   数据与规则全部来自三份研究文档（证据层级 [A]指南文献原值 / [B]权威转述 / [C]设计决策；cite 指向其小节）：
   - docs/ingredient-kb-product-mapping-research.md   → 下文简称「映射研究§…」
   - docs/ingredient-kb-retinoid-acid-research.md     → 下文简称「维A研究§…」
   - docs/ingredient-kb-sensitivity-research.md       → 下文简称「敏感研究§…」
   设计原则：
   - 宁缺勿错：产品名无词面证据不映射、不猜类别（映射研究§2#35）；
   - 药品先行：药字号一律 isDrug，叠加即提示「遵医嘱、勿自行叠加」（映射研究§1）；
   - 显式豁免：阿达帕林×过氧化苯甲酰 化学稳定可同场（Epíduo 复方为证），壬二酸×维A类 公认兼容，
     这两条绝不能报冲突（维A研究§2/§3，防误报关键）；
   - 措辞克制：只说「刺激/泛红/屏障受损风险」，不做医疗诊断断言；advice 给可操作动作。 */

(function (root) {
  'use strict';

  /* ---------- 类别定义（label + 词面关键词；drug=该类通用词命中即视为药字号） ----------
     壬二酸标注「兼酸属性」但不给 acid 类：它对维A类温和兼容，须走独立豁免规则（维A研究§3）。 */
  const CLASSES = {
    retinoid: { label: '维A酸类（处方维A酸 / 护肤A醇）', active: true,
      kws: ['a醇', '视黄醇', 'retinol', 'hpr', 'a酯', '视黄醛', 'retinal', '视黄醇棕榈酸酯'] },
    acid: { label: '酸类（AHA/BHA/PHA）', active: true,
      kws: ['水杨酸', 'salicylic', 'bha', '果酸', '甘醇酸', '乙醇酸', 'glycolic', 'aha', '乳酸', '杏仁酸', '扁桃酸', 'mandelic', '乳糖酸', '葡糖酸内酯', 'pha', '辛酰水杨酸'] },
    azelaic: { label: '壬二酸类（杜鹃花酸，温和、与维A兼容）', drug: true,
      kws: ['壬二酸', '杜鹃花酸', 'azelaic'] },
    bpo: { label: '过氧化苯甲酰', active: true, drug: true,
      kws: ['过氧化苯甲酰', '苯甲酰过氧化物', '班赛', 'bpo', 'benzoyl'] },
    niacinamide: { label: '烟酰胺', kws: ['烟酰胺', 'niacinamide'] },
    vc: { label: '维生素C（抗氧化）', active: true, kws: ['抗坏血酸', 'ascorbic', '维生素c', '维c', 'vc'] },
    alcohol: { label: '酒精类（变性酒精/乙醇）', not: ['无酒精', '不含酒精', '零酒精', '苯乙醇', '苯氧乙醇'],
      kws: ['变性酒精', '变性乙醇', '酒精', '乙醇', 'alcohol denat', 'sd alcohol'] },
    photosensitizer: { label: '光敏成分（柑橘类精油，含呋喃香豆素）',
      kws: ['柠檬精油', '柠檬油', '青柠', '佛手柑', '葡萄柚精油', '葡萄柚油', '柑橘精油', 'bergamot'] },
    moisturizer: { label: '保湿修护',
      kws: ['玻尿酸', '透明质酸', 'hyaluronic', '神经酰胺', 'ceramide', '泛醇', '维b5', 'b5', 'panthenol', '保湿', '积雪草', '尿素', '角鲨烷', '乳木果'] },
    sunscreen: { label: '防晒', kws: ['防晒', 'spf', 'sunscreen'] },
    scrub: { label: '物理去角质（磨砂/洁面仪）', kws: ['磨砂', '去角质', '洁面仪', 'scrub'] },
    antibiotic: { label: '外用抗生素/抗菌药（疗程限制）', drug: true,
      kws: ['克林霉素', 'clindamycin', '夫西地酸', 'fusidic', '莫匹罗星', '百多邦', '红霉素软膏', '甲硝唑', 'metronidazole'] },
    hydroquinone: { label: '氢醌类（美白药）', drug: true, kws: ['氢醌', '对苯二酚', 'hydroquinone'] },
    tci: { label: '钙调磷酸酶抑制剂（药）', drug: true,
      kws: ['他克莫司', '普特彼', 'tacrolimus', '吡美莫司', '爱宁达', 'pimecrolimus'] },
    antiviral: { label: '外用抗病毒药', drug: true, kws: ['阿昔洛韦', 'aciclovir'] },
    antifungal: { label: '外用抗真菌药', drug: true, kws: ['酮康唑', '联苯苄唑', '特比萘芬', 'ketoconazole'] },
    steroid: { label: '外用糖皮质激素（「松/他索」词族，强提示）', drug: true,
      re: /(?:地塞米松|氢化可的松|卤米松|糠酸莫米松|曲安奈德|哈西奈德|氟轻松|倍他米松|氯倍他索|[松索]乳膏|[松索]软膏)/ },
    whitening: { label: '美白（非处方）', kws: ['熊果苷', 'arbutin', '曲酸', 'kojic', '377', '苯乙基间苯二酚'] },
    cleanser: { label: '温和清洁/基础护理', kws: ['氨基酸', '洁面', 'freeplus'] }
  };

  /* ---------- 产品名映射（映射研究§1 药品14条 + §2 护肤词面/品牌系列） ----------
     conf：高=词面含成分名 / 中=知名系列名 / 低=仅系列推测；未检索到的（修丽可EF）不编造，只留注释。 */
  const PRODUCT_MAP = [
    { kw: ['阿达帕林', '达芙文', 'differin', 'adapalene'], classes: ['retinoid'], isDrug: true, sub: 'adapalene', conf: '高', note: '[B] 通用名即成分；映射研究§1#1' },
    { kw: ['维a酸', '迪维', '全反式维a酸', 'tretinoin'], classes: ['retinoid'], isDrug: true, sub: 'tretinoin', conf: '高', note: '[B] 光不稳定；映射研究§1#2' },
    { kw: ['他扎罗汀', 'tazarotene'], classes: ['retinoid'], isDrug: true, sub: 'tazarotene', conf: '高', note: '[C] 维A研究§2：按非adapalene保守处理' },
    { kw: ['过氧化苯甲酰', '班赛', '苯甲酰过氧化物', 'bpo', 'benzoyl'], classes: ['bpo'], isDrug: true, conf: '高', note: '[B] 映射研究§1#3' },
    { kw: ['壬二酸', '杜鹃花酸', 'azelaic', '芙清', '司亚乐'], classes: ['azelaic'], isDrug: true, conf: '高', note: '[B] 兼酸属性但走独立兼容规则；映射研究§1#4' },
    { kw: ['克林霉素'], classes: ['antibiotic'], isDrug: true, conf: '高', note: '[B] 单用易耐药；映射研究§1#5' },
    { kw: ['甲硝唑'], classes: ['antibiotic'], isDrug: true, conf: '高', note: '[B] 主用于玫瑰痤疮；映射研究§1#6' },
    { kw: ['夫西地酸'], classes: ['antibiotic'], isDrug: true, conf: '高', note: '[B] 连用≤7~10天；映射研究§1#7' },
    { kw: ['氢醌', '对苯二酚'], classes: ['hydroquinone'], isDrug: true, conf: '高', note: '[B] 避免与刺激成分叠加；映射研究§1#8' },
    { kw: ['他克莫司', '普特彼'], classes: ['tci'], isDrug: true, conf: '高', note: '[B→C] 限流整理，入库前按说明书复核' },
    { kw: ['吡美莫司', '爱宁达'], classes: ['tci'], isDrug: true, conf: '高', note: '[B→C] 同上' },
    { kw: ['阿昔洛韦'], classes: ['antiviral'], isDrug: true, conf: '高', note: '[B] 对痤疮无效；映射研究§1#11' },
    { re: CLASSES.steroid.re, classes: ['steroid'], isDrug: true, conf: '高', note: '[C] 词形特征强提示；映射研究§1#12' },
    { kw: ['酮康唑', '联苯苄唑', '特比萘芬'], classes: ['antifungal'], isDrug: true, conf: '高', note: '[B] 映射研究§1#13' },
    { kw: ['莫匹罗星', '百多邦', '红霉素软膏'], classes: ['antibiotic'], isDrug: true, conf: '高', note: '[B] 映射研究§1#14' },
    { kw: ['小白瓶'], classes: ['niacinamide'], conf: '中', note: '[中] OLAY 多版本，以成分表为准；映射研究§2' },
    { kw: ['修丽可ce', 'ce ferulic'], classes: ['vc'], conf: '中', note: '[中] 知名系列；映射研究§2' },
    { kw: ['修丽可ef'], classes: [], conf: '低', note: '未检索到官方对应，不映射（宁缺勿错）；映射研究§2#34' },
    { kw: ['理肤泉k', 'effaclar k', 'k乳'], classes: ['acid', 'retinoid'], conf: '中', note: '[中] 水杨酸+LHA+视黄醇酯；映射研究§2' },
    { kw: ['effaclar duo', '理肤泉duo', 'duo乳'], classes: ['acid', 'niacinamide'], conf: '中', note: '[中] 版本警告：美版含BPO 5.5%；映射研究§2' },
    { kw: ['芙丽芳丝', 'freeplus'], classes: ['cleanser'], conf: '中', note: '[中] 氨基酸表活；映射研究§2' },
    { kw: ['适乐肤sa', 'cerave sa', 'sa乳'], classes: ['acid', 'moisturizer'], conf: '中', note: '[中] SA=水杨酸；映射研究§2' },
    { kw: ['适乐肤', 'cerave'], not: ['sa'], classes: ['moisturizer', 'niacinamide'], conf: '中', note: '[中] 「C」指品牌而非VC，防误判；映射研究§2' },
    { kw: ['薇诺娜'], classes: ['moisturizer'], conf: '中', note: '[中] 修护舒缓定位；映射研究§2' },
    { kw: ['早c晚a'], classes: ['vc', 'retinoid'], conf: '低', note: '[C] 套装词，建议拆成两件分别录入；映射研究§2#36' }
  ];

  /* 通用词面规则并入匹配表（映射研究§2 编码要点：词面命中成分词即高置信） */
  const MATCHERS = PRODUCT_MAP.concat(Object.keys(CLASSES).map(key => {
    const c = CLASSES[key];
    return { kw: c.kws || null, re: c.re || null, not: c.not || null, classes: [key], isDrug: !!c.drug, conf: '高', note: '[C] 词面通用词（映射研究§2）' };
  })).filter(m => m.kw || m.re);

  const CONF_RANK = { '高': 3, '中': 2, '低': 1 };
  const PHASES = { morning: '晨间', day: '日间', evening: '晚间' };
  const PHASE_KEYS = ['morning', 'day', 'evening'];
  const ACTIVE_CLASSES = ['acid', 'retinoid', 'bpo', 'vc']; // 屏障过载计数口径（敏感研究§6 R19）
  const DRUG_ACTIVE_COSMETIC = ['acid', 'retinoid', 'vc', 'scrub']; // 药膏×功效护肤的「功效护肤」口径
  const RANK = { avoid: 3, caution: 2, info: 1 };

  /* ---------- 规则表（三份研究草稿去重合并，共 24 条）----------
     severity：avoid=硬警告 / caution=谨慎提示 / info=信息（含正向搭配）。 */
  const RULES = [
    { id: 'R-VA-ACID', severity: 'avoid', title: '维A类 × 酸类同场', reason: '维A类与AHA/BHA都加速角质更新，同场叠加显著放大刺激、泛红与屏障受损风险，无额外收益', advice: '隔夜交替，或「酸放早晨、维A放晚上」；确需同场时先酸、间隔20–30分钟再涂维A，并加强保湿', evidence: 'B', cite: '维A研究§3 规则5/6' },
    { id: 'R-VA-VA', severity: 'avoid', title: '双A叠加（两种维A类 / 早A晚A）', reason: '两种维A类（处方维A酸与护肤A醇同算）叠加不增加收益、只放大刺痛脱屑；「早A晚A」同日双A属常见误区', advice: '只保留一种维A类；想换着用就隔夜交替，从每周2–3晚渐进并配合保湿', evidence: 'B', cite: '维A研究§1；映射研究§3#4' },
    { id: 'R-MULTI-ACID', severity: 'avoid', title: '多酸叠加（同场≥2种酸）', reason: '果酸/水杨酸/杏仁酸等多种酸同日同区叠加，是屏障受损、泛红脱屑的高频组合', advice: '一般选一种酸即可；其余酸改到别的夜晚，搭配舒缓保湿', evidence: 'B', cite: '映射研究§3#2；维A研究§4' },
    { id: 'R-VA-BPO', severity: 'avoid', title: '维A酸 × 过氧化苯甲酰（非阿达帕林）', reason: '过氧化苯甲酰可使维A酸失活（经典配方+光照下约2小时降解>50%），且两者刺激叠加', advice: '分时段使用：BPO放早晨、维A酸放晚上；产品标注微球/光稳定配方时可咨询医生后同场', evidence: 'A', cite: '维A研究§2 规则3/4' },
    { id: 'R-VA-BPO-ADAP', severity: 'info', title: '阿达帕林 × 过氧化苯甲酰：可同场', reason: '阿达帕林化学结构稳定，在BPO存在下不降解（Epíduo 即两者固定复方，FDA 批准）', advice: '可同场使用；注意保湿缓冲与晨间防晒；处方联用请遵医嘱', evidence: 'A', cite: '维A研究§2（Epíduo；Br J Dermatol 稳定性研究）' },
    { id: 'R-TRIO', severity: 'avoid', title: 'VC+酸+维A 同场三重叠加', reason: '低pH VC、酸类、维A类同时段叠加是高刺激组合，刺痛泛红风险最高', advice: '拆成「早C晚A」，酸类放另一晚；敏感肌一次只保留一个活性物', evidence: 'B', cite: '敏感研究§1/§7 R2–R4' },
    { id: 'R-OVERLOAD', severity: 'avoid', title: '活性物叠加过载（同场≥3个）', reason: '同一流程叠3个以上活性类（酸/维A/BPO/VC），功效叠加超出皮肤承受力，屏障受损风险陡增', advice: '功效品分早晚或隔天使用；同场活性物不超过1–2个，其余替换为保湿修护', evidence: 'B', cite: '敏感研究§6 R19；映射研究§3#15' },
    { id: 'R-SCRUB-ACID', severity: 'avoid', title: '酸类 × 物理去角质同场', reason: '磨砂/洁面仪与酸类同用属多种去角质方式叠加，是过剥脱与屏障损伤的高频成因', advice: '物理去角质与酸类分日进行；出现刺痛发红紧绷时全部停用，只留温和清洁+保湿+防晒', evidence: 'B', cite: '映射研究§3#3；维A研究§4 规则10' },
    { id: 'R-SCRUB-VA', severity: 'caution', title: '维A类 × 物理去角质同场', reason: '维A类本身促进角质更新，与磨砂叠加刺激加大', advice: '出现刺痛/脱屑即暂停物理去角质；两者不要排在同一时段', evidence: 'B', cite: '维A研究§4 规则11' },
    { id: 'R-VC-ACID', severity: 'caution', title: 'VC × 酸类同场', reason: '低pH左旋VC与酸类叠加刺激增大，敏感/干皮更易刺痛', advice: '敏感肌拆到不同时段；健康皮如无不适可继续，出现刺痛即分开', evidence: 'B', cite: '敏感研究§7 R2' },
    { id: 'R-BPO-IRRIT', severity: 'caution', title: '过氧化苯甲酰 × 刺激性护肤（酸/VC）同场', reason: 'BPO本身干燥脱皮常见，再叠刺激物会加重（该具体组合为通用原则推论级证据）', advice: 'BPO区域只配温和保湿；酸/VC挪到别的时段', evidence: 'C', cite: '映射研究§3#16（推论级）' },
    { id: 'R-ALCOHOL-ACTIVE', severity: 'caution', title: '含酒精产品 × 维A/酸/BPO 同场', reason: '高配比挥发酒精脱脂削弱屏障，与刺激活性物叠加更易干燥刺痛（干敏皮风险更高）', advice: '干敏皮避免同场；用后加强神经酰胺/脂肪酸类保湿', evidence: 'C', cite: '敏感研究§7 R9' },
    { id: 'R-NIA-LOWPH', severity: 'caution', title: '烟酰胺 × 多个低pH活性物同场', reason: '烟酰胺与多个低pH去角质产品同场可能放大flush样泛红（>10%浓度更明显）', advice: '烟酰胺选2–5%浓度、与强活性物错开；出现泛红即降频', evidence: 'C', cite: '敏感研究§7 R7' },
    { id: 'R-HQ-IRRIT', severity: 'avoid', title: '氢醌 × 刺激成分（BPO/酸/维A/VC）', reason: '氢醌与刺激成分叠加有红肿脱皮风险', advice: '氢醌单独夜间薄涂色斑处，初期每周2–3次，并在医生指导下使用', evidence: 'B', cite: '映射研究§1（氢醌行）；§3#10' },
    { id: 'R-DRUG-STACK', severity: 'caution', title: '多种药膏同场叠加', reason: '均为国药准字药品，自行叠加多种药膏的吸收、刺激与相互作用风险不可控', advice: '请遵医嘱使用，勿自行叠加或当护肤品长期天天用', evidence: 'B', cite: '映射研究§1 总原则/编码要点' },
    { id: 'R-DRUG-ACTIVE', severity: 'caution', title: '药膏 × 功效护肤同场', reason: '药膏与酸/VC/磨砂等刺激性护肤同场，刺激叠加且可能影响药效', advice: '药膏遵医嘱使用；同场功效护肤先停，保湿之后再上药', evidence: 'C', cite: '映射研究§1 编码要点 [C]' },
    { id: 'R-STEROID', severity: 'caution', title: '糖皮质激素药膏（强提示）', reason: '「XX松/XX德」类激素药膏当护肤品长期用，是激素依赖性皮炎的主要成因之一', advice: '面部激素遵医嘱并控制时长（强效连续≤20天量级）；不自行购买长期涂', evidence: 'B', cite: '映射研究§3#8' },
    { id: 'R-VA-DAY', severity: 'caution', title: '维A类白天使用', reason: '维A酸见光快速降解、效力明显下降，本身轻度光敏', advice: '移到晚间使用；白天严格防晒', evidence: 'A', cite: '维A研究§5 规则12/13' },
    { id: 'R-ESSENTIAL-DAY', severity: 'avoid', title: '柑橘类精油白天使用', reason: '冷压柑橘精油含呋喃香豆素，经UVA激活可引发晒后24–72小时的红斑与色素沉着（光毒反应）', advice: '含柠檬/青柠/佛手柑/葡萄柚精油的驻留产品改夜间用，或选蒸馏/FCF版本；白天误用则加强防晒并观察皮肤反应', evidence: 'B', cite: '敏感研究§5 R15（来源受限）' },
    { id: 'R-ACID-DAY', severity: 'info', title: '酸类白天使用', reason: 'AHA会使皮肤对紫外线更易感，「涂够防晒即可白天用」；BHA相对日光友好', advice: '白天用酸务必配足量防晒并适时补涂', evidence: 'B', cite: '敏感研究§5 R16/R17' },
    { id: 'R-ABX-COURSE', severity: 'info', title: '外用抗生素疗程提醒', reason: '克林霉素等外用抗生素单用易耐药，均有明确疗程概念', advice: '按疗程使用（克林霉素≤8~12周、夫西地酸≤7~10天），勿当日常护肤品长期单用；是否与BPO/维A类联用遵医嘱', evidence: 'B', cite: '映射研究§3#9' },
    { id: 'R-DUP-ACTIVE', severity: 'info', title: '同一活性物早晚重复', reason: '同一活性物一天内多个时段重复出现，叠加无额外收益，只增加刺激概率', advice: '固定一个时段使用即可；想加强改隔天/隔周渐进', evidence: 'C', cite: '映射研究§3#15 [C]' },
    { id: 'R-AMPM-VCVA', severity: 'info', title: '早C晚A：经典搭配', reason: 'VC晨间抗氧化与防晒协同（不能替代防晒），维A类晚间使用效力更稳，两者错开互不干扰', advice: '保持早C晚A即可；新手从低浓度、隔天起步', evidence: 'A', cite: '敏感研究§1；维A研究§5' },
    { id: 'R-VA-AZELAIC', severity: 'info', title: '壬二酸 × 维A类：可同流程', reason: '壬二酸温和、与维A类兼容性公认良好，联用有临床耐受性证据（壬二酸+阿达帕林提高缓解率）', advice: '可同流程：先涂维A待吸收后再壬二酸，或「壬二酸早/维A晚」；渐进引入', evidence: 'A', cite: '维A研究§3 证据6（Sacchidanand 2017）' }
  ];
  const RULE = {};
  RULES.forEach(r => { RULE[r.id.replace(/-/g, '_')] = r; });

  /* 显式兼容对（维A研究§2/§3）：命中即跳过「药品叠加/药膏×护肤」类通用提示 */
  function isCompatSet(products) {
    if (products.length !== 2) return false;
    const cls = new Set();
    products.forEach(p => p.classes.forEach(c => cls.add(c)));
    if (cls.has('azelaic') && cls.has('retinoid')) return true; // 壬二酸×维A类
    if (cls.has('bpo') && cls.has('retinoid')) {
      const rets = products.filter(p => p.classes.includes('retinoid'));
      return rets.length > 0 && rets.every(p => p.subs.includes('adapalene')); // 阿达帕林×BPO
    }
    return false;
  }

  /* ---------- 产品名 → 类别（宁缺勿错，无词面证据返回空） ---------- */
  function productClassOf(name) {
    const norm = String(name == null ? '' : name).toLowerCase().replace(/\s+/g, '');
    const out = { classes: [], matched: [], subs: [], isDrug: false, conf: null };
    if (!norm) return out;
    MATCHERS.forEach(m => {
      if (m.not && m.not.some(n => norm.includes(n))) return;
      const kwHit = m.kw && m.kw.find(k => norm.includes(k));
      if (!kwHit && !(m.re && m.re.test(norm))) return;
      m.classes.forEach(c => { if (!out.classes.includes(c)) out.classes.push(c); });
      if (m.sub && !out.subs.includes(m.sub)) out.subs.push(m.sub);
      out.matched.push(kwHit || (m.re ? '「松/他索」词族' : ''));
      if (m.isDrug) out.isDrug = true;
      if (CONF_RANK[m.conf] > (CONF_RANK[out.conf] || 0)) out.conf = m.conf;
    });
    out.matched = out.matched.filter(Boolean);
    return out;
  }

  /* ---------- 分析主函数 ----------
     入参 {steps:{morning:[{name}],day:[],evening:[]}}（容忍缺字段/字符串步项/空周期）。
     输出 {findings:[{severity,title,products,phases,reason,advice,evidence,cite,rule}], stats:{checked,avoid,caution,info}}。
     findings 按 avoid>caution>info 排序；同一产品组合只报一次、取最严等级。 */
  function analyzeMix(cycle) {
    const root = cycle && typeof cycle === 'object' ? cycle : {};
    const steps = root.steps && typeof root.steps === 'object' ? root.steps : root;
    const byPhase = {};
    let checked = 0;
    PHASE_KEYS.forEach(ph => {
      const list = Array.isArray(steps && steps[ph]) ? steps[ph] : [];
      const products = [];
      const names = new Set();
      list.forEach(raw => {
        const name = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? (raw.name || raw.product || '') : '');
        if (typeof name !== 'string' || !name.trim() || names.has(name)) return;
        names.add(name);
        checked++;
        products.push(Object.assign({ name }, productClassOf(name)));
      });
      byPhase[ph] = products;
    });

    const seen = new Map();
    function emit(key, rule, patch) {
      const f = Object.assign({
        severity: rule.severity, title: rule.title, products: patch.products || [], phases: patch.phases || [],
        reason: rule.reason, advice: rule.advice, evidence: rule.evidence, cite: rule.cite, rule: rule.id
      }, patch);
      const prev = seen.get(key);
      if (!prev || RANK[f.severity] > RANK[prev.severity]) seen.set(key, f);
    }
    const pick = (ph, c) => byPhase[ph].filter(p => p.classes.includes(c));
    const pairKey = (a, b) => 'P|' + [a.name, b.name].sort().join('∥');
    const cross = (arr) => Array.from(new Set(arr));

    /* --- 同场（同时段）规则 --- */
    PHASE_KEYS.forEach(ph => {
      const ps = byPhase[ph];
      const acid = pick(ph, 'acid'), ret = pick(ph, 'retinoid'), bpo = pick(ph, 'bpo'), vc = pick(ph, 'vc');
      const scrub = pick(ph, 'scrub'), alc = pick(ph, 'alcohol'), nia = pick(ph, 'niacinamide');
      const hq = pick(ph, 'hydroquinone'), drug = ps.filter(p => p.isDrug);
      const aze = pick(ph, 'azelaic');
      /* 维A×酸（壬二酸是独立类别，天然不进本规则 → 显式豁免，见 R-VA-AZELAIC） */
      ret.forEach(a => acid.forEach(b => emit(pairKey(a, b), RULE.R_VA_ACID, { products: [a.name, b.name], phases: [ph] })));
      /* 壬二酸×维A类：显式兼容 info（维A研究§3 证据6） */
      ret.forEach(a => aze.forEach(b => emit(pairKey(a, b), RULE.R_VA_AZELAIC, { products: [a.name, b.name], phases: [ph] })));
      /* 维A×BPO：tretinoin/tazarotene 避免；adapalene 显式豁免为 info（维A研究§2） */
      ret.forEach(a => bpo.forEach(b => {
        if (a.subs.includes('adapalene')) emit(pairKey(a, b), RULE.R_VA_BPO_ADAP, { products: [a.name, b.name], phases: [ph] });
        else if (a.subs.includes('tretinoin') || a.subs.includes('tazarotene')) emit(pairKey(a, b), RULE.R_VA_BPO, { products: [a.name, b.name], phases: [ph] });
      }));
      if (acid.length >= 2) emit('S|R-MULTI-ACID|' + ph, RULE.R_MULTI_ACID, { products: acid.map(p => p.name), phases: [ph] });
      if (acid.length && ret.length && vc.length) emit('S|R-TRIO|' + ph, RULE.R_TRIO, { products: cross(ret.concat(acid, vc).map(p => p.name)), phases: [ph] });
      const actives = ps.filter(p => p.classes.some(c => ACTIVE_CLASSES.includes(c)));
      if (actives.length >= 3) emit('S|R-OVERLOAD|' + ph, RULE.R_OVERLOAD, { products: actives.map(p => p.name), phases: [ph] });
      scrub.forEach(s => {
        acid.forEach(a => emit(pairKey(s, a), RULE.R_SCRUB_ACID, { products: [s.name, a.name], phases: [ph] }));
        ret.forEach(a => emit(pairKey(s, a), RULE.R_SCRUB_VA, { products: [s.name, a.name], phases: [ph] }));
      });
      /* VC × 酸同场；不要把维A × VC 记到这条酸类规则上 */
      acid.forEach(a => vc.forEach(b => emit(pairKey(a, b), RULE.R_VC_ACID, { products: [a.name, b.name], phases: [ph] })));
      bpo.forEach(b => acid.concat(vc).forEach(a => emit(pairKey(b, a), RULE.R_BPO_IRRIT, { products: [b.name, a.name], phases: [ph] })));
      hq.forEach(h => bpo.concat(acid, ret, vc).forEach(a => emit(pairKey(h, a), RULE.R_HQ_IRRIT, { products: [h.name, a.name], phases: [ph] })));
      alc.forEach(al => ret.concat(acid, bpo).forEach(a => emit(pairKey(al, a), RULE.R_ALCOHOL_ACTIVE, { products: [al.name, a.name], phases: [ph] })));
      if (nia.length && acid.concat(vc).length >= 2) emit('S|R-NIA-LOWPH|' + ph, RULE.R_NIA_LOWPH, { products: cross(nia.concat(acid, vc).map(p => p.name)), phases: [ph] });
      /* 药品叠加/药膏×功效护肤：显式兼容对（壬二酸×维A、阿达帕林×BPO）不报 */
      if (drug.length >= 2 && !(drug.length === 2 && isCompatSet(drug))) emit('S|R-DRUG-STACK|' + ph, RULE.R_DRUG_STACK, { products: drug.map(p => p.name), phases: [ph] });
      drug.forEach(d => ps.filter(p => !p.isDrug && p.classes.some(c => DRUG_ACTIVE_COSMETIC.includes(c))).forEach(a => {
        if (!isCompatSet([d, a])) emit(pairKey(d, a), RULE.R_DRUG_ACTIVE, { products: [d.name, a.name], phases: [ph] });
      }));
      pick(ph, 'steroid').forEach(s => emit('X|R-STEROID|' + s.name, RULE.R_STEROID, { products: [s.name], phases: [ph] }));
    });

    /* --- 跨时段规则 --- */
    const retByPhase = PHASE_KEYS.map(ph => ({ ph, ps: pick(ph, 'retinoid') }));
    retByPhase.forEach((x, i) => retByPhase.forEach((y, j) => {
      if (j < i) return;
      x.ps.forEach(a => y.ps.forEach(b => {
        if (x.ph === y.ph && a.name === b.name) return;
        emit(pairKey(a, b), RULE.R_VA_VA, {
          products: [a.name, b.name], phases: x.ph === y.ph ? [x.ph] : [x.ph, y.ph],
          title: x.ph === y.ph ? '双A叠加（两种维A类）' : '双A叠加（早A晚A）'
        });
      }));
    }));
    ['acid', 'bpo', 'vc', 'azelaic'].forEach(c => {
      const withPh = PHASE_KEYS.filter(ph => pick(ph, c).length);
      if (withPh.length >= 2) emit('C|R-DUP-ACTIVE|' + c, RULE.R_DUP_ACTIVE, { products: cross(withPh.flatMap(ph => pick(ph, c)).map(p => p.name)), phases: withPh });
    });
    if (pick('morning', 'vc').length && pick('evening', 'retinoid').length) {
      emit('C|R-AMPM-VCVA', RULE.R_AMPM_VCVA, { products: cross(pick('morning', 'vc').concat(pick('evening', 'retinoid')).map(p => p.name)), phases: ['morning', 'evening'] });
    }
    const dayRet = pick('morning', 'retinoid').concat(pick('day', 'retinoid'));
    if (dayRet.length) {
      const adapOnly = dayRet.every(p => p.subs.includes('adapalene'));
      emit('C|R-VA-DAY', RULE.R_VA_DAY, {
        products: dayRet.map(p => p.name), phases: PHASE_KEYS.filter(ph => pick(ph, 'retinoid').length && ph !== 'evening'),
        title: adapOnly ? '维A类白天使用（阿达帕林）' : undefined,
        reason: adapOnly ? '阿达帕林光稳定、白天使用有据可依，但说明书惯例仍是每晚一次' : RULE.R_VA_DAY.reason,
        advice: adapOnly ? '尽量挪到晚间使用；白天务必防晒' : RULE.R_VA_DAY.advice
      });
    }
    const dayPhoto = pick('morning', 'photosensitizer').concat(pick('day', 'photosensitizer'));
    if (dayPhoto.length) emit('C|R-ESSENTIAL-DAY', RULE.R_ESSENTIAL_DAY, { products: dayPhoto.map(p => p.name), phases: PHASE_KEYS.filter(ph => pick(ph, 'photosensitizer').length && ph !== 'evening') });
    const dayAcid = pick('morning', 'acid').concat(pick('day', 'acid'));
    if (dayAcid.length) emit('C|R-ACID-DAY', RULE.R_ACID_DAY, { products: dayAcid.map(p => p.name), phases: PHASE_KEYS.filter(ph => pick(ph, 'acid').length && ph !== 'evening') });
    const abx = PHASE_KEYS.flatMap(ph => pick(ph, 'antibiotic'));
    if (abx.length) emit('C|R-ABX-COURSE', RULE.R_ABX_COURSE, { products: cross(abx.map(p => p.name)), phases: PHASE_KEYS.filter(ph => pick(ph, 'antibiotic').length) });

    /* --- 汇总：avoid > caution > info 排序（同等级保持规则命中顺序）--- */
    const findings = Array.from(seen.values()).sort((a, b) => RANK[b.severity] - RANK[a.severity]);
    const stats = { checked, avoid: 0, caution: 0, info: 0 };
    findings.forEach(f => { stats[f.severity]++; });
    return { findings, stats };
  }

  const api = { CLASSES, PRODUCT_MAP, RULES, PHASES, ACTIVE_CLASSES, productClassOf, analyzeMix };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SkinKnowledge = api;
})(typeof window !== 'undefined' ? window : globalThis);
