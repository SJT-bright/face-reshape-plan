const test = require('node:test');
const assert = require('node:assert/strict');
global.DailyPlanCore = require('../src/js/daily-plan-core.js');
const FixedPracticeCore = require('../src/js/fixed-practice-core.js');

test('face 的 clock 只读 practiceClock，非法时间当空字符串', () => {
  const db = {
    settings: {
      practiceClock: { morning: '25:99', evening: '21:05' },
      watchingPlans: { face: { morning: '08:00', evening: '22:00', targetMinutes: 30 } }
    }
  };
  assert.deepEqual(FixedPracticeCore.clock(db, 'face'), { morning: '', evening: '21:05' });
  db.settings.practiceClock = { morning: '00:00', evening: '23:59' };
  assert.deepEqual(FixedPracticeCore.clock(db, 'face'), { morning: '00:00', evening: '23:59' });
  db.settings.practiceClock = { morning: '', evening: '24:00' };
  assert.deepEqual(FixedPracticeCore.clock(db, 'face'), { morning: '', evening: '' });
  db.settings.practiceClock = { morning: '7:30', evening: '21:30:00' };
  assert.deepEqual(FixedPracticeCore.clock(db, 'face'), { morning: '', evening: '' });
  db.settings.practiceClock = { morning: '07:30', evening: null };
  assert.deepEqual(FixedPracticeCore.clock(db, 'face'), { morning: '07:30', evening: '' });
  assert.deepEqual(FixedPracticeCore.clock({ settings: {} }, 'face'), { morning: '', evening: '' });
  assert.deepEqual(FixedPracticeCore.clock({
    settings: { watchingPlans: { face: { morning: '08:00', evening: '21:00', targetMinutes: 15 } } }
  }, 'face'), { morning: '', evening: '' });

  let watchReads = 0;
  const settings = { practiceClock: { morning: '06:10', evening: '9:00' } };
  Object.defineProperty(settings, 'watchingPlans', {
    configurable: true,
    enumerable: true,
    get() {
      watchReads += 1;
      return { face: { morning: '01:00', evening: '02:00' } };
    }
  });
  assert.deepEqual(FixedPracticeCore.clock({ settings }, 'face'), { morning: '06:10', evening: '' });
  assert.equal(watchReads, 0);
});

test('其他 mode 的 clock 只读 DailyPlanCore.config，不读 practiceClock', () => {
  const db = {
    settings: {
      practiceClock: { morning: '06:00', evening: '18:00' },
      watchingPlans: {
        awakening: { targetMinutes: 40, morning: '09:05', evening: '24:00' },
        night: { targetMinutes: 5, morning: '', evening: '23:15' }
      }
    }
  };
  assert.deepEqual(FixedPracticeCore.clock(db, 'awakening'), { morning: '09:05', evening: '' });
  assert.deepEqual(FixedPracticeCore.clock(db, 'night'), { morning: '', evening: '23:15' });
  assert.deepEqual(FixedPracticeCore.clock(db, 'missing'), { morning: '', evening: '' });
  assert.deepEqual(FixedPracticeCore.clock(db, 'Face'), { morning: '', evening: '' });
  assert.deepEqual(db.settings.practiceClock, { morning: '06:00', evening: '18:00' });
  assert.equal(db.settings.watchingPlans.awakening.targetMinutes, 40);

  let clockReads = 0;
  const settings = { watchingPlans: { awakening: { morning: '10:00', evening: '21:00', targetMinutes: 15 } } };
  Object.defineProperty(settings, 'practiceClock', {
    configurable: true,
    enumerable: true,
    get() {
      clockReads += 1;
      return { morning: '01:02', evening: '03:04' };
    }
  });
  assert.deepEqual(FixedPracticeCore.clock({ settings }, 'awakening'), { morning: '10:00', evening: '21:00' });
  assert.equal(clockReads, 0);
});

test('timeFor 只在 morning 或 evening 返回该侧时间', () => {
  const db = {
    settings: {
      practiceClock: { morning: '07:30', evening: '', noon: '12:00' },
      watchingPlans: { awakening: { morning: '9:00', evening: '22:10', targetMinutes: 15 } }
    }
  };
  assert.equal(FixedPracticeCore.timeFor(db, 'face', 'morning'), '07:30');
  assert.equal(FixedPracticeCore.timeFor(db, 'face', 'evening'), '');
  for (const period of ['noon', 'day', '', null, undefined, 'Morning']) {
    assert.equal(FixedPracticeCore.timeFor(db, 'face', period), '');
  }
  assert.equal(FixedPracticeCore.timeFor(db, 'awakening', 'evening'), '22:10');
  assert.equal(FixedPracticeCore.timeFor(db, 'awakening', 'morning'), '');
  assert.equal(FixedPracticeCore.timeFor(db, 'awakening', 'day'), '');
});

test('pin 追加且不重复，早上的勾选不会出现在晚上', () => {
  const db = { settings: { fixedPractice: { face: { morning: ['a', 'b'] } } } };
  FixedPracticeCore.pin(db, 'face', 'morning', 'c', true);
  FixedPracticeCore.pin(db, 'face', 'morning', 'a', true);
  FixedPracticeCore.pin(db, 'face', 'morning', 'b', true);
  assert.deepEqual(db.settings.fixedPractice.face.morning, ['a', 'b', 'c']);
  assert.deepEqual(FixedPracticeCore.pins(db, 'face', 'morning'), ['a', 'b', 'c']);
  assert.equal(FixedPracticeCore.isPinned(db, 'face', 'morning', 'c'), true);
  assert.equal(FixedPracticeCore.isPinned(db, 'face', 'morning', 'a'), true);
  FixedPracticeCore.pin(db, 'face', 'evening', 'c', true);
  assert.deepEqual(db.settings.fixedPractice.face.evening, ['c']);
  assert.deepEqual(db.settings.fixedPractice.face.morning, ['a', 'b', 'c']);
  assert.equal(FixedPracticeCore.isPinned(db, 'face', 'evening', 'a'), false);
  assert.equal(FixedPracticeCore.isPinned(db, 'face', 'evening', 'c'), true);
  assert.deepEqual(FixedPracticeCore.pins(db, 'face', 'evening'), ['c']);
  FixedPracticeCore.pin(db, 'awakening', 'morning', 'a', true);
  assert.deepEqual(db.settings.fixedPractice.awakening.morning, ['a']);
  assert.deepEqual(db.settings.fixedPractice.face.morning, ['a', 'b', 'c']);
});

test('pin 取消勾选只移除该 id，非法 period 或空 id 不改数据', () => {
  const db = {
    settings: {
      fixedPractice: {
        face: { morning: ['a', 'b', 'c'], evening: ['b'] },
        awakening: { morning: ['z'] }
      }
    },
    videos: [{ id: 'a', title: 'A' }],
    sessions: [{ id: 'b', fixedDaily: true, name: '晚' }]
  };
  FixedPracticeCore.pin(db, 'face', 'morning', 'b', false);
  assert.deepEqual(db.settings.fixedPractice.face.morning, ['a', 'c']);
  assert.deepEqual(db.settings.fixedPractice.face.evening, ['b']);
  assert.deepEqual(db.settings.fixedPractice.awakening.morning, ['z']);
  assert.equal(FixedPracticeCore.isPinned(db, 'face', 'morning', 'b'), false);
  assert.equal(FixedPracticeCore.isPinned(db, 'face', 'morning', 'a'), true);
  assert.equal(FixedPracticeCore.isPinned(db, 'face', 'evening', 'b'), true);
  FixedPracticeCore.pin(db, 'face', 'morning', 'missing', false);
  assert.deepEqual(db.settings.fixedPractice.face.morning, ['a', 'c']);

  const before = structuredClone(db);
  FixedPracticeCore.pin(db, 'face', 'noon', 'a', true);
  FixedPracticeCore.pin(db, 'face', 'day', 'a', false);
  FixedPracticeCore.pin(db, 'face', '', 'a', true);
  FixedPracticeCore.pin(db, 'face', null, 'a', true);
  FixedPracticeCore.pin(db, 'face', 'morning', '', true);
  FixedPracticeCore.pin(db, 'face', 'morning', '', false);
  FixedPracticeCore.pin(db, 'face', 'morning', null, true);
  FixedPracticeCore.pin(db, 'face', 'evening', undefined, true);
  assert.deepEqual(db, before);
});

test('pins 返回拷贝，pin 不给视频或 session 写 time', () => {
  const video = { id: 'v1', title: '瘦脸操' };
  const session = { id: 's1', fixedDaily: true, name: '每日瘦脸跟练', videoId: 'v1' };
  const db = { settings: {}, videos: [video], sessions: [session] };
  FixedPracticeCore.pin(db, 'face', 'morning', 'v1', true);
  FixedPracticeCore.pin(db, 'face', 'morning', 's1', true);
  FixedPracticeCore.pin(db, 'face', 'evening', 'v1', true);
  assert.equal(Object.hasOwn(video, 'time'), false);
  assert.equal(Object.hasOwn(session, 'time'), false);
  assert.equal(Object.hasOwn(db.videos[0], 'time'), false);
  assert.equal(Object.hasOwn(db.sessions[0], 'time'), false);
  assert.deepEqual(video, { id: 'v1', title: '瘦脸操' });
  assert.deepEqual(session, { id: 's1', fixedDaily: true, name: '每日瘦脸跟练', videoId: 'v1' });
  assert.deepEqual(db.settings.fixedPractice.face.morning, ['v1', 's1']);
  const copy = FixedPracticeCore.pins(db, 'face', 'morning');
  assert.deepEqual(copy, ['v1', 's1']);
  assert.notEqual(copy, db.settings.fixedPractice.face.morning);
  copy.push('hack');
  copy[0] = 'y';
  assert.deepEqual(db.settings.fixedPractice.face.morning, ['v1', 's1']);
  assert.deepEqual(FixedPracticeCore.pins(db, 'face', 'morning'), ['v1', 's1']);
  const empty = FixedPracticeCore.pins(db, 'night', 'morning');
  assert.deepEqual(empty, []);
  empty.push('x');
  assert.deepEqual(FixedPracticeCore.pins(db, 'night', 'morning'), []);
  assert.equal(db.settings.fixedPractice.night, undefined);
});

test('setFaceClock 写入 practiceClock，空字符串允许，非法或相同时间不写入', () => {
  const db = { settings: { theme: 'dark', watchingPlans: { face: { morning: '01:00', evening: '02:00' } } } };
  FixedPracticeCore.setFaceClock(db, { morning: '', evening: '' });
  assert.deepEqual(db.settings.practiceClock, { morning: '', evening: '' });
  FixedPracticeCore.setFaceClock(db, { morning: '07:30', evening: '' });
  assert.deepEqual(db.settings.practiceClock, { morning: '07:30', evening: '' });
  FixedPracticeCore.setFaceClock(db, { morning: '', evening: '21:30' });
  assert.deepEqual(db.settings.practiceClock, { morning: '', evening: '21:30' });
  FixedPracticeCore.setFaceClock(db, { morning: '07:30', evening: '21:30' });
  assert.deepEqual(db.settings.practiceClock, { morning: '07:30', evening: '21:30' });
  assert.equal(db.settings.theme, 'dark');
  assert.deepEqual(db.settings.watchingPlans.face, { morning: '01:00', evening: '02:00' });

  const kept = { morning: '07:30', evening: '21:30' };
  assert.throws(() => FixedPracticeCore.setFaceClock(db, { morning: '25:99', evening: '22:00' }), /请填写有效的练习时间/);
  assert.deepEqual(db.settings.practiceClock, kept);
  assert.throws(() => FixedPracticeCore.setFaceClock(db, { morning: '08:00', evening: '25:99' }), /请填写有效的练习时间/);
  assert.deepEqual(db.settings.practiceClock, kept);
  assert.throws(() => FixedPracticeCore.setFaceClock(db, { morning: '9:00', evening: '21:30' }), /请填写有效的练习时间/);
  assert.deepEqual(db.settings.practiceClock, kept);
  assert.throws(() => FixedPracticeCore.setFaceClock(db, { morning: '21:30', evening: '21:30' }), /早上和晚上的练习时间需要不同/);
  assert.deepEqual(db.settings.practiceClock, kept);
  assert.throws(() => FixedPracticeCore.setFaceClock(db, { morning: '00:00', evening: '00:00' }), /早上和晚上的练习时间需要不同/);
  assert.deepEqual(db.settings.practiceClock, kept);

  const fresh = { settings: {} };
  assert.throws(() => FixedPracticeCore.setFaceClock(fresh, { morning: '25:99', evening: '21:00' }), /请填写有效的练习时间/);
  assert.equal(fresh.settings.practiceClock, undefined);
});

test('migrateFace 给无合法时段的固定安排补 period，只在该侧时钟为空时抄入时间', () => {
  const none = { settings: { practiceClock: { morning: '08:00', evening: '22:00' } } };
  assert.equal(FixedPracticeCore.migrateFace(none), false);
  assert.equal(none.sessions, undefined);
  assert.deepEqual(none.settings.practiceClock, { morning: '08:00', evening: '22:00' });

  const empty = { settings: {}, sessions: [] };
  assert.equal(FixedPracticeCore.migrateFace(empty), false);
  assert.deepEqual(empty.sessions, []);
  assert.equal(empty.settings.practiceClock, undefined);

  const fresh = {
    settings: {},
    sessions: [
      { id: 'm', fixedDaily: true, time: '07:30', name: '晨练' },
      { id: 'e', fixedDaily: true, time: '21:30', name: '晚练' }
    ]
  };
  assert.equal(FixedPracticeCore.migrateFace(fresh), true);
  assert.equal(fresh.sessions[0].period, 'morning');
  assert.equal(fresh.sessions[0].time, '07:30');
  assert.equal(fresh.sessions[1].period, 'evening');
  assert.equal(fresh.sessions[1].time, '21:30');
  assert.equal(fresh.settings.practiceClock.morning, '07:30');
  assert.equal(fresh.settings.practiceClock.evening, '21:30');
  const freshSnapshot = structuredClone(fresh);
  assert.equal(FixedPracticeCore.migrateFace(fresh), false);
  assert.deepEqual(fresh, freshSnapshot);

  const db = {
    settings: { practiceClock: { morning: '08:00', evening: '' } },
    sessions: [
      { id: 'm', fixedDaily: true, time: '07:30', name: '晨练', videoId: null },
      { id: 'e', fixedDaily: true, time: '21:30', name: '晚练', period: null },
      { id: 'plain', name: '普通', time: '07:30', videoId: 'v' },
      { id: 'set', fixedDaily: true, period: 'morning', time: '06:00', name: '已设' },
      { id: 'bad', fixedDaily: true, period: 'day', time: '07:30', name: '坏时段' }
    ]
  };
  assert.equal(FixedPracticeCore.migrateFace(db), true);
  assert.equal(db.sessions[0].period, 'morning');
  assert.equal(db.sessions[0].time, '07:30');
  assert.equal(db.sessions[0].name, '晨练');
  assert.equal(db.sessions[1].period, 'evening');
  assert.equal(db.sessions[1].time, '21:30');
  assert.equal(db.sessions[2].period, undefined);
  assert.equal(db.sessions[2].time, '07:30');
  assert.equal(db.sessions[3].period, 'morning');
  assert.equal(db.sessions[3].time, '06:00');
  assert.equal(db.sessions[4].period, 'morning');
  assert.equal(db.sessions[4].time, '07:30');
  assert.equal(db.settings.practiceClock.morning, '08:00');
  assert.equal(db.settings.practiceClock.evening, '21:30');
  const snapshot = structuredClone(db);
  assert.equal(FixedPracticeCore.migrateFace(db), false);
  assert.deepEqual(db, snapshot);
});

test('applyClock 只改有时段且该侧时钟非空的固定安排，并返回实际改动条数', () => {
  const untouched = { settings: {}, sessions: [{ id: 'a', fixedDaily: true, period: 'morning', time: '07:30', name: 'A' }] };
  assert.equal(FixedPracticeCore.applyClock(untouched), 0);
  assert.equal(untouched.sessions[0].time, '07:30');

  const invalid = {
    settings: {
      practiceClock: { morning: '25:99', evening: '' },
      watchingPlans: { face: { morning: '01:00', evening: '02:00' } }
    },
    sessions: [{ id: 'a', fixedDaily: true, period: 'morning', time: '07:30' }]
  };
  assert.equal(FixedPracticeCore.applyClock(invalid), 0);
  assert.equal(invalid.sessions[0].time, '07:30');

  const db = {
    settings: {
      practiceClock: { morning: '08:15', evening: '' },
      watchingPlans: { face: { morning: '01:00', evening: '02:00', targetMinutes: 15 } }
    },
    sessions: [
      { id: 'a', fixedDaily: true, period: 'morning', time: '07:30', name: 'A' },
      { id: 'b', fixedDaily: true, period: 'morning', time: '08:15', name: 'B' },
      { id: 'c', fixedDaily: true, period: 'evening', time: '21:30', name: 'C' },
      { id: 'd', fixedDaily: false, period: 'morning', time: '07:30', name: 'D' },
      { id: 'e', fixedDaily: true, period: '', time: '07:30', name: 'E' },
      { id: 'f', fixedDaily: true, time: '07:30', name: 'F' },
      { id: 'g', fixedDaily: true, period: 'noon', time: '07:30', name: 'G' }
    ]
  };
  assert.equal(FixedPracticeCore.applyClock(db), 1);
  assert.equal(db.sessions[0].time, '08:15');
  assert.equal(db.sessions[0].period, 'morning');
  assert.equal(db.sessions[0].name, 'A');
  assert.equal(db.sessions[1].time, '08:15');
  assert.equal(db.sessions[2].time, '21:30');
  assert.equal(db.sessions[3].time, '07:30');
  assert.equal(db.sessions[3].fixedDaily, false);
  assert.equal(db.sessions[4].time, '07:30');
  assert.equal(db.sessions[4].period, '');
  assert.equal(db.sessions[5].time, '07:30');
  assert.equal(db.sessions[5].period, undefined);
  assert.equal(db.sessions[6].time, '07:30');
  assert.equal(db.sessions[6].period, 'noon');
  assert.deepEqual(db.settings.watchingPlans.face, { morning: '01:00', evening: '02:00', targetMinutes: 15 });
  assert.deepEqual(db.settings.practiceClock, { morning: '08:15', evening: '' });

  db.settings.practiceClock.evening = '22:00';
  assert.equal(FixedPracticeCore.applyClock(db), 1);
  assert.equal(db.sessions[2].time, '22:00');
  assert.equal(db.sessions[2].period, 'evening');
  assert.equal(db.sessions[0].time, '08:15');
  assert.equal(db.sessions[3].time, '07:30');
  assert.equal(FixedPracticeCore.applyClock(db), 0);
});
