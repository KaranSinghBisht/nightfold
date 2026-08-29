// A watcher that actually watches Solana.
//
// Until now "ATTESTED" meant the cage would accept a signed claim about a
// Solana deposit and nothing produced those claims from real chain data. This
// closes that: it reads Solana devnet, finds real transfers into the cage's
// deposit address, and turns each one into a credit the EVM cage can verify.
//
// WHY THERE IS NO SOLANA PROGRAM HERE. A native cage on Solana would be a Rust
// program that custodies the deposit, which is a different project. This is the
// other well-trodden shape: a deposit address, watchers that observe it, and a
// destination that requires a quorum of them to agree. It is weaker than
// custody — the watchers are trusted, and the README says so — but every part
// of it is real, which the previous version was not.
//
// HOW A PLAYER SAYS WHO THEY ARE. Solana has no idea what an EVM address is, so
// the depositor attaches one as an SPL memo. The watcher reads it, checks it is
// a well-formed address, and credits that account. A transfer without a valid
// memo is ignored rather than guessed at.

import { rpc, DEVNET } from './rpc.mjs';

/** Lamports per SOL. */
export const LAMPORTS = 1_000_000_000n;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read recent deposits into `depositAddress`.
 *
 * @param {string} depositAddress   the address players send SOL to
 * @param {{ url?: string, limit?: number, since?: string }} [opts]
 *        `since` is a signature already processed; scanning stops when it is
 *        reached, so a watcher can poll without re-reading history.
 * @returns {Promise<Array<{
 *   signature: string, slot: number, from: string, lamports: bigint,
 *   player: string, memo: string
 * }>>} oldest first, so credits are applied in the order they happened
 */
export async function readDeposits(depositAddress, opts = {}) {
  const { url = DEVNET, limit = 25, since } = opts;

  const sigs = await rpc('getSignaturesForAddress', [depositAddress, { limit }], { url });

  const wanted = [];
  for (const s of sigs ?? []) {
    if (since && s.signature === since) break;
    if (s.err) continue; // a failed transaction moved nothing
    wanted.push(s.signature);
  }

  const deposits = [];
  // Oldest first: getSignaturesForAddress returns newest first, and credits
  // should be applied in the order the chain accepted them.
  for (const signature of wanted.reverse()) {
    const tx = await rpc(
      'getTransaction',
      [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      { url },
    );
    const parsed = parseDeposit(tx, depositAddress);
    if (parsed) deposits.push({ signature, ...parsed });
  }
  return deposits;
}

/**
 * Pull one deposit out of a parsed transaction, or null if it is not one.
 *
 * Exported so it can be tested against recorded chain data without a network,
 * which is the difference between testing the parser and testing the weather.
 */
export function parseDeposit(tx, depositAddress) {
  if (!tx || tx.meta?.err) return null;

  const instructions = tx.transaction?.message?.instructions ?? [];

  // The transfer. Only system transfers INTO the deposit address count — a
  // token transfer or a transfer back out is not a buy-in.
  let lamports = 0n;
  let from = null;
  for (const ix of instructions) {
    if (ix.program !== 'system') continue;
    const info = ix.parsed?.info;
    if (ix.parsed?.type !== 'transfer' || !info) continue;
    if (info.destination !== depositAddress) continue;
    lamports += BigInt(info.lamports ?? 0);
    from ??= info.source ?? null;
  }
  if (lamports === 0n || !from) return null;

  // The memo says which EVM account to credit. Without one there is nobody to
  // credit, and guessing is how money ends up in the wrong hands.
  const memo = instructions.find((ix) => ix.program === 'spl-memo')?.parsed;
  const player = typeof memo === 'string' ? memo.trim() : '';
  if (!EVM_ADDRESS.test(player)) return null;

  return { slot: tx.slot ?? 0, from, lamports, player, memo: player };
}

/**
 * What a deposit is worth in chips, at the published rate.
 * Floors, like the cage does — dust stays with the cage rather than being
 * rounded into existence.
 */
export function chipsForLamports(lamports, chipsPerSol) {
  return (BigInt(lamports) * BigInt(chipsPerSol)) / LAMPORTS;
}

/**
 * Turn a deposit into the receipt the destination cage verifies.
 *
 * `sourceRef` is the Solana signature, so the credit names the exact
 * transaction that funded it and anyone can go and look at it.
 */
export function receiptFor(deposit, { srcChainId, srcCage, dstChainId, dstCage, chipsPerSol, nonce }) {
  return {
    srcChainId,
    srcCage,
    dstChainId,
    dstCage,
    player: deposit.player,
    chipAmount: chipsForLamports(deposit.lamports, chipsPerSol),
    nonce,
    // Not part of the signed digest — carried alongside so a credit can be
    // traced back to the Solana transaction that caused it.
    solanaSignature: deposit.signature,
  };
}
