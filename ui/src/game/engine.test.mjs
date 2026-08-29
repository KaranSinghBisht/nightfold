// Plays many complete hands through the engine the table actually uses.
//
// A demo that crashes on an unusual line of betting is worse than no demo, so
// this drives random legal actions through hundreds of hands and asserts the
// invariants that must hold every time — chips are conserved, a folded hand
// never reaches showdown, and a mucked hand never leaks a card.
//
// Run with:  node ui/src/game/engine.test.mjs

import { startHand, applyAction, resolveShowdown, view, legalActions } from './engine.ts';
import { botAction, botShowdown } from './bot.ts';
import { rankOf } from './rank.ts';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) { failures++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
};

const HANDS = Number(process.argv[2] ?? 400);
let folds = 0, showdowns = 0, mucks = 0, splits = 0;
const START = 200;

for (let i = 0; i < HANDS; i++) {
  let e = startHand(i % 2 === 0 ? 0 : 1, [START, START]);

  // Both hole cards must be distinct real cards, and distinct from the board.
  const all = [...e.hole[0], ...e.hole[1], ...e.board];
  check('9 distinct cards dealt', new Set(all).size === 9, `hand ${i}`);

  let guard = 0;
  while (!e.betting.done && guard++ < 60) {
    const acts = legalActions(e.betting);
    check('someone can always act', acts.length > 0, `hand ${i} street ${e.betting.street}`);
    e = applyAction(e, botAction(e));
  }
  check('hand terminates', e.betting.done, `hand ${i} after ${guard} actions`);

  if (e.phase === 'showdown') {
    showdowns++;
    // seat 0 mucks half the time so both paths get exercised
    const c0 = i % 2 === 0 ? 'muck' : 'show';
    e = resolveShowdown(e, 0, c0, rankOf);
    if (e.shown[1] === null) e = resolveShowdown(e, 1, botShowdown(e, rankOf), rankOf);
    if (c0 === 'muck') mucks++;
  } else {
    folds++;
  }

  check('hand settles', e.phase === 'settled', `hand ${i} phase ${e.phase}`);
  check('a winner is named', e.winner !== null, `hand ${i}`);
  if (e.winner === 2) splits++;

  // Chips are conserved: nothing is created or destroyed by a hand.
  const total = e.betting.stacks[0] + e.betting.stacks[1] + e.betting.pot;
  check('chips conserved', total === START * 2, `hand ${i}: ${total} != ${START * 2}`);

  // THE INVARIANT THAT MATTERS. You always see your OWN cards — that is not a
  // leak, you were dealt them. The claim is that nobody else does: the
  // opponent's cards must be absent from your view unless they chose to show.
  const v = view(e, 0);
  check("opponent's cards absent unless shown",
        e.shown[1] === 'show' ? v.seats[1].hole !== undefined : v.seats[1].hole === undefined,
        `hand ${i}, opponent ${e.shown[1]}`);
  // And symmetrically, from the opponent's seat.
  const v1 = view(e, 1);
  check('your cards absent from their view unless you showed',
        e.shown[0] === 'show' ? v1.seats[0].hole !== undefined : v1.seats[0].hole === undefined,
        `hand ${i}, you ${e.shown[0]}`);
}

console.log(`\n  ${HANDS} hands played`);
console.log(`    ended on a fold : ${folds}`);
console.log(`    reached showdown: ${showdowns}`);
console.log(`    hands mucked    : ${mucks}`);
console.log(`    split pots      : ${splits}`);
console.log(failures === 0
  ? '\n  engine: all invariants held'
  : `\n  ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
