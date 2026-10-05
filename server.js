import http from 'node:http';
import { loadConfig } from './src/config.js';
import { openStore } from './src/store/index.js';
import { createApp } from './src/app.js';

const config = loadConfig();

let store;
try {
  store = await openStore(config);
} catch (e) {
  console.error(`\nCould not open the database: ${e.message}\n`);
  process.exit(1);
}

const server = http.createServer(createApp({ store, config }));
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE'
    ? `\nPort ${config.port} is already in use. Set another one, for example: PORT=3001 npm start\n`
    : e);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`\n  Day Hub is running:  http://${shown}:${config.port}\n`);
  console.log(`  Data file: ${config.dbPath}\n  Press Ctrl+C to stop.\n`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
