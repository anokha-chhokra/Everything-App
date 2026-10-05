// A tiny stand-in for Upstash's REST API: POST a JSON command, get { result }.
// Supports exactly what Day Hub uses: GET, SET, MGET and the compare-and-set EVAL.

import http from 'node:http';

export async function startMockUpstash({ token = 'test-token' } = {}) {
  const data = new Map();
  const log = []; // every command received, e.g. ['GET', 'dayhub:version']
  const state = { failNext: 0, delayMs: 0 };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'Unauthorized' });
    if (state.failNext > 0) { state.failNext -= 1; return reply(500, { error: 'ERR boom' }); }
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    let cmd;
    try { cmd = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, { error: 'ERR bad json' }); }
    log.push(cmd.map(String).map((x) => (x.length > 80 ? `${x.slice(0, 20)}…` : x)));
    const [name, ...args] = cmd;
    switch (String(name).toUpperCase()) {
      case 'GET': return reply(200, { result: data.has(args[0]) ? data.get(args[0]) : null });
      case 'SET': data.set(args[0], String(args[1])); return reply(200, { result: 'OK' });
      case 'MGET': return reply(200, { result: args.map((k) => (data.has(k) ? data.get(k) : null)) });
      case 'EVAL': {
        // EVAL script numkeys key1 key2 arg1 arg2 arg3 -- the one script Day Hub sends
        const [, , snapKey, verKey, expected, next, payload] = args;
        const cur = data.has(verKey) ? data.get(verKey) : null;
        if ((cur === null && expected === '0') || cur === expected) {
          data.set(snapKey, payload);
          data.set(verKey, next);
          return reply(200, { result: 1 });
        }
        return reply(200, { result: 0 });
      }
      default: return reply(400, { error: `ERR unknown command ${name}` });
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, token, data, log, state,
    count: (name) => log.filter((c) => c[0] === name).length,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
