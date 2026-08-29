// Where the Solana half of the cage lives.
//
// DEVNET ONLY. Both keypairs derive from fixed strings committed to this repo,
// exactly like the anvil keys the EVM tests use. They are fixtures, not
// secrets, and anything they control is worthless by construction. A real
// deployment would use a program-derived address and keys nobody publishes.

import { createHash } from 'node:crypto';

/** Deterministic, and namespaced so it cannot collide with a well-known seed —
    the obvious ones (all 7s, all 9s) are already SPL token accounts on devnet
    and cannot even pay a fee. */
const seedOf = (label) => new Uint8Array(createHash('sha256').update(label).digest());

export const PLAYER_SEED = seedOf('nightfold:devnet:player:v1');
export const DEPOSIT_SEED = seedOf('nightfold:devnet:cage:v1');

/** Derived from DEPOSIT_SEED. Hard-coded so the watcher needs no key material
    at all — it only ever reads. */
export const DEPOSIT_ADDRESS = '5a4uv9n8hEcXyVZgKsxarct273ekkYE43W84i3rKSB9c';
export const PLAYER_ADDRESS = 'CKAWFC49YwmeQ2oe4X4GjKeXgKSzimH24yqc5wG7gK5a';

export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

/** CAIP-2 for Solana devnet. The cage hashes this into its uint256 chain id
    space, so the source string is recoverable from the Credited event. */
export const SOLANA_DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
