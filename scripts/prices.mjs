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
// /coins/markets gives price, 24h change and a 7-day series in one call, which
// is what the cage picker needs to show a market rather than a number.
const URL_ =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd' +
  `&ids=${Object.values(IDS).join(',')}&sparkline=true&price_change_percentage=24h`;

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

// This is a system boundary: whatever comes back here becomes the exchange
// rate the cages price buy-ins at, so a bad number is a bad rate, not a bad
// pixel. A 200 response carrying an error object would have thrown an
// unhandled TypeError on .map below.
if (!Array.isArray(live)) {
  console.error('the price API did not return a list — pricing.json left as it was');
  process.exit(1);
}
const byId = Object.fromEntries(live.map((c) => [c?.id, c]));

/** 168 hourly points is more than a 70px sparkline can show; take 32. */
function thin(series, want = 32) {
  if (!Array.isArray(series) || series.length === 0) return [];
  const step = (series.length - 1) / (want - 1);
  return Array.from({ length: want }, (_, i) => {
    const v = series[Math.round(i * step)];
    // A hole in the series must not become NaN in a committed file.
    return Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
  }).filter((v) => v !== null);
}

const assets = {};
const change24h = {};
const spark = {};
for (const [ticker, id] of Object.entries(IDS)) {
  const row = byId[id];
  // typeof NaN is 'number', and so is Infinity. Neither is a price.
  if (!row || !Number.isFinite(row.current_price) || row.current_price <= 0) {
    console.error(`no usable USD price came back for ${ticker} — pricing.json left as it was`);
    process.exit(1);
  }
  assets[ticker] = row.current_price;
  change24h[ticker] = Math.round((row.price_change_percentage_24h ?? 0) * 100) / 100;
  spark[ticker] = thin(row.sparkline_in_7d?.price ?? []);
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
  source: 'coingecko coins/markets',
  assets,
  change24h,
  spark,
};

writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n');
console.log(`a chip is $${chipUsd}. snapshot ${next.snapshotUtc}\n`);
for (const [k, v] of Object.entries(assets)) {
  console.log(`  ${k.padEnd(5)} $${String(v).padEnd(10)} -> ${Math.round(v / chipUsd).toLocaleString('en-US')} chips`);
}
