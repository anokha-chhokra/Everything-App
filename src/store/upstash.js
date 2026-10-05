// Talks to Upstash Redis (the "Upstash Redis" storage you add from the Vercel
// Marketplace) over its plain HTTPS API, so there is nothing to install.
//
// Day Hub keeps its whole data set as one compressed snapshot under a single key,
// plus a version number next to it. Writes are "compare and set": a write only
// succeeds if nobody else saved since we read, so two open tabs or two server
// instances can never silently overwrite each other.

import zlib from 'node:zlib';
import { StorageConflict, StorageError } from './errors.js';

export { StorageConflict, StorageError };

// Saves only if the stored version is still the one we read (KEYS[2] missing counts as "0").
const SAVE_IF_UNCHANGED = `
local cur = redis.call('GET', KEYS[2])
if (not cur and ARGV[1] == '0') or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[3])
  redis.call('SET', KEYS[2], ARGV[2])
  return 1
end
return 0`;

export const encodeSnapshot = (dump) => zlib.gzipSync(JSON.stringify(dump)).toString('base64');
export const decodeSnapshot = (text) => JSON.parse(zlib.gunzipSync(Buffer.from(text, 'base64')).toString('utf8'));

export function createUpstashBackend({ url, token, key = 'dayhub', maxSnapshotBytes = 900_000, fetchImpl = fetch } = {}) {
  if (!url || !token) {
    throw new StorageError(
      'Storage is not connected. Add the Upstash Redis integration to this Vercel project ' +
      '(Storage tab), then redeploy. It provides KV_REST_API_URL and KV_REST_API_TOKEN.',
    );
  }
  const snapKey = `${key}:snapshot`;
  const verKey = `${key}:version`;

  async function command(args) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch {
      throw new StorageError('Could not reach the storage service. Try again in a moment.');
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || !data || data.error) {
      throw new StorageError(`Storage said no (${(data && data.error) || res.status}).`);
    }
    return data.result;
  }

  return {
    /**
     * Returns { version, dump }. dump is undefined when `knownVersion` is still current,
     * so the caller can reuse what it already has, and null when nothing was ever saved.
     */
    async read(knownVersion = null) {
      const current = Number((await command(['GET', verKey])) || 0);
      if (knownVersion !== null && current === knownVersion) return { version: current, dump: undefined };
      if (current === 0) return { version: 0, dump: null };
      const [snap, ver] = await command(['MGET', snapKey, verKey]);
      if (!snap) return { version: Number(ver || 0), dump: null };
      return { version: Number(ver), dump: decodeSnapshot(snap) };
    },

    /** Saves `dump` if the stored version is still `expectedVersion`. Returns the new version. */
    async write(dump, expectedVersion) {
      const payload = encodeSnapshot(dump);
      if (payload.length > maxSnapshotBytes) {
        throw new StorageError(
          `Your data (${Math.round(payload.length / 1024)} KB compressed) is bigger than this storage plan allows ` +
          `(about ${Math.round(maxSnapshotBytes / 1024)} KB). Download a backup in Settings and trim old entries, or raise DAYHUB_MAX_SNAPSHOT_KB on a bigger plan.`,
        );
      }
      const next = expectedVersion + 1;
      const saved = await command(['EVAL', SAVE_IF_UNCHANGED, '2', snapKey, verKey, String(expectedVersion), String(next), payload]);
      if (saved !== 1) throw new StorageConflict();
      return next;
    },
  };
}
