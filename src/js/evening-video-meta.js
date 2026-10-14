'use strict';
// Recorded phase is authoritative; legacy names use the recorder's Shanghai stamp.
function videoMetadata(file, records = []) {
  const match = /^护肤-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d{1,2})?\.webm$/.exec(file || '');
  if (!match || +match[4] > 23 || +match[5] > 59 || +match[6] > 59) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== date) return null;
  const saved = records.find(r => r.file === file);
  const phase = ['morning','day','evening'].includes(saved?.phase) ? saved.phase : +match[4] <= 10 ? 'morning' : +match[4] <= 16 ? 'day' : 'evening';
  return { file, date, phase, audioRecorded:saved?.audioRecorded ?? null, startedAt:saved?.startedAt || `${date}T${match[4]}:${match[5]}:${match[6]}+08:00` };
}
module.exports = {videoMetadata};
