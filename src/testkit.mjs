// Shared harness: deal hands the way the hardened contract requires.
//
// After the 2026-08-29 audit the dealer must commit the deck, the board and
// BOTH seats\' hole cards before anyone can act, and each seat is bound to an
// authorisation key. Tests go through here so they exercise the real flow
// rather than a shortcut the contract no longer permits.

import * as rt from '@midnight-ntwrk/compact-runtime';
import { randomBytes } from 'node:crypto';

export const ADDRESS = rt.sampleContractAddress();
export const COIN_PK = '0'.repeat(64);

export const witnesses = {
  seatSecret: ({ privateState }) => [privateState, privateState.secret],
  holeCards: ({ privateState }) => [privateState, privateState.hole],
  holeSalt: ({ privateState }) => [privateState, privateState.salt],
  claimedHand: ({ privateState }) => [privateState, privateState.claimed],
  handPick: ({ privateState }) => [privateState, privateState.pick],
};

export const emptyPS = () => ({
  secret: randomBytes(32), hole: [], salt: randomBytes(32), claimed: [], pick: [],
});

export function newTable(Contract) {
  const contract = new Contract(witnesses);
  const init = contract.initialState(rt.createConstructorContext(emptyPS(), COIN_PK));
  return { contract, state: init.currentContractState };
}

export function call(t, name, ps, ...args) {
  const ctx = rt.createCircuitContext(ADDRESS, COIN_PK, t.state, ps);
  const res = t.contract.impureCircuits[name](ctx, ...args);
  t.state = res.context.currentQueryContext.state;
  return res.result;
}

export const rejects = (fn) => { try { fn(); return false; } catch { return true; } };

/** Best five of seven, chosen off-chain as a real client would. */
export function bestFive(hole, board, handValue) {
  const seven = [...hole, ...board];
  let best = null;
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++)
    for (let c = b + 1; c < 7; c++) for (let d = c + 1; d < 7; d++)
      for (let e = d + 1; e < 7; e++) {
        const idx = [a, b, c, d, e];
        const v = handValue(idx.map((i) => seven[i]));
        if (!best || v > best.value) best = { value: v, idx, hand: idx.map((i) => seven[i]) };
      }
  return best;
}

/** Open a hand with dealer commitments; returns the ids and both seat states. */
export function dealHand(t, pureCircuits, { board, hole0, hole1 }) {
  const handId = randomBytes(32);
  const s0 = { ...emptyPS(), hole: hole0, salt: randomBytes(32) };
  const s1 = { ...emptyPS(), hole: hole1, salt: randomBytes(32) };

  call(t, 'openHand', emptyPS(), handId,
    randomBytes(32),
    pureCircuits.boardCommitment(board),
    pureCircuits.holeCommitment(hole0, s0.salt),
    pureCircuits.holeCommitment(hole1, s1.salt),
    pureCircuits.seatAuthKey(s0.secret),
    pureCircuits.seatAuthKey(s1.secret));

  return { handId, board, seats: [s0, s1] };
}

/** Stage a seat\'s best claim for a showdown call. */
export const stage = (ps, hole, board, handValue) => {
  const best = bestFive(hole, board, handValue);
  return { ...ps, claimed: best.hand, pick: best.idx.map(BigInt) };
};
