// The muck, tested as a privacy property rather than described as one.
//
// A packed rank encodes category and every tiebreaker, so publishing it
// publishes the hand's composition. A player who does not want that has two
// options that reveal strictly less:
//
//   muckHand      — concede. Nothing at all reaches the ledger.
//   beatShownRank — prove you beat what is already shown, without publishing
//                   your own rank.
//
// This test asserts what each path actually leaves behind.

import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../contracts/managed/nightfold-tc/contract/index.js';
import { witnesses, emptyPrivateState, stage, cards, showHand, bestFive } from './witnesses.mjs';
import { randomBytes } from 'node:crypto';

const ADDRESS = rt.sampleContractAddress();
const COIN_PK = '0'.repeat(64);
const evaluate5 = (h) => pureCircuits.handValue(h);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};

function newTable() {
  const contract = new Contract(witnesses);
  const init = contract.initialState(rt.createConstructorContext(emptyPrivateState(), COIN_PK));
  return { contract, state: init.currentContractState };
}
function call(t, name, ps, ...args) {
  const ctx = rt.createCircuitContext(ADDRESS, COIN_PK, t.state, ps);
  const res = t.contract.impureCircuits[name](ctx, ...args);
  t.state = res.context.currentQueryContext.state;
  return res.result;
}
const view = (t) => ledger(t.state);

const board = cards('Ah Kd 7c 3c 9c');
const ALICE = cards('As Kc');   // two pair, aces and kings
const BOB = cards('Qc 5c');     // club flush

// ---- 1. what a published rank actually gives away -------------------------

console.log('what a published rank leaks:\n');
{
  const best = bestFive(ALICE, board, evaluate5);
  const v = Number(evaluate5(best.hand));
  // decode: rank = cat*15^5 + t1*15^4 + t2*15^3 + t3*15^2 + t4*15 + t5
  const cat = Math.floor(v / 759375);
  let rest = v - cat * 759375;
  const t = [];
  for (const p of [50625, 3375, 225, 15, 1]) { t.push(Math.floor(rest / p)); rest %= p; }
  const NAMES = ['high card','pair','two pair','trips','straight','flush','full house','quads','straight flush'];
  const R = '23456789TJQKA';
  console.log(`  alice holds ${showHand(ALICE)}, best five ${showHand(best.hand)}`);
  console.log(`  published rank ${v} decodes to: ${NAMES[cat]}, ${t.map((x) => R[x]).join('')}`);
  check('a published rank does reveal the hand composition', cat === 2 && t[0] === 12 && t[1] === 12);
}

// ---- 2. muck: concede, reveal nothing --------------------------------------

console.log('\nmuck — concede without revealing:\n');
{
  const t = newTable();
  const handId = randomBytes(32);
  const a = { seat: 0n, ps: stage(emptyPrivateState(), { hole: ALICE }) };
  const b = { seat: 1n, ps: stage(emptyPrivateState(), { hole: BOB }) };
  call(t, 'commitDeal', a.ps, handId, a.seat);
  call(t, 'commitDeal', b.ps, handId, b.seat);

  // Bob shows. Alice mucks rather than publishing a rank.
  const bBest = bestFive(BOB, board, evaluate5);
  b.ps = stage(b.ps, { claimed: bBest.hand, pick: bBest.idx });
  call(t, 'revealHand', b.ps, handId, b.seat, board);
  call(t, 'muckHand', a.ps, handId, a.seat);

  const winner = call(t, 'settle', a.ps, handId);
  const l = view(t);
  const k0 = pureCircuits.seatKey(handId, 0n);

  check('bob wins on the concession', winner === 1n);
  check('alice published NO rank', !l.shownRanks.member(k0));
  check('only one rank on the whole ledger', l.shownRanks.size() === 1n);
  check('alice is recorded as mucked', l.muckedSeats.member(k0));
  console.log(`    ledger holds: ${l.shownRanks.size()} rank, ${l.muckedSeats.size()} muck, ${l.holeCommits.size()} commitments`);
}

// ---- 3. beat: win without publishing your rank -----------------------------

console.log('\nbeat — take the pot without showing:\n');
{
  const t = newTable();
  const handId = randomBytes(32);
  const a = { seat: 0n, ps: stage(emptyPrivateState(), { hole: ALICE }) };
  const b = { seat: 1n, ps: stage(emptyPrivateState(), { hole: BOB }) };
  call(t, 'commitDeal', a.ps, handId, a.seat);
  call(t, 'commitDeal', b.ps, handId, b.seat);

  // Alice shows first. Bob beats it without revealing what with.
  const aBest = bestFive(ALICE, board, evaluate5);
  a.ps = stage(a.ps, { claimed: aBest.hand, pick: aBest.idx });
  const aRank = call(t, 'revealHand', a.ps, handId, a.seat, board);

  const bBest = bestFive(BOB, board, evaluate5);
  b.ps = stage(b.ps, { claimed: bBest.hand, pick: bBest.idx });
  call(t, 'beatShownRank', b.ps, handId, b.seat, board, aRank);

  const winner = call(t, 'settle', a.ps, handId);
  const l = view(t);
  const k1 = pureCircuits.seatKey(handId, 1n);

  check('bob wins on the beat', winner === 1n);
  check("bob's rank is NOT on the ledger", !l.shownRanks.member(k1));
  check('only the shown rank is public', l.shownRanks.size() === 1n);
  check('the beat itself is recorded', l.beatShown.member(k1));
  console.log(`    chain knows: "seat 1 beats ${aRank}" and nothing about how`);

  // A weaker hand must not be able to claim the beat.
  const t2 = newTable();
  const h2 = randomBytes(32);
  const a2 = { ps: stage(emptyPrivateState(), { hole: BOB }) };
  const b2 = { ps: stage(emptyPrivateState(), { hole: ALICE }) };
  call(t2, 'commitDeal', a2.ps, h2, 0n);
  call(t2, 'commitDeal', b2.ps, h2, 1n);
  const strong = bestFive(BOB, board, evaluate5);
  a2.ps = stage(a2.ps, { claimed: strong.hand, pick: strong.idx });
  const strongRank = call(t2, 'revealHand', a2.ps, h2, 0n, board);
  const weak = bestFive(ALICE, board, evaluate5);
  b2.ps = stage(b2.ps, { claimed: weak.hand, pick: weak.idx });
  let threw = false;
  try { call(t2, 'beatShownRank', b2.ps, h2, 1n, board, strongRank); } catch { threw = true; }
  check('a losing hand cannot claim the beat', threw);
}

console.log(failures === 0
  ? '\nmuck holds: a conceding player leaves nothing, a winner need not show'
  : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
