// Where Day Hub keeps your data: in this browser, on this device, and nowhere else.
//
// There is no database and no server. Everything lives in one JSON document saved in
// the browser's localStorage. Each browser profile on each device therefore has its own
// separate copy; nothing is uploaded or shared.
//
// Rows look exactly like the objects the screens already use (camelCase), and money is
// whole minor units (paise/cents) so totals never drift. The same shapes make up the
// backup file, so "Backup" and "Restore" are just export and import of this store.

import {
  HttpError, bad, obj, str, isoDate, int, hhmm, oneOf, tags, weekdays, currency,
} from './validate.js';
import { KINDS } from './habits.js';
import { wordCount } from './prompts.js';

export const STORAGE_KEY = 'dayhub:data:v1';
const FORMAT = 1;
const LIMIT_CHARS = 5_000_000; // what browsers typically allow per site (rough)
const MAX_ROWS = 200_000;

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

/** The saved data cannot be read. `raw` is kept so it can be handed back to the person. */
export class DamagedData extends Error {
  constructor(message, raw = null) {
    super(message);
    this.name = 'DamagedData';
    this.raw = raw;
  }
}

/** A stand-in for localStorage that forgets everything when the page closes (and for tests). */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const emptyState = () => ({
  settings: {}, tasks: [], expenses: [], habits: [], habitLogs: [], journal: [], badges: {}, music: [],
  seq: { tasks: 0, expenses: 0, habits: 0, journal: 0, music: 0 },
});

const nowIso = () => new Date().toISOString();
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const copy = (v) => structuredClone(v);

// ---------- reading a saved or imported document (strict: bad data is refused, not guessed at) ----------

const bool = (v, field) => {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === undefined || v === null) return false;
  throw bad(`${field} must be true or false`);
};
const optDate = (v, field) => (v === undefined || v === null || v === '' ? null : isoDate(v, field));
const optText = (v, field, max) => (v === undefined || v === null || v === '' ? null : str(v, field, { max, optional: true }));
const stamp = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : nowIso());
const rowId = (v) => int(v, 'id', { min: 1, max: 2_000_000_000 });
const nullableId = (v, field) => (v === undefined || v === null ? null : int(v, field, { min: 1, max: 2_000_000_000 }));
/** Journal text keeps its line breaks. */
function longText(v, field, max = 10_000) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${field} must be text`);
  if (v.length > max) throw bad(`${field} is too long`);
  return v;
}

const cleaners = {
  task: (r) => ({
    id: rowId(r.id),
    title: str(r.title, 'title', { max: 200 }),
    dueOn: optDate(r.dueOn, 'due date'),
    priority: oneOf(r.priority, [0, 1], 'priority', 0),
    done: bool(r.done, 'done'),
    doneOn: optDate(r.doneOn, 'done date'),
    doneTime: hhmm(r.doneTime, 'done time'),
    createdAt: stamp(r.createdAt),
  }),
  expense: (r) => ({
    id: rowId(r.id),
    amountMinor: int(r.amountMinor, 'amount', { min: 1, max: 100_000_000_000 }),
    category: str(r.category ?? 'Other', 'category', { max: 30 }),
    note: optText(r.note, 'note', 120),
    spentOn: isoDate(r.spentOn, 'date'),
    entryId: nullableId(r.entryId, 'entry'),
    time: hhmm(r.time),
  }),
  habit: (r) => ({
    id: rowId(r.id),
    title: str(r.title, 'title', { max: 60 }),
    icon: str(r.icon ?? '📌', 'icon', { max: 16 }),
    kind: oneOf(r.kind, KINDS, 'type', 'check'),
    unit: optText(r.unit, 'unit', 20) ?? '',
    target: int(r.target, 'target', { min: 1, max: 1_000_000, fallback: 1 }),
    step: int(r.step, 'step', { min: 1, max: 1_000_000, fallback: 1 }),
    points: int(r.points, 'points', { min: 1, max: 100, fallback: 10 }),
    days: weekdays(r.days),
    remindAt: hhmm(r.remindAt, 'reminder time'),
    archived: bool(r.archived, 'archived'),
    createdOn: isoDate(r.createdOn, 'created date'),
  }),
  log: (r) => ({
    habitId: rowId(r.habitId),
    day: isoDate(r.day, 'day'),
    value: int(r.value, 'value', { min: 1, max: 1_000_000 }),
    time: hhmm(r.time),
  }),
  entry: (r) => {
    const text = longText(r.text, 'entry');
    return {
      id: rowId(r.id),
      day: isoDate(r.day, 'day'),
      time: hhmm(r.time),
      text,
      mood: r.mood === undefined || r.mood === null ? null : int(r.mood, 'mood', { min: 1, max: 5 }),
      tags: tags(r.tags),
      promptId: optText(r.promptId, 'prompt', 40),
      wordCount: Number.isInteger(r.wordCount) && r.wordCount >= 0 ? r.wordCount : wordCount(text),
      createdAt: stamp(r.createdAt),
      updatedAt: stamp(r.updatedAt),
    };
  },
  music: (r) => ({
    id: rowId(r.id),
    provider: str(r.provider, 'provider', { max: 20 }),
    kind: str(r.kind, 'kind', { max: 20 }),
    url: str(r.url, 'link', { max: 2048 }),
    embedUrl: str(r.embedUrl, 'embed link', { max: 2048 }),
    label: str(r.label, 'label', { max: 60 }),
  }),
};

function cleanSettings(raw) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  const s = obj(raw);
  if ('name' in s) out.name = str(s.name, 'name', { max: 40, optional: true }) ?? '';
  if ('currency' in s) out.currency = currency(s.currency);
  if ('monthlyBudgetMinor' in s) out.monthlyBudgetMinor = int(s.monthlyBudgetMinor, 'budget', { min: 0, max: 100_000_000_000 });
  if ('setupDone' in s) out.setupDone = bool(s.setupDone, 'setupDone');
  if ('currentMusicId' in s) out.currentMusicId = nullableId(s.currentMusicId, 'current music');
  if ('notifications' in s) out.notifications = bool(s.notifications, 'notifications');
  if ('journalReminder' in s) out.journalReminder = hhmm(s.journalReminder, 'journal reminder') ?? '';
  return out;
}

function rows(data, key) {
  const v = data[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`"${key}" should be a list`);
  if (v.length > MAX_ROWS) throw bad(`"${key}" has too many rows`);
  return v;
}

function readTable(data, key, label, clean) {
  const out = [];
  const seen = new Set();
  rows(data, key).forEach((raw, i) => {
    try {
      const row = clean(obj(raw));
      if (row.id !== undefined) {
        if (seen.has(row.id)) throw bad(`id ${row.id} appears twice`);
        seen.add(row.id);
      }
      out.push(row);
    } catch (e) {
      throw bad(`${label} #${i + 1}: ${e.message}`);
    }
  });
  return out;
}

/**
 * Builds a clean state from a backup file or from what was saved here.
 * Throws a 400 HttpError that says which row is wrong; the caller keeps its old data.
 */
export function readDocument(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('That is not a Day Hub backup');
  const looksRight = ['settings', 'tasks', 'expenses', 'habits', 'habitLogs', 'journal', 'badges', 'music'].some((k) => k in data);
  if (!looksRight) throw bad('That is not a Day Hub backup');

  const s = emptyState();
  s.tasks = readTable(data, 'tasks', 'Task', cleaners.task);
  s.expenses = readTable(data, 'expenses', 'Expense', cleaners.expense);
  s.habits = readTable(data, 'habits', 'Habit', cleaners.habit);
  s.journal = readTable(data, 'journal', 'Journal entry', cleaners.entry);
  s.music = readTable(data, 'music', 'Music link', cleaners.music);
  s.habitLogs = readTable(data, 'habitLogs', 'Habit log', cleaners.log);
  s.settings = cleanSettings(data.settings);

  if (data.badges !== undefined && data.badges !== null) {
    const b = obj(data.badges);
    for (const [id, day] of Object.entries(b)) {
      if (!id || id.length > 40) throw bad('Badge: bad name');
      s.badges[id] = isoDate(day, `badge "${id}" date`);
    }
  }

  // Tidy links between tables, the way the database used to by itself.
  const habitIds = new Set(s.habits.map((h) => h.id));
  const entryIds = new Set(s.journal.map((e) => e.id));
  const musicUrls = new Set();
  s.music = s.music.filter((m) => (musicUrls.has(m.embedUrl) ? false : musicUrls.add(m.embedUrl)));
  const lastLog = new Map();
  for (const l of s.habitLogs) if (habitIds.has(l.habitId)) lastLog.set(`${l.habitId}|${l.day}`, l);
  s.habitLogs = [...lastLog.values()];
  for (const e of s.expenses) if (e.entryId !== null && !entryIds.has(e.entryId)) e.entryId = null;
  if (s.settings.currentMusicId != null && !s.music.some((m) => m.id === s.settings.currentMusicId)) s.settings.currentMusicId = null;

  // Ids keep counting up, so a deleted row's number is never reused.
  const top = (list) => list.reduce((n, r) => Math.max(n, r.id), 0);
  const saved = data.seq && typeof data.seq === 'object' ? data.seq : {};
  const seq = (name, list) => Math.max(top(list), Number.isInteger(saved[name]) ? saved[name] : 0);
  s.seq = {
    tasks: seq('tasks', s.tasks), expenses: seq('expenses', s.expenses), habits: seq('habits', s.habits),
    journal: seq('journal', s.journal), music: seq('music', s.music),
  };
  return s;
}

// ---------- the store ----------

export function createStore({ storage, key = STORAGE_KEY } = {}) {
  let state = emptyState();
  let lastRaw = null; // exactly what is saved right now
  let dirty = false;

  const read = () => {
    try { return storage.getItem(key); } catch { return null; }
  };

  function load(raw) {
    if (raw === null || raw === undefined) return emptyState();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new DamagedData('The saved data cannot be read.', raw); }
    if (parsed && typeof parsed === 'object' && Number(parsed.v) > FORMAT) {
      throw new DamagedData('This data was saved by a newer version of Day Hub.', raw);
    }
    try { return readDocument(parsed); } catch (e) { throw new DamagedData(`The saved data does not look right (${e.message}).`, raw); }
  }

  lastRaw = read();
  state = load(lastRaw); // may throw DamagedData: the caller shows a recovery screen

  const touch = () => { dirty = true; };
  const nextId = (table) => { state.seq[table] += 1; touch(); return state.seq[table]; };

  /** Picks up changes another tab of this browser has saved. Call before each request. */
  function refresh() {
    const raw = read();
    if (raw === lastRaw) return;
    try {
      state = load(raw);
      lastRaw = raw;
      dirty = false;
    } catch { /* keep what we have; our next save will replace the unreadable copy */ }
  }

  /** Saves if anything changed. If the browser refuses (full), the change is undone and this throws. */
  function commit() {
    if (!dirty) return;
    const raw = JSON.stringify({ v: FORMAT, ...state });
    try {
      storage.setItem(key, raw);
    } catch {
      rollback();
      throw new HttpError(507, 'This browser has no room left for Day Hub data. Download a backup in Settings, then remove things you no longer need.');
    }
    lastRaw = raw;
    dirty = false;
  }

  /** Forgets everything done since the last save (a request failed half way). */
  function rollback() {
    try { state = load(lastRaw); } catch { /* keep going with what is in memory */ }
    dirty = false;
  }

  function usage() {
    const chars = lastRaw ? lastRaw.length : 0;
    return { chars, limitChars: LIMIT_CHARS, share: Math.min(1, chars / LIMIT_CHARS) };
  }

  // ---------- settings ----------
  const getSettings = () => ({ ...copy(DEFAULTS), ...copy(state.settings) });
  function setSettings(patch) {
    for (const [k, v] of Object.entries(patch)) if (SETTING_KEYS.includes(k)) state.settings[k] = copy(v);
    touch();
    return getSettings();
  }

  // ---------- tasks ----------
  const byDue = (a, b) => (a.done - b.done) || (a.dueOn === null) - (b.dueOn === null) || cmp(a.dueOn, b.dueOn) || (b.priority - a.priority) || (a.id - b.id);
  const allTasks = () => state.tasks.slice().sort(byDue).map(copy);
  const taskRow = (id) => state.tasks.find((t) => t.id === id);
  const getTask = (id) => (taskRow(id) ? copy(taskRow(id)) : null);
  function listTasks({ status = 'open' } = {}) {
    if (status === 'done') {
      return state.tasks.filter((t) => t.done)
        .sort((a, b) => cmp(b.doneOn || '', a.doneOn || '') || (b.id - a.id)).slice(0, 100).map(copy);
    }
    const list = status === 'all' ? state.tasks : state.tasks.filter((t) => !t.done);
    return list.slice().sort(byDue).slice(0, 500).map(copy);
  }
  function createTask({ title, dueOn = null, priority = 0 }) {
    const row = { id: nextId('tasks'), title, dueOn, priority, done: false, doneOn: null, doneTime: null, createdAt: nowIso() };
    state.tasks.push(row);
    return copy(row);
  }
  function updateTask(id, patch) {
    const row = taskRow(id);
    if (!row) return null;
    for (const k of ['title', 'dueOn', 'priority', 'done', 'doneOn', 'doneTime']) {
      if (k in patch) row[k] = k === 'done' ? !!patch[k] : patch[k];
    }
    touch();
    return copy(row);
  }
  function deleteTask(id) {
    const at = state.tasks.findIndex((t) => t.id === id);
    if (at === -1) return false;
    state.tasks.splice(at, 1);
    touch();
    return true;
  }
  const dashboardTasks = (today) => state.tasks
    .filter((t) => (!t.done && (t.dueOn === null || t.dueOn <= today)) || (t.done && t.doneOn === today))
    .sort(byDue).map(copy);
  const doneTasksOn = (day) => state.tasks.filter((t) => t.done && t.doneOn === day)
    .sort((a, b) => cmp(a.doneTime || '', b.doneTime || '') || (a.id - b.id)).map(copy);

  // ---------- expenses ----------
  const byNewest = (a, b) => cmp(b.spentOn, a.spentOn) || (b.id - a.id);
  function createExpense({ amountMinor, category, note = null, spentOn, entryId = null, time = null }) {
    const row = { id: nextId('expenses'), amountMinor, category, note, spentOn, entryId, time };
    state.expenses.push(row);
    return copy(row);
  }
  const listEntryExpenses = (entryId) => state.expenses.filter((e) => e.entryId === entryId).sort((a, b) => a.id - b.id).map(copy);
  /** Keeps spending that came from a journal entry on the entry's day and time. */
  function moveEntryExpenses(entryId, { fromDay, spentOn, time }) {
    let n = 0;
    for (const e of state.expenses) {
      if (e.entryId === entryId && e.spentOn === fromDay) { e.spentOn = spentOn; e.time = time ?? null; n += 1; }
    }
    if (n) touch();
    return n;
  }
  /** Recent expenses with notes, used to learn which words mean which category. */
  const recentExpenseNotes = (limit = 500) => state.expenses.filter((e) => e.note)
    .sort((a, b) => b.id - a.id).slice(0, limit).map((e) => ({ note: e.note, category: e.category }));
  function deleteExpense(id) {
    const at = state.expenses.findIndex((e) => e.id === id);
    if (at === -1) return false;
    state.expenses.splice(at, 1);
    touch();
    return true;
  }
  function listExpenses({ from, to } = {}) {
    const list = from && to ? state.expenses.filter((e) => e.spentOn >= from && e.spentOn < to) : state.expenses;
    return list.slice().sort(byNewest).map(copy);
  }
  function summarizeExpenses({ from, to }) {
    const inRange = state.expenses.filter((e) => e.spentOn >= from && e.spentOn < to);
    const groups = new Map();
    for (const e of inRange) {
      const g = groups.get(e.category) || { category: e.category, totalMinor: 0, count: 0 };
      g.totalMinor += e.amountMinor;
      g.count += 1;
      groups.set(e.category, g);
    }
    return {
      totalMinor: inRange.reduce((n, e) => n + e.amountMinor, 0),
      count: inRange.length,
      byCategory: [...groups.values()].sort((a, b) => (b.totalMinor - a.totalMinor) || cmp(a.category, b.category)),
    };
  }

  // ---------- habits ----------
  const habitRow = (id) => state.habits.find((h) => h.id === id);
  const getHabit = (id) => (habitRow(id) ? copy(habitRow(id)) : null);
  const listHabits = ({ includeArchived = false } = {}) => state.habits
    .filter((h) => includeArchived || !h.archived).sort((a, b) => a.id - b.id).map(copy);
  function createHabit(h) {
    const row = {
      id: nextId('habits'), title: h.title, icon: h.icon, kind: h.kind, unit: h.unit, target: h.target, step: h.step,
      points: h.points, days: [...h.days], remindAt: h.remindAt ?? null, archived: false, createdOn: h.createdOn,
    };
    state.habits.push(row);
    return copy(row);
  }
  function updateHabit(id, patch) {
    const row = habitRow(id);
    if (!row) return null;
    for (const k of ['title', 'icon', 'kind', 'unit', 'target', 'step', 'points', 'days', 'remindAt', 'archived']) {
      if (!(k in patch)) continue;
      row[k] = k === 'days' ? [...patch[k]] : k === 'archived' ? !!patch[k] : patch[k];
    }
    touch();
    return copy(row);
  }
  function setHabitLog(habitId, day, value, time = null) {
    const at = state.habitLogs.findIndex((l) => l.habitId === habitId && l.day === day);
    if (value <= 0) {
      if (at !== -1) state.habitLogs.splice(at, 1);
    } else if (at !== -1) {
      state.habitLogs[at].value = value;
      state.habitLogs[at].time = time;
    } else {
      state.habitLogs.push({ habitId, day, value, time });
    }
    touch();
  }
  const listLogs = ({ from, to } = {}) => (from && to ? state.habitLogs.filter((l) => l.day >= from && l.day < to) : state.habitLogs)
    .slice().sort((a, b) => cmp(a.day, b.day)).map(copy);

  // ---------- journal ----------
  const entryRow = (id) => state.journal.find((e) => e.id === id);
  const getEntry = (id) => (entryRow(id) ? copy(entryRow(id)) : null);
  const newestFirst = (a, b) => cmp(b.day, a.day) || cmp(b.time || '', a.time || '') || (b.id - a.id);
  const listEntries = ({ from, to } = {}) => (from && to ? state.journal.filter((e) => e.day >= from && e.day < to) : state.journal)
    .slice().sort(newestFirst).map(copy);
  function createEntry(e) {
    const now = nowIso();
    const row = {
      id: nextId('journal'), day: e.day, time: e.time ?? null, text: e.text, mood: e.mood ?? null, tags: [...(e.tags || [])],
      promptId: e.promptId ?? null, wordCount: e.wordCount, createdAt: now, updatedAt: now,
    };
    state.journal.push(row);
    return copy(row);
  }
  function updateEntry(id, patch) {
    const row = entryRow(id);
    if (!row) return null;
    for (const k of ['text', 'mood', 'tags', 'wordCount', 'day', 'time']) {
      if (k in patch) row[k] = k === 'tags' ? [...patch[k]] : patch[k];
    }
    row.updatedAt = nowIso();
    touch();
    return copy(row);
  }
  function deleteEntry(id) {
    const at = state.journal.findIndex((e) => e.id === id);
    if (at === -1) return false;
    state.journal.splice(at, 1);
    for (const e of state.expenses) if (e.entryId === id) e.entryId = null; // spending stays, just unlinked
    touch();
    return true;
  }

  // ---------- badges ----------
  const listBadges = () => ({ ...state.badges });
  function unlockBadges(ids, day) {
    const fresh = ids.filter((id) => !state.badges[id]);
    for (const id of fresh) state.badges[id] = day;
    if (fresh.length) touch();
    return fresh;
  }

  // ---------- music ----------
  const listMusic = () => state.music.slice().sort((a, b) => b.id - a.id).slice(0, 200).map(copy);
  const getMusic = (id) => { const m = state.music.find((x) => x.id === id); return m ? copy(m) : null; };
  function addMusic({ provider, kind, url, embedUrl, label }) {
    const existing = state.music.find((m) => m.embedUrl === embedUrl);
    if (existing) {
      existing.label = label; // same link again: just rename it
      touch();
      return copy(existing);
    }
    const row = { id: nextId('music'), provider, kind, url, embedUrl, label };
    state.music.push(row);
    return copy(row);
  }
  function deleteMusic(id) {
    const at = state.music.findIndex((m) => m.id === id);
    if (at === -1) return false;
    state.music.splice(at, 1);
    touch();
    return true;
  }

  // ---------- backup and restore ----------
  const exportAll = () => ({
    exportedAt: nowIso(),
    settings: getSettings(),
    tasks: allTasks(),
    expenses: listExpenses(),
    habits: listHabits({ includeArchived: true }),
    habitLogs: listLogs(),
    journal: listEntries(),
    badges: listBadges(),
    music: state.music.slice().sort((a, b) => b.id - a.id).map(copy),
  });
  /** Replaces everything with a backup. Throws (and changes nothing) if the file is not a good backup. */
  function importAll(data) {
    state = readDocument(data);
    touch();
    return {
      tasks: state.tasks.length, expenses: state.expenses.length, habits: state.habits.length,
      entries: state.journal.length, music: state.music.length,
    };
  }

  return {
    refresh, commit, rollback, usage,
    getSettings, setSettings,
    listTasks, getTask, createTask, updateTask, deleteTask, dashboardTasks, doneTasksOn,
    createExpense, deleteExpense, listExpenses, summarizeExpenses, listEntryExpenses, moveEntryExpenses, recentExpenseNotes,
    getHabit, listHabits, createHabit, updateHabit, setHabitLog, listLogs,
    getEntry, listEntries, createEntry, updateEntry, deleteEntry,
    listBadges, unlockBadges,
    listMusic, getMusic, addMusic, deleteMusic,
    exportAll, importAll,
  };
}
