/* 可编辑的跟练时间模板。面部训练效果证据有限；这些时长只是日程预设，
   不作为疗效、安全强度或个人训练量的承诺。 */

const TEMPLATES = [
  {
    id: 'tpl_starter_14',
    name: '新手启动 · 14天',
    tag: '从短时间开始，建立固定日程',
    weeks: 2,
    accent: '#22c55e',
    description: '第 1 周每天安排 5 分钟，第 2 周安排 10 分钟。适合刚开始建立跟练习惯的人；时间与提醒都可以调整。',
    principles: [
      '先从短时间开始，按自己的状态调整',
      '默认 21:30 提醒，可在跟练计划中修改',
      '第 2 周的预设目标由 5 分钟增至 10 分钟',
      '当天累计达到目标后，成就日历会点亮'
    ],
    phases: [
      {
        name: '第 1 周 · 唤醒期',
        dailyTargetMinutes: 5,
        sessions: [
          { name: '晚间瘦脸操', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], targetMinutes: 5 }
        ]
      },
      {
        name: '第 2 周 · 建立期',
        dailyTargetMinutes: 10,
        sessions: [
          { name: '晚间瘦脸操', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], targetMinutes: 10 }
        ]
      }
    ]
  },
  {
    id: 'tpl_progress_28',
    name: '进阶重塑 · 28天',
    tag: '逐周增加预设时长',
    weeks: 4,
    accent: '#f472b6',
    description: '每日目标逐周按 10、15、20、25 分钟预设；第 4 周另有周六 30 分钟安排。可按自己的状态调整。',
    principles: [
      '每周目标逐步增加，不必硬追预设时长',
      '训练安排和每日目标都可以自行修改',
      '第 4 周增设周六 30 分钟跟练',
      '默认 21:30 提醒，可在跟练计划中修改'
    ],
    phases: [
      {
        name: '第 1 周 · 适应',
        dailyTargetMinutes: 10,
        sessions: [
          { name: '晚间瘦脸操', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], targetMinutes: 10 }
        ]
      },
      {
        name: '第 2 周 · 提升',
        dailyTargetMinutes: 15,
        sessions: [
          { name: '晚间瘦脸操', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], targetMinutes: 15 }
        ]
      },
      {
        name: '第 3 周 · 强化',
        dailyTargetMinutes: 20,
        sessions: [
          { name: '晚间瘦脸操', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], targetMinutes: 20 }
        ]
      },
      {
        name: '第 4 周 · 深度',
        dailyTargetMinutes: 25,
        sessions: [
          { name: '晚间瘦脸操', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], targetMinutes: 20 },
          { name: '周六深度塑形', time: '15:00', days: [6], targetMinutes: 30 }
        ]
      }
    ]
  },
  {
    id: 'tpl_daily_long',
    name: '日常维持 · 长期',
    tag: '用固定时段维持日程',
    weeks: 0,
    accent: '#a78bfa',
    description: '每天安排 15 分钟晚间跟练，工作日早上另安排 3 分钟。适合希望维持固定日程的人；可以随时调整。',
    principles: [
      '晚间与晨间安排可分别调整或关闭',
      '晨间提醒可以放在刷牙后等固定时段',
      '漏练后可从下一次继续，日历会如实记录',
      '以适合自己的节奏维持日程'
    ],
    phases: [
      {
        name: '长期维持',
        dailyTargetMinutes: 15,
        sessions: [
          { name: '晨间面部唤醒', time: '07:40', days: [1, 2, 3, 4, 5], targetMinutes: 3 },
          { name: '晚间瘦脸操', time: '21:30', days: [0, 1, 2, 3, 4, 5, 6], targetMinutes: 15 }
        ]
      }
    ]
  }
];

const PlanTemplate = {
  current() { return Store.db.planTemplate || null; },
  tplById(id) { return TEMPLATES.find(t => t.id === id) || null; },

  /* 应用模板：替换旧模板会话（按 tplId 标记），写入当前阶段 */
  apply(tpl, startDate) {
    const oldSessions = Store.db.sessions.filter(s => !s.tplId);
    const kept = oldSessions; // 保留用户自建会话，仅替换模板生成的
    const phase = tpl.phases[0];
    const created = phase.sessions.map(x => ({
      id: uid('sess'), tplId: tpl.id, name: x.name, time: x.time,
      days: x.days.slice(), videoId: x.videoId || null,
      targetMinutes: x.targetMinutes, enabled: true
    }));
    Store.db.sessions = kept.concat(created);
    Store.db.settings.dailyTargetMinutes = phase.dailyTargetMinutes;
    Store.db.planTemplate = {
      tplId: tpl.id, startDate, phaseIndex: 0,
      phaseStart: startDate
    };
    Store.save(true);
  },

  /* 当前阶段信息 */
  phaseInfo() {
    const pt = this.current();
    if (!pt) return null;
    const tpl = this.tplById(pt.tplId);
    if (!tpl) return null;
    const phase = tpl.phases[pt.phaseIndex];
    const dayN = daysBetween(pt.phaseStart, todayKey()) + 1;
    const nextPhase = tpl.phases[pt.phaseIndex + 1] || null;
    return { tpl, phase, phaseIndex: pt.phaseIndex, dayN, phaseDays: phase.days || 7, nextPhase, pt };
  },

  /* 升级到下一阶段：更新会话目标与每日目标 */
  advance() {
    const pt = this.current();
    if (!pt) return false;
    const tpl = this.tplById(pt.tplId);
    const next = tpl.phases[pt.phaseIndex + 1];
    if (!next) return false;
    // 替换本模板生成的会话
    const kept = Store.db.sessions.filter(s => s.tplId !== tpl.id);
    const created = next.sessions.map(x => ({
      id: uid('sess'), tplId: tpl.id, name: x.name, time: x.time,
      days: x.days.slice(), videoId: x.videoId || null,
      targetMinutes: x.targetMinutes, enabled: true
    }));
    Store.db.sessions = kept.concat(created);
    Store.db.settings.dailyTargetMinutes = next.dailyTargetMinutes;
    pt.phaseIndex += 1;
    pt.phaseStart = todayKey();
    Store.save(true);
    return true;
  },

  stop() {
    delete Store.db.planTemplate;
    Store.db.sessions = Store.db.sessions.filter(s => !s.tplId);
    Store.save(true);
  }
};

/* ---------- 训练计划快捷导入：一行一个安排 ----------
   支持格式：瘦脸操10分钟 21:30 每天 BV1xxxx / 完整链接 / 抖音链接或分享口令
   可识别：时间 HH:MM、时长 N分钟、每天/工作日/周末/周一~周日、视频链接或BV号（B 站 / 抖音） */
const PlanImporter = {
  parseLine(line) {
    let s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) return null;
    const out = { name: s, time: null, targetMinutes: null, days: null, videoRef: null };

    // 视频（链接 / BV号 / av号 / 抖音链接或分享口令）
    const bv = s.match(/BV[0-9A-Za-z]{10}/);
    const av = s.match(/av(\d{3,})/i);
    const url = s.match(/https?:\/\/\S+/);
    if (bv) { out.videoRef = { type: 'bv', val: bv[0] }; }
    else if (av) { out.videoRef = { type: 'av', val: av[1] }; }
    else if (url && /bilibili/.test(url[0])) {
      const b2 = url[0].match(/BV[0-9A-Za-z]{10}/);
      const a2 = url[0].match(/av(\d{3,})/i);
      if (b2) out.videoRef = { type: 'bv', val: b2[0] };
      else if (a2) out.videoRef = { type: 'av', val: a2[1] };
    }
    else if (/douyin\.com|iesdouyin\.com/i.test(s)) {
      /* 抖音：分享口令噪声多，交给 Douyin.parse 提取链接（含不带 https:// 的短链）；
         短链此时还解析不出 vid，val 暂存 URL，vid 由主进程重定向解析。 */
      const d = (typeof Douyin !== 'undefined') ? Douyin.parse(s) : null;
      if (d) out.videoRef = { type: 'douyin', val: d.vid || d.url, url: d.url, vid: d.vid, title: d.title };
    }
    // 只有视频链接的行只加入视频库，不凭空创建一个默认时间的训练安排。
    out.videoOnly = !!out.videoRef && !s
      .replace(/(?:https?:\/\/)?(?:v\.|www\.|m\.)?(?:douyin|iesdouyin)\.com\/\S+/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/BV[0-9A-Za-z]{10}/g, '')
      .replace(/av\d{3,}/gi, '').trim();

    // 时间：必须是合法 HH:MM（0-23:0-59），不从 25:30 这类非法串里捞尾巴
    const tm = s.match(/(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/);
    if (tm) out.time = pad2(+tm[1]) + ':' + tm[2];

    // 时长
    const du = s.match(/(\d{1,3})\s*分钟/);
    if (du) out.targetMinutes = Math.max(1, Math.min(180, +du[1]));

    // 重复日
    const WD = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    if (/每天|每日|天天|everyday|daily/i.test(s)) out.days = [0, 1, 2, 3, 4, 5, 6];
    else if (/工作日|weekday/i.test(s)) out.days = [1, 2, 3, 4, 5];
    else if (/周末|weekend/i.test(s)) out.days = [0, 6];
    else {
      const ms = s.matchAll(/周([一二三四五六日天])/g);
      const set = new Set();
      for (const m of ms) set.add(WD[m[1]]);
      if (set.size) out.days = Array.from(set).sort();
    }

    // 清洗名称：去掉时间/时长/星期/视频/分隔符（开头的"周X/周X末"属于名字的一部分，保留）
    out.name = s
      .replace(/(?:https?:\/\/)?(?:v\.|www\.|m\.)?(?:douyin|iesdouyin)\.com\/\S+/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/BV[0-9A-Za-z]{10}/g, '')
      .replace(/av\d{3,}/gi, '')
      .replace(/([01]?\d|2[0-3])[:：]([0-5]\d)/g, '')
      .replace(/\d{1,3}\s*分钟/g, '')
      .replace(/每天|每日|天天|工作日|周末|everyday|daily|weekday|weekend/gi, '')
      .replace(/(?<!^)周[一二三四五六日天]/g, '')
      .replace(/[｜|,，;；:：]+\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .slice(0, 60) /* 与 UI 输入上限一致，防超长行撑爆布局 */
      .trim() || '瘦脸跟练';
    return out;
  },

  /* 批量解析 + 导入视频 + 建会话；onProgress(step, total, msg) 回调 */
  async importLines(text, onProgress) {
    const rows = String(text || '').split(/\r?\n/).map(l => this.parseLine(l)).filter(Boolean);
    if (!rows.length) return { sessions: 0, videos: 0 };
    /* 安排去重和视频去重各自处理：同名同时间的新链接仍需进入视频库。 */
    const sigOf = (r) => `${r.name}|${r.time || '21:30'}|${(r.days || [0,1,2,3,4,5,6]).join(',')}`;
    const existing = new Set((Store.db.sessions || []).filter(x => x.enabled !== false).map(x => `${x.name}|${x.time}|${(x.days || []).join(',')}`));
    const seen = new Set();
    const newSessions = [];
    let skipped = 0;
    for (const r of rows) {
      if (r.videoOnly) continue;
      const sig = sigOf(r);
      if (existing.has(sig) || seen.has(sig)) { skipped++; continue; }
      seen.add(sig);
      newSessions.push(r);
    }

    // 从所有输入行导入视频，包括安排已存在或同批安排重复的行。
    const needFetch = [];
    for (const r of rows) {
      if (!r.videoRef) continue;
      const exist = Store.videosForMode('face').find(v =>
        (r.videoRef.type === 'bv' && v.bvid === r.videoRef.val) ||
        (r.videoRef.type === 'av' && v.aid === r.videoRef.val) ||
        (r.videoRef.type === 'douyin' && r.videoRef.vid && v.douyinId === r.videoRef.vid) ||
        (r.videoRef.type === 'douyin' && !r.videoRef.vid && v.douyinUrl === r.videoRef.url));
      if (exist) {
        if (r.videoRef.type === 'douyin') await Douyin.ensureLocal(exist);
        r.videoId = exist.id;
      }
      else needFetch.push(r);
    }
    let vi = 0;
    let importedVideos = 0;
    const pendingRefs = []; /* 抓取失败但已保存引用的链接：导入反馈需要与成功获取信息的区分开 */
    for (const r of needFetch) {
      vi++;
      /* 同批两行同 BV：先拉的那条入库后，后续行直接复用，不再重复请求与入库 */
      const dup = Store.videosForMode('face').find(v =>
        (r.videoRef.type === 'bv' && v.bvid === r.videoRef.val) ||
        (r.videoRef.type === 'av' && v.aid === r.videoRef.val) ||
        (r.videoRef.type === 'douyin' && r.videoRef.vid && v.douyinId === r.videoRef.vid) ||
        (r.videoRef.type === 'douyin' && !r.videoRef.vid && v.douyinUrl === r.videoRef.url));
      if (dup) { if (r.videoRef.type === 'douyin') await Douyin.ensureLocal(dup); r.videoId = dup.id; continue; }
      if (onProgress) onProgress(vi, needFetch.length, `获取视频信息：${r.videoRef.val}`);
      if (r.videoRef.type === 'douyin') {
        const v = await Douyin.importLocal({vid:r.videoRef.vid,url:r.videoRef.url,title:r.videoRef.title}, 'face', d => {
          if(onProgress) onProgress(vi,needFetch.length,d.total?`下载中：${Math.floor(d.received/d.total*100)}%`:`下载中：${(d.received/1048576).toFixed(1)} MB`);
        });
        r.videoId = v.id;
        importedVideos++;
        continue;
      }
      const info = await window.native.fetchBilibiliInfo(r.videoRef.type === 'bv' ? r.videoRef.val : ('av' + r.videoRef.val));
      if (!(info && info.ok)) pendingRefs.push(r.videoRef.type === 'bv' ? r.videoRef.val : ('av' + r.videoRef.val));
      const v = {
        id: uid('vid'), source: 'bilibili',
        bvid: r.videoRef.type === 'bv' ? r.videoRef.val : null,
        aid: r.videoRef.type === 'av' ? r.videoRef.val : null, page: 1,
        cid: (info && info.ok) ? (info.cid || null) : null,
        title: (info && info.ok) ? info.title : r.videoRef.val,
        pic: (info && info.ok) ? info.pic : '',
        durationSec: (info && info.ok) ? info.durationSec : null,
        addedAt: new Date().toISOString()
      };
      Store.addVideo(v, 'face');
      r.videoId = v.id;
      importedVideos++;
    }

    // 建会话（默认时间 21:30，默认每天）
    let si = 0;
    for (const r of newSessions) {
      si++;
      if (onProgress) onProgress(si, rows.length, `创建安排：${r.name}`);
      Store.db.sessions.push({
        id: uid('sess'), name: r.name,
        time: r.time || '21:30',
        days: r.days || [0, 1, 2, 3, 4, 5, 6],
        videoId: r.videoId || null,
        targetMinutes: r.targetMinutes || 10,
        enabled: true
      });
    }
    if (importedVideos || newSessions.length) Store.save(true);
    return { sessions: newSessions.length, videos: importedVideos, skipped, pendingRefs };
  },

  /* 导入结果 → 提示文案。成功路径保持原文案不变；有待核实链接时追加一条说明，
     让用户知道哪些视频只保存了引用、未获取到标题/时长等信息。 */
  resultToasts(r) {
    const out = [{ msg: `导入完成：${r.sessions} 个安排、${r.videos} 个新视频 ✓`, type: 'green' }];
    const refs = (r && r.pendingRefs) || [];
    if (refs.length) {
      const shown = refs.slice(0, 3).join('、') + (refs.length > 3 ? ` 等 ${refs.length} 个` : '');
      out.push({ msg: `⚠️ ${refs.length} 个视频只保存了链接、未获取到信息，待核实：${shown}`, type: '' });
    }
    return out;
  }
};
