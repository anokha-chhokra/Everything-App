// There is no server-side data: the only server code is a file server for public/.
// These tests keep it that way.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const sentHeaders = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => { server.close(); server.closeAllConnections?.(); });

const raw = (p, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: server.address().port, path: p, method }, (res) => {
    let text = '';
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
  });
  req.on('error', reject);
  req.end();
});

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

test('the file server serves the app with the same security headers Vercel sends', async () => {
  const home = await raw('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<title>Day Hub<\/title>/);
  for (const [k, v] of Object.entries(sentHeaders)) assert.equal(home.headers[k], v, k);
  const js = await raw('/js/core/store.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /javascript/);
  assert.match((await raw('/manifest.webmanifest')).headers['content-type'], /manifest\+json/);
});

test('the file server only serves files from public/', async () => {
  for (const p of ['/%2e%2e/package.json', '/..%2f..%2fetc/passwd', '/%00', '/../server.js', '/js/', '/nothing.js', '/api/tasks', '/api/export']) {
    assert.equal((await raw(p)).status, 404, p);
  }
  assert.equal((await raw('/', 'POST')).status, 405);
  assert.equal((await raw('/api/tasks', 'POST')).status, 405);
});

test('nothing in the app talks to a server, a database or the network', () => {
  const files = walk(path.join(root, 'public')).filter((f) => /\.(js|html)$/.test(f));
  assert.ok(files.length > 15);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    for (const banned of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /from\s+['"]node:/, /\bindexedDB\b/, /<script[^>]+src=["']https?:/]) {
      assert.doesNotMatch(text, banned, `${rel} uses ${banned}`);
    }
  }
  assert.match(sentHeaders['content-security-policy'], /connect-src 'none'/); // the browser itself blocks any request the page tries to make
  assert.equal(vercel.rewrites, undefined);
  assert.equal(vercel.functions, undefined);
  assert.equal(vercel.outputDirectory, 'public');
  assert.equal(fs.existsSync(path.join(root, 'api')), false);
  assert.equal(fs.existsSync(path.join(root, 'src')), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test('every name a module imports from another module is really exported there', () => {
  const dir = path.join(root, 'public', 'js');
  const files = walk(dir).filter((f) => f.endsWith('.js'));
  const exportsOf = (file) => {
    const text = fs.readFileSync(file, 'utf8');
    const names = new Set();
    for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
    }
    if (/^export\s+default\b/m.test(text)) names.add('default');
    return names;
  };
  let checked = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), m[2]);
      assert.ok(fs.existsSync(target), `${path.relative(root, file)} imports ${m[2]}, which does not exist`);
      const have = exportsOf(target);
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        assert.ok(have.has(name), `${path.relative(root, file)} imports { ${name} } from ${m[2]}, which does not export it`);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `only ${checked} imports checked`);
});
