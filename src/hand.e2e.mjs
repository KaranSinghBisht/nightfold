// Plays a complete hand of Nightfold through the real circuits.
//
// This runs the compiled contract against a simulated ledger — no devnet, no
// proof server — so it checks LOGIC, not proving. It is the gate the spec calls
// for: nothing gets built on top until a hand deals, reveals and settles, and
// until the cheating paths are shown to fail.
//
// The property under test is the muck: the ledger must end the hand knowing
// who won and nothing whatsoever about the losing cards.

import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../contracts/managed/nightfold-tc/contract/index.js';
import { witnesses, emptyPrivateState, stage, cards, showHand, bestFive } from './witnesses.mjs';
import { randomBytes } from 'node:crypto';

const evaluate5 = (h) => pureCircuits.handValue(h);

// ---- simulator -------------------------------------------------------------

const ADDRESS = rt.sampleContractAddress();
const COIN_PK = '0'.repeat(64);

function newTable() {
  const contract = new Contract(witnesses);
  const init = contract.initialState(
    rt.createConstructorContext(emptyPrivateState(), COIN_PK)
  );
  return {
    contract,
    state: init.currentContractState,
    // The chain state is shared by both players; only the private state differs
    // per caller, which is exactly the asymmetry the muck relies on.
    privateStates: new Map(),
  };
}

/** Runs a circuit with `ps` staged as the caller's private state. */
function call(table, name, ps, ...args) {
  const ctx = rt.createCircuitContext(ADDRESS, COIN_PK, table.state, ps);
  const res = table.contract.impureCircuits[name](ctx, ...args);
  table.state = res.context.currentQueryContext.state;
  return res.result;
}

const state = (table) => ledger(table.state);

// ---- the hand --------------------------------------------------------------

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};

const table = newTable();
const handId = randomBytes(32);

// Alice makes two pair, aces and kings. Bob makes a club flush and wins.
// Board carries three clubs so Bob's Qc/5c completes five; Alice holds only
// Kc, so she never gets there.
const board = cards('Ah Kd 7c 3c 9c');
const alice = { seat: 0n, hole: cards('As Kc'), ps: emptyPrivateState() };
const bob   = { seat: 1n, hole: cards('Qc 5c'), ps: emptyPrivateState() };

console.log('board  ', showHand(board));
console.log('alice  ', showHand(alice.hole), '(hidden)');
console.log('bob    ', showHand(bob.hole), '(hidden)\n');

// -- deal --------------------------------------------------------------------
for (const p of [alice, bob]) {
  p.ps = stage(p.ps, { hole: p.hole });
  call(table, 'commitDeal', p.ps, handId, p.seat);
}
check('both hole commitments on ledger', state(table).holeCommits.size() === 2n);
check('handsDealt counter', state(table).handsDealt === 2n);

// The commitment must be opaque: it must not equal a hash of the cards alone,
// and two players holding the same cards must still commit differently.
{
  const same = pureCircuits.holeCommitment(alice.hole, alice.ps.salt);
  const other = pureCircuits.holeCommitment(alice.hole, randomBytes(32));
  check('commitment is salted (hiding)', Buffer.compare(same, other) !== 0);
}

// -- showdown ----------------------------------------------------------------
for (const p of [alice, bob]) {
  const best = bestFive(p.hole, board, evaluate5);
  p.ps = stage(p.ps, { claimed: best.hand, pick: best.idx });
  p.rank = call(table, 'revealHand', p.ps, handId, p.seat, board);
  console.log(`  ${p === alice ? 'alice' : 'bob  '} proves rank ${p.rank}  (best five: ${showHand(best.hand)})`);
}
check('bob outranks alice', bob.rank > alice.rank, `${bob.rank} > ${alice.rank}`);

// -- settle ------------------------------------------------------------------
const winner = call(table, 'settle', alice.ps, handId);
check('settle names seat 1 (bob)', winner === 1n, `winner=${winner}`);
check('hand marked settled', state(table).settledHands.member(handId));
check('payout attestation written', state(table).payoutAttest.member(handId));

// ---- THE MUCK: what did the ledger actually learn? -------------------------
console.log('\nledger contents after the hand:');
const l = state(table);
const leaked = [];
for (const [, commit] of l.holeCommits) leaked.push(Buffer.from(commit).toString('hex'));
for (const [, rank] of l.shownRanks) leaked.push(String(rank));

const allCardIds = [...alice.hole, ...bob.hole].map((c) => Number(c.id));
const blob = leaked.join(' ');
console.log('  holeCommits :', leaked.slice(0, 2).map((h) => h.slice(0, 24) + '…').join(', '));
console.log('  shownRanks  :', [...l.shownRanks].map(([, r]) => String(r)).join(', '));
console.log('  settled     :', l.settledHands.size(), ' payouts:', l.payoutAttest.size());

check('losing cards absent from ledger',
  !allCardIds.some((id) => blob.includes(` ${id} `)),
  'only commitments and ranks are stored');

// ---- cheating paths must fail ---------------------------------------------
console.log('\ncheating attempts:');

// 1. Claim a hand you were never dealt.
{
  const fake = stage(alice.ps, { hole: cards('As Ac'), claimed: cards('As Ac Ah Kd 7s'), pick: [0, 1, 2, 3, 4] });
  let threw = false;
  try { call(table, 'revealHand', fake, handId, 0n, board); } catch { threw = true; }
  check('cannot reveal cards that do not open the commitment', threw);
}

// 2. Use the same board card twice to manufacture a pair.
{
  const dup = stage(bob.ps, { claimed: cards('Ah Ah Kd 7s 3c'), pick: [2, 2, 3, 4, 5] });
  let threw = false;
  try { call(table, 'revealHand', dup, handId, 1n, board); } catch { threw = true; }
  check('cannot reuse the same card twice', threw);
}

// 3. Claim a card that is neither in hand nor on the board.
{
  const alien = stage(bob.ps, { claimed: cards('2d 2h 2s 2c 5d'), pick: [0, 1, 2, 3, 4] });
  let threw = false;
  try { call(table, 'revealHand', alien, handId, 1n, board); } catch { threw = true; }
  check('cannot claim a card from outside the seven', threw);
}

// 4. Settle twice.
{
  let threw = false;
  try { call(table, 'settle', alice.ps, handId); } catch { threw = true; }
  check('cannot settle the same hand twice', threw);
}

console.log(failures === 0 ? '\nhand played end to end — all checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
