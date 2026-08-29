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
