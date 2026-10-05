// Habit rules, points, streaks and badges. Pure functions: no database, no clock.
// Everything takes explicit days ("YYYY-MM-DD") so it is easy to test.

export const KINDS = ['check', 'goal', 'limit'];
// check = done / not done.  goal = count up to a target.  limit = stay at or under a target.

/** Ready-made habits offered in setup and in the "add habit" sheet. */
export const PRESETS = [
  { id: 'water', title: 'Drink water', icon: '💧', kind: 'goal', unit: 'glasses', target: 8, step: 1, points: 10 },
  { id: 'steps', title: 'Steps', icon: '🚶', kind: 'goal', unit: 'steps', target: 8000, step: 500, points: 20 },
  { id: 'workout', title: 'Workout', icon: '🏋️', kind: 'check', unit: '', target: 1, step: 1, points: 20 },
  { id: 'read', title: 'Read 20 pages', icon: '📖', kind: 'check', unit: '', target: 1, step: 1, points: 10 },
  { id: 'meditate', title: 'Meditate', icon: '🧘', kind: 'check', unit: '', target: 1, step: 1, points: 10 },
  { id: 'sleep', title: 'Sleep by 11 pm', icon: '😴', kind: 'check', unit: '', target: 1, step: 1, points: 10 },
  { id: 'nophone', title: 'No screens before bed', icon: '📵', kind: 'check', unit: '', target: 1, step: 1, points: 10 },
  { id: 'coffee', title: 'Coffee / tea', icon: '☕', kind: 'limit', unit: 'cups', target: 3, step: 1, points: 5 },
  { id: 'screen', title: 'Screen time', icon: '📱', kind: 'limit', unit: 'hours', target: 3, step: 1, points: 5 },
];

const DAY_MS = 86_400_000;
const toUtc = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (ymd, n) => new Date(toUtc(ymd) + n * DAY_MS).toISOString().slice(0, 10);
export const weekday = (ymd) => new Date(toUtc(ymd)).getUTCDay(); // 0 = Sunday

/** Habit runs on the day if its weekday list includes it and it already existed. */
export function isScheduled(habit, ymd) {
  if (habit.createdOn && ymd < habit.createdOn) return false;
  return habit.days.includes(weekday(ymd));
}

/** Points for one habit on one day. Limits cost points when you go over. */
export function dayPoints(habit, value) {
  const v = Math.max(0, value || 0);
  if (habit.kind === 'check') return v >= 1 ? habit.points : 0;
  if (habit.kind === 'goal') return Math.round((habit.points * Math.min(v, habit.target)) / Math.max(1, habit.target));
  // limit: logging something under the limit earns points, going over costs them
  if (v === 0) return 0;
  return v <= habit.target ? habit.points : -habit.points;
}

/** "Done" for display: check ticked, goal reached, limit logged and not exceeded. */
export function isDone(habit, value) {
  const v = Math.max(0, value || 0);
  if (habit.kind === 'check') return v >= 1;
  if (habit.kind === 'goal') return v >= habit.target;
  return v > 0 && v <= habit.target;
}

/** "Fine" for a clean day: like done, but a limit you never touched is fine too. */
export function isOk(habit, value) {
  if (habit.kind === 'limit') return Math.max(0, value || 0) <= habit.target;
  return isDone(habit, value);
}

/** Counts as "showing up": something done, not just logged over a limit. */
export function isActivity(habit, value) {
  const v = Math.max(0, value || 0);
  if (v <= 0) return false;
  if (habit.kind === 'limit') return v <= habit.target;
  return true; // any progress on a check or goal counts, even if rounding gives 0 points
}

export const JOURNAL_DAY_POINTS = 10; // for the first entry written on a day

export const BADGES = [
  { id: 'first-step', icon: '👣', name: 'First step', desc: 'Complete a habit for the first time', test: (s) => s.habitDoneCount >= 1 },
  { id: 'first-entry', icon: '✍️', name: 'First entry', desc: 'Write your first journal entry', test: (s) => s.totalEntries >= 1 },
  { id: 'streak-3', icon: '🔥', name: '3-day streak', desc: 'Show up 3 days in a row', test: (s) => s.longestStreak >= 3 },
  { id: 'streak-7', icon: '🔥', name: '7-day streak', desc: 'Show up 7 days in a row', test: (s) => s.longestStreak >= 7 },
  { id: 'streak-30', icon: '🏆', name: '30-day streak', desc: 'Show up 30 days in a row', test: (s) => s.longestStreak >= 30 },
  { id: 'points-100', icon: '⭐', name: '100 points', desc: 'Earn 100 points', test: (s) => s.totalPoints >= 100 },
  { id: 'points-1000', icon: '🌟', name: '1,000 points', desc: 'Earn 1,000 points', test: (s) => s.totalPoints >= 1000 },
  { id: 'entries-10', icon: '📓', name: '10 entries', desc: 'Write 10 journal entries', test: (s) => s.totalEntries >= 10 },
  { id: 'entries-100', icon: '📚', name: '100 entries', desc: 'Write 100 journal entries', test: (s) => s.totalEntries >= 100 },
  { id: 'words-10000', icon: '🖋️', name: '10,000 words', desc: 'Write 10,000 words in total', test: (s) => s.totalWords >= 10000 },
  { id: 'night-owl', icon: '🦉', name: 'Night owl', desc: 'Write an entry after 9 pm', test: (s) => s.nightOwl },
  { id: 'early-bird', icon: '🐦', name: 'Early bird', desc: 'Write an entry before 7 am', test: (s) => s.earlyBird },
  { id: 'clean-build', icon: '✅', name: 'Clean build', desc: 'Finish every habit in a day (3 or more habits)', test: (s) => s.perfectDays >= 1 },
];

export const badgeInfo = ({ test, ...rest }) => rest; // hide the function when sending to the browser

/**
 * habits: all habits including archived ones (their logs still count)
 * logs:   [{ habitId, day, value }]
 * entries:[{ day, time, wordCount }]
 */
export function computeStats({ habits, logs, entries, today }) {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const pointsByDay = new Map();
  const activeDays = new Set();
  const valueByDayHabit = new Map(); // "day|id" -> value
  let habitDoneCount = 0;
  const add = (day, n) => pointsByDay.set(day, (pointsByDay.get(day) || 0) + n);

  for (const log of logs) {
    const habit = byId.get(log.habitId);
    if (!habit) continue;
    valueByDayHabit.set(`${log.day}|${habit.id}`, log.value);
    const p = dayPoints(habit, log.value);
    add(log.day, p);
    if (isActivity(habit, log.value)) activeDays.add(log.day);
    if (isDone(habit, log.value)) habitDoneCount += 1;
  }

  const entryDays = new Set();
  let totalWords = 0;
  let nightOwl = false;
  let earlyBird = false;
  for (const e of entries) {
    totalWords += e.wordCount || 0;
    if (!entryDays.has(e.day)) {
      entryDays.add(e.day);
      add(e.day, JOURNAL_DAY_POINTS);
    }
    activeDays.add(e.day);
    if (e.time) {
      if (e.time >= '21:00') nightOwl = true;
      if (e.time < '07:00') earlyBird = true;
    }
  }

  // days on which every scheduled habit was fine (needs at least 3 scheduled)
  const logDays = new Set(logs.map((l) => l.day));
  let perfectDays = 0;
  for (const day of logDays) {
    if (day > today) continue;
    const scheduled = habits.filter((h) => !h.archived && isScheduled(h, day));
    if (scheduled.length < 3) continue;
    if (!scheduled.every((h) => isOk(h, valueByDayHabit.get(`${day}|${h.id}`)))) continue;
    // an untouched limit is "fine", but a perfect day needs real work: at least two checks or goals done
    const real = scheduled.filter((h) => h.kind !== 'limit' && isDone(h, valueByDayHabit.get(`${day}|${h.id}`))).length;
    if (real >= 2) perfectDays += 1;
  }

  // Streaks: consecutive days with any activity. Two kinds of day never break a streak:
  // today (it is not over yet) and rest days (no habit is scheduled that weekday).
  const live = habits.filter((h) => !h.archived);
  const isRest = (day) => live.length > 0 && !live.some((h) => h.days.includes(weekday(day)));
  const sorted = [...activeDays].filter((d) => d <= today).sort();
  const gapIsRest = (from, to) => {
    for (let d = addDays(from, 1); d < to; d = addDays(d, 1)) if (!isRest(d)) return false;
    return true;
  };
  let longestStreak = 0;
  let run = 0;
  let prev = null;
  for (const d of sorted) {
    run = prev && gapIsRest(prev, d) ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    prev = d;
  }
  let streak = 0;
  const first = sorted[0];
  if (first) {
    for (let d = today; d >= first; d = addDays(d, -1)) {
      if (activeDays.has(d)) streak += 1;
      else if (d === today || isRest(d)) continue;
      else break;
    }
  }

  let total = 0;
  for (const n of pointsByDay.values()) total += n;

  return {
    totalPoints: Math.max(0, total),
    todayPoints: pointsByDay.get(today) || 0,
    totalEntries: entries.length,
    totalWords,
    habitDoneCount,
    perfectDays,
    streak,
    longestStreak,
    nightOwl,
    earlyBird,
  };
}

export function earnedBadgeIds(stats) {
  return BADGES.filter((b) => b.test(stats)).map((b) => b.id);
}
