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
import { witnesses, emptyPrivateState, stage, cards, showHand, bestFive } from './witnesses.mjs';
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

const ADDRESS = rt.sampleContractAddress();
const COIN_PK = '0'.repeat(64);
const contract = new Contract(witnesses);
const init = contract.initialState(rt.createConstructorContext(emptyPrivateState(), COIN_PK));
let mnState = init.currentContractState;

function mnCall(name, ps, ...args) {
  const ctx = rt.createCircuitContext(ADDRESS, COIN_PK, mnState, ps);
  const res = contract.impureCircuits[name](ctx, ...args);
  mnState = res.context.currentQueryContext.state;
  return res.result;
}
const mnLedger = () => ledger(mnState);

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

// ---- the hand --------------------------------------------------------------

const handIdBytes = randomBytes(32);
const handIdHex = hex(handIdBytes);

const board = cards('Ah Kd 7c 3c 9c');
const alice = { seat: 0n, hole: cards('As Kc'), ps: emptyPrivateState() };
const bob   = { seat: 1n, hole: cards('Qc 5c'), ps: emptyPrivateState() };

console.log('┌─ EVM (public) ────────────────  ┌─ MIDNIGHT (private) ──────────');
console.log(`│ escrow ${escrow.slice(0, 10)}…            │ contract deployed`);

// 1. money on the EVM chain
await wait(await wallet('alice').writeContract({ address: escrow, abi, functionName: 'openHand', args: [handIdHex], value: STAKE }));
await wait(await wallet('bob').writeContract({ address: escrow, abi, functionName: 'joinHand', args: [handIdHex], value: STAKE }));
console.log(`│ pot ${formatEther(STAKE * 2n)} ETH staked           │`);

check('pot is held by the escrow', (await pub.getBalance({ address: escrow })) === STAKE * 2n);

// 2. cards on Midnight
for (const p of [alice, bob]) {
  p.ps = stage(p.ps, { hole: p.hole });
  mnCall('commitDeal', p.ps, handIdBytes, p.seat);
}
console.log(`│                                 │ 2 hole commitments, 0 cards`);

// 3. showdown — ranks only
for (const p of [alice, bob]) {
  const best = bestFive(p.hole, board, (h) => pureCircuits.handValue(h));
  p.ps = stage(p.ps, { claimed: best.hand, pick: best.idx });
  p.rank = mnCall('revealHand', p.ps, handIdBytes, p.seat, board);
}
mnCall('settle', alice.ps, handIdBytes);
console.log(`│                                 │ ranks ${alice.rank} vs ${bob.rank}`);
console.log(`│                                 │ settled, attestation written`);

// 4. the relayer carries it across
const outcome = readOutcome(mnLedger(), handIdBytes, (h, s) => pureCircuits.seatKey(h, s));
check('relayer reads a settled outcome', outcome !== null);
check('relayer names seat 1', outcome.winner === 1);

const bobBefore = await pub.getBalance({ address: acct.bob.address });
const relayed = await relayHand(outcome, {
  base: async (id, winner, attestation) =>
    wait(await wallet('relayer').writeContract({
      address: escrow, abi, functionName: 'settle', args: [id, winner, attestation],
    })),
});
const bobAfter = await pub.getBalance({ address: acct.bob.address });

console.log(`│ pot → bob                       │`);
console.log('└─────────────────────────────────└───────────────────────────────\n');

check('pot paid out on the EVM chain', bobAfter - bobBefore === STAKE * 2n, `bob +${formatEther(bobAfter - bobBefore)} ETH`);
check('escrow emptied', (await pub.getBalance({ address: escrow })) === 0n);
check('attestation on the EVM chain matches Midnight',
  (await pub.readContract({ address: escrow, abi, functionName: 'hands', args: [handIdHex] }))[5]
    === hex(outcome.attestation));
check('relayed to every configured chain', relayed.length === 1 && relayed[0].chain === 'base');

// ---- what leaked? ----------------------------------------------------------

console.log('what the two public ledgers know:');
const l = mnLedger();
console.log('  midnight  :', l.holeCommits.size(), 'commitments,', l.shownRanks.size(),
            'ranks,', l.settledHands.size(), 'settled');
console.log('  evm       : stake, pot, winner address, attestation');
console.log('  neither   : any card either player held\n');

// The transcript must not contain the losing hand anywhere.
const transcript = JSON.stringify({
  midnight: {
    commits: [...l.holeCommits].map(([k, v]) => [hex(k), hex(v)]),
    ranks: [...l.shownRanks].map(([k, v]) => [hex(k), String(v)]),
    attest: [...l.payoutAttest].map(([k, v]) => [hex(k), hex(v)]),
  },
  evm: { escrow, winner: acct.bob.address, pot: String(STAKE * 2n) },
});

const loserIds = alice.hole.map((c) => Number(c.id));
check("loser's cards absent from the combined transcript",
  !loserIds.some((id) => new RegExp(`\\b${id}\\b`).test(transcript)),
  `alice held ${showHand(alice.hole)} — never published`);

console.log(failures === 0
  ? 'cross-chain hand complete: private on Midnight, paid on EVM'
  : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
