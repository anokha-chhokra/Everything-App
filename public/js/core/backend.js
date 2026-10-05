// Runs the app's routes inside the page. call(method, url, body) works like a small
// request function that never leaves the browser: it answers { status, body, headers }.

import { createStore, memoryStorage } from './store.js';
import { createRoutes } from './routes.js';
import { Reply } from './router.js';
import { HttpError } from './validate.js';

/** The browser's localStorage if it works, otherwise a memory-only stand-in (flagged `volatile`). */
export function browserStorage() {
  try {
    const probe = '__dayhub_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const fallback = memoryStorage();
    fallback.volatile = true;
    return fallback;
  }
}

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function createBackend({ storage }) {
  const store = createStore({ storage }); // may throw DamagedData
  const router = createRoutes({ store });
  let queue = Promise.resolve();

  async function dispatch(method, target, body) {
    try {
      const url = new URL(target, 'http://day-hub.local');
      const found = router.match(method, url.pathname);
      if (!found) throw new HttpError(404, 'Not found');
      if (found.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
      store.refresh(); // another tab may have saved since the last request
      const ctx = {
        params: found.params,
        query: url.searchParams,
        json: async () => (body === undefined || body === null ? {} : clone(body)),
      };
      let out;
      try {
        out = await found.handler(ctx);
        store.commit();
      } catch (e) {
        store.rollback(); // a failed request leaves no half-done changes behind
        throw e;
      }
      const reply = out instanceof Reply ? out : new Reply(200, out);
      return { status: reply.status, body: clone(reply.body), headers: reply.headers };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message }, headers: {} };
      console.error('Unexpected error:', e);
      return { status: 500, body: { error: 'Something went wrong in Day Hub' }, headers: {} };
    }
  }

  return {
    store,
    /** One request at a time, so two quick taps can never interleave their changes. */
    call(method, target, body) {
      const run = queue.then(() => dispatch(method, target, body));
      queue = run.catch(() => {});
      return run;
    },
  };
}
