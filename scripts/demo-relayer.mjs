// The relayer, running for real.
//
// Two jobs, and it can do neither on its own authority:
//
//   BoughtIn        a deposit landed in the cage -> credit the player chips
//   BurnedForRemote chips were burned for another chain -> pay out THERE
//
// The second leg is a real Solana devnet transfer. That is the cross-chain
// claim in its most checkable form: a signature anyone can open in an explorer
// and a balance that moved on a chain this process does not otherwise touch.
//
//   node scripts/demo-relayer.mjs

import { createWalletClient, createPublicClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { DEPOSIT_SEED, PLAYER_ADDRESS } from '../src/solana/config.mjs';
import { unitsForChips } from '../src/pricing.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const DEVNET = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
// public/ so the page can fetch it in dev AND from a built bundle; a file
// under src/ is only served by the dev server.
const FEED = 'ui/public/payouts.json';

const deployed = JSON.parse(readFileSync('ui/src/arcade/deployed.json', 'utf8'));
const RELAYER = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const relayer = privateKeyToAccount(RELAYER);
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = createWalletClient({ account: relayer, chain: foundry, transport: http(RPC) });
const wait = (hash) => pub.waitForTransactionReceipt({ hash });

const solana = new Connection(DEVNET, 'confirmed');
const treasury = Keypair.fromSeed(DEPOSIT_SEED);

const log = (tag, msg) => console.log(`  ${tag.padEnd(9)} ${msg}`);

/** The browser reads this to show the payout without needing a backend. */
const publishPayout = (entry) => {
  const all = existsSync(FEED) ? JSON.parse(readFileSync(FEED, 'utf8')) : [];
  all.unshift({ ...entry, at: new Date().toISOString() });
  writeFileSync(FEED, JSON.stringify(all.slice(0, 20), null, 2) + '\n');
};

/**
 * Credit a deposit the cage has already taken custody of.
 *
 * The relayer cannot invent one: creditLocal only works on a depositId the
 * cage recorded from a real payable buyIn, and the cage checks its own
 * solvency before the chips exist.
 */
async function creditDeposit(cageAddress, depositId, player, amount) {
  log('deposit', `${formatEther(amount)} ETH from ${player.slice(0, 10)}… (${depositId.slice(0, 12)}…)`);
  try {
    await wait(await wallet.writeContract({
      address: cageAddress, abi: deployed.abi, functionName: 'creditLocal', args: [depositId],
    }));
    const chips = await pub.readContract({
      address: cageAddress, abi: deployed.abi, functionName: 'chips', args: [player],
    });
    log('credited', `${player.slice(0, 10)}… now holds ${chips} chips`);
  } catch (err) {
    // A refused credit is the cage working. Say which guard, do not retry blindly.
    log('REFUSED', `the cage would not credit it — ${String(err.shortMessage ?? err.message).slice(0, 120)}`);
  }
}

/**
 * Pay a burn out on Solana devnet, for real.
 *
 * Chips are burned on the source cage before this runs, so the payout is not
 * new money — it is the same value arriving on a different chain, which is the
 * only thing that makes a cross-chain cage different from two unrelated ones.
 */
async function payOutOnSolana(nonce, player, chips) {
  const sol = unitsForChips('SOL', chips);
  const lamports = Math.round(sol * LAMPORTS_PER_SOL);
  log('burn', `${chips} chips burned by ${player.slice(0, 10)}… -> ${sol.toFixed(6)} SOL on devnet`);

  const balance = await solana.getBalance(treasury.publicKey);
  if (balance < lamports + 5000) {
    log('SHORT', `devnet cage holds ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, needs ` +
                 `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} — fund ${treasury.publicKey.toBase58()}`);
    return;
  }

  try {
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: treasury.publicKey,
      toPubkey: new PublicKey(PLAYER_ADDRESS),
      lamports,
    }));
    const signature = await sendAndConfirmTransaction(solana, tx, [treasury], { commitment: 'confirmed' });
    const url = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
    log('PAID', `${sol.toFixed(6)} SOL — ${signature.slice(0, 16)}…`);
    log('', url);
    publishPayout({ nonce: String(nonce), chips: String(chips), sol: sol.toFixed(6), signature, url });
  } catch (err) {
    log('FAILED', `devnet payout did not confirm — ${String(err.message).slice(0, 140)}`);
  }
}

console.log(`\nnightfold relayer\n  evm     ${RPC}\n  solana  ${DEVNET}` +
            `\n  cage    ${treasury.publicKey.toBase58()}` +
            `\n  paying  ${PLAYER_ADDRESS}\n`);
console.log(`  devnet cage balance: ${((await solana.getBalance(treasury.publicKey)) / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);
console.log('  watching both cages. deposit from the browser and this will credit it.\n');

for (const [name, address] of Object.entries(deployed.cages)) {
  pub.watchContractEvent({
    address, abi: deployed.abi, eventName: 'BoughtIn',
    onLogs: (logs) => logs.forEach((l) =>
      void creditDeposit(address, l.args.depositId, l.args.player, l.args.amount)),
  });
  pub.watchContractEvent({
    address, abi: deployed.abi, eventName: 'BurnedForRemote',
    onLogs: (logs) => logs.forEach((l) =>
      void payOutOnSolana(l.args.nonce, l.args.player, l.args.chips)),
  });
  log('watching', `${name} cage ${address}`);
}
