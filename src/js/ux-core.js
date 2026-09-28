/* Versioned, side-effect-free compatibility rules for the daily workspace. */
(function(root) {
  const clone = x => JSON.parse(JSON.stringify(x));
  function migrate(db, today) {
    db.settings ||= {}; db.logs ||= {}; db.logs.training ||= {};
    if (!db.uxVersion) {
      const minutes = Math.max(1, Number(db.settings.dailyTargetMinutes) || 15);
      db.targetHistory = [{ from: '2000-01-01', minutes, source: 'migration-reference' }];
      for (const day of Object.values(db.logs.training)) if (day.targetMinutes == null) day.targetMinutes = minutes;
      db.profile = clone(db.strength?.bmiProfile || {});
      db.settings.enabledModules ||= ['follow', 'strength', 'skincare', 'nutrition', 'achievements'];
      // Existing documents are never forced through onboarding.
      db.onboarding ||= { done: !db.freshInstall, step: 0 };
      db.uxVersion = 1;
    }
    db.targetHistory ||= []; db.profile ||= {}; db.drafts ||= {};
    return db;
  }
  function target(db, date) {
    const snap = db.logs?.training?.[date]?.targetMinutes;
    if (Number(snap) > 0) return Number(snap);
    const h = (db.targetHistory || []).filter(x => x.from <= date).sort((a,b) => b.from.localeCompare(a.from))[0];
    return Number(h?.minutes) || Number(db.settings?.dailyTargetMinutes) || 15;
  }
  function changeTarget(db, minutes, today) {
    minutes = Number(minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) throw Error('目标需要为 1–600 分钟');
    db.targetHistory ||= [];
    db.targetHistory = db.targetHistory.filter(x => x.from !== today);
    db.targetHistory.push({from:today, minutes, source:'user'});
    db.settings.dailyTargetMinutes = minutes;
    if (db.logs?.training?.[today]) db.logs.training[today].targetMinutes = minutes;
  }
  function setSummary(sets) {
    const done = (sets || []).filter(s => s.done);
    return { setsDone:done.length, repsText:done.map(s=>s.reps).join('+'),
      weightKg: done.length && done.every(s=>s.weightKg===done[0].weightKg) ? done[0].weightKg : null,
      loadVolume:done.reduce((n,s)=>n+(Number(s.weightKg)||0)*s.reps,0) };
  }
  function validSets(sets) {
    return Array.isArray(sets) && sets.every(s=>Number.isInteger(s.reps)&&s.reps>=0&&s.reps<=999&&
      (s.weightKg===null || (Number.isFinite(s.weightKg)&&s.weightKg>=0&&s.weightKg<=2000)));
  }
  function draftCompatible(d, signature, now=Date.now()) {
    return !!d && d.version===1 && d.signature===signature && now-d.updatedAt < 30*86400000;
  }
  const api={migrate,target,changeTarget,setSummary,validSets,draftCompatible,clone};
  if(typeof module!=='undefined'&&module.exports)module.exports=api; else root.UXCore=api;
})(typeof window==='undefined'?globalThis:window);
