// Hosted storage (Vercel): the Upstash backend, the per-request snapshot store, the
// whole API running on top of it, and the password sign-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { createSqliteStore } from '../src/store/sqlite.js';
import { createUpstashBackend, encodeSnapshot, decodeSnapshot } from '../src/store/upstash.js';
import { StorageConflict, StorageError } from '../src/store/errors.js';
import { createSnapshotStore } from '../src/store/serverless.js';
import { createApp, SECURITY_HEADERS } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { readJson } from '../src/http.js';
import { loadConfig } from '../src/config.js';
import { startMockUpstash } from './helpers/mock-upstash.js';

const TODAY = '2026-10-05';

const backendFor = (mock, extra = {}) => createUpstashBackend({ url: mock.url, token: mock.token, ...extra });

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  const call = async (method, path, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const at = pair.indexOf('=');
      const value = pair.slice(at + 1);
      if (/Max-Age=0/i.test(sc) || !value) jar.delete(pair.slice(0, at)); else jar.set(pair.slice(0, at), value);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { call, jar, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

function hostedApp(mock, overrides = {}) {
  const config = loadConfig({ host: '0.0.0.0', dbClient: 'upstash', password: '', requireAuth: false, ...overrides });
  const store = createSnapshotStore(backendFor(mock));
  return { store, handler: createApp({ store, config }), config };
}

// ---------- the sqlite dump the snapshot is made of ----------

test('dump and load: a copy has the same rows and keeps counting ids from where it was', () => {
  const a = createSqliteStore(':memory:');
  a.createTask({ title: 'one', dueOn: null, priority: 0 });
  const second = a.createTask({ title: 'two', dueOn: TODAY, priority: 1 });
  a.deleteTask(second.id);
  a.setSettings({ name: 'Asha', setupDone: true });
  const dump = a.dumpRaw();

  const b = createSqliteStore(':memory:');
  b.loadRaw(JSON.parse(JSON.stringify(dump)));
  assert.deepEqual(b.dumpRaw(), dump);
  assert.equal(b.getSettings().name, 'Asha');
  assert.equal(b.createTask({ title: 'three', dueOn: null, priority: 0 }).id, second.id + 1); // not reusing the deleted id
  a.close(); b.close();
});

test('snapshot text round trips and is much smaller than the data', () => {
  const dump = { format: 1, tables: { tasks: Array.from({ length: 300 }, (_, i) => ({ id: i, title: `task number ${i}` })) }, sequences: {} };
  const text = encodeSnapshot(dump);
  assert.deepEqual(decodeSnapshot(text), dump);
  assert.ok(text.length < JSON.stringify(dump).length / 2);
});

// ---------- the Upstash backend ----------

test('backend: empty at first, saves, reads back, and skips the download when nothing changed', async () => {
  const mock = await startMockUpstash();
  try {
    const be = backendFor(mock);
    assert.deepEqual(await be.read(null), { version: 0, dump: null });
    const v1 = await be.write({ format: 1, tables: { tasks: [] }, sequences: {} }, 0);
    assert.equal(v1, 1);
    const got = await be.read(null);
    assert.equal(got.version, 1);
    assert.deepEqual(got.dump.tables, { tasks: [] });
    const again = await be.read(1);
    assert.equal(again.dump, undefined); // unchanged: nothing to download
    assert.equal(mock.count('MGET'), 1);
  } finally { await mock.close(); }
});

test('backend: a stale write is refused instead of overwriting newer data', async () => {
  const mock = await startMockUpstash();
  try {
    const be = backendFor(mock);
    await be.write({ format: 1, tables: { a: [1] }, sequences: {} }, 0);
    await assert.rejects(be.write({ format: 1, tables: { a: [2] }, sequences: {} }, 0), StorageConflict);
    assert.deepEqual((await be.read(null)).dump.tables, { a: [1] });
  } finally { await mock.close(); }
});

test('backend: clear messages for missing setup, bad token, outage and oversize data', async () => {
  assert.throws(() => createUpstashBackend({ url: '', token: '' }), (e) => e instanceof StorageError && /Upstash Redis/.test(e.message));

  const mock = await startMockUpstash();
  try {
    await assert.rejects(createUpstashBackend({ url: mock.url, token: 'wrong' }).read(null), /Storage said no/);
    mock.state.failNext = 1;
    await assert.rejects(backendFor(mock).read(null), StorageError);
    await assert.rejects(backendFor(mock, { maxSnapshotBytes: 50 }).write({ format: 1, tables: { t: Array.from({ length: 200 }, (_, i) => ({ i, v: Math.random() })) }, sequences: {} }, 0), /bigger than this storage plan/);
  } finally { await mock.close(); }
  await assert.rejects(createUpstashBackend({ url: 'http://127.0.0.1:1', token: 'x' }).read(null), /Could not reach the storage service/);
});

// ---------- the per-request snapshot store ----------

test('snapshot store: saves only when a request changed something, and drops aborted work', async () => {
  const mock = await startMockUpstash();
  const store = createSnapshotStore(backendFor(mock));
  try {
    let lease = await store.begin();
    store.listTasks({ status: 'all' });
    await lease.commit();
    assert.equal(mock.count('EVAL'), 0); // reading saves nothing

    lease = await store.begin();
    store.createTask({ title: 'kept', dueOn: null, priority: 0 });
    await lease.commit();
    assert.equal(mock.count('EVAL'), 1);

    lease = await store.begin();
    store.createTask({ title: 'thrown away', dueOn: null, priority: 0 });
    lease.abort();
    lease.abort(); // twice is harmless
    assert.equal(mock.count('EVAL'), 1);

    lease = await store.begin();
    assert.deepEqual(store.listTasks({ status: 'all' }).map((t) => t.title), ['kept']);
    await lease.commit();
    assert.throws(() => store.listTasks({}), /outside a request/);
  } finally { store.close(); await mock.close(); }
});

test('snapshot store: requests on one server wait their turn instead of sharing a copy', async () => {
  const mock = await startMockUpstash();
  mock.state.delayMs = 15;
  const store = createSnapshotStore(backendFor(mock));
  try {
    const add = async (title) => { const lease = await store.begin(); store.createTask({ title, dueOn: null, priority: 0 }); await lease.commit(); };
    await Promise.all(['a', 'b', 'c', 'd'].map(add));
    const lease = await store.begin();
    assert.deepEqual(store.listTasks({ status: 'all' }).map((t) => t.title).sort(), ['a', 'b', 'c', 'd']);
    await lease.commit();
  } finally { store.close(); await mock.close(); }
});

test('snapshot store: a failed save followed by abort() does not disturb the request waiting behind it', async () => {
  const mock = await startMockUpstash();
  const store = createSnapshotStore(backendFor(mock));
  const other = backendFor(mock);
  try {
    const first = await store.begin();
    store.createTask({ title: 'loses the race', dueOn: null, priority: 0 });
    // somebody else saves while this request is running, so this save must be refused
    await other.write({ format: 1, tables: {}, sequences: {} }, 0);
    const second = store.begin(); // already waiting for its turn
    await assert.rejects(first.commit(), StorageConflict);
    first.abort(); // what the app does after a failure
    const lease = await second;
    store.createTask({ title: 'second request', dueOn: null, priority: 0 });
    const third = store.begin();
    let thirdStarted = false;
    third.then(() => { thirdStarted = true; });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(thirdStarted, false); // still waiting: the second request keeps its turn
    await lease.commit();
    (await third).abort();
  } finally { store.close(); await mock.close(); }
});

// ---------- the whole API on hosted storage ----------

test('api on hosted storage: data survives a cold start, and failed requests save nothing', async () => {
  const mock = await startMockUpstash();
  const first = hostedApp(mock);
  const s1 = await serve(first.handler);
  try {
    assert.equal((await s1.call('GET', '/api/state')).json.setupDone, false);
    assert.equal(mock.count('EVAL'), 0);
    const bad = await s1.call('POST', '/api/tasks', { title: '' });
    assert.equal(bad.status, 400);
    assert.equal(mock.count('EVAL'), 0);

    await s1.call('POST', '/api/setup', { name: 'Asha', currency: 'inr', today: TODAY });
    await s1.call('POST', '/api/tasks', { title: 'Send invoice', dueOn: TODAY });
    await s1.call('POST', '/api/journal', { text: 'Spent ₹250 on lunch', today: TODAY, time: '13:10', expenses: [{ amount: 250, category: 'Food', note: 'lunch' }] });
    const savedWrites = mock.count('EVAL');
    await s1.call('GET', '/api/dashboard?today=' + TODAY);
    assert.equal(mock.count('EVAL'), savedWrites); // a plain read does not write
  } finally { await s1.close(); first.store.close(); }

  // a brand new server (as after a cold start) sees everything
  const second = hostedApp(mock);
  const s2 = await serve(second.handler);
  try {
    assert.equal((await s2.call('GET', '/api/state')).json.settings.name, 'Asha');
    assert.deepEqual((await s2.call('GET', '/api/tasks')).json.tasks.map((t) => t.title), ['Send invoice']);
    const spend = (await s2.call('GET', `/api/expenses?today=${TODAY}`)).json;
    assert.equal(spend.totalMinor, 25000);
    const tl = (await s2.call('GET', `/api/timeline?day=${TODAY}&today=${TODAY}&now=14:00`)).json;
    assert.ok(tl.items.some((i) => i.type === 'entry'));
  } finally { await s2.close(); second.store.close(); await mock.close(); }
});

test('api on hosted storage: two servers writing at once both keep their changes', async () => {
  const mock = await startMockUpstash();
  mock.state.delayMs = 10;
  const a = hostedApp(mock);
  const b = hostedApp(mock);
  const sa = await serve(a.handler);
  const sb = await serve(b.handler);
  try {
    await sa.call('POST', '/api/setup', { name: 'Asha', today: TODAY });
    const results = await Promise.all([
      ...['a1', 'a2', 'a3'].map((title) => sa.call('POST', '/api/tasks', { title })),
      ...['b1', 'b2', 'b3'].map((title) => sb.call('POST', '/api/tasks', { title })),
    ]);
    assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201, 201, 201]);
    const titles = (await sa.call('GET', '/api/tasks')).json.tasks.map((t) => t.title).sort();
    assert.deepEqual(titles, ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
  } finally { await sa.close(); await sb.close(); a.store.close(); b.store.close(); await mock.close(); }
});

test('api on hosted storage: an outage becomes a clear 503 and the next request works', async () => {
  const mock = await startMockUpstash();
  const app = hostedApp(mock);
  const s = await serve(app.handler);
  try {
    mock.state.failNext = 1;
    const down = await s.call('GET', '/api/state');
    assert.equal(down.status, 503);
    assert.equal(down.json.code, 'storage');
    assert.equal((await s.call('GET', '/api/state')).status, 200);
  } finally { await s.close(); app.store.close(); await mock.close(); }
});

// ---------- sign-in ----------

test('sign-in: nothing is shown on a hosted copy that has no password', async () => {
  const mock = await startMockUpstash();
  const app = hostedApp(mock, { requireAuth: true, password: '' });
  const s = await serve(app.handler);
  try {
    const state = await s.call('GET', '/api/state');
    assert.equal(state.status, 503);
    assert.equal(state.json.code, 'setup');
    assert.equal((await s.call('GET', '/api/session')).json.signIn, 'missing');
    assert.equal((await s.call('POST', '/api/login', { password: '' })).status, 503);
    assert.equal((await s.call('GET', '/api/export')).status, 503);
    assert.equal(mock.log.length, 0); // storage was never even asked
  } finally { await s.close(); app.store.close(); await mock.close(); }
});

test('sign-in: wrong and right passwords, sign out, and a forged cookie', async () => {
  const mock = await startMockUpstash();
  const app = hostedApp(mock, { requireAuth: true, password: 'correct horse', sessionSecret: 'abc', secureCookies: false });
  const s = await serve(app.handler);
  try {
    assert.equal((await s.call('GET', '/api/health')).json.ok, true); // open
    assert.deepEqual((await s.call('GET', '/api/session')).json, { signIn: 'password', signedIn: false, hosted: true });
    const locked = await s.call('GET', '/api/state');
    assert.equal(locked.status, 401);
    assert.equal(locked.json.code, 'auth');
    assert.equal((await s.call('POST', '/api/tasks', { title: 'sneaky' })).status, 401);
    assert.equal(mock.log.length, 0);

    assert.equal((await s.call('POST', '/api/login', { password: 'nope' })).status, 401);
    const ok = await s.call('POST', '/api/login', { password: 'correct horse' });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.equal((await s.call('GET', '/api/state')).status, 200);
    assert.equal((await s.call('GET', '/api/session')).json.signedIn, true);

    await s.call('POST', '/api/logout', {});
    assert.equal((await s.call('GET', '/api/state')).status, 401);

    const token = cookie.split(';')[0].split('=')[1];
    const forged = `${token.slice(0, -3)}${token.endsWith('AAA') ? 'BBB' : 'AAA'}`;
    assert.equal((await s.call('GET', '/api/state', undefined, { cookie: `dh_session=${forged}` })).status, 401);
    assert.equal((await s.call('GET', '/api/state', undefined, { cookie: 'dh_session=v1.9999999999999.abc' })).status, 401);
    assert.equal((await s.call('GET', '/api/state', undefined, { cookie: `dh_session=${token}` })).status, 200); // the real one still works
  } finally { await s.close(); app.store.close(); await mock.close(); }
});

test('sign-in: too many wrong passwords are refused, and the cookie is Secure on https hosts', () => {
  let clock = 1_000_000_000_000;
  const auth = createAuth({ password: 'pw', requireAuth: true, secureCookies: true }, { now: () => clock });
  const req = { headers: { 'x-forwarded-for': '9.9.9.9' }, socket: {} };
  for (let i = 0; i < 7; i += 1) assert.deepEqual(auth.login(req, 'bad'), { ok: false, tooMany: false });
  assert.equal(auth.login(req, 'bad').tooMany, true);
  assert.equal(auth.login(req, 'pw').tooMany, true); // even the right one waits
  clock += 16 * 60 * 1000;
  const good = auth.login(req, 'pw');
  assert.equal(good.ok, true);
  assert.match(good.cookie, /; Secure/);
  assert.equal(auth.signedIn({ headers: { cookie: good.cookie.split(';')[0] } }), true);
  clock += 31 * 24 * 3600 * 1000;
  assert.equal(auth.signedIn({ headers: { cookie: good.cookie.split(';')[0] } }), false); // expired
  const other = createAuth({ password: 'different', requireAuth: true }, { now: () => clock - 31 * 24 * 3600 * 1000 });
  assert.equal(other.signedIn({ headers: { cookie: good.cookie.split(';')[0] } }), false); // changing the password signs everyone out
});

test('no password on your own computer: the app opens straight away', async () => {
  const mock = await startMockUpstash();
  const app = hostedApp(mock, { requireAuth: false, password: '' });
  const s = await serve(app.handler);
  try {
    assert.equal((await s.call('GET', '/api/session')).json.signIn, 'off');
    assert.equal((await s.call('GET', '/api/state')).status, 200);
  } finally { await s.close(); app.store.close(); await mock.close(); }
});

// ---------- hosting details ----------

test('a body the host already parsed (req.body) is accepted, and stays size limited', async () => {
  assert.deepEqual(await readJson({ body: { a: 1 }, headers: {} }), { a: 1 });
  assert.deepEqual(await readJson({ body: '{"a":2}', headers: {} }), { a: 2 });
  assert.deepEqual(await readJson({ body: Buffer.from('{"a":3}'), headers: {} }), { a: 3 });
  assert.deepEqual(await readJson({ body: '', headers: {} }), {});
  await assert.rejects(readJson({ body: '{nope', headers: {} }), /not valid JSON/);
  await assert.rejects(readJson({ body: { big: 'x'.repeat(200_000) }, headers: {} }), /too large/);
});

test('vercel.json: security headers match the app, /api goes to the function, Node is pinned', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const sent = Object.fromEntries(cfg.headers[0].headers.map((h) => [h.key, h.value]));
  assert.deepEqual(sent, SECURITY_HEADERS);
  assert.equal(cfg.outputDirectory, 'public');
  assert.ok(cfg.rewrites.some((r) => r.source === '/api/:path*' && r.destination === '/api'));
  assert.ok(fs.existsSync(new URL('../api/index.js', import.meta.url)));
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engines.node, '24.x');
});
