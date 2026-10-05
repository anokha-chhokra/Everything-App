// A store for hosts with no writable disk (Vercel and similar).
//
// Each API request: load the saved snapshot into a throw-away in-memory SQLite
// database, run the request against it exactly as the normal store would, and
// save the snapshot back only if something changed. All the rules (points,
// streaks, timeline, detection) are therefore the same code as on your computer.
//
// Requests are handled one at a time per server instance, so they cannot
// trample each other's in-memory copy; the backend's compare-and-set protects
// against other instances.

import { createSqliteStore } from './sqlite.js';

export function createSnapshotStore(backend) {
  let inner = null;   // the copy the current request works on
  let current = null; // the request that owns it
  let tail = Promise.resolve();
  let baseline = null;
  let baseVersion = 0;
  let cache = null; // { version, dump } from the last read or write on this instance

  /** Ends one request's turn: closes its copy and lets the next request in. Safe to call twice. */
  function finish(lease) {
    if (lease.closed) return;
    lease.closed = true;
    if (current === lease) {
      if (inner) { try { inner.close(); } catch { /* already closed */ } }
      inner = null;
      current = null;
    }
    lease.next(); // only now may the next request start
  }

  /**
   * Waits for earlier requests, then opens a fresh copy of the saved data.
   * Returns { commit, abort } for this request alone, so a late abort() can never
   * end somebody else's turn.
   */
  async function begin() {
    const previous = tail;
    let next;
    tail = new Promise((resolve) => { next = resolve; });
    await previous;
    const lease = { closed: false, next };
    current = lease;
    try {
      const { version, dump } = await backend.read(cache ? cache.version : null);
      const data = dump === undefined ? cache.dump : dump;
      cache = { version, dump: data };
      inner = createSqliteStore(':memory:');
      if (data) inner.loadRaw(data);
      baseVersion = version;
      baseline = JSON.stringify(inner.dumpRaw());
    } catch (e) {
      finish(lease);
      throw e;
    }
    return {
      /** Saves if the request changed anything, then closes the copy. Throws if the save fails. */
      async commit() {
        if (lease.closed) return;
        try {
          const dump = inner.dumpRaw();
          if (JSON.stringify(dump) !== baseline) {
            const version = await backend.write(dump, baseVersion);
            cache = { version, dump };
          }
        } catch (e) {
          cache = null; // we no longer know what is stored
          throw e;
        } finally {
          finish(lease);
        }
      },
      /** Throws the copy away without saving (the request failed). */
      abort() { finish(lease); },
    };
  }

  // Same method names as the SQLite store, each running against the current copy.
  const probe = createSqliteStore(':memory:');
  const names = Object.keys(probe).filter((k) => typeof probe[k] === 'function' && k !== 'close');
  probe.close();
  const store = { begin, close() { if (current) finish(current); } };
  for (const name of names) {
    store[name] = (...args) => {
      if (!inner) throw new Error('Storage was used outside a request');
      return inner[name](...args);
    };
  }
  return store;
}
