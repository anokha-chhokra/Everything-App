import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Optional .env file (Node 22 built-in loader). Real environment variables win.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  /* no .env file: fine */
}

export function loadConfig(overrides = {}) {
  const env = process.env;
  return {
    root,
    publicDir: path.join(root, 'public'),
    port: Number(env.PORT) || 3000,
    host: env.HOST || '127.0.0.1',
    // On Vercel there is no writable disk, so hosted storage is the default there.
    dbClient: (env.DB_CLIENT || (env.VERCEL ? 'upstash' : 'sqlite')).toLowerCase(),
    upstash: {
      url: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '',
      token: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '',
      key: env.DAYHUB_KEY_PREFIX || 'dayhub',
      maxSnapshotBytes: (Number(env.DAYHUB_MAX_SNAPSHOT_KB) || 900) * 1024,
    },
    // Sign-in. A password is optional on your own computer and required on Vercel
    // (without one, the app refuses to show any data).
    password: env.DAYHUB_PASSWORD || '',
    sessionSecret: env.DAYHUB_SESSION_SECRET || '',
    requireAuth: env.DAYHUB_REQUIRE_AUTH === '1' || !!env.VERCEL,
    secureCookies: !!env.VERCEL,
    dbPath: env.DB_PATH ? path.resolve(root, env.DB_PATH) : path.join(root, 'data', 'dayhub.db'),
    ...overrides,
  };
}
