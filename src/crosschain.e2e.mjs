// The whole thesis in one test.
//
// Alice and Bob stake real ETH on an EVM chain. They play a hand whose cards
// exist only as commitments on Midnight. Midnight proves who won without
// either player revealing a card. The relayer carries that outcome across, and
// the pot moves on the EVM chain.
//
// Nothing anywhere in the transcript says what anyone was holding.

import * as rt from '@midnight-ntwrk/compact-runtime';
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { randomBytes } from 'node:crypto';

import { Contract, ledger, pureCircuits } from '../contracts/managed/nightfold-tc/contract/index.js';
import { cards, showHand } from './witnesses.mjs';
import { newTable, call as mnCall, dealHand, stage, emptyPS } from './testkit.mjs';
import { compileEscrow } from './evm/compile.mjs';
import { readOutcome, relayHand, hex } from './relayer.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const STAKE = parseEther('0.05');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};

// ---- Midnight side ---------------------------------------------------------

const hv = (h) => pureCircuits.handValue(h);
const table = newTable(Contract);
const mnLedger = () => ledger(table.state);

// ---- EVM side --------------------------------------------------------------

const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  alice:    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  bob:      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  relayer:  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
};
const acct = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, privateKeyToAccount(v)]));
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (a) => createWalletClient({ account: acct[a], chain: foundry, transport: http(RPC) });
const wait = (hash) => pub.waitForTransactionReceipt({ hash });

const { abi, bytecode } = compileEscrow();
const { contractAddress: escrow } = await wait(
  await wallet('deployer').deployContract({ abi, bytecode, args: [acct.relayer.address] })
);
const jump = async (secs) => {
  for (const [method, params] of [['evm_increaseTime', [secs]], ['evm_mine', []]]) {
    await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  }
};

// ---- the hand --------------------------------------------------------------

const board = cards('Ah Kd 7c 3c 9c');
const ALICE = cards('As Kc');
const BOB = cards('Qc 5c');

// The dealer opens the hand on Midnight, committing deck, board and both
// seats' cards before anyone can act.
const hand = dealHand(table, pureCircuits, { board, hole0: ALICE, hole1: BOB });
const handIdBytes = hand.handId;
const handIdHex = hex(handIdBytes);

console.log('┌─ EVM (public) ────────────────  ┌─ MIDNIGHT (private) ──────────');
console.log(`│ escrow ${escrow.slice(0, 10)}…            │ contract deployed`);

// 1. money on the EVM chain
await wait(await wallet('alice').writeContract({ address: escrow, abi, functionName: 'openHand', args: [handIdHex], value: STAKE }));
await wait(await wallet('bob').writeContract({ address: escrow, abi, functionName: 'joinHand', args: [handIdHex], value: STAKE }));
console.log(`│ pot ${formatEther(STAKE * 2n)} ETH staked           │`);

check('pot is held by the escrow', (await pub.getBalance({ address: escrow })) === STAKE * 2n);

console.log(`│                                 │ deck + board + 2 hole commitments`);

// 2. showdown — Alice shows, Bob MUCKS. The private path, which the audit
//    (NF-007) showed the relayer could not previously carry at all.
const aliceRank = mnCall(table, 'revealHand', stage(hand.seats[0], ALICE, board, hv), handIdBytes, 0n, board);
mnCall(table, 'muckHand', hand.seats[1], handIdBytes, 1n);
mnCall(table, 'settle', emptyPS(), handIdBytes);
console.log(`│                                 │ seat 0 shows ${aliceRank}, seat 1 mucks`);
console.log(`│                                 │ settled, attestation written`);

// 4. the relayer carries it across
const outcome = readOutcome(mnLedger(), handIdBytes, (h, s) => pureCircuits.seatKeyOf(h, s));
check('relayer reads a settled outcome', outcome !== null);
check('relayer carries a MUCKED hand (NF-007)', outcome !== null && outcome.resolution[1] === 'muck');
check('relayer names seat 0 as winner', outcome.winner === 0);

const relayed = await relayHand(outcome, {
  base: async (id, winner) => {
    // The escrow recomputes the attestation itself; the relayer cannot name a
    // winner the hand did not produce (NF-006).
    const att = await pub.readContract({ address: escrow, abi, functionName: 'expectedAttestation', args: [id, winner] });
    return wait(await wallet('relayer').writeContract({
      address: escrow, abi, functionName: 'proposeSettlement', args: [id, winner, att],
    }));
  },
});
await jump(601);
const aliceBefore = await pub.getBalance({ address: acct.alice.address });
await wait(await wallet('bob').writeContract({ address: escrow, abi, functionName: 'finaliseSettlement', args: [handIdHex] }));
await wait(await wallet('alice').writeContract({ address: escrow, abi, functionName: 'withdraw', args: [] }));
const aliceAfter = await pub.getBalance({ address: acct.alice.address });

console.log(`│ pot → alice                     │`);
console.log('└─────────────────────────────────└───────────────────────────────\n');

check('pot paid out on the EVM chain', aliceAfter > aliceBefore, `alice +${formatEther(aliceAfter - aliceBefore)} ETH (less gas)`);
check('escrow emptied', (await pub.getBalance({ address: escrow })) === 0n);
check('relayed to every configured chain', relayed.length === 1 && relayed[0].chain === 'base');

// ---- what leaked? ----------------------------------------------------------

console.log('what the two public ledgers know:');
const l = mnLedger();
console.log('  midnight  :', l.hands.size(), 'hand,', l.shownRanks.size(),
            'rank,', l.muckedSeats.size(), 'muck,', l.settledHands.size(), 'settled');
console.log('  evm       : stake, pot, winner address, attestation');
console.log('  neither   : any card either player held\n');

// The transcript must not contain the losing hand anywhere.
// The MUCKING seat published nothing at all: no rank, no cards.
const k1 = pureCircuits.seatKeyOf(handIdBytes, 1n);
check("the mucking seat published no rank", !l.shownRanks.member(k1),
  `bob held ${showHand(BOB)} — never published`);
check('exactly one rank is public in the whole hand', l.shownRanks.size() === 1n);

console.log(failures === 0
  ? 'cross-chain hand complete: private on Midnight, paid on EVM'
  : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
