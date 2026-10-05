// The storage layer. The rest of the app only talks to the object returned here,
// so another database can be added by writing a module with the same methods
// (see "Switching databases" in README.md for the list).

export async function openStore(config) {
  if (config.dbClient === 'sqlite') {
    const { createSqliteStore } = await import('./sqlite.js');
    return createSqliteStore(config.dbPath);
  }
  throw new Error(
    `DB_CLIENT=${config.dbClient} is not available yet. Only "sqlite" ships today; ` +
      'see "Switching databases" in README.md to add PostgreSQL or MySQL.',
  );
}
