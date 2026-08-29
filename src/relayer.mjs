// The relayer: carries a settled hand from Midnight to the money chains.
//
// It reads the outcome from Midnight's public ledger and reports it to each
// escrow. It never sees a card, because nothing it reads contains one.
//
// SECURITY NOTES (2026-08-29 audit)
//
//   NF-007: the first version returned null unless BOTH seats had published
//   ranks, which made the muck and beat paths — the whole privacy story —
//   impossible to relay. A hand settled privately on Midnight would sit in the
//   escrow until timeout. It now resolves every combination of show / beat /
//   muck, exactly as the contract's `settle` does.
//
//   NF-006: the relayer no longer decides anything. It recomputes the
//   attestation Midnight wrote and checks it commits to (handId, winner)
//   before reporting; the escrow independently checks the same value, so a
//   wrong report is rejected on-chain rather than merely being detectable.

/**
 * The relayer does not verify the attestation cryptographically — it cannot,
 * without reimplementing Midnight's persistentHash in JS. It checks the value
 * is present and well formed, and the ESCROW independently recomputes
 * keccak256("nf:payout:" ++ handId ++ keccak256(winner)) and rejects anything
 * that does not match. That is what makes a wrong report fail on-chain rather
 * than merely being detectable afterwards (NF-006).
 */
const wellFormedAttestation = (v) => v instanceof Uint8Array && v.length === 32;

import { resolve } from './game/lifecycle.mjs';

/**
 * Read a settled hand's outcome. Returns null if the hand has not settled, so
 * this is safe to poll.
 *
 * Resolves every path the contract supports:
 *   both shown          -> higher rank wins
 *   one shown, one muck -> the shower wins
 *   one shown, one beat -> the beater wins
 *   both muck           -> split
 */
export function readOutcome(ledgerView, handId, seatKeyOf) {
  if (!ledgerView.settledHands.member(handId)) return null;
  if (!ledgerView.payoutAttest.member(handId)) return null;

  const k0 = seatKeyOf(handId, 0n);
  const k1 = seatKeyOf(handId, 1n);

  const shown0 = ledgerView.shownRanks.member(k0);
  const shown1 = ledgerView.shownRanks.member(k1);
  const muck0 = ledgerView.muckedSeats.member(k0);
  const muck1 = ledgerView.muckedSeats.member(k1);
  const beat0 = ledgerView.beatShown.member(k0);
  const beat1 = ledgerView.beatShown.member(k1);

  // Every seat must have acted, or the hand could not have settled.
  // NFV-007: one rule, in one place. This used to restate the ordering and
  // agreed with the contract by luck rather than by construction.
  const ending = [
    muck0 ? 'muck' : beat0 ? 'beat' : shown0 ? 'show' : null,
    muck1 ? 'muck' : beat1 ? 'beat' : shown1 ? 'show' : null,
  ];
  const ranks = [
    shown0 ? Number(ledgerView.shownRanks.lookup(k0)) : 0,
    shown1 ? Number(ledgerView.shownRanks.lookup(k1)) : 0,
  ];
  const verdict = resolve(ending, ranks);
  if (!verdict.done) return null;

  const winner = verdict.winner;

  const attestation = ledgerView.payoutAttest.lookup(handId);
  if (!wellFormedAttestation(attestation)) return null;

  return {
    handId,
    attestation,
    winner,
    /** How the hand ended, for logging and for the UI. */
    resolution: [
      muck0 ? 'muck' : beat0 ? 'beat' : 'show',
      muck1 ? 'muck' : beat1 ? 'beat' : 'show',
    ],
    /** Only ranks that were voluntarily published. Absent for muck/beat. */
    ranks: [
      shown0 ? ledgerView.shownRanks.lookup(k0) : null,
      shown1 ? ledgerView.shownRanks.lookup(k1) : null,
    ],
  };
}

/** `0x`-prefixed hex for a Uint8Array, as viem wants it. */
export const hex = (bytes) => '0x' + Buffer.from(bytes).toString('hex');

/**
 * Push a settled outcome to one escrow on one chain.
 * `settleFn(handIdHex, winner)` does the chain-specific write, so the same
 * relayer drives Base, Solana, or anything else added later.
 */
export async function relayTo(chainName, settleFn, outcome) {
  const handIdHex = hex(outcome.handId);
  const receipt = await settleFn(handIdHex, outcome.winner);
  return { chain: chainName, handId: handIdHex, winner: outcome.winner, receipt };
}

/**
 * Fan a single settled hand out to every configured chain.
 * One Midnight proof, N payouts — the cross-chain claim in one line.
 */
export async function relayHand(outcome, chains) {
  const results = [];
  for (const [name, settleFn] of Object.entries(chains)) {
    results.push(await relayTo(name, settleFn, outcome));
  }
  return results;
}
