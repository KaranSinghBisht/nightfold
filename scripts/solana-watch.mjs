// Show the real Solana devnet deposits the cage would credit.
//
//     npm run solana:watch
//
// Reads the chain and nothing else — no keys, no signing, no local state. What
// it prints is what a watcher would sign.

import { readDeposits, chipsForLamports, LAMPORTS } from '../src/solana/watcher.mjs';
import { reachable } from '../src/solana/rpc.mjs';
import { DEPOSIT_ADDRESS, PLAYER_ADDRESS } from '../src/solana/config.mjs';
import { chipsPerToken } from '../src/pricing.mjs';

if (!(await reachable())) {
  console.error('solana devnet is unreachable from here');
  process.exit(1);
}

const rate = chipsPerToken('SOL');
console.log(`deposit address  ${DEPOSIT_ADDRESS}`);
console.log(`published rate   1 SOL = ${rate} chips\n`);

const deposits = await readDeposits(DEPOSIT_ADDRESS, { limit: 25 });

if (deposits.length === 0) {
  console.log('no deposits yet.\n');
  console.log('to make one:');
  console.log(`  1. fund ${PLAYER_ADDRESS}`);
  console.log('     at https://faucet.solana.com (devnet, 0.5 SOL is plenty)');
  console.log('  2. npm run solana:deposit -- 0.05 0xYourEvmAddress\n');
  process.exit(0);
}

console.log(`${deposits.length} deposit(s):\n`);
for (const d of deposits) {
  const sol = Number(d.lamports) / Number(LAMPORTS);
  console.log(`  ${sol.toFixed(4)} SOL -> ${chipsForLamports(d.lamports, rate)} chips`);
  console.log(`    from   ${d.from}`);
  console.log(`    credit ${d.player}`);
  console.log(`    tx     https://explorer.solana.com/tx/${d.signature}?cluster=devnet\n`);
}
