// Plays one hand and narrates it, so you can watch the privacy model work
// without a browser.
//
// Three columns matter: what Alice knows, what Bob knows, and what the public
// chains know. The last one is the argument.
//
//   npx tsx src/game/watch.mjs

import { startHand, applyAction, resolveShowdown, view } from './engine.ts';
import { botAction, botShowdown } from './bot.ts';
import { rankOf, handName } from './rank.ts';

const RANKS = '23456789TJQKA';
const SUITS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const name = (id) => RANKS[id >> 2] + SUITS['shdc'[id & 3]];
const hand = (ids) => ids.map(name).join(' ');

const rule = (s = '') => console.log('  ' + '─'.repeat(66) + (s ? '\n  ' + s : ''));

let e = startHand(0, [200, 200]);

console.log('\n  NIGHTFOLD — one hand\n');
rule();
console.log(`  deck commitment  ${e.deckCommitment}`);
console.log(`  published before a single card was delivered\n`);
console.log(`  Alice holds      ${hand(e.hole[0])}      (only Alice can see this)`);
console.log(`  Bob holds        ${hand(e.hole[1])}      (only Bob can see this)`);
console.log(`  board            ${hand(e.board)}   (dealt face up street by street)`);
rule();

// ---- betting ----
let street = null;
let guard = 0;
while (!e.betting.done && guard++ < 60) {
  if (e.betting.street !== street) {
    street = e.betting.street;
    const up = { preflop: 0, flop: 3, turn: 4, river: 5 }[street];
    console.log(`\n  ${street.toUpperCase().padEnd(8)} ${up ? hand(e.board.slice(0, up)) : '(no board yet)'}`);
  }
  const who = e.betting.toAct === 0 ? 'Alice' : 'Bob  ';
  const before = e.betting.pot + e.betting.committed[0] + e.betting.committed[1];
  const action = botAction(e);
  const desc = action.amount ? `${action.type}s ${action.amount}` : `${action.type}s`;
  e = applyAction(e, action);
  const after = e.betting.pot + e.betting.committed[0] + e.betting.committed[1];
  console.log(`    ${who} ${desc.padEnd(12)} pot ${String(before).padStart(3)} → ${after}`);
}

// ---- showdown ----
console.log('');
rule();
if (e.phase === 'showdown') {
  console.log('  SHOWDOWN\n');
  console.log(`    Alice actually has  ${handName([...e.hole[0], ...e.board])}`);
  console.log(`    Bob actually has    ${handName([...e.hole[1], ...e.board])}\n`);

  const aliceWins = rankOf([...e.hole[0], ...e.board]) >= rankOf([...e.hole[1], ...e.board]);
  const aliceChoice = aliceWins ? 'show' : 'muck';
  console.log(`    Alice chooses to ${aliceChoice.toUpperCase()}`);
  e = resolveShowdown(e, 0, aliceChoice, rankOf);
  if (e.shown[1] === null) {
    const bobChoice = botShowdown(e, rankOf);
    console.log(`    Bob chooses to   ${bobChoice.toUpperCase()}`);
    e = resolveShowdown(e, 1, bobChoice, rankOf);
  } else {
    console.log(`    Bob never has to act — the muck conceded the pot`);
  }
} else {
  const folder = e.betting.folded === 0 ? 'Alice' : 'Bob';
  console.log(`  ${folder} FOLDED — no showdown, nobody shows anything`);
}

const winner = e.winner === 2 ? 'split pot' : e.winner === 0 ? 'Alice' : 'Bob';
console.log(`\n    winner: ${winner}    stacks: Alice ${e.betting.stacks[0]} · Bob ${e.betting.stacks[1]}`);

// ---- what leaked ----
console.log('');
rule('WHAT THE PUBLIC CHAINS NOW KNOW');
for (const ev of e.events) {
  const chain = ev.chain === 'midnight' ? 'MIDNIGHT' : ev.chain === 'base' ? 'BASE    ' : 'SOLANA  ';
  console.log(`    ${chain}  ${ev.label.padEnd(14)} ${ev.detail}`);
}

console.log('');
rule('WHAT THEY DO NOT KNOW');
const hidden = [];
for (const seat of [0, 1]) {
  if (e.shown[seat] !== 'show') {
    hidden.push(`${seat === 0 ? 'Alice' : 'Bob'}'s cards (${hand(e.hole[seat])}) — never published, on any chain, ever`);
  }
}
if (hidden.length === 0) console.log('    both players chose to show, so both hands are public');
else hidden.forEach((h) => console.log(`    ${h}`));

// prove it against the view the opponent actually gets
const fromBob = view(e, 1);
console.log(`\n    Bob's view of Alice's seat: ${fromBob.seats[0].hole ? hand(e.hole[0]) : 'no cards present'}`);
const fromAlice = view(e, 0);
console.log(`    Alice's view of Bob's seat: ${fromAlice.seats[1].hole ? hand(e.hole[1]) : 'no cards present'}`);
console.log('');
