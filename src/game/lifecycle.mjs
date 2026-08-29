// One resolution matrix, for every component that resolves a hand.
//
// NFV-007: the UI settled the moment one seat mucked; Compact refused until
// both seats had acted; the relayer had its own copy of the ordering; and
// Compact had no fold at all while the UI paid one immediately. Four
// implementations of one rule, agreeing by luck.
//
// This is the rule. Each component consumes it rather than restating it, and
// src/lifecycle.test.mjs checks that they all still answer the same.

/** @typedef {'show'|'muck'|'beat'|'fold'|null} Ending */

/**
 * Who wins, given what each seat did.
 *
 * @param {[Ending, Ending]} ending  what each seat did, null if they have not acted
 * @param {[number, number]} rank    packed ranks, only meaningful where the seat showed
 * @returns {{ done: boolean, winner: 0|1|2|null, why: string }}
 */
export function resolve(ending, rank) {
  const [a, b] = ending;

  // A fold ends the hand immediately and needs no showdown at all — the folder
  // has left, so there is nobody to compare against.
  if (a === 'fold') return { done: true, winner: 1, why: 'seat 0 folded' };
  if (b === 'fold') return { done: true, winner: 0, why: 'seat 1 folded' };

  // A muck is a CONCESSION, and it resolves the hand on its own. The opponent
  // does not have to answer it — that is the whole point of winning without
  // showing, and requiring them to act would let a sulking winner strand the
  // pot by never acting at all.
  //
  // Both mucking is only reachable when neither has conceded to the other,
  // which in practice means they acted without seeing each other. Nobody
  // claimed the pot, so it splits.
  if (a === 'muck' && b === 'muck') return { done: true, winner: 2, why: 'neither seat claims the pot' };
  if (a === 'muck') return { done: true, winner: 1, why: 'seat 0 conceded' };
  if (b === 'muck') return { done: true, winner: 0, why: 'seat 1 conceded' };

  // Anything else is a real showdown and needs both answers to compare.
  if (a === null || b === null) return { done: false, winner: null, why: 'a seat has not acted' };

  if (a === 'beat') return { done: true, winner: 0, why: 'seat 0 proved the better hand' };
  if (b === 'beat') return { done: true, winner: 1, why: 'seat 1 proved the better hand' };

  if (rank[0] > rank[1]) return { done: true, winner: 0, why: 'seat 0 has the better rank' };
  if (rank[1] > rank[0]) return { done: true, winner: 1, why: 'seat 1 has the better rank' };
  return { done: true, winner: 2, why: 'equal ranks split' };
}

/** Every combination, so a test can walk the whole matrix rather than samples. */
export const ENDINGS = ['show', 'muck', 'beat', 'fold', null];
