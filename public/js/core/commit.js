// Glue between the store and the habit/journal rules (the "commit()" features).

import {
  BADGES, badgeInfo, computeStats, earnedBadgeIds, isDone, isScheduled, dayPoints, addDays, JOURNAL_DAY_POINTS,
} from './habits.js';
import { promptForDay } from './prompts.js';
import { minutesBetween } from './insights.js';

/** Morning, afternoon… for grouping a day's timeline. null means "no time recorded". */
export function partOfDay(time) {
  if (!time) return null;
  if (time < '05:00') return 'Late night';
  if (time < '12:00') return 'Morning';
  if (time < '17:00') return 'Afternoon';
  if (time < '21:00') return 'Evening';
  return 'Night';
}

export function createCommit(store) {
  function statsFor(today) {
    return computeStats({
      habits: store.listHabits({ includeArchived: true }),
      logs: store.listLogs(),
      entries: store.listEntries().map((e) => ({ day: e.day, time: e.time, wordCount: e.wordCount })),
      today,
    });
  }

  /** Recomputes stats and records any badge earned since last time. */
  function syncBadges(today) {
    const stats = statsFor(today);
    const fresh = store.unlockBadges(earnedBadgeIds(stats), today);
    return {
      stats,
      newBadges: fresh.map((id) => badgeInfo(BADGES.find((b) => b.id === id))),
    };
  }

  function badgeList() {
    const have = store.listBadges();
    return BADGES.map((b) => ({ ...badgeInfo(b), unlockedOn: have[b.id] || null }));
  }

  function decorate(habit, day, valueMap) {
    const value = valueMap.get(habit.id) || 0;
    return {
      ...habit,
      scheduled: isScheduled(habit, day),
      value,
      done: isDone(habit, value),
      pointsToday: dayPoints(habit, value),
    };
  }

  function habitsForDay(day, { onlyScheduled = false } = {}) {
    const logs = store.listLogs({ from: day, to: addDays(day, 1) });
    const valueMap = new Map(logs.map((l) => [l.habitId, l.value]));
    const list = store.listHabits().map((h) => decorate(h, day, valueMap));
    return onlyScheduled ? list.filter((h) => h.scheduled) : list;
  }

  function oneHabit(habitId, day) {
    const habit = store.getHabit(habitId);
    if (!habit) return null;
    const logs = store.listLogs({ from: day, to: addDays(day, 1) });
    return decorate(habit, day, new Map(logs.map((l) => [l.habitId, l.value])));
  }

  function calendar(ym, from, to) {
    const habits = store.listHabits({ includeArchived: true });
    const logs = store.listLogs({ from, to });
    const entries = store.listEntries({ from, to });
    const days = {};
    const slot = (d) => (days[d] ??= { entries: 0, mood: null, habitsDone: 0, habitsScheduled: 0 });
    const moods = {};
    for (const e of entries) {
      slot(e.day).entries += 1;
      if (e.mood) (moods[e.day] ??= []).push(e.mood);
    }
    for (const [d, list] of Object.entries(moods)) days[d].mood = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
    const valueByDayHabit = new Map(logs.map((l) => [`${l.day}|${l.habitId}`, l.value]));
    const loggedDays = new Set(logs.map((l) => l.day));
    for (const d of loggedDays) {
      const scheduled = habits.filter((h) => !h.archived && isScheduled(h, d));
      const s = slot(d);
      s.habitsScheduled = scheduled.length;
      s.habitsDone = scheduled.filter((h) => isDone(h, valueByDayHabit.get(`${d}|${h.id}`))).length;
    }
    return { month: ym, days };
  }

  /**
   * Everything that happened (or is planned) on one day, in time order:
   * journal entries, habits, spending and finished tasks.
   */
  function timeline(day, { today = day, now = null } = {}) {
    const next = addDays(day, 1);
    const logs = store.listLogs({ from: day, to: next });
    const logByHabit = new Map(logs.map((l) => [l.habitId, l]));
    const habits = store.listHabits().filter((h) => isScheduled(h, day)).map((h) => {
      const log = logByHabit.get(h.id);
      const value = log ? log.value : 0;
      return { ...h, scheduled: true, value, done: isDone(h, value), pointsToday: dayPoints(h, value), loggedTime: log ? log.time : null };
    });
    // Archived habits that were logged that day still belong in that day's history.
    for (const h of store.listHabits({ includeArchived: true }).filter((x) => x.archived)) {
      const log = logByHabit.get(h.id);
      if (log) habits.push({ ...h, scheduled: false, value: log.value, done: isDone(h, log.value), pointsToday: dayPoints(h, log.value), loggedTime: log.time });
    }
    const entries = store.listEntries({ from: day, to: next });
    const expenses = store.listExpenses({ from: day, to: next });
    const tasks = store.doneTasksOn(day);

    const items = [];
    const anytime = [];
    const goals = [];
    for (const h of habits) {
      if (h.kind !== 'check') { goals.push(h); continue; }
      if (h.done) items.push({ type: 'habit', time: h.loggedTime || h.remindAt || null, habit: h });
      else if (h.remindAt) {
        // planned: still ahead of us, or already past its time without being done
        const late = day < today || (day === today && now !== null && minutesBetween(h.remindAt, now) > 0);
        items.push({ type: 'habit', time: h.remindAt, habit: h, pending: true, missed: late });
      }
      else anytime.push(h);
    }
    for (const e of entries) items.push({ type: 'entry', time: e.time || null, entry: e });
    for (const e of expenses) items.push({ type: 'expense', time: e.time || null, expense: e });
    for (const t of tasks) items.push({ type: 'task', time: t.doneTime || null, task: t });
    // Time order. Items with no time go last. Within the same minute: habits, tasks, the
    // journal entry, then spending, so "Spent ₹250" follows the entry it came from.
    const rank = { habit: 0, task: 1, entry: 2, expense: 3 };
    for (const it of items) it.part = partOfDay(it.time);
    items.sort((a, b) => {
      const ta = a.time || '99:99';
      const tb = b.time || '99:99';
      return ta < tb ? -1 : ta > tb ? 1 : rank[a.type] - rank[b.type];
    });

    const pointsFromHabits = habits.reduce((n, h) => n + h.pointsToday, 0);
    return {
      day,
      summary: {
        points: pointsFromHabits + (entries.length ? JOURNAL_DAY_POINTS : 0),
        habitsDone: habits.filter((h) => h.scheduled && h.done).length,
        habitsScheduled: habits.filter((h) => h.scheduled).length,
        entries: entries.length,
        spentMinor: expenses.reduce((n, e) => n + e.amountMinor, 0),
        tasksDone: tasks.length,
        missed: items.filter((it) => it.missed).length,
      },
      goals,
      anytime,
      items,
    };
  }

  function dashboardPart(today, now = null) {
    const stats = statsFor(today);
    const list = habitsForDay(today, { onlyScheduled: true });
    const todays = store.listEntries({ from: today, to: addDays(today, 1) });
    const latest = todays.find((e) => e.mood);
    // A tap on a quick-mood face right after another one is a correction, not a new check-in.
    const recentMood = now ? todays.find((e) => !e.text && e.mood && e.time && minutesBetween(e.time, now) >= 0 && minutesBetween(e.time, now) <= 30) : null;
    return {
      habits: { list, doneCount: list.filter((h) => h.done).length, total: list.length },
      stats: { totalPoints: stats.totalPoints, todayPoints: stats.todayPoints, streak: stats.streak, longestStreak: stats.longestStreak },
      journal: { prompt: promptForDay(today), todayCount: todays.length, latestMood: latest ? latest.mood : null, quickMoodId: recentMood ? recentMood.id : null },
    };
  }

  function markdown(today, name, currencyCode) {
    const stats = statsFor(today);
    const badges = badgeList();
    const habits = store.listHabits();
    const entries = store.listEntries().slice().reverse();
    const L = [];
    L.push(`# Day Hub journal${name ? ` — ${name}` : ''}`, '', `_Exported ${today}_`, '');
    L.push('## Stats', '');
    L.push(`- **Total points:** ${stats.totalPoints}`);
    L.push(`- **Current streak:** ${stats.streak} day${stats.streak === 1 ? '' : 's'} (longest ${stats.longestStreak})`);
    L.push(`- **Journal entries:** ${stats.totalEntries}`);
    L.push(`- **Words written:** ${stats.totalWords}`);
    L.push(`- **Badges unlocked:** ${badges.filter((b) => b.unlockedOn).length} / ${badges.length}`, '');
    L.push('## Habits', '');
    if (habits.length) {
      L.push('| Habit | Type | Target | Points |', '|---|---|---|---|');
      for (const h of habits) {
        const type = { check: 'Daily check', goal: 'Goal', limit: 'Limit' }[h.kind];
        L.push(`| ${h.icon} ${h.title} | ${type} | ${h.kind === 'check' ? '' : `${h.target} ${h.unit}`.trim()} | ${h.points} |`);
      }
    } else L.push('_No habits yet._');
    L.push('', '## Badges', '');
    for (const b of badges) L.push(b.unlockedOn ? `- [x] ${b.icon} **${b.name}** — ${b.desc} _(${b.unlockedOn})_` : `- [ ] ${b.icon} ${b.name} — ${b.desc}`);
    L.push('', '## Journal', '');
    if (!entries.length) L.push('_No entries yet._');
    let lastDay = '';
    for (const e of entries) {
      if (e.day !== lastDay) { L.push(`### ${e.day}`, ''); lastDay = e.day; }
      const meta = [e.time, e.mood ? `mood ${e.mood}/5` : '', e.tags.length ? e.tags.map((t) => `#${t}`).join(' ') : ''].filter(Boolean).join(' · ');
      if (meta) L.push(`_${meta}_`, '');
      if (e.text) L.push(e.text, '');
    }
    void currencyCode;
    return `${L.join('\n')}\n`;
  }

  return { statsFor, syncBadges, badgeList, habitsForDay, oneHabit, calendar, timeline, dashboardPart, markdown };
}
