// Move devnet SOL from the demo player into the devnet cage, so the cage can
// actually pay a realistic win out.
//
// Both keypairs derive from strings committed to this repo — fixtures, not
// secrets, on devnet only.
//
//   node scripts/solana-fund-cage.mjs [SOL]

import {
  Connection, Keypair, SystemProgram, Transaction,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { PLAYER_SEED, DEPOSIT_SEED } from '../src/solana/config.mjs';

const amount = Number(process.argv[2] ?? 3);
if (!Number.isFinite(amount) || amount <= 0) {
  console.error('usage: node scripts/solana-fund-cage.mjs [SOL]');
  process.exit(1);
}

const connection = new Connection(process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com', 'confirmed');
const player = Keypair.fromSeed(PLAYER_SEED);
const cage = Keypair.fromSeed(DEPOSIT_SEED);
const sol = (lamports) => (lamports / LAMPORTS_PER_SOL).toFixed(4);

const before = await connection.getBalance(player.publicKey);
console.log(`player ${player.publicKey.toBase58()}  ${sol(before)} SOL`);
console.log(`cage   ${cage.publicKey.toBase58()}  ${sol(await connection.getBalance(cage.publicKey))} SOL`);

const lamports = Math.round(amount * LAMPORTS_PER_SOL);
if (before < lamports + 5000) {
  console.error(`\nplayer holds ${sol(before)} SOL, cannot send ${amount}`);
  process.exit(1);
}

const tx = new Transaction().add(SystemProgram.transfer({
  fromPubkey: player.publicKey, toPubkey: cage.publicKey, lamports,
}));
const signature = await sendAndConfirmTransaction(connection, tx, [player], { commitment: 'confirmed' });

console.log(`\nsent ${amount} SOL`);
console.log(`  ${signature}`);
console.log(`  https://explorer.solana.com/tx/${signature}?cluster=devnet`);
console.log(`\ncage now holds ${sol(await connection.getBalance(cage.publicKey))} SOL`);
