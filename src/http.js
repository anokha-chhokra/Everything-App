// A tiny router, JSON helpers and static file server on top of node:http.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './validate.js';

export class Reply {
  constructor(status = 200, body = null, headers = {}) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

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

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const escaped = pattern.replace(/[.+*?^${}()|[\]\\]/g, '\\$&');
    const source = escaped.replace(/:([a-zA-Z]+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    });
    this.routes.push({ method, re: new RegExp(`^${source}/?$`), keys, handler });
  }

  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  patch(p, h) { this.add('PATCH', p, h); }
  delete(p, h) { this.add('DELETE', p, h); }

  /** { handler, params } | { methodNotAllowed: true } | null */
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      try {
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      } catch {
        throw new HttpError(400, 'Bad URL');
      }
      return { handler: r.handler, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export async function readJson(req, limit = 100_000) {
  // Some hosts (Vercel) read and parse the body before our code runs and leave it on
  // req.body. Looking at it first also keeps us from reading a stream they own.
  let parsed;
  try { parsed = req.body; } catch { throw new HttpError(400, 'Body is not valid JSON'); }
  if (parsed !== undefined && parsed !== null) return fromHost(parsed, limit);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Past the limit we stop storing but keep reading, so the client still receives
    // a clean 413 instead of a dropped connection. A hard cap ends endless uploads.
    if (size > limit * 50) req.destroy();
    else if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new HttpError(413, 'Request body is too large');
  if (!size) return {};
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON (Content-Type: application/json)');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

// A body the host already read: an object (parsed JSON), a string or a Buffer.
function fromHost(body, limit) {
  let value = body;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    if (value.length > limit) throw new HttpError(413, 'Request body is too large');
    if (!value.trim()) return {};
    try { return JSON.parse(value); } catch { throw new HttpError(400, 'Body is not valid JSON'); }
  }
  if (JSON.stringify(value).length > limit) throw new HttpError(413, 'Request body is too large');
  return value;
}

export function send(res, status, body, headers = {}) {
  let payload = body;
  const h = { ...headers };
  if (body !== null && body !== undefined && typeof body === 'object' && !Buffer.isBuffer(body)) {
    payload = JSON.stringify(body);
    h['content-type'] = h['content-type'] || 'application/json; charset=utf-8';
  }
  if (status === 204 || payload === null || payload === undefined) {
    res.writeHead(status, h);
    res.end();
    return;
  }
  h['content-length'] = Buffer.byteLength(payload);
  res.writeHead(status, h);
  res.end(payload);
}

/** Serves a file from `root`. Returns false when there is no such file. */
export async function serveStatic(root, pathname, res, headers = {}) {
  let rel;
  try {
    rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    return false;
  }
  const full = path.join(root, path.normalize(rel));
  if (!full.startsWith(root + path.sep)) return false;
  try {
    const info = await stat(full);
    if (!info.isFile()) return false;
    const data = await readFile(full);
    send(res, 200, data, {
      ...headers,
      'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    return true;
  } catch {
    return false;
  }
}
