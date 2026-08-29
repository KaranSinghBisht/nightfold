// Make a real Solana devnet deposit into the Nightfold cage.
//
//     npm run solana:deposit -- 0.25 0xYourEvmAddress
//
// This is the player's half of the attested path: send SOL to the cage's
// deposit address with your EVM address as an SPL memo, and the watcher credits
// that account. Devnet only — the keypair below is derived from a fixed seed
// committed to this repo, so it controls nothing worth having.

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { DEPOSIT_ADDRESS, PLAYER_SEED, MEMO_PROGRAM } from '../src/solana/config.mjs';

const amount = Number(process.argv[2] ?? '0.05');
const evmAddress = process.argv[3] ?? '0x9F2cA1E4B6d3705e8AC0f2b21B4Dd7C0E1a94d81';

if (!Number.isFinite(amount) || amount <= 0 || amount > 5) {
  console.error('amount must be a positive number of SOL, at most 5');
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{40}$/.test(evmAddress)) {
  console.error('second argument must be an EVM address to credit');
  process.exit(1);
}

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const player = Keypair.fromSeed(PLAYER_SEED);
const lamports = Math.round(amount * LAMPORTS_PER_SOL);

const balance = await connection.getBalance(player.publicKey);
console.log(`player  ${player.publicKey.toBase58()}  ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
console.log(`deposit ${DEPOSIT_ADDRESS}`);
if (balance < lamports + 10_000) {
  console.error(`\nnot enough devnet SOL. fund ${player.publicKey.toBase58()} at https://faucet.solana.com`);
  process.exit(1);
}

const tx = new Transaction()
  .add(SystemProgram.transfer({
    fromPubkey: player.publicKey,
    toPubkey: new PublicKey(DEPOSIT_ADDRESS),
    lamports,
  }))
  // The memo is how a Solana transfer says which EVM account to credit.
  .add(new TransactionInstruction({
    keys: [],
    programId: new PublicKey(MEMO_PROGRAM),
    data: Buffer.from(evmAddress, 'utf8'),
  }));

console.log(`\nsending ${amount} SOL, memo ${evmAddress} …`);
const signature = await sendAndConfirmTransaction(connection, tx, [player], { commitment: 'confirmed' });

console.log(`\nconfirmed  ${signature}`);
console.log(`explorer   https://explorer.solana.com/tx/${signature}?cluster=devnet`);
