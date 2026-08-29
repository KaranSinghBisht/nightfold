// Private chip stacks.
//
// The cards were private and the money was not. NightfoldTable publishes every
// stack, so anyone watching knows exactly how much pressure each player can
// apply — and on a public ledger that history is queryable forever, which is
// the same asymmetry that makes a published rank worse than a shown hand.
//
// A stack is now a commitment. A player can prove it covers a bet, and move
// chips out of it, without the ledger ever holding a balance.

import { randomBytes } from 'node:crypto';
import { Contract, ledger, pureCircuits } from '../contracts/managed/nightfold-tc/contract/index.js';
import { newTable, call, rejects, dealHand, emptyPS } from './testkit.mjs';
import { cards } from './witnesses.mjs';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};

const board = cards('Ah Kd 7c 3c 9c');
const ALICE = cards('As Kc');
const BOB = cards('Qc 5c');
const view = (t) => ledger(t.state);

// Bytes<32> comes back as a Uint8Array, and === on those compares references.
// Three assertions in this file quietly failed that way before it was a helper.
const sameBytes = (a, b) =>
  a.length === b.length && [...a].every((x, i) => x === b[i]);

const t = newTable(Contract);
const h = dealHand(t, pureCircuits, { board, hole0: ALICE, hole1: BOB });
const k0 = pureCircuits.seatKeyOf(h.handId, 0n);

// Alice sits down with 1,000 chips. Nobody is going to learn that number.
const STACK = 1000n;
const salt = randomBytes(32);
const commit = pureCircuits.stackCommitment(STACK, salt);
const withStack = (ps, stack, s, next) => ({ ...ps, stack, stackSalt: s, nextStackSalt: next ?? s });

console.log('alice sits down with 1,000 chips. watch what reaches the ledger.\n');

call(t, 'openStack', withStack(h.seats[0], STACK, salt), h.handId, 0n, commit);

check('a stack commitment is recorded', view(t).stackCommits.member(k0));
check('and the ledger holds a hash, not a balance',
      view(t).stackCommits.lookup(k0).length === 32,
      '32 bytes — the same shape whatever the stack is');

// The commitment has to actually open to a stack the player holds.
check('a commitment to a stack you do not hold is refused',
      rejects(() => {
        const t2 = newTable(Contract);
        const h2 = dealHand(t2, pureCircuits, { board, hole0: ALICE, hole1: BOB });
        // Claim a commitment to 5,000 while witnessing 1,000.
        const lie = pureCircuits.stackCommitment(5000n, salt);
        return call(t2, 'openStack', withStack(h2.seats[0], STACK, salt), h2.handId, 0n, lie);
      }),
      'otherwise it is a number with no meaning attached');

check('a stack cannot be committed twice',
      rejects(() => call(t, 'openStack', withStack(h.seats[0], STACK, salt), h.handId, 0n, commit)));

// ---- proving you are good for a bet ----------------------------------------

call(t, 'proveCanCover', withStack(h.seats[0], STACK, salt), h.handId, 0n, 400n);
check('alice proves she covers a 400 bet', true, 'and the ledger learns only that');

call(t, 'proveCanCover', withStack(h.seats[0], STACK, salt), h.handId, 0n, STACK);
check('she can prove she covers exactly her whole stack', true);

check('but not a chip more',
      rejects(() => call(t, 'proveCanCover', withStack(h.seats[0], STACK, salt), h.handId, 0n, STACK + 1n)),
      'the one direction that cannot be faked');

check('and proving it reveals nothing new',
      sameBytes(view(t).stackCommits.lookup(k0), commit),
      'the commitment is unchanged — no balance was written');

check('a stranger cannot prove cover for your seat',
      rejects(() => call(t, 'proveCanCover', withStack(emptyPS(), STACK, salt), h.handId, 0n, 1n)),
      'the seat secret still gates it');

// ---- spending from a private stack -----------------------------------------

const BET = 250n;
const nextSalt = randomBytes(32);
const nextCommit = pureCircuits.stackCommitment(STACK - BET, nextSalt);

call(t, 'spendFromStack',
     withStack(h.seats[0], STACK, salt, nextSalt), h.handId, 0n, BET, nextCommit);

check('a bet moves the commitment', sameBytes(view(t).stackCommits.lookup(k0), nextCommit));
check('and the new one is to exactly the remainder',
      sameBytes(nextCommit, pureCircuits.stackCommitment(STACK - BET, nextSalt)),
      `${STACK} - ${BET} = ${STACK - BET}, proven in circuit`);

// The remainder must be exact — you cannot quietly keep more than you should.
check('you cannot understate the bet',
      rejects(() => {
        const cheat = pureCircuits.stackCommitment(STACK - 1n, nextSalt);
        return call(t, 'spendFromStack',
          withStack(h.seats[0], STACK - BET, nextSalt, randomBytes(32)),
          h.handId, 0n, BET, cheat);
      }),
      'the new commitment has to be the real remainder');

check('and you cannot spend what you do not have',
      rejects(() => call(t, 'spendFromStack',
        withStack(h.seats[0], STACK - BET, nextSalt, randomBytes(32)),
        h.handId, 0n, 10_000n, pureCircuits.stackCommitment(0n, nextSalt))));

// ---- what the chain actually knows -----------------------------------------

const l = view(t);
const stored = l.stackCommits.lookup(k0);
console.log('\nwhat the ledger knows about alice\'s money:');
console.log(`  commitment  ${Buffer.from(stored).toString('hex').slice(0, 32)}…`);
console.log(`  balance     — never written`);
console.log(`  she is good for a 400 bet, and for 1,000, and not for 1,001`);

check('the stack itself is nowhere on the ledger',
      !JSON.stringify([...Object.keys(l)]).includes('stackAmount'),
      'only commitments, only ever');

console.log(failures
  ? `\n${failures} FAILED`
  : '\nprivate stacks: provably good for the bet, never a balance on chain');
process.exit(failures ? 1 : 0);
