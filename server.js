// Serves the files in public/ so Day Hub can open in your browser. That is all it does:
// there is no database and no API. Your data lives in the browser, not here.
//
//   node server.js        (or: npm start)      then open http://127.0.0.1:3000

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

// Same security headers Vercel sends (vercel.json is the one place they are written down).
let securityHeaders = {};
try {
  const cfg = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  securityHeaders = Object.fromEntries(((cfg.headers || [])[0] || { headers: [] }).headers.map((x) => [x.key, x.value]));
} catch { /* run without them */ }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function createServer() {
  return http.createServer(async (req, res) => {
    const fail = (status, text) => {
      res.writeHead(status, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Method not allowed');
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return fail(400, 'Bad URL');
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const full = path.join(publicDir, path.normalize(rel));
    if (!full.startsWith(publicDir + path.sep)) return fail(404, 'Not found');
    try {
      if (!(await stat(full)).isFile()) return fail(404, 'Not found');
      const data = await readFile(full);
      res.writeHead(200, {
        ...securityHeaders,
        'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'content-length': data.length,
        'cache-control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      fail(404, 'Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE'
      ? `\nPort ${port} is already in use. Set another one, for example: PORT=3001 npm start\n`
      : e);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`\n  Day Hub is running:  http://${shown}:${port}\n`);
    console.log('  Your data is saved in the browser, not on this computer\'s disk. Press Ctrl+C to stop.\n');
  });
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
