// SQLite storage using Node's built-in node:sqlite (no packages to install).
// Money is kept as whole minor units (paise/cents) so totals never drift.
// All SQL uses bound parameters.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA_V1 = `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  due_on     TEXT,
  priority   INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,
  done_on    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_state ON tasks(done, due_on);
CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_minor INTEGER NOT NULL,
  category     TEXT NOT NULL,
  note         TEXT,
  spent_on     TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_expenses_date ON expenses(spent_on);
CREATE TABLE music_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  provider   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  url        TEXT NOT NULL,
  embed_url  TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const SCHEMA_V2 = `
CREATE TABLE habits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  icon       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT '',
  target     INTEGER NOT NULL DEFAULT 1,
  step       INTEGER NOT NULL DEFAULT 1,
  points     INTEGER NOT NULL DEFAULT 10,
  days       TEXT NOT NULL,
  remind_at  TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE habit_logs (
  habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  day      TEXT NOT NULL,
  value    INTEGER NOT NULL,
  PRIMARY KEY (habit_id, day)
);
CREATE INDEX idx_habit_logs_day ON habit_logs(day);
CREATE TABLE journal_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL,
  time       TEXT,
  text       TEXT NOT NULL DEFAULT '',
  mood       INTEGER,
  tags       TEXT NOT NULL DEFAULT '[]',
  prompt_id  TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_entries_day ON journal_entries(day);
CREATE TABLE badges (
  id          TEXT PRIMARY KEY,
  unlocked_on TEXT NOT NULL
);
ALTER TABLE expenses ADD COLUMN entry_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL;
`;

// v3: remember the time of day things happened, for the daily timeline.
const SCHEMA_V3 = `
ALTER TABLE habit_logs ADD COLUMN time TEXT;
ALTER TABLE expenses ADD COLUMN time TEXT;
ALTER TABLE tasks ADD COLUMN done_time TEXT;
`;

const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3];

const DEFAULTS = {
  name: '',
  currency: 'INR',
  monthlyBudgetMinor: 0,
  setupDone: false,
  currentMusicId: null,
  notifications: false,
  journalReminder: '',
};
const SETTING_KEYS = Object.keys(DEFAULTS);

const toTask = (r) => r && {
  id: r.id,
  title: r.title,
  dueOn: r.due_on,
  priority: r.priority,
  done: !!r.done,
  doneOn: r.done_on,
  doneTime: r.done_time ?? null,
  createdAt: r.created_at,
};
const toExpense = (r) => r && {
  id: r.id,
  amountMinor: r.amount_minor,
  category: r.category,
  note: r.note,
  spentOn: r.spent_on,
  entryId: r.entry_id ?? null,
  time: r.time ?? null,
};
const toHabit = (r) => r && {
  id: r.id,
  title: r.title,
  icon: r.icon,
  kind: r.kind,
  unit: r.unit,
  target: r.target,
  step: r.step,
  points: r.points,
  days: JSON.parse(r.days),
  remindAt: r.remind_at,
  archived: !!r.archived,
  createdOn: r.created_on,
};
const toEntry = (r) => r && {
  id: r.id,
  day: r.day,
  time: r.time,
  text: r.text,
  mood: r.mood,
  tags: JSON.parse(r.tags),
  promptId: r.prompt_id,
  wordCount: r.word_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
};
const toMusic = (r) => r && {
  id: r.id,
  provider: r.provider,
  kind: r.kind,
  url: r.url,
  embedUrl: r.embed_url,
  label: r.label,
};

export function createSqliteStore(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

  const version = db.prepare('PRAGMA user_version').get().user_version;
  MIGRATIONS.forEach((sql, i) => {
    if (version > i) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  const q = (sql) => db.prepare(sql);
  const nowIso = () => new Date().toISOString();
  function tx(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- settings ----------
  function getSettings() {
    const out = structuredClone(DEFAULTS);
    for (const row of q('SELECT key, value FROM settings').all()) {
      if (!SETTING_KEYS.includes(row.key)) continue;
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        /* keep default */
      }
    }
    return out;
  }
  function setSettings(patch) {
    tx(() => {
      const up = q('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      for (const [k, v] of Object.entries(patch)) {
        if (SETTING_KEYS.includes(k)) up.run(k, JSON.stringify(v));
      }
    });
    return getSettings();
  }

  // ---------- tasks ----------
  const getTask = (id) => toTask(q('SELECT * FROM tasks WHERE id = ?').get(id)) || null;
  function listTasks({ status = 'open' } = {}) {
    if (status === 'done') {
      return q('SELECT * FROM tasks WHERE done = 1 ORDER BY done_on DESC, id DESC LIMIT 100').all().map(toTask);
    }
    if (status === 'all') {
      return q('SELECT * FROM tasks ORDER BY done, (due_on IS NULL), due_on, priority DESC, id LIMIT 500').all().map(toTask);
    }
    return q('SELECT * FROM tasks WHERE done = 0 ORDER BY (due_on IS NULL), due_on, priority DESC, id LIMIT 500').all().map(toTask);
  }
  function createTask({ title, dueOn = null, priority = 0 }) {
    const r = q('INSERT INTO tasks(title, due_on, priority, created_at) VALUES(?, ?, ?, ?)').run(title, dueOn, priority, nowIso());
    return getTask(Number(r.lastInsertRowid));
  }
  function updateTask(id, patch) {
    const cols = { title: 'title', dueOn: 'due_on', priority: 'priority', done: 'done', doneOn: 'done_on', doneTime: 'done_time' };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(cols)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        vals.push(k === 'done' ? (patch[k] ? 1 : 0) : patch[k]);
      }
    }
    if (!sets.length) return getTask(id);
    const r = q(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    return r.changes ? getTask(id) : null;
  }
  const deleteTask = (id) => q('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  function dashboardTasks(today) {
    return q(
      `SELECT * FROM tasks
       WHERE (done = 0 AND (due_on IS NULL OR due_on <= ?)) OR (done = 1 AND done_on = ?)
       ORDER BY done, (due_on IS NULL), due_on, priority DESC, id`,
    ).all(today, today).map(toTask);
  }

  const doneTasksOn = (day) => q('SELECT * FROM tasks WHERE done = 1 AND done_on = ? ORDER BY COALESCE(done_time, \'\'), id').all(day).map(toTask);

  // ---------- expenses ----------
  function createExpense({ amountMinor, category, note = null, spentOn, entryId = null, time = null }) {
    const r = q('INSERT INTO expenses(amount_minor, category, note, spent_on, entry_id, time, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(amountMinor, category, note, spentOn, entryId, time, nowIso());
    return toExpense(q('SELECT * FROM expenses WHERE id = ?').get(Number(r.lastInsertRowid)));
  }
  const listEntryExpenses = (entryId) => q('SELECT * FROM expenses WHERE entry_id = ? ORDER BY id').all(entryId).map(toExpense);
  /** Keeps spending that came from a journal entry on the entry's day and time. */
  const moveEntryExpenses = (entryId, { fromDay, spentOn, time }) =>
    q('UPDATE expenses SET spent_on = ?, time = ? WHERE entry_id = ? AND spent_on = ?').run(spentOn, time ?? null, entryId, fromDay).changes;
  /** Recent expenses with notes, used to learn which words mean which category. */
  const recentExpenseNotes = (limit = 500) =>
    q("SELECT note, category FROM expenses WHERE note IS NOT NULL AND note != '' ORDER BY id DESC LIMIT ?").all(limit);
  const deleteExpense = (id) => q('DELETE FROM expenses WHERE id = ?').run(id).changes > 0;
  function listExpenses({ from, to } = {}) {
    if (from && to) {
      return q('SELECT * FROM expenses WHERE spent_on >= ? AND spent_on < ? ORDER BY spent_on DESC, id DESC LIMIT 2000')
        .all(from, to).map(toExpense);
    }
    return q('SELECT * FROM expenses ORDER BY spent_on DESC, id DESC LIMIT 20000').all().map(toExpense);
  }
  function summarizeExpenses({ from, to }) {
    const total = q('SELECT COALESCE(SUM(amount_minor), 0) AS total, COUNT(*) AS n FROM expenses WHERE spent_on >= ? AND spent_on < ?').get(from, to);
    const byCategory = q(
      `SELECT category, SUM(amount_minor) AS total, COUNT(*) AS n
       FROM expenses WHERE spent_on >= ? AND spent_on < ?
       GROUP BY category ORDER BY total DESC`,
    ).all(from, to).map((r) => ({ category: r.category, totalMinor: r.total, count: r.n }));
    return { totalMinor: total.total, count: total.n, byCategory };
  }

  // ---------- habits ----------
  const getHabit = (id) => toHabit(q('SELECT * FROM habits WHERE id = ?').get(id)) || null;
  const listHabits = ({ includeArchived = false } = {}) =>
    q(`SELECT * FROM habits ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY id`).all().map(toHabit);
  function createHabit(h) {
    const r = q(
      `INSERT INTO habits(title, icon, kind, unit, target, step, points, days, remind_at, created_on, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.title, h.icon, h.kind, h.unit, h.target, h.step, h.points, JSON.stringify(h.days), h.remindAt ?? null, h.createdOn, nowIso());
    return getHabit(Number(r.lastInsertRowid));
  }
  function updateHabit(id, patch) {
    const cols = {
      title: 'title', icon: 'icon', kind: 'kind', unit: 'unit', target: 'target', step: 'step',
      points: 'points', days: 'days', remindAt: 'remind_at', archived: 'archived',
    };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(cols)) {
      if (!(k in patch)) continue;
      sets.push(`${col} = ?`);
      vals.push(k === 'days' ? JSON.stringify(patch[k]) : k === 'archived' ? (patch[k] ? 1 : 0) : patch[k]);
    }
    if (!sets.length) return getHabit(id);
    const r = q(`UPDATE habits SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    return r.changes ? getHabit(id) : null;
  }
  function setHabitLog(habitId, day, value, time = null) {
    if (value <= 0) q('DELETE FROM habit_logs WHERE habit_id = ? AND day = ?').run(habitId, day);
    else {
      q(`INSERT INTO habit_logs(habit_id, day, value, time) VALUES(?, ?, ?, ?)
         ON CONFLICT(habit_id, day) DO UPDATE SET value = excluded.value, time = excluded.time`)
        .run(habitId, day, value, time);
    }
  }
  const toLog = (r) => ({ habitId: r.habit_id, day: r.day, value: r.value, time: r.time ?? null });
  const listLogs = ({ from, to } = {}) => (from && to
    ? q('SELECT * FROM habit_logs WHERE day >= ? AND day < ? ORDER BY day').all(from, to)
    : q('SELECT * FROM habit_logs ORDER BY day LIMIT 200000').all()).map(toLog);

  // ---------- journal ----------
  const getEntry = (id) => toEntry(q('SELECT * FROM journal_entries WHERE id = ?').get(id)) || null;
  const listEntries = ({ from, to } = {}) => (from && to
    ? q('SELECT * FROM journal_entries WHERE day >= ? AND day < ? ORDER BY day DESC, COALESCE(time, \'\') DESC, id DESC').all(from, to)
    : q('SELECT * FROM journal_entries ORDER BY day DESC, COALESCE(time, \'\') DESC, id DESC LIMIT 20000').all()).map(toEntry);
  function createEntry(e) {
    const now = nowIso();
    const r = q(
      `INSERT INTO journal_entries(day, time, text, mood, tags, prompt_id, word_count, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(e.day, e.time ?? null, e.text, e.mood ?? null, JSON.stringify(e.tags || []), e.promptId ?? null, e.wordCount, now, now);
    return getEntry(Number(r.lastInsertRowid));
  }
  function updateEntry(id, patch) {
    const cols = { text: 'text', mood: 'mood', tags: 'tags', wordCount: 'word_count', day: 'day', time: 'time' };
    const sets = ['updated_at = ?'];
    const vals = [nowIso()];
    for (const [k, col] of Object.entries(cols)) {
      if (!(k in patch)) continue;
      sets.push(`${col} = ?`);
      vals.push(k === 'tags' ? JSON.stringify(patch[k]) : patch[k]);
    }
    const r = q(`UPDATE journal_entries SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    return r.changes ? getEntry(id) : null;
  }
  const deleteEntry = (id) => q('DELETE FROM journal_entries WHERE id = ?').run(id).changes > 0;

  // ---------- badges ----------
  const listBadges = () => Object.fromEntries(q('SELECT id, unlocked_on FROM badges').all().map((r) => [r.id, r.unlocked_on]));
  function unlockBadges(ids, day) {
    const have = listBadges();
    const fresh = ids.filter((id) => !have[id]);
    for (const id of fresh) q('INSERT INTO badges(id, unlocked_on) VALUES(?, ?)').run(id, day);
    return fresh;
  }

  // ---------- music ----------
  const listMusic = () => q('SELECT * FROM music_links ORDER BY id DESC LIMIT 200').all().map(toMusic);
  const getMusic = (id) => toMusic(q('SELECT * FROM music_links WHERE id = ?').get(id)) || null;
  function addMusic({ provider, kind, url, embedUrl, label }) {
    q(
      `INSERT INTO music_links(provider, kind, url, embed_url, label, created_at) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(embed_url) DO UPDATE SET label = excluded.label`,
    ).run(provider, kind, url, embedUrl, label, nowIso());
    return toMusic(q('SELECT * FROM music_links WHERE embed_url = ?').get(embedUrl));
  }
  const deleteMusic = (id) => q('DELETE FROM music_links WHERE id = ?').run(id).changes > 0;

  // ---------- backup ----------
  function exportAll() {
    return {
      exportedAt: nowIso(),
      settings: getSettings(),
      tasks: listTasks({ status: 'all' }),
      expenses: listExpenses(),
      habits: listHabits({ includeArchived: true }),
      habitLogs: listLogs(),
      journal: listEntries(),
      badges: listBadges(),
      music: listMusic(),
    };
  }

  return {
    getSettings, setSettings,
    listTasks, getTask, createTask, updateTask, deleteTask, dashboardTasks, doneTasksOn,
    createExpense, deleteExpense, listExpenses, summarizeExpenses, listEntryExpenses, moveEntryExpenses, recentExpenseNotes,
    getHabit, listHabits, createHabit, updateHabit, setHabitLog, listLogs,
    getEntry, listEntries, createEntry, updateEntry, deleteEntry,
    listBadges, unlockBadges,
    listMusic, getMusic, addMusic, deleteMusic,
    exportAll,
    close: () => db.close(),
  };
}
