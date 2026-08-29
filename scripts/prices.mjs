// Refresh pricing.json from live market data.
//
//     npm run prices
//
// The table is committed rather than fetched at runtime on purpose: the cage
// tests have to be deterministic, and a contract cannot call an HTTP API. What
// keeps a deployed cage honest is the oracle — `postRate()` with a staleness
// window and a bounded move — and this script is what a watcher would feed it.
//
// Falls back to leaving the file untouched if the API is unreachable, so a
// flaky network cannot silently reprice the game.

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../pricing.json', import.meta.url));
const IDS = { ETH: 'ethereum', BTC: 'bitcoin', SOL: 'solana', ADA: 'cardano', NEAR: 'near' };
const URL_ = `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(IDS).join(',')}&vs_currencies=usd`;

const current = JSON.parse(readFileSync(FILE, 'utf8'));

let live;
try {
  const res = await fetch(URL_, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  live = await res.json();
} catch (err) {
  console.error(`could not reach the price API (${err.message}) — pricing.json left as it was`);
  process.exit(1);
}

const assets = {};
for (const [ticker, id] of Object.entries(IDS)) {
  const usd = live[id]?.usd;
  if (typeof usd !== 'number') {
    console.error(`no USD price came back for ${ticker} — pricing.json left as it was`);
    process.exit(1);
  }
  assets[ticker] = usd;
}

/**
 * A chip is $0.20 and stays $0.20. It is the unit a player counts in, so it
 * has to be stable and human — a $20 buy-in is 100 chips whatever the market
 * did overnight. Asset prices are rounded onto that grid so every rate divides
 * exactly; rounding left over is the gap an arbitrageur trades against.
 */
const CHIP_USD = 0.2;

const chipUsd = CHIP_USD;
for (const k of Object.keys(assets)) {
  assets[k] = Math.max(chipUsd, Math.round(assets[k] / chipUsd) * chipUsd);
  assets[k] = Math.round(assets[k] * 100) / 100;
}

const next = {
  ...current,
  chipUsd,
  snapshotUtc: new Date().toISOString(),
  source: 'coingecko simple/price',
  assets,
};

writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n');
console.log(`a chip is $${chipUsd}. snapshot ${next.snapshotUtc}\n`);
for (const [k, v] of Object.entries(assets)) {
  console.log(`  ${k.padEnd(5)} $${String(v).padEnd(10)} -> ${Math.round(v / chipUsd).toLocaleString('en-US')} chips`);
}
