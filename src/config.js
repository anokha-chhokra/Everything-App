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
    dbClient: (env.DB_CLIENT || 'sqlite').toLowerCase(),
    dbPath: env.DB_PATH ? path.resolve(root, env.DB_PATH) : path.join(root, 'data', 'dayhub.db'),
    ...overrides,
  };
}
