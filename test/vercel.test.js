// The function Vercel actually runs (src/vercel.js), driven the way Vercel drives it:
// environment variables decide everything, and a half-set-up project must say what is missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startMockUpstash } from './helpers/mock-upstash.js';

const KEYS = ['VERCEL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'DAYHUB_PASSWORD', 'DAYHUB_SESSION_SECRET'];

test('vercel function: says what is missing, then works once the setup is complete', async () => {
  for (const k of KEYS) delete process.env[k];
  process.env.VERCEL = '1';
  const { default: handler } = await import('../src/vercel.js');
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mock = await startMockUpstash();
  try {
    // 1. storage not connected yet
    const none = await fetch(`${base}/api/session`);
    assert.equal(none.status, 503);
    const body = await none.json();
    assert.equal(body.code, 'setup');
    assert.match(body.error, /Upstash Redis/);

    // 2. storage connected (the names the Vercel integration provides), no password yet
    process.env.KV_REST_API_URL = mock.url;
    process.env.KV_REST_API_TOKEN = mock.token;
    const session = await (await fetch(`${base}/api/session`)).json();
    assert.equal(session.signIn, 'missing');
    assert.equal((await fetch(`${base}/api/state`)).status, 503);
    assert.equal(mock.log.length, 0);

    // 3. password set. On Vercel a changed variable means a new deployment, so start a fresh copy of the function.
    process.env.DAYHUB_PASSWORD = 'open sesame';
    process.env.DAYHUB_SESSION_SECRET = 'x'.repeat(32);
    const { default: redeployed } = await import('../src/vercel.js?redeploy');
    server.removeAllListeners('request');
    server.on('request', redeployed);
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'open sesame' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    assert.match(login.headers.getSetCookie()[0], /; Secure/); // VERCEL is set, so https-only cookies
    const asUser = { cookie, 'content-type': 'application/json' };
    const made = await fetch(`${base}/api/tasks`, { method: 'POST', headers: asUser, body: JSON.stringify({ title: 'from vercel' }) });
    assert.equal(made.status, 201);
    const list = await (await fetch(`${base}/api/tasks`, { headers: asUser })).json();
    assert.deepEqual(list.tasks.map((t) => t.title), ['from vercel']);
    assert.equal(mock.count('EVAL'), 1);
  } finally { server.close(); server.closeAllConnections?.(); await mock.close(); }
});
