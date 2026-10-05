import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../public/js/core/backend.js';
import { memoryStorage } from '../public/js/core/store.js';

const TODAY = '2026-10-05';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// ---- app under test: the same routes the page runs, against a store kept in memory ----
function startApp(storage = memoryStorage()) {
  const backend = createBackend({ storage });
  const call = async (method, path, body) => {
    const res = await backend.call(method, path, body);
    const text = typeof res.body === 'string' ? res.body : res.body === null || res.body === undefined ? '' : JSON.stringify(res.body);
    const lower = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: res.status,
      json: res.body && typeof res.body === 'object' ? res.body : null,
      text,
      headers: { get: (k) => lower[String(k).toLowerCase()] ?? null },
    };
  };
  return { call, store: backend.store, storage, close: () => {} };
}

test('first run: not set up, then the wizard saves everything at once', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('GET', '/api/state')).json.setupDone, false);

    // a bad value anywhere means nothing is saved
    const bad = await app.call('POST', '/api/setup', { name: 'Asha', currency: 'XXXX' });
    assert.equal(bad.status, 400);
    const badMusic = await app.call('POST', '/api/setup', { name: 'Asha', musicUrl: 'https://example.com/x' });
    assert.equal(badMusic.status, 400);
    assert.equal((await app.call('GET', '/api/state')).json.setupDone, false);

    const ok = await app.call('POST', '/api/setup', {
      name: 'Asha', currency: 'inr', monthlyBudget: '30,000',
      musicUrl: YOUTUBE,
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.setupDone, true);
    assert.equal(ok.json.currency, 'INR');
    assert.equal(ok.json.monthlyBudgetMinor, 3_000_000);
    assert.ok(ok.json.currentMusicId);
  } finally { app.close(); }
});

test('tasks: add, complete, reopen, edit, delete', async () => {
  const app = await startApp();
  try {
    const t = (await app.call('POST', '/api/tasks', { title: '  Send invoice  ', dueOn: TODAY, priority: 1 })).json;
    assert.equal(t.title, 'Send invoice');
    assert.equal(t.priority, 1);
    assert.equal((await app.call('POST', '/api/tasks', { title: '' })).status, 400);
    assert.equal((await app.call('POST', '/api/tasks', { title: 'x', dueOn: '2026-13-40' })).status, 400);
    assert.equal((await app.call('POST', '/api/tasks', { title: 'x', priority: 5 })).status, 400);

    const done = (await app.call('PATCH', `/api/tasks/${t.id}`, { done: true, today: TODAY })).json;
    assert.equal(done.done, true);
    assert.equal(done.doneOn, TODAY);
    assert.equal((await app.call('GET', '/api/tasks?status=open')).json.tasks.length, 0);
    assert.equal((await app.call('GET', '/api/tasks?status=done')).json.tasks.length, 1);

    const reopened = (await app.call('PATCH', `/api/tasks/${t.id}`, { done: false, dueOn: null })).json;
    assert.equal(reopened.done, false);
    assert.equal(reopened.dueOn, null);
    assert.equal((await app.call('PATCH', '/api/tasks/9999', { done: true })).status, 404);

    assert.equal((await app.call('DELETE', `/api/tasks/${t.id}`)).status, 204);
    assert.equal((await app.call('DELETE', `/api/tasks/${t.id}`)).status, 404);
    assert.equal((await app.call('DELETE', '/api/tasks/abc')).status, 400);
  } finally { app.close(); }
});

test('expenses: exact money, months, summary and a safe CSV', async () => {
  const app = await startApp();
  try {
    const a = await app.call('POST', '/api/expenses', { amount: '123.45', category: 'Food', note: 'Lunch', spentOn: '2026-10-02' });
    assert.equal(a.status, 201);
    assert.equal(a.json.amountMinor, 12345);
    await app.call('POST', '/api/expenses', { amount: '0.10', category: 'Food', spentOn: '2026-10-03' });
    await app.call('POST', '/api/expenses', { amount: '0.20', category: 'Transport', note: '=HYPERLINK("http://evil")', spentOn: '2026-10-03' });
    await app.call('POST', '/api/expenses', { amount: '50', category: 'Bills', spentOn: '2026-09-30' });

    for (const amount of ['abc', '0', '-1', '1.234', '']) {
      assert.equal((await app.call('POST', '/api/expenses', { amount, category: 'Food' })).status, 400, amount);
    }
    assert.equal((await app.call('POST', '/api/expenses', { amount: '5', category: 'Nope' })).status, 400);

    const oct = (await app.call('GET', '/api/expenses?month=2026-10')).json;
    assert.equal(oct.totalMinor, 12345 + 10 + 20); // 0.1 + 0.2 is exactly 30 paise
    assert.equal(oct.count, 3);
    assert.equal(oct.byCategory[0].category, 'Food');
    assert.equal((await app.call('GET', '/api/expenses?month=2026-9')).status, 400);

    const csv = await app.call('GET', '/api/expenses.csv?month=2026-10');
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.text, /^Date,Amount,Category,Note\n/);
    assert.match(csv.text, /2026-10-02,123\.45,Food,Lunch/);
    assert.doesNotMatch(csv.text, /,=HYPERLINK/); // formula is neutralised
    assert.match(csv.text, /'=HYPERLINK/);

    assert.equal((await app.call('DELETE', `/api/expenses/${a.json.id}`)).status, 204);
    assert.equal((await app.call('GET', '/api/expenses?month=2026-10')).json.count, 2);
  } finally { app.close(); }
});

test('dashboard: attention tile lists overdue and due-today tasks', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/api/setup', { name: 'Asha', monthlyBudget: '1000' });
    await app.call('POST', '/api/tasks', { title: 'Pay rent', dueOn: '2026-10-03', priority: 1 });
    await app.call('POST', '/api/tasks', { title: 'Call plumber', dueOn: TODAY });
    await app.call('POST', '/api/tasks', { title: 'Someday', dueOn: '2026-12-01' });
    const done = (await app.call('POST', '/api/tasks', { title: 'Buy milk' })).json;
    await app.call('PATCH', `/api/tasks/${done.id}`, { done: true, today: TODAY });
    await app.call('POST', '/api/expenses', { amount: '250.50', category: 'Food', spentOn: TODAY });
    await app.call('POST', '/api/expenses', { amount: '100', category: 'Bills', spentOn: '2026-10-01' });
    await app.call('POST', '/api/expenses', { amount: '999', category: 'Bills', spentOn: '2026-09-30' });

    const d = (await app.call('GET', `/api/dashboard?today=${TODAY}`)).json;
    assert.equal(d.name, 'Asha');
    assert.deepEqual(d.attention.map((a) => a.type), ['task', 'task']);
    assert.equal(d.attention[0].title, 'Pay rent');
    assert.equal(d.attention[0].overdue, true);
    assert.equal(d.attention[1].overdue, false);
    assert.equal(d.tasks.doneToday, 1);
    assert.equal(d.tasks.total, 3); // overdue, due today, done today (not the December one)
    assert.equal(d.spend.totalMinor, 25050 + 10000);
    assert.equal(d.spend.todayMinor, 25050);
    assert.equal(d.spend.budgetMinor, 100000);
  } finally { app.close(); }
});

test('music: saved links, current track, delete', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/music', { url: 'https://example.com/song' })).status, 400);
    assert.equal((await app.call('POST', '/api/music', { url: 'https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M' })).status, 400);
    const a = (await app.call('POST', '/api/music', { url: YOUTUBE, label: 'Focus' })).json;
    assert.equal(a.link.label, 'Focus');
    const b = (await app.call('POST', '/api/music', { url: 'https://www.youtube.com/playlist?list=PLabcdefghij1234567' })).json;

    let m = (await app.call('GET', '/api/music')).json;
    assert.equal(m.current.id, b.link.id); // the newest link plays
    assert.equal(m.links.length, 2);

    m = (await app.call('PUT', '/api/music/current', { id: a.link.id })).json;
    assert.equal(m.current.id, a.link.id);
    assert.equal((await app.call('PUT', '/api/music/current', { id: 9999 })).status, 404);

    assert.equal((await app.call('DELETE', `/api/music/${a.link.id}`)).status, 204);
    m = (await app.call('GET', '/api/music')).json;
    assert.equal(m.current, null);
    assert.equal(m.links.length, 1);
  } finally { app.close(); }
});

test('settings: validation and backup', async () => {
  const app = await startApp();
  try {
    const s = (await app.call('PUT', '/api/settings', { name: 'Ravi', currency: 'usd', monthlyBudget: 500 })).json;
    assert.equal(s.currency, 'USD');
    assert.equal(s.monthlyBudgetMinor, 50000);
    assert.equal((await app.call('PUT', '/api/settings', { currency: 'ZZZ9' })).status, 400);
    assert.equal((await app.call('PUT', '/api/settings', { name: 'x'.repeat(41) })).status, 400);
    assert.equal((await app.call('PUT', '/api/settings', [1, 2])).status, 400);
    const backup = await app.call('GET', '/api/export');
    assert.match(backup.headers.get('content-disposition'), /day-hub-backup\.json/);
    assert.equal(backup.json.settings.name, 'Ravi');
  } finally { app.close(); }
});

test('routes: unknown paths, wrong methods and odd input are refused cleanly', async () => {
  const app = startApp();
  try {
    assert.equal((await app.call('GET', '/api/nothing')).status, 404);
    assert.equal((await app.call('PUT', '/api/tasks', {})).status, 405);
    assert.equal((await app.call('DELETE', '/api/tasks/%E0%A4%A')).status, 400); // broken URL escape
    assert.equal((await app.call('POST', '/api/tasks', 'not an object')).status, 400);
    assert.equal((await app.call('POST', '/api/tasks', [1, 2])).status, 400);
    assert.equal((await app.call('POST', '/api/tasks', { title: 'x'.repeat(201) })).status, 400);
    assert.equal((await app.call('POST', '/api/tasks', { title: 'ok\u0000\u0007 text' })).json.title, 'ok   text'); // each control character becomes a space
    // nothing a screen sends can reach the stored rows by reference
    const t = (await app.call('POST', '/api/tasks', { title: 'one' })).json;
    t.title = 'changed in the caller';
    assert.equal((await app.call('GET', '/api/tasks')).json.tasks.find((x) => x.id === t.id).title, 'one');
  } finally { app.close(); }
});

// ---------- commit() features ----------

test('habits: create, log, points, limits, archive keeps history', async () => {
  const app = await startApp();
  try {
    const water = (await app.call('POST', '/api/habits', { title: 'Water', icon: '💧', kind: 'goal', unit: 'glasses', target: 8, points: 16, today: TODAY })).json;
    const gym = (await app.call('POST', '/api/habits', { title: 'Workout', kind: 'check', points: 20, days: [1, 3, 5], today: TODAY })).json;
    const coffee = (await app.call('POST', '/api/habits', { title: 'Coffee', kind: 'limit', unit: 'cups', target: 2, points: 5, today: TODAY })).json;
    assert.equal(gym.target, 1);
    assert.equal((await app.call('POST', '/api/habits', { title: '', kind: 'check' })).status, 400);
    assert.equal((await app.call('POST', '/api/habits', { title: 'x', kind: 'weird' })).status, 400);
    assert.equal((await app.call('POST', '/api/habits', { title: 'x', days: [9] })).status, 400);
    assert.equal((await app.call('POST', '/api/habits', { title: 'x', remindAt: '25:00' })).status, 400);

    let list = (await app.call('GET', `/api/habits?today=${TODAY}`)).json.habits; // 2026-10-05 is a Monday
    assert.equal(list.length, 3);
    assert.equal(list.find((h) => h.title === 'Workout').scheduled, true);

    let r = (await app.call('PUT', `/api/habits/${water.id}/log`, { day: TODAY, value: 4, today: TODAY })).json;
    assert.equal(r.habit.pointsToday, 8);
    assert.equal(r.habit.done, false);
    assert.equal(r.stats.totalPoints, 8);
    r = (await app.call('PUT', `/api/habits/${gym.id}/log`, { day: TODAY, value: 5, today: TODAY })).json; // check clamps to 1
    assert.equal(r.habit.value, 1);
    assert.equal(r.habit.done, true);
    assert.ok(r.newBadges.some((b) => b.id === 'first-step'));
    r = (await app.call('PUT', `/api/habits/${gym.id}/log`, { day: TODAY, value: 1, today: TODAY })).json;
    assert.deepEqual(r.newBadges, []); // a badge is announced only once
    r = (await app.call('PUT', `/api/habits/${coffee.id}/log`, { day: TODAY, value: 3, today: TODAY })).json;
    assert.equal(r.habit.pointsToday, -5);
    assert.equal(r.stats.totalPoints, 8 + 20 - 5);
    assert.equal((await app.call('PUT', `/api/habits/${water.id}/log`, { day: 'nope', value: 1 })).status, 400);
    assert.equal((await app.call('PUT', `/api/habits/${water.id}/log`, { day: TODAY, value: -1 })).status, 400);

    // edit, then archive: the habit disappears but points stay
    const edited = (await app.call('PATCH', `/api/habits/${water.id}`, { target: 10, today: TODAY })).json;
    assert.equal(edited.target, 10);
    assert.equal(edited.title, 'Water');
    assert.equal((await app.call('DELETE', `/api/habits/${gym.id}`)).status, 204);
    list = (await app.call('GET', `/api/habits?today=${TODAY}`)).json.habits;
    assert.equal(list.some((h) => h.title === 'Workout'), false);
    assert.equal((await app.call('PUT', `/api/habits/${gym.id}/log`, { day: TODAY, value: 1 })).status, 404);
    const stats = (await app.call('GET', `/api/stats?today=${TODAY}`)).json;
    assert.ok(stats.totalPoints >= 20); // workout points kept after archiving
    assert.equal(stats.badges.length, 13);
  } finally { app.close(); }
});

test('journal: entries, mood-only check-ins, edits, deletes, linked expenses', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/journal', { text: '', today: TODAY })).status, 400);
    assert.equal((await app.call('POST', '/api/journal', { mood: 9 })).status, 400);

    const detected = (await app.call('POST', '/api/expenses/detect', { text: 'Spent ₹250 on lunch. Paid 400 for fuel.' })).json.items;
    assert.equal(detected.length, 2);

    const made = (await app.call('POST', '/api/journal', {
      day: TODAY, time: '22:30', text: 'Good day. Spent ₹250 on lunch.', mood: 4, tags: ['Work', 'work', 'gratitude'], promptId: 'highlight',
      expenses: [{ amount: '250', category: 'Food', note: 'lunch' }], today: TODAY,
    })).json;
    assert.equal(made.entry.wordCount, 6);
    assert.deepEqual(made.entry.tags, ['work', 'gratitude']);
    assert.equal(made.expenses[0].entryId, made.entry.id);
    assert.ok(made.newBadges.some((b) => b.id === 'first-entry'));
    assert.ok(made.newBadges.some((b) => b.id === 'night-owl'));
    assert.equal((await app.call('POST', '/api/journal', { text: 'x', promptId: 'nope' })).status, 400);
    assert.equal((await app.call('POST', '/api/journal', { text: 'x', expenses: [{ amount: '-5' }] })).status, 400);

    const checkin = (await app.call('POST', '/api/journal', { day: TODAY, mood: 2, today: TODAY })).json; // mood only
    assert.equal(checkin.entry.text, '');

    const ex = (await app.call('GET', `/api/expenses?month=2026-10`)).json;
    assert.equal(ex.expenses.length, 1);
    assert.equal(ex.expenses[0].entryId, made.entry.id);

    const list = (await app.call('GET', '/api/journal?month=2026-10')).json.entries;
    assert.equal(list.length, 2);
    const patched = (await app.call('PATCH', `/api/journal/${made.entry.id}`, { text: 'Edited it', mood: 5, tags: [] })).json.entry;
    assert.equal(patched.text, 'Edited it');
    assert.equal(patched.wordCount, 2);
    assert.equal(patched.mood, 5);
    assert.equal((await app.call('PATCH', `/api/journal/${checkin.entry.id}`, { mood: null })).status, 400); // would be empty

    const cal = (await app.call('GET', '/api/calendar?month=2026-10')).json;
    assert.equal(cal.days[TODAY].entries, 2);
    assert.equal(cal.days[TODAY].mood, 4); // average of 5 and 2, rounded

    // deleting an entry keeps the expense it created
    assert.equal((await app.call('DELETE', `/api/journal/${made.entry.id}`)).status, 204);
    assert.equal((await app.call('GET', `/api/expenses?month=2026-10`)).json.expenses[0].entryId, null);
    assert.equal((await app.call('DELETE', `/api/journal/${made.entry.id}`)).status, 404);

    const md = await app.call('GET', `/api/export.md?today=${TODAY}`);
    assert.equal(md.status, 200);
    assert.match(md.text, /## Journal/);
    assert.match(md.headers.get('content-type'), /markdown/);
  } finally { app.close(); }
});

test('setup can create starter habits, and the dashboard shows habits + journal', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/setup', { name: 'A', habits: ['nope'] })).status, 400);
    assert.equal((await app.call('GET', '/api/habits')).json.habits.length, 0); // nothing saved on error
    await app.call('POST', '/api/setup', { name: 'Asha', habits: ['water', 'coffee', 'workout'], today: TODAY });
    const d = (await app.call('GET', `/api/dashboard?today=${TODAY}`)).json;
    assert.equal(d.habits.total, 3);
    assert.equal(d.habits.doneCount, 0);
    assert.equal(d.stats.streak, 0);
    assert.ok(d.journal.prompt.id);
    assert.equal(d.journal.todayCount, 0);
    const s = (await app.call('PUT', '/api/settings', { notifications: true, journalReminder: '21:30' })).json;
    assert.equal(s.notifications, true);
    assert.equal(s.journalReminder, '21:30');
    assert.equal((await app.call('PUT', '/api/settings', { journalReminder: '9pm' })).status, 400);
  } finally { app.close(); }
});

test('timeline: one day merged in time order (entries, habits, spending, tasks)', async () => {
  const app = await startApp();
  try {
    const gym = (await app.call('POST', '/api/habits', { title: 'Workout', kind: 'check', remindAt: '07:30', today: TODAY })).json;
    const read = (await app.call('POST', '/api/habits', { title: 'Read', kind: 'check', remindAt: '21:00', today: TODAY })).json;
    const nap = (await app.call('POST', '/api/habits', { title: 'Stretch', kind: 'check', today: TODAY })).json; // no time
    const water = (await app.call('POST', '/api/habits', { title: 'Water', kind: 'goal', unit: 'glasses', target: 8, points: 16, today: TODAY })).json;

    await app.call('PUT', `/api/habits/${gym.id}/log`, { day: TODAY, value: 1, time: '07:45', today: TODAY });
    await app.call('PUT', `/api/habits/${water.id}/log`, { day: TODAY, value: 4, time: '11:00', today: TODAY });
    await app.call('POST', '/api/journal', { day: TODAY, time: '08:15', text: 'Morning pages', mood: 4, today: TODAY });
    await app.call('POST', '/api/expenses', { amount: '180', category: 'Food', note: 'Lunch', spentOn: TODAY, time: '12:40' });
    const task = (await app.call('POST', '/api/tasks', { title: 'Send invoice' })).json;
    await app.call('PATCH', `/api/tasks/${task.id}`, { done: true, today: TODAY, time: '18:05' });
    await app.call('POST', '/api/journal', { day: TODAY, time: '22:30', text: 'Night thoughts', today: TODAY });

    const t = (await app.call('GET', `/api/timeline?day=${TODAY}`)).json;
    assert.deepEqual(t.items.map((i) => `${i.time} ${i.type}${i.pending ? ':pending' : ''}`), [
      '07:45 habit', '08:15 entry', '12:40 expense', '18:05 task', '21:00 habit:pending', '22:30 entry',
    ]);
    assert.deepEqual(t.anytime.map((h) => h.title), ['Stretch']); // untimed and not done yet
    assert.deepEqual(t.goals.map((h) => [h.title, h.value]), [['Water', 4]]);
    assert.equal(t.summary.habitsDone, 1);
    assert.equal(t.summary.habitsScheduled, 4);
    assert.equal(t.summary.entries, 2);
    assert.equal(t.summary.spentMinor, 18000);
    assert.equal(t.summary.tasksDone, 1);
    assert.equal(t.summary.points, 8 + 10 + 10); // water half of 16, workout 10, first journal entry 10
    void nap; void read;

    // another day is its own page; a bad day is rejected
    const other = (await app.call('GET', '/api/timeline?day=2026-10-04')).json;
    assert.equal(other.items.length, 0);
    assert.equal((await app.call('GET', '/api/timeline?day=oops')).status, 400);
    assert.equal((await app.call('PUT', `/api/habits/${gym.id}/log`, { day: TODAY, value: 1, time: '7am' })).status, 400);
  } finally { app.close(); }
});

test('logic: no logging on future days; journal entries cannot be written for tomorrow', async () => {
  const app = await startApp();
  try {
    const h1 = (await app.call('POST', '/api/habits', { title: 'Read', kind: 'check', today: TODAY })).json;
    const fut = await app.call('PUT', `/api/habits/${h1.id}/log`, { day: '2026-10-06', value: 1, today: TODAY });
    assert.equal(fut.status, 400);
    assert.match(fut.json.error, /hasn't happened/);
    assert.equal((await app.call('POST', '/api/journal', { day: '2026-10-06', text: 'tomorrow', today: TODAY })).status, 400);
    assert.equal((await app.call('PUT', `/api/habits/${h1.id}/log`, { day: TODAY, value: 1, today: TODAY })).status, 200);
  } finally { app.close(); }
});

test('logic: editing an entry can fix its day and time, and its spending follows', async () => {
  const app = await startApp();
  try {
    const made = (await app.call('POST', '/api/journal', {
      day: TODAY, time: '23:10', text: 'Spent ₹250 on lunch', today: TODAY, expenses: [{ amount: '250', category: 'Food', note: 'lunch' }],
    })).json;
    const patched = await app.call('PATCH', `/api/journal/${made.entry.id}`, { day: '2026-10-04', time: '13:05', today: TODAY });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.entry.day, '2026-10-04');
    assert.equal(patched.json.entry.time, '13:05');
    const t = (await app.call('GET', `/api/timeline?day=2026-10-04&today=${TODAY}`)).json;
    assert.deepEqual(t.items.map((i) => `${i.time} ${i.type}`), ['13:05 entry', '13:05 expense']);
    assert.equal((await app.call('GET', `/api/timeline?day=${TODAY}&today=${TODAY}`)).json.items.length, 0);
    // cannot move an entry into the future; a bad time is rejected
    assert.equal((await app.call('PATCH', `/api/journal/${made.entry.id}`, { day: '2026-10-09', today: TODAY })).status, 400);
    assert.equal((await app.call('PATCH', `/api/journal/${made.entry.id}`, { time: '25:00', today: TODAY })).status, 400);
  } finally { app.close(); }
});

test('logic: detection on edit skips what is already saved, and "yesterday" lands on yesterday', async () => {
  const app = await startApp();
  try {
    const made = (await app.call('POST', '/api/journal', {
      day: TODAY, time: '20:00', text: 'Spent ₹250 on lunch', today: TODAY, expenses: [{ amount: '250', category: 'Food', note: 'lunch' }],
    })).json;
    const text = 'Spent ₹250 on lunch. Yesterday I paid ₹400 for fuel.';
    const fresh = (await app.call('POST', '/api/expenses/detect', { text, day: TODAY })).json.items;
    assert.equal(fresh.length, 2);
    const onEdit = (await app.call('POST', '/api/expenses/detect', { text, day: TODAY, entryId: made.entry.id })).json.items;
    assert.deepEqual(onEdit.map((x) => [x.amountMinor, x.daysAgo]), [[40000, 1]]);

    // saving it via an edit adds just that one, dated yesterday with no invented time
    const res = (await app.call('PATCH', `/api/journal/${made.entry.id}`, { text, today: TODAY, expenses: [{ amount: '400', category: 'Transport', note: 'fuel', daysAgo: 1 }] })).json;
    assert.equal(res.expenses.length, 1);
    assert.equal(res.expenses[0].spentOn, '2026-10-04');
    assert.equal(res.expenses[0].time, null);
    const yesterday = (await app.call('GET', `/api/timeline?day=2026-10-04&today=${TODAY}`)).json;
    assert.equal(yesterday.summary.spentMinor, 40000);
  } finally { app.close(); }
});

test('logic: categories learn from your own expenses', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/api/expenses', { amount: '700', category: 'Fun', note: 'zorbing', spentOn: TODAY });
    await app.call('POST', '/api/expenses', { amount: '300', category: 'Fun', note: 'zorbing ride', spentOn: TODAY });
    const r = (await app.call('POST', '/api/expenses/detect', { text: 'paid 650 for zorbing' })).json.items;
    assert.equal(r[0].category, 'Fun');
  } finally { app.close(); }
});

test('logic: needs-you-now adds missed habits, the journal nudge and a budget warning; dashboard has a spending pace', async () => {
  const app = await startApp();
  try {
    await app.call('PUT', '/api/settings', { monthlyBudget: 1000 });
    await app.call('POST', '/api/habits', { title: 'Evening walk', kind: 'check', remindAt: '19:30', today: TODAY });
    await app.call('POST', '/api/expenses', { amount: '1500', category: 'Other', spentOn: TODAY });

    const early = (await app.call('GET', `/api/dashboard?today=${TODAY}&now=10:00`)).json;
    assert.deepEqual(early.attention.map((a) => a.type), ['budget']);
    assert.equal(early.attention[0].overByMinor, 50000);
    assert.equal(early.spend.pace.status, 'over');

    const late = (await app.call('GET', `/api/dashboard?today=${TODAY}&now=21:15`)).json;
    assert.deepEqual(late.attention.map((a) => a.type), ['budget', 'habit', 'journal']);
    assert.equal(late.attention[1].title, 'Evening walk');

    // tick the walk and write something: both nudges go away
    const walk = late.habits.list[0];
    await app.call('PUT', `/api/habits/${walk.id}/log`, { day: TODAY, value: 1, time: '21:20', today: TODAY });
    await app.call('POST', '/api/journal', { day: TODAY, time: '21:30', text: 'Done', today: TODAY });
    const after = (await app.call('GET', `/api/dashboard?today=${TODAY}&now=21:40`)).json;
    assert.deepEqual(after.attention.map((a) => a.type), ['budget']);

    // without a clock the time-based nudges are skipped
    const noClock = (await app.call('GET', `/api/dashboard?today=${TODAY}`)).json;
    assert.deepEqual(noClock.attention.map((a) => a.type), ['budget']);
    assert.equal((await app.call('GET', `/api/dashboard?today=${TODAY}&now=9pm`)).status, 400);
  } finally { app.close(); }
});

test('logic: timeline shows a planned habit as missed once its time has passed', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/api/habits', { title: 'Evening walk', kind: 'check', remindAt: '19:30', today: '2026-10-01' });
    const at = async (day, now) => (await app.call('GET', `/api/timeline?day=${day}&today=${TODAY}${now ? `&now=${now}` : ''}`)).json;
    assert.equal((await at(TODAY, '18:00')).items[0].missed, false); // still ahead
    assert.equal((await at(TODAY, '19:31')).items[0].missed, true);
    assert.equal((await at(TODAY)).items[0].missed, false); // no clock -> cannot tell
    const past = await at('2026-10-02', '10:00');
    assert.equal(past.items[0].missed, true);
    assert.equal(past.summary.missed, 1);
    assert.equal(past.items[0].part, 'Evening');
  } finally { app.close(); }
});

test('logic: a mood tap soon after another one is a correction, not a second check-in', async () => {
  const app = await startApp();
  try {
    const first = (await app.call('POST', '/api/journal', { day: TODAY, time: '10:00', mood: 3, today: TODAY })).json.entry;
    const near = (await app.call('GET', `/api/dashboard?today=${TODAY}&now=10:20`)).json;
    assert.equal(near.journal.quickMoodId, first.id);
    const far = (await app.call('GET', `/api/dashboard?today=${TODAY}&now=11:00`)).json;
    assert.equal(far.journal.quickMoodId, null);
    // an entry with text is never treated as a quick mood
    await app.call('POST', '/api/journal', { day: TODAY, time: '11:30', mood: 4, text: 'Real entry', today: TODAY });
    assert.equal((await app.call('GET', `/api/dashboard?today=${TODAY}&now=11:40`)).json.journal.quickMoodId, null);
  } finally { app.close(); }
});
