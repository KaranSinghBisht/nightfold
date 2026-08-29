// Private inputs for the Nightfold circuits.
//
// Everything here lives client-side and never reaches the ledger. The witness
// functions read from a per-player private state object that the API stages
// before each circuit call — the same staging pattern NightPool used, because
// a witness cannot take arguments.

import { randomBytes } from 'node:crypto';

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

/** "As" -> { id, rank, suit } as the circuit expects (bigints). */
export function card(str) {
  const rank = RANKS.indexOf(str[0]);
  const suit = SUITS.indexOf(str[1]);
  if (rank < 0 || suit < 0) throw new Error(`bad card: ${str}`);
  return { id: BigInt(rank * 4 + suit), rank: BigInt(rank), suit: BigInt(suit) };
}

export const cards = (s) => s.split(/\s+/).filter(Boolean).map(card);
export const showCard = (c) => RANKS[Number(c.rank)] + SUITS[Number(c.suit)];
export const showHand = (cs) => cs.map(showCard).join(' ');

/** Fresh private state for one player. */
export function emptyPrivateState() {
  return {
    secret: randomBytes(32), hole: [], salt: randomBytes(32), boardSalt: randomBytes(32),
    claimed: [], pick: [], dealt: [], dealSalts: [],
    stack: 0n, stackSalt: randomBytes(32), nextStackSalt: randomBytes(32),
  };
}

/**
 * Stage the inputs for the next circuit call.
 * `hole` and `claimed` are card arrays; `pick` is where each claimed card sits
 * among the player's seven (hole[0], hole[1], board[0..4]).
 */
export function stage(ps, { hole, salt, claimed, pick }) {
  return {
    ...ps,
    ...(hole !== undefined ? { hole } : {}),
    ...(salt !== undefined ? { salt } : {}),
    ...(claimed !== undefined ? { claimed } : {}),
    ...(pick !== undefined ? { pick: pick.map(BigInt) } : {}),
  };
}

/**
 * The witness bundle. There is exactly one, and everything uses it.
 *
 * NFV-004: there used to be three — the simulator's, the real-proof harness's,
 * and one CI built for itself. The harness's omitted seatSecret and boardSalt,
 * so `proof:real` could not even construct the contract, and CI could not
 * notice because it was checking a different object. A bundle that is copied is
 * a bundle that drifts.
 */
export const witnesses = {
  seatSecret: ({ privateState }) => [privateState, privateState.secret],
  holeCards: ({ privateState }) => [privateState, privateState.hole],
  holeSalt: ({ privateState }) => [privateState, privateState.salt],
  boardSalt: ({ privateState }) => [privateState, privateState.boardSalt],
  claimedHand: ({ privateState }) => [privateState, privateState.claimed],
  handPick: ({ privateState }) => [privateState, privateState.pick],
  dealtCards: ({ privateState }) => [privateState, privateState.dealt ?? []],
  dealSalts: ({ privateState }) => [privateState, privateState.dealSalts ?? []],
  stackAmount: ({ privateState }) => [privateState, privateState.stack ?? 0n],
  stackSalt: ({ privateState }) => [privateState, privateState.stackSalt],
  nextStackSalt: ({ privateState }) => [privateState, privateState.nextStackSalt],
};

/** Every witness the contract requires, for anyone wanting to check coverage. */
export const WITNESS_NAMES = Object.keys(witnesses);

/**
 * Pick the best five of seven by brute force, off-chain.
 *
 * This runs on the player's machine, not in the circuit — which is the whole
 * point of the design. The circuit only verifies the five cards named here are
 * really the player's and really rank what they claim; it never has to search
 * all 21 combinations itself.
 */
export function bestFive(hole, board, evaluate5) {
  const seven = [...hole, ...board];
  let best = null;
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      for (let c = b + 1; c < 7; c++)
        for (let d = c + 1; d < 7; d++)
          for (let e = d + 1; e < 7; e++) {
            const idx = [a, b, c, d, e];
            const hand = idx.map((i) => seven[i]);
            const v = evaluate5(hand);
            if (best === null || v > best.value) best = { value: v, idx, hand };
          }
  return best;
}
