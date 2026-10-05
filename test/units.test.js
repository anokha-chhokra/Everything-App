import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicUrl } from '../public/js/core/music.js';
import { moneyToMinor, isoDate, monthRange, HttpError } from '../public/js/core/validate.js';


test('music: YouTube links become privacy-friendly embeds', () => {
  const v = parseMusicUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(v.provider, 'youtube');
  assert.equal(v.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(parseMusicUrl('https://youtu.be/dQw4w9WgXcQ?t=3').embedUrl, v.embedUrl);
  assert.equal(parseMusicUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ').provider, 'youtube');
  const p = parseMusicUrl('https://www.youtube.com/playlist?list=PLabcdefghij1234567');
  assert.equal(p.kind, 'playlist');
  assert.equal(p.embedUrl, 'https://www.youtube-nocookie.com/embed/videoseries?list=PLabcdefghij1234567');
  const both = parseMusicUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij1234567');
  assert.match(both.embedUrl, /embed\/dQw4w9WgXcQ\?list=PLabcdefghij1234567$/);
});

test('music: anything else is rejected', () => {
  for (const bad of ['', 'hello', 'javascript:alert(1)', 'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'spotify:track:37i9dQZF1DXcBWIGoYBM5M', 'ftp://youtu.be/dQw4w9WgXcQ']) {
    assert.throws(() => parseMusicUrl(bad), HttpError, bad);
  }
});

test('validate: money is exact and strict', () => {
  assert.equal(moneyToMinor('123.45', 'amount'), 12345);
  assert.equal(moneyToMinor('1,234.5', 'amount'), 123450);
  assert.equal(moneyToMinor(0.1, 'amount'), 10);
  assert.equal(moneyToMinor('0', 'amount', { allowZero: true }), 0);
  for (const bad of ['0', '-5', '1.234', 'abc', '', null, 1e21, '99999999999']) {
    assert.throws(() => moneyToMinor(bad, 'amount'), HttpError, String(bad));
  }
});

test('validate: dates and month ranges', () => {
  assert.equal(isoDate('2026-02-28', 'd'), '2026-02-28');
  assert.throws(() => isoDate('2026-02-30', 'd'), /real date/);
  assert.throws(() => isoDate('05/10/2026', 'd'), HttpError);
  assert.deepEqual(monthRange('2026-12'), ['2026-12-01', '2027-01-01']);
  assert.deepEqual(monthRange('2026-01'), ['2026-01-01', '2026-02-01']);
});

// ---------- commit() features ----------
import { dayPoints, isDone, isOk, isScheduled, computeStats, earnedBadgeIds, weekday } from '../public/js/core/habits.js';
import { detectExpenses } from '../public/js/core/detect.js';
import { promptForDay, wordCount } from '../public/js/core/prompts.js';

const H = (over) => ({ id: 1, kind: 'check', target: 1, points: 10, days: [0, 1, 2, 3, 4, 5, 6], createdOn: '2026-01-01', archived: false, ...over });

test('habits: points for check, goal and limit', () => {
  assert.equal(dayPoints(H(), 1), 10);
  assert.equal(dayPoints(H(), 0), 0);
  const goal = H({ kind: 'goal', target: 8, points: 20 });
  assert.equal(dayPoints(goal, 4), 10); // proportional
  assert.equal(dayPoints(goal, 80), 20); // capped at the target
  assert.equal(isDone(goal, 7), false);
  assert.equal(isDone(goal, 8), true);
  const limit = H({ kind: 'limit', target: 3, points: 5 });
  assert.equal(dayPoints(limit, 0), 0);
  assert.equal(dayPoints(limit, 2), 5);
  assert.equal(dayPoints(limit, 4), -5); // over the limit costs points
  assert.equal(isOk(limit, 0), true);
  assert.equal(isDone(limit, 0), false);
});

test('habits: weekday schedule and creation date', () => {
  assert.equal(weekday('2026-10-05'), 1); // Monday
  const weekdaysOnly = H({ days: [1, 2, 3, 4, 5], createdOn: '2026-10-01' });
  assert.equal(isScheduled(weekdaysOnly, '2026-10-05'), true);
  assert.equal(isScheduled(weekdaysOnly, '2026-10-04'), false); // Sunday
  assert.equal(isScheduled(weekdaysOnly, '2026-09-30'), false); // before it existed
});

test('stats: streaks, journal points, perfect days and badges', () => {
  const habits = [H({ id: 1 }), H({ id: 2 }), H({ id: 3, kind: 'limit', target: 2, points: 5 })];
  const logs = [];
  for (const day of ['2026-10-01', '2026-10-02', '2026-10-03']) for (const id of [1, 2]) logs.push({ habitId: id, day, value: 1 });
  logs.push({ habitId: 3, day: '2026-10-03', value: 3 }); // over the limit: costs points, day not perfect
  const entries = [
    { day: '2026-10-04', time: '22:10', wordCount: 40 },
    { day: '2026-10-04', time: '06:30', wordCount: 10 }, // second entry the same day earns no extra points
  ];
  const s = computeStats({ habits, logs, entries, today: '2026-10-04' });
  assert.equal(s.streak, 4);
  assert.equal(s.longestStreak, 4);
  assert.equal(s.totalEntries, 2);
  assert.equal(s.totalWords, 50);
  assert.equal(s.totalPoints, 6 * 10 - 5 + 10);
  assert.equal(s.perfectDays, 2); // Oct 1 and 2; Oct 3 went over the limit
  assert.equal(s.nightOwl, true);
  assert.equal(s.earlyBird, true);
  const ids = earnedBadgeIds(s);
  for (const id of ['first-step', 'first-entry', 'streak-3', 'night-owl', 'early-bird', 'clean-build']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('points-100'));
  assert.ok(!ids.includes('streak-7'));
  // today empty does not break yesterday's streak; a missed day does
  assert.equal(computeStats({ habits, logs, entries, today: '2026-10-05' }).streak, 4);
  assert.equal(computeStats({ habits, logs, entries, today: '2026-10-07' }).streak, 0);
});

test('detect: finds spending in journal text and ignores counts', () => {
  const one = (t) => detectExpenses(t);
  assert.deepEqual(one('Spent ₹250 on lunch with Ravi.'), [{ amountMinor: 25000, category: 'Food', note: 'lunch', daysAgo: 0 }]);
  assert.deepEqual(one('paid Rs 1,200 for internet bill'), [{ amountMinor: 120000, category: 'Bills', note: 'internet bill', daysAgo: 0 }]);
  assert.deepEqual(one('bought groceries for 540'), [{ amountMinor: 54000, category: 'Food', note: 'groceries', daysAgo: 0 }]);
  assert.equal(one('spent 1.5k on headphones')[0].amountMinor, 150000);
  const two = one('Lunch ₹180 and auto 60 rs');
  assert.deepEqual(two.map((x) => [x.amountMinor, x.category]), [[18000, 'Food'], [6000, 'Transport']]);
  const mixed = one('Spent ₹250 on lunch with Ravi and paid 400 for fuel.');
  assert.deepEqual(mixed.map((x) => [x.amountMinor, x.category, x.note]), [[25000, 'Food', 'lunch'], [40000, 'Transport', 'fuel']]);
  assert.equal(one('Spent ₹250 on lunch.').length, 1); // not counted twice
  assert.deepEqual(one('I walked 8000 steps and bought 3 apples'), []);
  assert.deepEqual(one('Had a great day, nothing special.'), []);
  assert.deepEqual(one(''), []);
});

test('prompts: one per day, stable, and word counting', () => {
  assert.equal(promptForDay('2026-10-05').id, promptForDay('2026-10-05').id);
  assert.notEqual(promptForDay('2026-10-05').id, promptForDay('2026-10-06').id);
  assert.equal(wordCount('  one two\nthree  '), 3);
  assert.equal(wordCount(''), 0);
});

// ---------- better logic ----------
import { isActivity, addDays as addDay } from '../public/js/core/habits.js';
import { buildHints } from '../public/js/core/detect.js';
import { spendPace, buildAttention } from '../public/js/core/insights.js';
import { partOfDay } from '../public/js/core/commit.js';

const habit = (o = {}) => ({ id: 1, title: 'x', kind: 'check', target: 1, points: 10, days: [0, 1, 2, 3, 4, 5, 6], createdOn: '2026-01-01', archived: false, ...o });
const stats = (habits, logs, entries, today) => computeStats({ habits, logs, entries, today });

test('streak: rest days (nothing scheduled) do not break it, and missed scheduled days do', () => {
  // Weekday-only habit. 2026-10-05 is a Monday, so Sat 3rd and Sun 4th are rest days.
  const weekdays = habit({ days: [1, 2, 3, 4, 5] });
  const logs = ['2026-10-01', '2026-10-02', '2026-10-05'].map((day) => ({ habitId: 1, day, value: 1 }));
  const s = stats([weekdays], logs, [], '2026-10-05');
  assert.equal(s.streak, 3); // Thu, Fri, (weekend off), Mon
  assert.equal(s.longestStreak, 3);
  // missing a scheduled weekday does break it
  const broken = stats([weekdays], logs.filter((l) => l.day !== '2026-10-02'), [], '2026-10-05');
  assert.equal(broken.streak, 1);
  // an everyday habit has no rest days
  const daily = stats([habit()], logs, [], '2026-10-05');
  assert.equal(daily.streak, 1);
});

test('streak: today not done yet is not a miss, but yesterday missed is', () => {
  const h1 = habit();
  const logs = [{ habitId: 1, day: '2026-10-03', value: 1 }, { habitId: 1, day: '2026-10-04', value: 1 }];
  assert.equal(stats([h1], logs, [], '2026-10-05').streak, 2);
  assert.equal(stats([h1], logs, [], '2026-10-06').streak, 0);
});

test('streak: going over a limit, or a day with no progress, is not showing up', () => {
  const coffee = habit({ id: 2, kind: 'limit', target: 3, points: 5 });
  assert.equal(isActivity(coffee, 2), true);
  assert.equal(isActivity(coffee, 4), false);
  assert.equal(isActivity(coffee, 0), false);
  const steps = habit({ id: 3, kind: 'goal', target: 8000, points: 1 });
  assert.equal(isActivity(steps, 100), true); // tiny progress rounds to 0 points but still counts
  assert.equal(stats([coffee], [{ habitId: 2, day: '2026-10-05', value: 4 }], [], '2026-10-05').streak, 0);
});

test('clean build: untouched limits alone cannot make a perfect day', () => {
  const c1 = habit({ id: 1, kind: 'limit', target: 3 });
  const c2 = habit({ id: 2, kind: 'limit', target: 3 });
  const c3 = habit({ id: 3, kind: 'limit', target: 3 });
  const justLimits = stats([c1, c2, c3], [{ habitId: 1, day: '2026-10-05', value: 1 }], [], '2026-10-05');
  assert.equal(justLimits.perfectDays, 0);
  const real = [habit({ id: 1 }), habit({ id: 2 }), habit({ id: 3, kind: 'limit', target: 3 })];
  const day = '2026-10-05';
  const done = stats(real, [{ habitId: 1, day, value: 1 }, { habitId: 2, day, value: 1 }], [], day);
  assert.equal(done.perfectDays, 1);
});

test('detect: income, refunds and budgets are not expenses', () => {
  const d = (t, o) => detectExpenses(t, o);
  assert.deepEqual(d('Earned ₹5000 today from a client.'), []);
  assert.deepEqual(d('Got paid 50000 for the project.'), []);
  assert.deepEqual(d('My budget is ₹30000 this month.'), []);
  assert.deepEqual(d('Received a refund of ₹200 from amazon'), []);
  // but spending next to an income word in another clause still works
  assert.equal(d('Refunded ₹200 by amazon, spent ₹90 on chai')[0].amountMinor, 9000);
  assert.equal(d('Spent ₹500 which is within my budget')[0].amountMinor, 50000);
});

test('detect: lakh, crore and k; relative days; weekdays', () => {
  const d = (t, o) => detectExpenses(t, o);
  assert.equal(d('Paid 1.2 lakh for the bike')[0].amountMinor, 12_000_000);
  assert.equal(d('Spent 2k on a gift')[0].amountMinor, 200_000);
  assert.equal(d('Spent 3 lakhs on a car')[0].amountMinor, 30_000_000);
  assert.equal(d('Yesterday I spent ₹400 on dinner')[0].daysAgo, 1);
  assert.equal(d('Spent ₹90 on chai the day before yesterday')[0].daysAgo, 2);
  assert.equal(d('5 days ago I spent 2k on a gift')[0].daysAgo, 5);
  assert.equal(d('Spent 300 on dosa today')[0].daysAgo, 0);
  // "on Friday" needs to know the entry's day (2026-10-05 is a Monday -> 3 days back)
  assert.equal(d('Spent 300 on dosa on Friday', { refDay: '2026-10-05' })[0].daysAgo, 3);
  assert.equal(d('Spent 300 on dosa on Friday')[0].daysAgo, 0);
  assert.equal(d('Spent 300 on dosa on Friday', { refDay: '2026-10-05' })[0].note, 'dosa');
  assert.equal(d('Recharged phone for 299 and paid rent of ₹12,000').length, 2);
});

test('detect: your own history decides categories', () => {
  const hints = buildHints([
    { note: 'zorbing', category: 'Fun' }, { note: 'zorbing ride', category: 'Fun' }, { note: 'cricket nets', category: 'Fun' },
  ]);
  assert.equal(detectExpenses('paid 700 for zorbing', { hints })[0].category, 'Fun');
  assert.equal(detectExpenses('paid 700 for zorbing')[0].category, 'Other');
  // one past expense only fills in "Other"; it does not override a clear keyword
  const once = buildHints([{ note: 'dinner', category: 'Fun' }]);
  assert.equal(detectExpenses('spent 300 on dinner', { hints: once })[0].category, 'Food');
  // two or more agreeing past expenses win over the word list
  const twice = buildHints([{ note: 'dinner', category: 'Fun' }, { note: 'dinner party', category: 'Fun' }]);
  assert.equal(detectExpenses('spent 300 on dinner', { hints: twice })[0].category, 'Fun');
});

test('spending pace: allowance per day, projection from day 5, status', () => {
  const base = { ym: '2026-10', budgetMinor: 3_000_000 };
  // Oct 5: 5 days gone, ₹10,000 spent -> projects ₹62,000 for 31 days; budget ₹30,000 -> watch
  const watch = spendPace({ ...base, today: '2026-10-05', totalMinor: 1_000_000 });
  assert.equal(watch.status, 'watch');
  assert.equal(watch.daysLeft, 27);
  assert.equal(watch.projectedMinor, 6_200_000);
  assert.equal(watch.perDayLeftMinor, 74000); // ₹20,000 / 27 days = ₹740.74 -> ₹740
  assert.equal(spendPace({ ...base, today: '2026-10-05', totalMinor: 400_000 }).status, 'ok');
  assert.equal(spendPace({ ...base, today: '2026-10-05', totalMinor: 3_100_000 }).status, 'over');
  // too early to project
  const early = spendPace({ ...base, today: '2026-10-02', totalMinor: 900_000 });
  assert.equal(early.projectedMinor, null);
  assert.equal(early.status, 'ok');
  assert.equal(spendPace({ ym: '2026-10', today: '2026-10-05', totalMinor: 5, budgetMinor: 0 }).status, 'none');
  // a past month has nothing left to plan
  assert.equal(spendPace({ ...base, today: '2026-11-03', totalMinor: 1 }).daysLeft, 0);
});

test('attention: ranks overdue and starred tasks, adds missed habits, journal and budget nudges', () => {
  const today = '2026-10-05';
  const tasks = [
    { id: 1, title: 'Due today', dueOn: today, priority: 0 },
    { id: 2, title: 'Starred today', dueOn: today, priority: 1 },
    { id: 3, title: 'Ten days late', dueOn: '2026-09-25', priority: 0 },
    { id: 4, title: 'Next week', dueOn: '2026-10-12', priority: 1 },
    { id: 5, title: 'No date', dueOn: null, priority: 1 },
  ];
  const habits = [
    { id: 9, title: 'Walk', icon: '🚶', kind: 'check', done: false, scheduled: true, remindAt: '19:30' },
    { id: 8, title: 'Early', icon: '🌅', kind: 'check', done: false, scheduled: true, remindAt: '23:00' },
    { id: 7, title: 'Done one', icon: '✅', kind: 'check', done: true, scheduled: true, remindAt: '08:00' },
  ];
  const a = buildAttention({ today, now: '20:00', tasks, habits, entriesToday: 0, journalReminder: '', spend: { status: 'ok' } });
  assert.deepEqual(a.map((x) => x.title), ['Ten days late', 'Starred today', 'Due today', 'Walk']);
  assert.equal(a.length, 4); // capped
  assert.equal(a[0].overdue, true);
  // later: journal nudge appears once there are fewer competing items
  const b = buildAttention({ today, now: '21:00', tasks: [], habits: [], entriesToday: 0, journalReminder: '20:30', spend: { status: 'ok' } });
  assert.deepEqual(b.map((x) => x.type), ['journal']);
  const early = buildAttention({ today, now: '10:00', tasks: [], habits, entriesToday: 0, journalReminder: '', spend: { status: 'ok' } });
  assert.deepEqual(early, []); // nothing is late yet at 10:00 except Done one, which is done
  const noClock = buildAttention({ today, now: null, tasks: [], habits, entriesToday: 0, journalReminder: '', spend: { status: 'ok' } });
  assert.deepEqual(noClock, []);
  const over = buildAttention({ today, now: '10:00', tasks: [], habits: [], entriesToday: 1, journalReminder: '', spend: { status: 'over', overByMinor: 500 } });
  assert.deepEqual(over.map((x) => x.type), ['budget']);
});

test('timeline parts of the day', () => {
  assert.equal(partOfDay('03:10'), 'Late night');
  assert.equal(partOfDay('08:00'), 'Morning');
  assert.equal(partOfDay('12:00'), 'Afternoon');
  assert.equal(partOfDay('19:59'), 'Evening');
  assert.equal(partOfDay('21:00'), 'Night');
  assert.equal(partOfDay(null), null);
  assert.equal(addDay('2026-10-31', 1), '2026-11-01');
});
