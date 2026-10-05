// Routes and request handling. createApp() returns a plain (req, res) handler,
// so tests can run it on any port without touching the real database.

import { Router, Reply, readJson, send, serveStatic } from './http.js';
import {
  HttpError, bad, obj, str, isoDate, month, moneyToMinor, oneOf, currency, id, int, hhmm, weekdays, tags,
  todayOf, monthRange,
} from './validate.js';
import { parseMusicUrl } from './music.js';
import { createCommit } from './commit.js';
import { spendPace, buildAttention } from './insights.js';
import { KINDS, PRESETS, addDays } from './habits.js';
import { PROMPTS, TAG_SUGGESTIONS, promptForDay, wordCount } from './prompts.js';
import { detectExpenses, buildHints } from './detect.js';

export const CATEGORIES = ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Fun', 'Other'];

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

const csvCell = (value) => {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const minorToDecimal = (n) => (n / 100).toFixed(2);

export function createApp({ store, config }) {
  const router = new Router();
  const commit = createCommit(store);
  const loopbackOnly = ['127.0.0.1', 'localhost', '::1'].includes(config.host);

  function addMusicFromInput(urlInput, labelInput) {
    const parsed = parseMusicUrl(urlInput);
    const label = str(labelInput, 'label', { max: 60, optional: true }) || parsed.defaultLabel;
    return store.addMusic({ ...parsed, label });
  }

  function setCurrentMusic(link) {
    return store.setSettings({ currentMusicId: link ? link.id : null });
  }

  function musicState() {
    const s = store.getSettings();
    return { current: s.currentMusicId ? store.getMusic(s.currentMusicId) : null };
  }

  // ---------- state & settings ----------
  router.get('/api/health', () => ({ ok: true }));

  router.get('/api/state', () => {
    const settings = store.getSettings();
    return { setupDone: settings.setupDone, settings };
  });

  router.get('/api/settings', () => store.getSettings());

  router.put('/api/settings', async (ctx) => {
    const b = obj(await ctx.json());
    const patch = {};
    if ('name' in b) patch.name = str(b.name, 'name', { max: 40, optional: true }) ?? '';
    if ('currency' in b) patch.currency = currency(b.currency);
    if ('monthlyBudget' in b) {
      patch.monthlyBudgetMinor =
        b.monthlyBudget === '' || b.monthlyBudget === null || b.monthlyBudget === 0
          ? 0
          : moneyToMinor(b.monthlyBudget, 'monthly budget', { allowZero: true });
    }
    if ('notifications' in b) {
      if (typeof b.notifications !== 'boolean') throw bad('notifications must be true or false');
      patch.notifications = b.notifications;
    }
    if ('journalReminder' in b) patch.journalReminder = hhmm(b.journalReminder, 'journal reminder') ?? '';
    return store.setSettings(patch);
  });

  // First-run wizard: everything in one call so a half-finished setup never sticks.
  router.post('/api/setup', async (ctx) => {
    const b = obj(await ctx.json());
    const patch = { setupDone: true };
    patch.name = str(b.name, 'name', { max: 40, optional: true }) ?? '';
    if (b.currency !== undefined) patch.currency = currency(b.currency);
    if (b.monthlyBudget !== undefined && b.monthlyBudget !== '' && b.monthlyBudget !== null) {
      patch.monthlyBudgetMinor = moneyToMinor(b.monthlyBudget, 'monthly budget', { allowZero: true });
    }
    let musicParsed = null;
    if (b.musicUrl) musicParsed = parseMusicUrl(b.musicUrl);
    const presetIds = Array.isArray(b.habits) ? b.habits : [];
    const presets = presetIds.map((pid) => {
      const p = PRESETS.find((x) => x.id === pid);
      if (!p) throw bad(`Unknown habit "${pid}"`);
      return p;
    });
    const today = todayOf(b.today);

    let settings = store.setSettings(patch);
    for (const p of presets) {
      store.createHabit({ ...p, days: [0, 1, 2, 3, 4, 5, 6], remindAt: null, createdOn: today });
    }
    if (musicParsed) {
      const link = store.addMusic({ ...musicParsed, label: musicParsed.defaultLabel });
      settings = setCurrentMusic(link);
    }
    return settings;
  });

  // ---------- dashboard ----------
  router.get('/api/dashboard', (ctx) => {
    const today = todayOf(ctx.query.get('today'));
    const settings = store.getSettings();

    const now = hhmm(ctx.query.get('now'));
    const taskRows = store.dashboardTasks(today);

    const ym = today.slice(0, 7);
    const [from, to] = monthRange(ym);
    const monthSummary = store.summarizeExpenses({ from, to });
    const todaySummary = store.summarizeExpenses({ from: today, to: nextDay(today) });
    const pace = spendPace({ ym, today, totalMinor: monthSummary.totalMinor, budgetMinor: settings.monthlyBudgetMinor });
    const part = commit.dashboardPart(today, now);

    const attention = buildAttention({
      today,
      now,
      tasks: taskRows.filter((t) => !t.done),
      habits: part.habits.list,
      entriesToday: part.journal.todayCount,
      journalReminder: settings.journalReminder,
      spend: { status: pace.status, overByMinor: monthSummary.totalMinor - settings.monthlyBudgetMinor },
    });

    return {
      today,
      name: settings.name,
      attention,
      tasks: {
        list: taskRows,
        total: taskRows.length,
        doneToday: taskRows.filter((t) => t.done).length,
      },
      spend: {
        month: ym,
        currency: settings.currency,
        totalMinor: monthSummary.totalMinor,
        budgetMinor: settings.monthlyBudgetMinor,
        todayMinor: todaySummary.totalMinor,
        pace,
      },
      music: musicState(),
      ...part,
    };
  });

  function nextDay(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    return dt.toISOString().slice(0, 10);
  }

  // ---------- tasks ----------
  router.get('/api/tasks', (ctx) => ({
    tasks: store.listTasks({ status: oneOf(ctx.query.get('status') || undefined, ['open', 'done', 'all'], 'status', 'open') }),
  }));

  router.post('/api/tasks', async (ctx) => {
    const b = obj(await ctx.json());
    return new Reply(201, store.createTask({
      title: str(b.title, 'title', { max: 200 }),
      dueOn: isoDate(b.dueOn, 'due date', { optional: true }),
      priority: oneOf(b.priority, [0, 1], 'priority', 0),
    }));
  });

  router.patch('/api/tasks/:id', async (ctx) => {
    const taskId = id(ctx.params.id);
    const b = obj(await ctx.json());
    const patch = {};
    if ('title' in b) patch.title = str(b.title, 'title', { max: 200 });
    if ('dueOn' in b) patch.dueOn = isoDate(b.dueOn, 'due date', { optional: true });
    if ('priority' in b) patch.priority = oneOf(b.priority, [0, 1], 'priority');
    if ('done' in b) {
      if (typeof b.done !== 'boolean') throw bad('done must be true or false');
      patch.done = b.done;
      patch.doneOn = b.done ? todayOf(b.today) : null;
      patch.doneTime = b.done ? hhmm(b.time) : null;
    }
    const task = store.updateTask(taskId, patch);
    if (!task) throw new HttpError(404, 'Task not found');
    return task;
  });

  router.delete('/api/tasks/:id', (ctx) => {
    if (!store.deleteTask(id(ctx.params.id))) throw new HttpError(404, 'Task not found');
    return new Reply(204);
  });

  // ---------- expenses ----------
  const monthParam = (ctx) => (ctx.query.get('month') ? month(ctx.query.get('month')) : todayOf(ctx.query.get('today')).slice(0, 7));

  router.get('/api/expenses', (ctx) => {
    const ym = monthParam(ctx);
    const [from, to] = monthRange(ym);
    return { month: ym, expenses: store.listExpenses({ from, to }), ...store.summarizeExpenses({ from, to }) };
  });

  router.post('/api/expenses', async (ctx) => {
    const b = obj(await ctx.json());
    return new Reply(201, store.createExpense({
      amountMinor: moneyToMinor(b.amount, 'amount'),
      category: oneOf(b.category, CATEGORIES, 'category', 'Other'),
      note: str(b.note, 'note', { max: 120, optional: true }),
      spentOn: b.spentOn ? isoDate(b.spentOn, 'date') : todayOf(b.today),
      time: hhmm(b.time),
    }));
  });

  router.delete('/api/expenses/:id', (ctx) => {
    if (!store.deleteExpense(id(ctx.params.id))) throw new HttpError(404, 'Expense not found');
    return new Reply(204);
  });

  router.get('/api/expenses.csv', (ctx) => {
    let rows;
    let name = 'expenses-all';
    if (ctx.query.get('month')) {
      const ym = month(ctx.query.get('month'));
      const [from, to] = monthRange(ym);
      rows = store.listExpenses({ from, to });
      name = `expenses-${ym}`;
    } else {
      rows = store.listExpenses();
    }
    const lines = ['Date,Amount,Category,Note', ...rows.map((r) =>
      [r.spentOn, minorToDecimal(r.amountMinor), r.category, r.note].map(csvCell).join(','))];
    return new Reply(200, `${lines.join('\n')}\n`, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.csv"`,
    });
  });

  // ---------- music ----------
  router.get('/api/music', () => ({ links: store.listMusic(), ...musicState() }));

  router.post('/api/music', async (ctx) => {
    const b = obj(await ctx.json());
    const link = addMusicFromInput(b.url, b.label);
    if (b.makeCurrent !== false) setCurrentMusic(link);
    return new Reply(201, { link });
  });

  router.put('/api/music/current', async (ctx) => {
    const b = obj(await ctx.json());
    if (b.id === null || b.id === undefined) {
      setCurrentMusic(null);
      return musicState();
    }
    const link = store.getMusic(id(b.id));
    if (!link) throw new HttpError(404, 'Link not found');
    setCurrentMusic(link);
    return musicState();
  });

  router.delete('/api/music/:id', (ctx) => {
    const linkId = id(ctx.params.id);
    if (!store.deleteMusic(linkId)) throw new HttpError(404, 'Link not found');
    if (store.getSettings().currentMusicId === linkId) setCurrentMusic(null);
    return new Reply(204);
  });

  // ---------- habits (daily check-ins, goals and limits) ----------
  const habitFields = (b, base = {}) => {
    const kind = 'kind' in b || !base.kind ? oneOf(b.kind, KINDS, 'type', base.kind || 'check') : base.kind;
    const target = kind === 'check' ? 1 : int(b.target ?? base.target, 'target', { min: 1, max: 1_000_000, fallback: 1 });
    return {
      title: str(b.title ?? base.title, 'title', { max: 60 }),
      icon: str(b.icon ?? base.icon, 'icon', { max: 8, optional: true }) || '📌',
      kind,
      unit: kind === 'check' ? '' : str(b.unit ?? base.unit, 'unit', { max: 20, optional: true }) || '',
      target,
      step: Math.min(int(b.step ?? base.step, 'step', { min: 1, max: 1_000_000, fallback: 1 }), target),
      points: int(b.points ?? base.points, 'points', { min: 1, max: 100, fallback: 10 }),
      days: weekdays(b.days ?? base.days),
      remindAt: hhmm(b.remindAt ?? base.remindAt, 'reminder time'),
    };
  };

  router.get('/api/habits/presets', () => ({ presets: PRESETS }));

  router.get('/api/habits', (ctx) => ({ habits: commit.habitsForDay(todayOf(ctx.query.get('today'))) }));

  router.post('/api/habits', async (ctx) => {
    const b = obj(await ctx.json());
    const habit = store.createHabit({ ...habitFields(b), createdOn: todayOf(b.today) });
    return new Reply(201, habit);
  });

  router.patch('/api/habits/:id', async (ctx) => {
    const habitId = id(ctx.params.id);
    const b = obj(await ctx.json());
    const current = store.getHabit(habitId);
    if (!current) throw new HttpError(404, 'Habit not found');
    const merged = habitFields(b, current);
    const habit = store.updateHabit(habitId, merged);
    return commit.oneHabit(habit.id, todayOf(b.today));
  });

  // "Delete" keeps history (points and streaks stay), it just hides the habit.
  router.delete('/api/habits/:id', (ctx) => {
    if (!store.updateHabit(id(ctx.params.id), { archived: true })) throw new HttpError(404, 'Habit not found');
    return new Reply(204);
  });

  router.put('/api/habits/:id/log', async (ctx) => {
    const habitId = id(ctx.params.id);
    const b = obj(await ctx.json());
    const habit = store.getHabit(habitId);
    if (!habit || habit.archived) throw new HttpError(404, 'Habit not found');
    const day = isoDate(b.day, 'day');
    noFuture(day, todayOf(b.today), 'log');
    let value = int(b.value, 'value', { min: 0, max: 1_000_000 });
    if (habit.kind === 'check') value = Math.min(value, 1);
    store.setHabitLog(habitId, day, value, hhmm(b.time));
    const today = todayOf(b.today);
    const { stats, newBadges } = commit.syncBadges(today);
    return { habit: commit.oneHabit(habitId, day), stats: { totalPoints: stats.totalPoints, todayPoints: stats.todayPoints, streak: stats.streak }, newBadges };
  });

  // ---------- journal ----------
  router.get('/api/prompts', (ctx) => ({
    prompts: PROMPTS,
    tags: TAG_SUGGESTIONS,
    today: promptForDay(todayOf(ctx.query.get('today'))),
  }));

  router.post('/api/expenses/detect', async (ctx) => {
    const b = obj(await ctx.json());
    const text = typeof b.text === 'string' ? b.text.slice(0, 10000) : '';
    const refDay = b.day ? isoDate(b.day, 'day') : null;
    let items = detectExpenses(text, { refDay, hints: buildHints(store.recentExpenseNotes()) });
    // Editing an entry: do not suggest spending that is already saved with it.
    if (b.entryId !== undefined && b.entryId !== null) {
      const saved = store.listEntryExpenses(id(b.entryId)).map((e) => e.amountMinor);
      items = items.filter((x) => {
        const at = saved.indexOf(x.amountMinor);
        if (at === -1) return true;
        saved.splice(at, 1);
        return false;
      });
    }
    return { items };
  });

  router.get('/api/journal', (ctx) => {
    const ym = monthParam(ctx);
    const [from, to] = monthRange(ym);
    return { month: ym, entries: store.listEntries({ from, to }) };
  });

  const journalExpenses = (list) => {
    const inputs = Array.isArray(list) ? list : [];
    if (inputs.length > 5) throw bad('At most 5 expenses per entry');
    return inputs.map((x) => {
      const o = obj(x);
      return {
        amountMinor: moneyToMinor(o.amount, 'amount'),
        category: oneOf(o.category, CATEGORIES, 'category', 'Other'),
        note: str(o.note, 'note', { max: 120, optional: true }),
        daysAgo: int(o.daysAgo, 'daysAgo', { min: 0, max: 30, fallback: 0 }),
      };
    });
  };
  const noFuture = (day, today, what) => { if (day > today) throw bad(`You can't ${what} a day that hasn't happened yet`); };

  router.post('/api/journal', async (ctx) => {
    const b = obj(await ctx.json());
    const today = todayOf(b.today);
    const day = b.day ? isoDate(b.day, 'day') : today;
    const text = str(b.text, 'entry', { max: 10000, optional: true }) ?? '';
    const mood = b.mood === null || b.mood === undefined || b.mood === '' ? null : int(b.mood, 'mood', { min: 1, max: 5 });
    if (!text && !mood) throw bad('Write something or pick a mood');
    const promptId = b.promptId ? oneOf(b.promptId, PROMPTS.map((p) => p.id), 'prompt') : null;
    const expenses = journalExpenses(b.expenses);
    noFuture(day, today, 'write on');
    const entry = store.createEntry({
      day, time: hhmm(b.time), text, mood, tags: tags(b.tags), promptId, wordCount: wordCount(text),
    });
    const created = expenses.map(({ daysAgo, ...e }) => store.createExpense({
      ...e, spentOn: daysAgo ? addDays(day, -daysAgo) : day, entryId: entry.id, time: daysAgo ? null : entry.time,
    }));
    const { stats, newBadges } = commit.syncBadges(today);
    return new Reply(201, { entry, expenses: created, stats: { totalPoints: stats.totalPoints, streak: stats.streak }, newBadges });
  });

  router.patch('/api/journal/:id', async (ctx) => {
    const entryId = id(ctx.params.id);
    const b = obj(await ctx.json());
    const current = store.getEntry(entryId);
    if (!current) throw new HttpError(404, 'Entry not found');
    const patch = {};
    if ('text' in b) {
      patch.text = str(b.text, 'entry', { max: 10000, optional: true }) ?? '';
      patch.wordCount = wordCount(patch.text);
    }
    if ('mood' in b) patch.mood = b.mood === null || b.mood === '' ? null : int(b.mood, 'mood', { min: 1, max: 5 });
    if ('tags' in b) patch.tags = tags(b.tags);
    const today = todayOf(b.today);
    if ('day' in b) { patch.day = isoDate(b.day, 'day'); noFuture(patch.day, today, 'move an entry to'); }
    if ('time' in b) patch.time = hhmm(b.time);
    const nextText = 'text' in patch ? patch.text : current.text;
    const nextMood = 'mood' in patch ? patch.mood : current.mood;
    if (!nextText && !nextMood) throw bad('Write something or pick a mood');
    const added = journalExpenses(b.expenses);
    const entry = store.updateEntry(entryId, patch);
    // Spending saved with the entry follows it when its day or time changes.
    if (entry.day !== current.day || entry.time !== current.time) {
      store.moveEntryExpenses(entryId, { fromDay: current.day, spentOn: entry.day, time: entry.time });
    }
    const created = added.map(({ daysAgo, ...e }) => store.createExpense({
      ...e, spentOn: daysAgo ? addDays(entry.day, -daysAgo) : entry.day, entryId, time: daysAgo ? null : entry.time,
    }));
    const { newBadges } = commit.syncBadges(today);
    return { entry, expenses: created, newBadges };
  });

  router.delete('/api/journal/:id', (ctx) => {
    if (!store.deleteEntry(id(ctx.params.id))) throw new HttpError(404, 'Entry not found');
    return new Reply(204);
  });

  router.get('/api/timeline', (ctx) => {
    const day = ctx.query.get('day') ? isoDate(ctx.query.get('day'), 'day') : todayOf(ctx.query.get('today'));
    return commit.timeline(day, { today: todayOf(ctx.query.get('today')), now: hhmm(ctx.query.get('now')) });
  });

  router.get('/api/calendar', (ctx) => {
    const ym = monthParam(ctx);
    const [from, to] = monthRange(ym);
    return commit.calendar(ym, from, to);
  });

  router.get('/api/stats', (ctx) => {
    const today = todayOf(ctx.query.get('today'));
    commit.syncBadges(today);
    return { ...commit.statsFor(today), badges: commit.badgeList() };
  });

  // ---------- backup ----------
  router.get('/api/export.md', (ctx) => new Reply(200, commit.markdown(todayOf(ctx.query.get('today')), store.getSettings().name, store.getSettings().currency), {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': 'attachment; filename="day-hub-journal.md"',
  }));
  router.get('/api/export', () => new Reply(200, store.exportAll(), {
    'content-disposition': 'attachment; filename="day-hub-backup.json"',
  }));

  // ---------- request pipeline ----------
  function hostAllowed(req) {
    if (!loopbackOnly) return true;
    const name = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return ['localhost', '127.0.0.1', '::1'].includes(name) || name.endsWith('.localhost');
  }

  async function handler(req, res) {
    try {
      if (!hostAllowed(req)) throw new HttpError(403, 'Unexpected Host header');
      const url = new URL(req.url, 'http://localhost');
      const method = req.method;
      const isApi = url.pathname.startsWith('/api/');

      if (method !== 'GET' && method !== 'HEAD' && req.headers.origin) {
        let originHost = null;
        try { originHost = new URL(req.headers.origin).host; } catch { /* invalid origin */ }
        if (originHost !== req.headers.host) throw new HttpError(403, 'Cross-site requests are not allowed');
      }

      if (isApi) {
        const found = router.match(method, url.pathname);
        if (!found) throw new HttpError(404, 'Not found');
        if (found.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
        let cached;
        const ctx = {
          req,
          params: found.params,
          query: url.searchParams,
          json: async () => (cached ??= await readJson(req)),
        };
        const out = await found.handler(ctx);
        const reply = out instanceof Reply ? out : new Reply(200, out);
        send(res, reply.status, reply.body, { ...SECURITY_HEADERS, 'cache-control': 'no-store', ...reply.headers });
        return;
      }

      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      const served = await serveStatic(config.publicDir, url.pathname, res, SECURITY_HEADERS);
      if (!served) throw new HttpError(404, 'Not found');
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) {
        send(res, e.status, { error: e.message }, { ...SECURITY_HEADERS, 'cache-control': 'no-store' });
      } else {
        console.error('Unexpected error:', e);
        send(res, 500, { error: 'Something went wrong on the server' }, { ...SECURITY_HEADERS });
      }
    }
  }

  return handler;
}
