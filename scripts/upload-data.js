// One-time helper: copies the data from your local Day Hub (the SQLite file) into the
// hosted storage, so a journal you started on your computer shows up on Vercel.
//
//   node --disable-warning=ExperimentalWarning scripts/upload-data.js          (or: npm run upload)
//   ... --force      replace what is already stored online
//
// It needs the storage address and token. Copy them from Vercel: Storage tab, your
// Upstash Redis database, ".env.local" (KV_REST_API_URL and KV_REST_API_TOKEN), and put
// them in a local .env file or in your terminal's environment before running this.

import { loadConfig } from '../src/config.js';
import { createSqliteStore } from '../src/store/sqlite.js';
import { createUpstashBackend } from '../src/store/upstash.js';

const force = process.argv.includes('--force');
const config = loadConfig();

let backend;
try {
  backend = createUpstashBackend(config.upstash);
} catch (e) {
  console.error(`\n${e.message}\nSet KV_REST_API_URL and KV_REST_API_TOKEN first (see the note at the top of this file).\n`);
  process.exit(1);
}

const local = createSqliteStore(config.dbPath);
const dump = local.dumpRaw();
local.close();
const rows = Object.values(dump.tables).reduce((n, list) => n + list.length, 0);
if (!rows) {
  console.error(`\nNothing to upload: ${config.dbPath} has no data yet.\n`);
  process.exit(1);
}

try {
  const current = await backend.read(null);
  if (current.dump && !force) {
    console.error('\nThere is already data in the hosted storage. Nothing was changed.\nRun again with --force if you really want to replace it.\n');
    process.exit(1);
  }
  await backend.write(dump, current.version);
  console.log(`\nUploaded ${rows} records from ${config.dbPath}. Reload your Vercel site to see them.\n`);
} catch (e) {
  console.error(`\nUpload failed: ${e.message}\n`);
  process.exit(1);
}
