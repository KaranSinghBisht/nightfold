// Hand ranking for the table.
//
// This is the reference implementation from src/handrank.fuzz.mjs — the one
// that suite proves orders hands IDENTICALLY to the Compact circuit across
// 20,000 random comparisons. The circuit is the authority; this exists so the
// browser doesn't have to load the proving WASM just to lay out a table.
//
// Card ids are 0..51 with id = rank * 4 + suit.

const CATEGORY = [
  'high card', 'pair', 'two pair', 'three of a kind',
  'straight', 'flush', 'full house', 'four of a kind', 'straight flush',
] as const;

const RANK_NAME = '23456789TJQKA';

/** [category, ...tiebreakers] — compare lexically. */
function evaluate5(ids: number[]): number[] {
  const ranks = ids.map((c) => c >> 2);
  const suits = ids.map((c) => c & 3);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = ordered.map(([, n]) => n);
  const tiers = ordered.flatMap(([r, n]) => Array(n).fill(r));

  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);

  let straight = false;
  let high = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) { straight = true; high = uniq[0]; }
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[4] === 0) { straight = true; high = 3; } // wheel
  }

  const is = (a: number[]) => shape.length === a.length && shape.every((v, i) => v === a[i]);

  if (straight && flush) return [8, high, 0, 0, 0, 0];
  if (is([4, 1])) return [7, ...tiers];
  if (is([3, 2])) return [6, ...tiers];
  if (flush) return [5, ...tiers];
  if (straight) return [4, high, 0, 0, 0, 0];
  if (is([3, 1, 1])) return [3, ...tiers];
  if (is([2, 2, 1])) return [2, ...tiers];
  if (is([2, 1, 1, 1])) return [1, ...tiers];
  return [0, ...tiers];
}

/** Pack to one comparable integer, matching the circuit's encoding. */
const pack = (v: number[]) =>
  v[0] * 759375 + (v[1] ?? 0) * 50625 + (v[2] ?? 0) * 3375 + (v[3] ?? 0) * 225 + (v[4] ?? 0) * 15 + (v[5] ?? 0);

/** Best five from seven, as a single packed rank. */
export function rankOf(ids: number[]): number {
  let best = -1;
  for (let a = 0; a < ids.length; a++)
    for (let b = a + 1; b < ids.length; b++)
      for (let c = b + 1; c < ids.length; c++)
        for (let d = c + 1; d < ids.length; d++)
          for (let e = d + 1; e < ids.length; e++) {
            const v = pack(evaluate5([ids[a], ids[b], ids[c], ids[d], ids[e]]));
            if (v > best) best = v;
          }
  return best;
}

/** Human-readable name for the best hand available from these cards. */
export function handName(ids: number[]): string {
  let best: number[] | null = null;
  let bestVal = -1;
  for (let a = 0; a < ids.length; a++)
    for (let b = a + 1; b < ids.length; b++)
      for (let c = b + 1; c < ids.length; c++)
        for (let d = c + 1; d < ids.length; d++)
          for (let e = d + 1; e < ids.length; e++) {
            const v = evaluate5([ids[a], ids[b], ids[c], ids[d], ids[e]]);
            const p = pack(v);
            if (p > bestVal) { bestVal = p; best = v; }
          }
  if (!best) return '';
  const cat = CATEGORY[best[0]];
  const kicker = RANK_NAME[best[1]] ?? '';
  return best[0] === 4 || best[0] === 8 ? `${cat}, ${kicker} high` : `${cat}, ${kicker} high`;
}
