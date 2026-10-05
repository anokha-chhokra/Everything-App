// The storage layer. The rest of the app only talks to the object returned here,
// so another database can be added by writing a module with the same methods
// (see "Switching databases" in README.md for the list).
//
//   sqlite   a file on disk (default; your own computer or a server with a disk)
//   upstash  Upstash Redis over HTTPS (for Vercel and other serverless hosts)

export async function openStore(config) {
  if (config.dbClient === 'sqlite') {
    const { createSqliteStore } = await import('./sqlite.js');
    return createSqliteStore(config.dbPath);
  }
  if (config.dbClient === 'upstash') {
    const { createSnapshotStore } = await import('./serverless.js');
    const { createUpstashBackend } = await import('./upstash.js');
    return createSnapshotStore(createUpstashBackend(config.upstash));
  }
  throw new Error(
    `DB_CLIENT=${config.dbClient} is not available. Use "sqlite" or "upstash"; ` +
      'see "Switching databases" in README.md to add PostgreSQL or MySQL.',
  );
}
