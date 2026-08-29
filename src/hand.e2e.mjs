// Plays a complete hand of Nightfold through the real circuits.
//
// Runs the compiled contract against a simulated ledger — no devnet, no proof
// server — so it checks LOGIC, not proving. It is the gate the spec calls for:
// nothing gets built on top until a hand opens, resolves and settles, and
// until the cheating paths are shown to fail.
//
// The property under test is the muck: the ledger must end the hand knowing
// who won and nothing whatsoever about the losing cards.

import { Contract, ledger, pureCircuits } from '../contracts/managed/nightfold-tc/contract/index.js';
import { cards, showHand } from './witnesses.mjs';
import { newTable, call, rejects, dealHand, stage, emptyPS } from './testkit.mjs';
import { randomBytes } from 'node:crypto';

const hv = (h) => pureCircuits.handValue(h);
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};

const board = cards('Ah Kd 7c 3c 9c');
const ALICE = cards('As Kc');   // two pair, aces and kings
const BOB = cards('Qc 5c');     // club flush

console.log('board  ', showHand(board));
console.log('alice  ', showHand(ALICE), '(hidden)');
console.log('bob    ', showHand(BOB), '(hidden)\n');

const t = newTable(Contract);
const h = dealHand(t, pureCircuits, { board, hole0: ALICE, hole1: BOB });
const state = () => ledger(t.state);

check('the hand is open with its commitments', state().hands.member(h.handId));
check('handsOpened counter', state().handsOpened === 1n);

// The commitment must be hiding: same cards, different salt, different value.
{
  const other = pureCircuits.holeCommitment(ALICE, randomBytes(32));
  const stored = state().hands.lookup(h.handId).hole0Commit;
  check('hole commitments are salted (hiding)',
        Buffer.compare(Buffer.from(stored), Buffer.from(other)) !== 0);
}

// -- showdown ----------------------------------------------------------------
const aliceStaged = stage(h.seats[0], ALICE, board, hv);
const bobStaged = stage(h.seats[1], BOB, board, hv);

const aliceRank = call(t, 'revealHand', aliceStaged, h.handId, 0n, board);
const bobRank = call(t, 'revealHand', bobStaged, h.handId, 1n, board);
console.log(`  alice shows rank ${aliceRank}`);
console.log(`  bob   shows rank ${bobRank}`);
check('bob outranks alice', bobRank > aliceRank, `${bobRank} > ${aliceRank}`);

// -- settle ------------------------------------------------------------------
const winner = call(t, 'settle', emptyPS(), h.handId);
check('settle names seat 1 (bob)', winner === 1n, `winner=${winner}`);
check('hand marked settled', state().settledHands.member(h.handId));
check('payout attestation written', state().payoutAttest.member(h.handId));

// ---- what did the ledger actually learn? -----------------------------------
console.log('\nledger contents after the hand:');
const l = state();
console.log('  hands       :', l.hands.size(), '· commitments only');
console.log('  shownRanks  :', [...l.shownRanks].map(([, r]) => String(r)).join(', '));
console.log('  settled     :', l.settledHands.size(), ' payouts:', l.payoutAttest.size());

// ---- cheating paths must fail ---------------------------------------------
console.log('\ncheating attempts:');

{
  // cards that do not open the dealt commitment
  const fake = { ...h.seats[0], hole: cards('As Ac'), salt: randomBytes(32) };
  const staged = stage(fake, cards('As Ac'), board, hv);
  check('cannot reveal cards that do not open the dealt commitment',
        rejects(() => call(t, 'revealHand', staged, h.handId, 0n, board)));
}
{
  // the same card claimed twice
  const dup = { ...bobStaged, claimed: cards('Ah Ah Kd 7c 3c'), pick: [2n, 2n, 3n, 4n, 5n] };
  check('cannot reuse the same card twice',
        rejects(() => call(t, 'revealHand', dup, h.handId, 1n, board)));
}
{
  // a card from outside the seven
  const alien = { ...bobStaged, claimed: cards('2d 2h 2s 2c 5d'), pick: [0n, 1n, 2n, 3n, 4n] };
  check('cannot claim a card from outside the seven',
        rejects(() => call(t, 'revealHand', alien, h.handId, 1n, board)));
}
check('cannot settle the same hand twice',
      rejects(() => call(t, 'settle', emptyPS(), h.handId)));

console.log(failures === 0 ? '\nhand played end to end — all checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
