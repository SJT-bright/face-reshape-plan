/* Scheduled routines share the existing reminder ledger; no guessed video or time. */
const RoutineCore = {
  periods: ['morning', 'evening'],
  days(value) { return [...new Set((value || []).filter(x => Number.isInteger(x) && x >= 0 && x <= 6))].sort(); },
  validate(config, videos) {
    const out = { enabled: !!config.enabled, camera: !!config.camera, autoCapture: !!config.autoCapture, careAutoOpen: !!config.careAutoOpen };
    for (const period of this.periods) {
      const slot = config[period] || {};
      const time = String(slot.time || ''), videoId = String(slot.videoId || '');
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('请填写有效的开始时间');
      if (videoId && !videos.some(v => v.id === videoId)) throw Error('预选视频已不存在，请重新选择');
      if (!!time !== !!videoId) throw Error('每个时段需要同时选择时间和视频，或同时留空');
      const days = this.days(slot.days);
      if (time && !days.length) throw Error('至少选择一周中的一天');
      out[period] = { time, videoId, days };
    }
    return out;
  },
  rows(db, now) {
    const config = db.settings?.automation;
    if (!config?.enabled) return [];
    return this.periods.flatMap(period => {
      const slot = config[period];
      if (!slot?.time || !slot.videoId || !slot.days?.includes(now.getDay())) return [];
      const video = db.videos?.find(v => v.id === slot.videoId);
      if (!video) return [];
      return [{ id: 'routine-' + period, time: slot.time, title: (period === 'morning' ? '早上' : '晚上') + '跟练与护肤', period, videoId: video.id }];
    });
  }
};
if (typeof module !== 'undefined') module.exports = RoutineCore;
