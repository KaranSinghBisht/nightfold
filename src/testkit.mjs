// Shared harness: deal hands the way the hardened contract requires.
//
// After the 2026-08-29 audit the dealer must commit the deck, the board and
// BOTH seats\' hole cards before anyone can act, and each seat is bound to an
// authorisation key. Tests go through here so they exercise the real flow
// rather than a shortcut the contract no longer permits.

import * as rt from '@midnight-ntwrk/compact-runtime';
import { witnesses as sharedWitnesses } from './witnesses.mjs';
import { randomBytes } from 'node:crypto';

export const ADDRESS = rt.sampleContractAddress();
export const COIN_PK = '0'.repeat(64);

// One bundle for the whole repo — see src/witnesses.mjs (NFV-004).
export { witnesses } from './witnesses.mjs';

export const emptyPS = () => ({
  secret: randomBytes(32), hole: [], salt: randomBytes(32), boardSalt: randomBytes(32),
  claimed: [], pick: [], dealt: [], dealSalts: [],
});

export function newTable(Contract) {
  const contract = new Contract(sharedWitnesses);
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
  // The board commitment is salted now (RA-007), and every seat needs the same
  // salt to reopen it, so it lives on the hand rather than on a seat.
  const boardSalt = randomBytes(32);
  const s0 = { ...emptyPS(), hole: hole0, salt: randomBytes(32), boardSalt };
  const s1 = { ...emptyPS(), hole: hole1, salt: randomBytes(32), boardSalt };

  const deckCommit = randomBytes(32);
  const boardCommit = pureCircuits.boardCommitment(board, boardSalt);
  const hole0Commit = pureCircuits.holeCommitment(hole0, s0.salt);
  const hole1Commit = pureCircuits.holeCommitment(hole1, s1.salt);
  const seat0Key = pureCircuits.seatAuthKey(s0.secret);
  const seat1Key = pureCircuits.seatAuthKey(s1.secret);

  // RA-006: the id is derived from the setup, so it cannot be claimed with
  // different content.
  const handId = pureCircuits.handIdFor(
    deckCommit, boardCommit, hole0Commit, hole1Commit, seat0Key, seat1Key,
  );

  // openHand proves the deal is possible, so the dealer has to bring it
  // (NFV-003). Nine cards, in order: hole0, hole1, board.
  const dealerPS = {
    ...emptyPS(),
    dealt: [...hole0, ...hole1, ...board],
    dealSalts: [s0.salt, s1.salt, boardSalt],
  };

  call(t, 'openHand', dealerPS, handId,
    deckCommit, boardCommit, hole0Commit, hole1Commit, seat0Key, seat1Key);

  return { handId, board, boardSalt, seats: [s0, s1] };
}

/** Stage a seat\'s best claim for a showdown call. */
export const stage = (ps, hole, board, handValue) => {
  const best = bestFive(hole, board, handValue);
  return { ...ps, claimed: best.hand, pick: best.idx.map(BigInt) };
};
