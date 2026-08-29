// The muck, tested as a privacy property rather than described as one.
//
// A packed rank encodes category and every tiebreaker, so publishing it
// publishes the hand's composition. A player who does not want that has two
// options that reveal strictly less:
//
//   muckHand      — concede. Nothing at all reaches the ledger.
//   beatOpponent  — prove you beat what is already shown, without publishing
//                   your own rank. The threshold is read FROM THE LEDGER, so
//                   there is nothing for a caller to choose (NF-005).

import { Contract, ledger, pureCircuits } from '../contracts/managed/nightfold-tc/contract/index.js';
import { cards, showHand } from './witnesses.mjs';
import { newTable, call, rejects, dealHand, stage, emptyPS } from './testkit.mjs';

const hv = (h) => pureCircuits.handValue(h);
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};

const board = cards('Ah Kd 7c 3c 9c');
const ALICE = cards('As Kc');
const BOB = cards('Qc 5c');
const view = (t) => ledger(t.state);

// ---- 1. what a published rank actually gives away -------------------------

console.log('what a published rank leaks:\n');
{
  const best = stage(emptyPS(), ALICE, board, hv);
  const v = Number(hv(best.claimed));
  const cat = Math.floor(v / 759375);
  let rest = v - cat * 759375;
  const t = [];
  for (const p of [50625, 3375, 225, 15, 1]) { t.push(Math.floor(rest / p)); rest %= p; }
  const NAMES = ['high card','pair','two pair','trips','straight','flush','full house','quads','straight flush'];
  const R = '23456789TJQKA';
  console.log(`  alice holds ${showHand(ALICE)}, best five ${showHand(best.claimed)}`);
  console.log(`  published rank ${v} decodes to: ${NAMES[cat]}, ${t.map((x) => R[x]).join('')}`);
  check('a published rank does reveal the hand composition', cat === 2 && t[0] === 12 && t[1] === 12);
}

// ---- 2. muck: concede, reveal nothing --------------------------------------

console.log('\nmuck — concede without revealing:\n');
{
  const t = newTable(Contract);
  const h = dealHand(t, pureCircuits, { board, hole0: ALICE, hole1: BOB });

  call(t, 'revealHand', stage(h.seats[1], BOB, board, hv), h.handId, 1n, board);
  call(t, 'muckHand', h.seats[0], h.handId, 0n);

  const winner = call(t, 'settle', emptyPS(), h.handId);
  const l = view(t);
  const k0 = pureCircuits.seatKeyOf(h.handId, 0n);

  check('bob wins on the concession', winner === 1n);
  check('alice published NO rank', !l.shownRanks.member(k0));
  check('only one rank on the whole ledger', l.shownRanks.size() === 1n);
  check('alice is recorded as mucked', l.muckedSeats.member(k0));
  console.log(`    ledger holds: ${l.shownRanks.size()} rank, ${l.muckedSeats.size()} muck, ${l.hands.size()} hand`);
}

// ---- 3. beat: win without publishing your rank -----------------------------

console.log('\nbeat — take the pot without showing:\n');
{
  const t = newTable(Contract);
  const h = dealHand(t, pureCircuits, { board, hole0: ALICE, hole1: BOB });

  const aRank = call(t, 'revealHand', stage(h.seats[0], ALICE, board, hv), h.handId, 0n, board);
  call(t, 'beatOpponent', stage(h.seats[1], BOB, board, hv), h.handId, 1n, board);

  const winner = call(t, 'settle', emptyPS(), h.handId);
  const l = view(t);
  const k1 = pureCircuits.seatKeyOf(h.handId, 1n);

  check('bob wins on the beat', winner === 1n);
  check("bob's rank is NOT on the ledger", !l.shownRanks.member(k1));
  check('only the shown rank is public', l.shownRanks.size() === 1n);
  check('the beat itself is recorded', l.beatShown.member(k1));
  console.log(`    chain knows: "seat 1 beats ${aRank}" and nothing about how`);
}

{
  // A weaker hand cannot claim the beat, and cannot pick its own threshold.
  const t = newTable(Contract);
  const h = dealHand(t, pureCircuits, { board, hole0: BOB, hole1: ALICE });
  call(t, 'revealHand', stage(h.seats[0], BOB, board, hv), h.handId, 0n, board);
  check('a losing hand cannot claim the beat',
        rejects(() => call(t, 'beatOpponent', stage(h.seats[1], ALICE, board, hv), h.handId, 1n, board)));
}
{
  // And a beat requires the opponent to have shown at all.
  const t = newTable(Contract);
  const h = dealHand(t, pureCircuits, { board, hole0: ALICE, hole1: BOB });
  check('cannot beat an opponent who has not shown',
        rejects(() => call(t, 'beatOpponent', stage(h.seats[1], BOB, board, hv), h.handId, 1n, board)));
}

{
  // RA-009: if BOTH seats muck, neither is claiming the pot — so neither takes
  // it. The old ordering fell through `muck1 ? 0` and quietly handed it to
  // seat 0, while the comments and the UI both said split.
  const t2 = newTable(Contract);
  const h = dealHand(t2, pureCircuits, { board, hole0: ALICE, hole1: BOB });

  call(t2, 'muckHand', h.seats[0], h.handId, 0n);
  call(t2, 'muckHand', h.seats[1], h.handId, 1n);
  const winner = call(t2, 'settle', h.seats[0], h.handId);

  check('when both seats muck the pot splits', Number(winner) === 2,
        'nobody claims it, so nobody takes it');
}

console.log(failures === 0
  ? '\nmuck holds: a conceding player leaves nothing, a winner need not show'
  : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
