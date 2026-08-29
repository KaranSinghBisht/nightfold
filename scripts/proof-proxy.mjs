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
// Bind loopback explicitly. `.listen(port)` binds every interface, which on a
// shared network exposes the local proof server through an unauthenticated
// proxy (NF-010).
const HOST = '127.0.0.1';
// A proof preimage is small; anything larger is a mistake or an attack.
const MAX_BODY = 8 * 1024 * 1024;
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = Number(process.env.PROOF_PORT ?? 6300);

createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end('request too large');
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
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

          // The server rejects on a SERIALIZATION HEADER TAG it reads off the
          // front of the body, and its 400 quotes the tag it wanted. Printing
          // the tag actually sent is the only way to compare the two — the
          // difference between them is the whole bug.
          const lead = body.subarray(0, 120).toString('latin1');
          const tag = lead.match(/midnight:\([^)]*\)*[^:]*:/)?.[0]
                   ?? lead.replace(/[^\x20-\x7e]/g, '.').slice(0, 80);
          console.log(`  sent tag: ${tag}`);
          if (!ok && process.env.PROXY_HEXDUMP) {
            // A rejected body is small enough to read in full, and the shape
            // after the tag says whether the optional IR was actually sent.
            const after = body.subarray(tag.length);
            console.log(`  body after tag (${after.length}B):`);
            for (let i = 0; i < Math.min(after.length, 256); i += 16) {
              const row = after.subarray(i, i + 16);
              const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
              const asc = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
              console.log(`    ${String(i).padStart(4)}  ${hex.padEnd(47)}  ${asc}`);
            }
          }
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
}).listen(LISTEN, HOST, () => {
  console.log(`proof proxy: ${HOST}:${LISTEN} → ${TARGET_HOST}:${TARGET_PORT}  (diagnostic only)\n`);
});
