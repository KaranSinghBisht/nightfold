// The relayer: carries a settled hand from Midnight to the money chains.
//
// It reads two things from Midnight's public ledger — the payout attestation
// and the two proven ranks — and reports the outcome to each escrow. It never
// sees a card, because nothing it reads contains one.
//
// What it can and cannot do is enforced on the escrow side (see
// evm/NightfoldEscrow.sol): it cannot take funds, cannot invent an outcome
// undetectably, and cannot trap a hand — only delay it.

/**
 * Read a settled hand's outcome from a Midnight ledger view.
 * Returns null if the hand has not settled yet, so this is safe to poll.
 */
export function readOutcome(ledgerView, handId, seatKeyOf) {
  if (!ledgerView.settledHands.member(handId)) return null;
  if (!ledgerView.payoutAttest.member(handId)) return null;

  const k0 = seatKeyOf(handId, 0n);
  const k1 = seatKeyOf(handId, 1n);
  if (!ledgerView.shownRanks.member(k0) || !ledgerView.shownRanks.member(k1)) return null;

  const r0 = ledgerView.shownRanks.lookup(k0);
  const r1 = ledgerView.shownRanks.lookup(k1);

  return {
    handId,
    attestation: ledgerView.payoutAttest.lookup(handId),
    ranks: [r0, r1],
    // 0 = seat 0, 1 = seat 1, 2 = split. Recomputed from the ranks the chain
    // published, so the relayer is transcribing rather than deciding.
    winner: r0 > r1 ? 0 : r1 > r0 ? 1 : 2,
  };
}

/** `0x`-prefixed hex for a Uint8Array, as viem wants it. */
export const hex = (bytes) =>
  '0x' + Buffer.from(bytes).toString('hex');

/**
 * Push a settled outcome to one escrow on one chain.
 * `settleFn(handIdHex, winner, attestationHex)` does the chain-specific write,
 * so the same relayer drives Base, Solana, or anything else added later.
 */
export async function relayTo(chainName, settleFn, outcome) {
  const handIdHex = hex(outcome.handId);
  const attestHex = hex(outcome.attestation);
  const receipt = await settleFn(handIdHex, outcome.winner, attestHex);
  return { chain: chainName, handId: handIdHex, winner: outcome.winner, receipt };
}

/**
 * Fan a single settled hand out to every configured chain.
 * One Midnight proof, N payouts — which is the cross-chain claim in one line.
 */
export async function relayHand(outcome, chains) {
  const results = [];
  for (const [name, settleFn] of Object.entries(chains)) {
    results.push(await relayTo(name, settleFn, outcome));
  }
  return results;
}
