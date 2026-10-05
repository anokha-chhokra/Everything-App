// The entry point Vercel runs (through api/index.js). It builds the app once per warm
// server and then hands every request to it. Pages and scripts in public/ never reach
// this code: Vercel serves them directly.

import { loadConfig } from './config.js';
import { openStore } from './store/index.js';
import { createApp } from './app.js';
import { StorageError } from './store/errors.js';

let ready = null;

function build() {
  // Vercel puts its own proxy in front, so the loopback-only Host check does not apply.
  const config = loadConfig({ host: '0.0.0.0' });
  return openStore(config).then((store) => createApp({ store, config }));
}

export default async function handler(req, res) {
  let app;
  try {
    ready ??= build().catch((e) => { ready = null; throw e; }); // a failed start is retried next time
    app = await ready;
  } catch (e) {
    const known = e instanceof StorageError;
    if (!known) console.error('Day Hub could not start:', e);
    const body = JSON.stringify({
      error: known ? e.message : 'Day Hub could not start. Open the function logs in Vercel for details.',
      code: 'setup',
    });
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  return app(req, res);
}
