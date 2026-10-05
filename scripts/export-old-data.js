// One-time helper for people who used Day Hub when it kept data in a file
// (data/dayhub.db). It writes your data to a backup file that the new, browser-only
// Day Hub can restore: Settings, then "Restore from backup".
//
//   node scripts/export-old-data.js                 reads data/dayhub.db, writes dayhub-backup.json
//   node scripts/export-old-data.js old.db out.json custom paths
//
// It only reads the database. It needs Node 22.13 or newer (for the built-in node:sqlite).

import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbPath = path.resolve(process.argv[2] || path.join(root, 'data', 'dayhub.db'));
const outPath = path.resolve(process.argv[3] || path.join(root, 'dayhub-backup.json'));

if (!existsSync(dbPath)) {
  console.error(`\nNo database found at ${dbPath}\nPass the path as the first argument if it lives somewhere else.\n`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const has = (table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const all = (table, order) => (has(table) ? db.prepare(`SELECT * FROM ${table} ${order || ''}`).all() : []);

const settings = {};
for (const r of all('settings')) {
  try { settings[r.key] = JSON.parse(r.value); } catch { /* skip a value we cannot read */ }
}

const out = {
  exportedAt: new Date().toISOString(),
  settings,
  tasks: all('tasks', 'ORDER BY id').map((r) => ({
    id: r.id, title: r.title, dueOn: r.due_on ?? null, priority: r.priority, done: !!r.done,
    doneOn: r.done_on ?? null, doneTime: r.done_time ?? null, createdAt: r.created_at,
  })),
  expenses: all('expenses', 'ORDER BY id').map((r) => ({
    id: r.id, amountMinor: r.amount_minor, category: r.category, note: r.note || null, spentOn: r.spent_on,
    entryId: r.entry_id ?? null, time: r.time ?? null,
  })),
  habits: all('habits', 'ORDER BY id').map((r) => ({
    id: r.id, title: r.title, icon: r.icon, kind: r.kind, unit: r.unit, target: r.target, step: r.step,
    points: r.points, days: JSON.parse(r.days), remindAt: r.remind_at ?? null, archived: !!r.archived, createdOn: r.created_on,
  })),
  habitLogs: all('habit_logs', 'ORDER BY day').map((r) => ({ habitId: r.habit_id, day: r.day, value: r.value, time: r.time ?? null })),
  journal: all('journal_entries', 'ORDER BY id').map((r) => ({
    id: r.id, day: r.day, time: r.time ?? null, text: r.text, mood: r.mood ?? null, tags: JSON.parse(r.tags || '[]'),
    promptId: r.prompt_id ?? null, wordCount: r.word_count, createdAt: r.created_at, updatedAt: r.updated_at,
  })),
  badges: Object.fromEntries(all('badges').map((r) => [r.id, r.unlocked_on])),
  music: all('music_links', 'ORDER BY id').map((r) => ({
    id: r.id, provider: r.provider, kind: r.kind, url: r.url, embedUrl: r.embed_url, label: r.label,
  })),
};
db.close();

writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nSaved ${out.tasks.length} tasks, ${out.expenses.length} expenses, ${out.habits.length} habits, ${out.journal.length} journal entries and ${out.music.length} music links to:\n  ${outPath}\n\nOpen the new Day Hub, go to Settings and choose "Restore from backup".\n`);
