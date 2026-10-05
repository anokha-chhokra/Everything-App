// Small pure helpers that decide what deserves attention right now and how the
// month's spending is going. No database and no clock: the caller passes the day and time.

const toMinutes = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const minutesBetween = (earlier, later) => {
  const a = toMinutes(earlier);
  const b = toMinutes(later);
  return a === null || b === null ? null : b - a;
};

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * How the month's spending is going.
 * Early in the month a projection is mostly noise, so it only appears from day 5.
 */
export function spendPace({ ym, today, totalMinor, budgetMinor }) {
  const [y, m] = ym.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const inThisMonth = today.startsWith(ym);
  const dayOfMonth = inThisMonth ? Number(today.slice(8, 10)) : daysInMonth;
  const daysLeft = inThisMonth ? daysInMonth - dayOfMonth + 1 : 0; // today still counts
  const projectedMinor = dayOfMonth >= 5 && inThisMonth ? Math.round((totalMinor / dayOfMonth) * daysInMonth) : null;
  if (!budgetMinor) return { daysLeft, projectedMinor, perDayLeftMinor: null, status: 'none' };
  const left = budgetMinor - totalMinor;
  let status = 'ok';
  if (left < 0) status = 'over';
  else if (projectedMinor !== null && projectedMinor > budgetMinor) status = 'watch';
  return {
    daysLeft,
    projectedMinor,
    // whole currency units: "About ₹1,111 a day" reads better than ₹1,111.11
    perDayLeftMinor: daysLeft > 0 ? Math.max(0, Math.floor(left / daysLeft / 100) * 100) : null,
    status,
  };
}

/**
 * The "Needs you now" list, most urgent first, at most `limit` items.
 *  tasks:   open tasks with a due date (any) [{ id, title, dueOn, priority }]
 *  habits:  today's habits [{ id, title, icon, kind, done, remindAt, scheduled }]
 *  now:     "HH:MM" or null (without a clock, time-based nudges are skipped)
 */
export function buildAttention({ today, now, tasks, habits, entriesToday, journalReminder, spend, limit = 4 }) {
  const items = [];
  for (const t of tasks) {
    if (!t.dueOn || t.dueOn > today) continue;
    const overdueDays = daysBetween(t.dueOn, today);
    const overdue = overdueDays > 0;
    items.push({
      type: 'task', id: t.id, title: t.title, dueOn: t.dueOn, overdue, priority: t.priority,
      score: (overdue ? 50 + Math.min(overdueDays, 30) : 35) + (t.priority ? 20 : 0),
    });
  }
  if (now) {
    for (const hb of habits) {
      if (hb.kind !== 'check' || hb.done || !hb.scheduled || !hb.remindAt) continue;
      const late = minutesBetween(hb.remindAt, now);
      if (late !== null && late >= 0) {
        items.push({ type: 'habit', id: hb.id, title: hb.title, icon: hb.icon, remindAt: hb.remindAt, score: 30 });
      }
    }
    const cutoff = journalReminder || '20:00';
    if (entriesToday === 0 && minutesBetween(cutoff, now) !== null && minutesBetween(cutoff, now) >= 0) {
      items.push({ type: 'journal', title: 'Write today’s entry', score: 20 });
    }
  }
  if (spend && spend.status === 'over') items.push({ type: 'budget', title: 'Over this month’s budget', overByMinor: spend.overByMinor, score: 70 });
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, limit).map(({ score, ...rest }) => rest);
}
