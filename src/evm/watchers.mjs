// Watchers: the independent signers a remote credit needs.
//
// The relayer used to be able to invent a deposit and credit itself. Now it can
// only CARRY a receipt somebody else signed. This module is the somebody else —
// in production these would be separate operators watching the source chain; in
// the tests they are distinct keys, which is enough to prove the destination
// contract actually checks the quorum.

import { privateKeyToAccount } from 'viem/accounts';
import { encodeAbiParameters, keccak256 } from 'viem';

/** Anvil keys 5..7. Distinct from deployer, players, relayer and oracle. */
export const WATCHER_KEYS = [
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
];

export const watchers = WATCHER_KEYS.map((k) => privateKeyToAccount(k));
export const watcherAddresses = watchers.map((w) => w.address);

const DIGEST_ABI = [
  { type: 'string' }, { type: 'uint256' }, { type: 'address' },
  { type: 'uint256' }, { type: 'address' }, { type: 'address' },
  { type: 'uint256' }, { type: 'uint256' },
];

/** The same bytes NightfoldCage.creditDigest produces. */
export function creditDigest(rc) {
  return keccak256(
    encodeAbiParameters(DIGEST_ABI, [
      'nf:remote-credit:v1',
      rc.srcChainId, rc.srcCage, rc.dstChainId, rc.dstCage, rc.player, rc.chipAmount, rc.nonce,
    ]),
  );
}

/**
 * Sign a receipt with `count` watchers.
 *
 * The contract requires signers in strictly ascending address order, which is
 * how it rejects the same watcher submitted N times as a quorum. Sorting here
 * is not a convenience — an unsorted set is meant to fail.
 */
export async function signCredit(rc, count = 2, signers = watchers) {
  const digest = creditDigest(rc);
  const picked = signers.slice(0, count);
  const signed = await Promise.all(
    picked.map(async (w) => ({
      address: w.address.toLowerCase(),
      sig: await w.signMessage({ message: { raw: digest } }),
    })),
  );
  signed.sort((a, b) => (a.address < b.address ? -1 : 1));
  return signed.map((s) => s.sig);
}

const SETTLE_ABI = [
  { type: 'string' }, { type: 'uint256' }, { type: 'address' },
  { type: 'bytes32' }, { type: 'uint8' },
];

/** The same bytes NightfoldEscrow.settleDigest produces. */
export function settleDigest({ chainId, escrow, handId, winner }) {
  return keccak256(
    encodeAbiParameters(SETTLE_ABI, ['nf:settle:v1', chainId, escrow, handId, winner]),
  );
}

/**
 * Sign a settlement.
 *
 * RA-002: the relayer used to compute the escrow's expected value itself and
 * hand it back, which is not verification of anything. These signatures come
 * from keys the relayer does not hold, which is the whole point.
 */
export async function signSettle(params, count = 2, signers = watchers) {
  const digest = settleDigest(params);
  const signed = await Promise.all(
    signers.slice(0, count).map(async (w) => ({
      address: w.address.toLowerCase(),
      sig: await w.signMessage({ message: { raw: digest } }),
    })),
  );
  signed.sort((a, b) => (a.address < b.address ? -1 : 1));
  return signed.map((s) => s.sig);
}

/** The same bytes NightfoldTable.settleDigest produces. */
export function tableSettleDigest({ chainId, table, handId, winner }) {
  return keccak256(
    encodeAbiParameters(SETTLE_ABI, ['nf:table-settle:v1', chainId, table, handId, winner]),
  );
}

/**
 * Sign a table settlement.
 *
 * NFT-002: NightfoldTable.settle took no signatures at all, so a stranger could
 * name the winner and the Midnight proof never entered into it. These come from
 * keys the relayer does not hold.
 */
export async function signTableSettle(params, count = 2, signers = watchers) {
  const digest = tableSettleDigest(params);
  const signed = await Promise.all(
    signers.slice(0, count).map(async (w) => ({
      address: w.address.toLowerCase(),
      sig: await w.signMessage({ message: { raw: digest } }),
    })),
  );
  signed.sort((a, b) => (a.address < b.address ? -1 : 1));
  return signed.map((s) => s.sig);
}
