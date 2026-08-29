// A logging proxy in front of the Midnight proof server.
//
// The SDK surfaces proof-server failures as bare "Bad Request" and the server
// logs the request but not the reason, so a /check rejection tells you nothing.
// Point the config at this proxy and the actual response body is printed.
//
//   node scripts/proof-proxy.mjs            # listens on 6301 -> 6300
//   MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6301 npm run proof:real

import { createServer, request as httpRequest } from 'node:http';

const LISTEN = Number(process.env.PROXY_PORT ?? 6301);
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = Number(process.env.PROOF_PORT ?? 6300);

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const started = Date.now();

    const proxied = httpRequest(
      { host: TARGET_HOST, port: TARGET_PORT, path: req.url, method: req.method, headers: req.headers },
      (upstream) => {
        const out = [];
        upstream.on('data', (c) => out.push(c));
        upstream.on('end', () => {
          const respBody = Buffer.concat(out);
          const ms = Date.now() - started;
          const ok = upstream.statusCode >= 200 && upstream.statusCode < 300;

          console.log(
            `${ok ? '  ok ' : 'FAIL'} ${req.method} ${req.url} → ${upstream.statusCode} ` +
            `(${ms}ms, req ${body.length}B, res ${respBody.length}B)`
          );
          if (!ok) {
            console.log('  ┌─ response body ' + '─'.repeat(50));
            console.log('  │ ' + respBody.toString('utf8').slice(0, 1500).split('\n').join('\n  │ '));
            console.log('  └' + '─'.repeat(66));
          }

          res.writeHead(upstream.statusCode, upstream.headers);
          res.end(respBody);
        });
      }
    );
    proxied.on('error', (e) => {
      console.error('  proxy error:', e.message);
      res.writeHead(502).end(e.message);
    });
    proxied.end(body);
  });
}).listen(LISTEN, () => {
  console.log(`proof proxy: 127.0.0.1:${LISTEN} → 127.0.0.1:${TARGET_PORT}\n`);
});
