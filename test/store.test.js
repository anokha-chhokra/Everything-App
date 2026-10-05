// The browser store: saving, reloading, other tabs, full storage, unreadable data,
// and backup / restore. Everything runs against a pretend localStorage kept in memory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../public/js/core/backend.js';
import { createStore, memoryStorage, DamagedData, STORAGE_KEY } from '../public/js/core/store.js';

const TODAY = '2026-10-05';

const open = (storage) => {
  const backend = createBackend({ storage });
  const call = async (method, path, body) => {
    const res = await backend.call(method, path, body);
    return { status: res.status, json: res.body, headers: res.headers };
  };
  return { backend, call, store: backend.store };
};

async function fill(call) {
  await call('POST', '/api/setup', { name: 'Asha', currency: 'inr', monthlyBudget: 30000, habits: ['water', 'workout'], musicUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', today: TODAY });
  await call('POST', '/api/tasks', { title: 'Send invoice', dueOn: TODAY, priority: 1 });
  const entry = (await call('POST', '/api/journal', { text: 'Good day.\nSpent ₹250 on lunch', today: TODAY, time: '13:10', mood: 4, tags: ['work'], expenses: [{ amount: 250, category: 'Food', note: 'lunch' }] })).json;
  await call('POST', '/api/expenses', { amount: '99.50', category: 'Bills', spentOn: TODAY });
  const habits = (await call('GET', `/api/habits?today=${TODAY}`)).json.habits;
  await call('PUT', `/api/habits/${habits[0].id}/log`, { day: TODAY, value: 3, today: TODAY, time: '09:00' });
  return entry.entry;
}

test('saved data is still there when the page is opened again, and ids keep counting up', async () => {
  const storage = memoryStorage();
  const first = open(storage);
  const entry = await fill(first.call);
  const gone = (await first.call('POST', '/api/tasks', { title: 'temporary' })).json;
  await first.call('DELETE', `/api/tasks/${gone.id}`);

  const second = open(storage); // a fresh page load
  assert.equal((await second.call('GET', '/api/state')).json.settings.name, 'Asha');
  assert.equal((await second.call('GET', '/api/tasks')).json.tasks[0].title, 'Send invoice');
  const day = (await second.call('GET', `/api/timeline?day=${TODAY}&today=${TODAY}&now=23:00`)).json;
  assert.equal(day.items.find((i) => i.type === 'entry').entry.text, 'Good day.\nSpent ₹250 on lunch'); // line break kept
  assert.equal(day.summary.spentMinor, 25000 + 9950);
  assert.equal((await second.call('GET', `/api/stats?today=${TODAY}`)).json.totalEntries, 1);
  assert.ok(entry.id);
  const next = (await second.call('POST', '/api/tasks', { title: 'after reload' })).json;
  assert.equal(next.id, gone.id + 1); // a deleted id is not handed out again
});

test('two pages of the same browser share one copy and never overwrite each other', async () => {
  const storage = memoryStorage();
  const a = open(storage);
  const b = open(storage);
  await a.call('POST', '/api/tasks', { title: 'from tab A' });
  assert.deepEqual((await b.call('GET', '/api/tasks')).json.tasks.map((t) => t.title), ['from tab A']);
  await b.call('POST', '/api/tasks', { title: 'from tab B' });
  await a.call('POST', '/api/tasks', { title: 'from tab A again' });
  const titles = (await b.call('GET', '/api/tasks')).json.tasks.map((t) => t.title).sort();
  assert.deepEqual(titles, ['from tab A', 'from tab A again', 'from tab B']);
  const ids = (await a.call('GET', '/api/tasks')).json.tasks.map((t) => t.id);
  assert.equal(new Set(ids).size, 3);
});

test('requests made at the same moment are handled one after another', async () => {
  const storage = memoryStorage();
  const app = open(storage);
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => app.call('POST', '/api/tasks', { title: `t${i}` })));
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(new Set(results.map((r) => r.json.id)).size, 25);
  assert.equal(open(storage).store.listTasks().length, 25);
});

test('a browser with no room left refuses the change and keeps the old data', async () => {
  const real = memoryStorage();
  let full = false;
  const storage = { ...real, setItem: (k, v) => { if (full) throw new DOMException('quota', 'QuotaExceededError'); real.setItem(k, v); } };
  const app = open(storage);
  await app.call('POST', '/api/tasks', { title: 'saved' });
  full = true;
  const refused = await app.call('POST', '/api/tasks', { title: 'does not fit' });
  assert.equal(refused.status, 507);
  assert.match(refused.json.error, /no room/);
  assert.deepEqual((await app.call('GET', '/api/tasks')).json.tasks.map((t) => t.title), ['saved']); // memory matches what is saved
  full = false;
  assert.equal((await app.call('POST', '/api/tasks', { title: 'fits now' })).status, 201);
  assert.deepEqual(open(real).store.listTasks().map((t) => t.title), ['saved', 'fits now']);
});

test('changes made by a request that fails half way are undone', () => {
  const store = createStore({ storage: memoryStorage() });
  store.createTask({ title: 'kept' });
  store.commit();
  store.createTask({ title: 'half done' });
  store.setSettings({ name: 'Nope' });
  store.rollback();
  assert.deepEqual(store.listTasks().map((t) => t.title), ['kept']);
  assert.equal(store.getSettings().name, '');
  assert.equal(store.createTask({ title: 'next' }).id, 2); // ids too
});

test('unreadable saved data is never overwritten: the app is told and keeps the raw text', () => {
  for (const [raw, why] of [
    ['{not json', /cannot be read/],
    ['{"hello": 1}', /does not look right/],
    ['[1, 2, 3]', /does not look right/],
    [JSON.stringify({ v: 99, tasks: [] }), /newer version/],
    [JSON.stringify({ v: 1, tasks: [{ id: 1, title: '' }] }), /Task #1/],
  ]) {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, raw);
    assert.throws(() => createBackend({ storage }), (e) => e instanceof DamagedData && why.test(e.message) && e.raw === raw, raw);
    assert.equal(storage.getItem(STORAGE_KEY), raw); // untouched
  }
});

test('journal entries keep their line breaks; other fields stay on one line', async () => {
  const app = open(memoryStorage());
  const e = (await app.call('POST', '/api/journal', { text: '  First line\r\n\r\nThird\tline  ', today: TODAY })).json.entry;
  assert.equal(e.text, 'First line\n\nThird\tline');
  const edited = (await app.call('PATCH', `/api/journal/${e.id}`, { text: 'a\nb', today: TODAY })).json.entry;
  assert.equal(edited.text, 'a\nb');
  assert.equal(edited.wordCount, 2);
  assert.equal((await app.call('POST', '/api/tasks', { title: 'one\ntwo' })).json.title, 'one two');
});

test('deleting a journal entry keeps its spending, just unlinked; a repeated music link is renamed, not duplicated', async () => {
  const app = open(memoryStorage());
  const entry = await fill(app.call);
  assert.equal((await app.call('DELETE', `/api/journal/${entry.id}`)).status, 204);
  const spend = (await app.call('GET', `/api/expenses?today=${TODAY}`)).json;
  assert.equal(spend.count, 2);
  assert.ok(spend.expenses.every((x) => x.entryId === null));

  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const before = (await app.call('GET', '/api/music')).json.links;
  const again = (await app.call('POST', '/api/music', { url, label: 'Renamed' })).json.link;
  assert.equal(again.id, before[0].id);
  assert.equal((await app.call('GET', '/api/music')).json.links.length, 1);
  assert.equal((await app.call('GET', '/api/music')).json.links[0].label, 'Renamed');
});

// ---------- backup and restore ----------

test('backup then restore on a clean browser gives back exactly the same data', async () => {
  const a = open(memoryStorage());
  await fill(a.call);
  const backup = (await a.call('GET', '/api/export')).json;
  assert.match((await a.call('GET', '/api/export')).headers['content-disposition'], /day-hub-backup\.json/);

  const b = open(memoryStorage());
  const done = await b.call('POST', '/api/import', JSON.parse(JSON.stringify(backup)));
  assert.equal(done.status, 200);
  assert.equal(done.json.restored.entries, 1);
  const norm = (x) => { const c = JSON.parse(JSON.stringify(x)); delete c.exportedAt; return c; };
  assert.deepEqual(norm((await b.call('GET', '/api/export')).json), norm(backup));
  assert.equal(open(memoryStorage()).store.listTasks().length, 0); // another browser's data is separate
});

test('restore replaces what is there, and a bad file changes nothing', async () => {
  const storage = memoryStorage();
  const app = open(storage);
  await app.call('POST', '/api/tasks', { title: 'mine' });
  const good = (await app.call('GET', '/api/export')).json;
  const before = storage.getItem(STORAGE_KEY);

  const cases = [
    [{}, /not a Day Hub backup/],
    [{ hello: 'world' }, /not a Day Hub backup/],
    [{ ...good, tasks: 'nope' }, /"tasks" should be a list/],
    [{ ...good, tasks: [{ id: 1, title: 'a' }, { id: 1, title: 'b' }] }, /id 1 appears twice/],
    [{ ...good, expenses: [{ id: 1, amountMinor: -5, category: 'Food', spentOn: TODAY }] }, /Expense #1/],
    [{ ...good, journal: [{ id: 1, day: 'yesterday', text: '' }] }, /Journal entry #1/],
    [{ ...good, habits: [{ id: 1, title: 'x', kind: 'weird', createdOn: TODAY }] }, /Habit #1/],
    [{ ...good, journal: [{ id: 1, day: TODAY, text: 'x'.repeat(10_001) }] }, /too long/],
    [{ ...good, settings: { currency: 'ZZZ9' } }, /currency/],
  ];
  for (const [body, why] of cases) {
    const res = await app.call('POST', '/api/import', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match(res.json.error, why);
  }
  assert.equal((await app.call('POST', '/api/import', [1, 2])).status, 400);
  assert.equal(storage.getItem(STORAGE_KEY), before);
  assert.deepEqual((await app.call('GET', '/api/tasks')).json.tasks.map((t) => t.title), ['mine']);

  const replacement = { settings: { name: 'New', setupDone: true }, tasks: [{ id: 7, title: 'imported', priority: 1 }] };
  assert.equal((await app.call('POST', '/api/import', replacement)).status, 200);
  assert.deepEqual((await app.call('GET', '/api/tasks')).json.tasks.map((t) => t.title), ['imported']);
  assert.equal((await app.call('POST', '/api/tasks', { title: 'next' })).json.id, 8); // ids continue after the highest imported one
});

test('restore tidies broken links instead of keeping them', async () => {
  const app = open(memoryStorage());
  const res = await app.call('POST', '/api/import', {
    settings: { currentMusicId: 99 },
    habits: [{ id: 1, title: 'Water', kind: 'goal', target: 8, createdOn: TODAY }],
    habitLogs: [{ habitId: 1, day: TODAY, value: 2 }, { habitId: 1, day: TODAY, value: 5 }, { habitId: 42, day: TODAY, value: 1 }],
    expenses: [{ id: 1, amountMinor: 500, category: 'Food', spentOn: TODAY, entryId: 77 }],
  });
  assert.equal(res.status, 200);
  const backup = (await app.call('GET', '/api/export')).json;
  assert.deepEqual(backup.habitLogs, [{ habitId: 1, day: TODAY, value: 5, time: null }]); // duplicate day: last wins; unknown habit dropped
  assert.equal(backup.expenses[0].entryId, null);
  assert.equal(backup.settings.currentMusicId, null);
});

test('the storage route reports how much room Day Hub is using', async () => {
  const app = open(memoryStorage());
  assert.equal((await app.call('GET', '/api/storage')).json.chars, 0);
  await fill(app.call);
  const u = (await app.call('GET', '/api/storage')).json;
  assert.ok(u.chars > 500 && u.chars < u.limitChars && u.share > 0);
});
