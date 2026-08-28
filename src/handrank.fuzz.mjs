// Randomised cross-check of the Compact hand evaluator against an independent
// reference implementation written from the poker rules.
//
// The muck depends on this being exactly right: if two hands ever compare the
// wrong way, a losing player can prove a winning rank and take the pot. A
// ladder of hand-picked examples is not enough coverage for that, so this
// compares ORDERING over many random pairs — the property that actually
// matters — rather than comparing packed values, which are an implementation
// detail the reference has no reason to reproduce.

import { pureCircuits } from '../contracts/managed/handrank-tc/contract/index.js';

const toCard = (id) => ({ id: BigInt(id), rank: BigInt(id >> 2), suit: BigInt(id & 3) });

// ---- reference evaluator (independent of the circuit) ----------------------
// Returns a comparable array: [category, ...tiebreakers], compared lexically.
function reference(ids) {
  const ranks = ids.map((c) => c >> 2);
  const suits = ids.map((c) => c & 3);

  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  // sort ranks by (count desc, rank desc)
  const ordered = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = ordered.map(([, n]) => n);
  const tiers = ordered.flatMap(([r, n]) => Array(n).fill(r));

  const flush = suits.every((s) => s === suits[0]);

  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straight = false, high = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) { straight = true; high = uniq[0]; }
    // wheel: A,5,4,3,2 -> ranks 12,3,2,1,0
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[4] === 0) { straight = true; high = 3; }
  }

  const eq = (a) => shape.length === a.length && shape.every((v, i) => v === a[i]);

  if (straight && flush) return [8, high, 0, 0, 0, 0];
  if (eq([4, 1]))        return [7, ...tiers];
  if (eq([3, 2]))        return [6, ...tiers];
  if (flush)             return [5, ...tiers];
  if (straight)          return [4, high, 0, 0, 0, 0];
  if (eq([3, 1, 1]))     return [3, ...tiers];
  if (eq([2, 2, 1]))     return [2, ...tiers];
  if (eq([2, 1, 1, 1]))  return [1, ...tiers];
  return [0, ...tiers];
}

const cmpRef = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
};

function randomHand(rng) {
  const seen = new Set();
  while (seen.size < 5) seen.add(Math.floor(rng() * 52));
  return [...seen];
}

// deterministic PRNG so a failure is reproducible
let seed = 0x9e3779b9;
const rng = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) % 1e6) / 1e6;
};

const N = Number(process.argv[2] ?? 20000);
let mismatches = 0, shown = 0;
const catSeen = new Set();

const show = (ids) => ids.map((c) => '23456789TJQKA'[c >> 2] + 'shdc'[c & 3]).join(' ');

for (let i = 0; i < N; i++) {
  const A = randomHand(rng), B = randomHand(rng);
  const refA = reference(A), refB = reference(B);
  catSeen.add(refA[0]);

  const vA = pureCircuits.evaluate5(A.map(toCard));
  const vB = pureCircuits.evaluate5(B.map(toCard));

  const wantOrd = cmpRef(refA, refB);
  const gotOrd = vA === vB ? 0 : vA > vB ? 1 : -1;

  if (wantOrd !== gotOrd) {
    mismatches++;
    if (shown++ < 8) {
      console.log(`MISMATCH  ${show(A)}  [${refA}] v=${vA}`);
      console.log(`          ${show(B)}  [${refB}] v=${vB}`);
      console.log(`          reference says ${wantOrd}, circuit says ${gotOrd}\n`);
    }
  }
}

const names = ['high card','pair','two pair','trips','straight','flush','full house','quads','str flush'];
console.log(`categories exercised: ${[...catSeen].sort().map((c) => names[c]).join(', ')}`);
console.log(mismatches === 0
  ? `${N} random comparisons — ordering matches the reference exactly`
  : `${mismatches}/${N} MISMATCHES`);
process.exit(mismatches === 0 ? 0 : 1);
