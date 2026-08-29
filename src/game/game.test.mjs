// Betting and dealing — the two pieces that make Nightfold a game people play
// rather than a proof harness.

import { newHand, act, legalActions, payout, endedOnFold } from './betting.mjs';
import { commitSeed, deal, verifyDeal, shuffle, cardName } from './dealer.mjs';
import { randomBytes } from 'node:crypto';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};

// ---- betting ---------------------------------------------------------------

console.log('betting — heads-up no-limit\n');

{
  const h = newHand({ stackA: 200, stackB: 200, button: 0 });
  check('button posts the small blind', h.committed[0] === 1 && h.committed[1] === 2,
        `sb=${h.committed[0]} bb=${h.committed[1]}`);
  check('button acts first preflop', h.toAct === 0);
  check('facing the big blind you may fold, call or raise',
        legalActions(h).map((a) => a.type).join(',') === 'fold,call,raise');
}

{
  // fold ends it immediately and nobody shows
  let h = newHand({ button: 0 });
  h = act(h, { type: 'fold' });
  check('a fold ends the hand', h.done && endedOnFold(h));
  const p = payout(h);
  check('folding gives the pot to the other seat', p.stacks[1] === 201, `stacks ${p.stacks}`);
  check('a folded hand never reaches showdown', h.street === 'preflop');
}

{
  // limp, check, and walk the streets
  let h = newHand({ button: 0 });
  h = act(h, { type: 'call' });      // button completes
  check('after the button calls, the big blind acts', h.toAct === 1);
  h = act(h, { type: 'check' });     // bb checks
  check('both acted and matched moves to the flop', h.street === 'flop', h.street);
  check('pot collected from the street', h.pot === 4, `pot=${h.pot}`);
  check('non-button acts first postflop', h.toAct === 1);
}

{
  // raise sizing
  let h = newHand({ button: 0 });
  const raise = legalActions(h).find((a) => a.type === 'raise');
  check('min-raise is call plus the last raise', raise.min === 3, `min=${raise.min}`);
  let threw = false;
  try { act(h, { type: 'raise', amount: 2 }); } catch { threw = true; }
  check('an undersized raise is rejected', threw);
  h = act(h, { type: 'raise', amount: 7 });
  check('raising reopens the action for the opponent', h.toAct === 1 && h.acted.size === 1);
  check('you cannot check facing a raise',
        !legalActions(h).some((a) => a.type === 'check'));
}

{
  // all-in runs the board out with no further betting
  let h = newHand({ stackA: 20, stackB: 20, button: 0 });
  h = act(h, { type: 'raise', amount: 19 });  // button shoves
  h = act(h, { type: 'call' });               // bb calls
  check('an all-in call runs straight to showdown', h.done, `street=${h.street}`);
  check('all chips are in the pot', h.pot === 40, `pot=${h.pot}`);
  const p = payout(h, 1);
  check('showdown winner takes it', p.stacks[1] === 40, `stacks ${p.stacks}`);
}

{
  // a whole hand to the river
  let h = newHand({ button: 0 });
  h = act(h, { type: 'call' });
  h = act(h, { type: 'check' });
  for (const _ of ['flop', 'turn', 'river']) {
    h = act(h, { type: 'check' });
    h = act(h, { type: 'check' });
  }
  check('checking down reaches showdown', h.done, `street=${h.street}`);
  const split = payout(h, 2);
  check('a split pot divides the chips', split.stacks[0] === 200 && split.stacks[1] === 200,
        `stacks ${split.stacks}`);
}

// ---- dealing ---------------------------------------------------------------

console.log('\ndealing — committed, verifiable, seeded by both players\n');

{
  const a = commitSeed();
  const b = commitSeed();
  const d = deal(a.seed, b.seed, { a: a.commitment, b: b.commitment });

  const all = [...d.hole[0], ...d.hole[1], ...d.board];
  check('nine distinct cards are dealt', new Set(all).size === 9);
  check('every card is a real card', all.every((c) => c >= 0 && c < 52));
  console.log(`    seat 0 ${d.hole[0].map(cardName).join(' ')} · seat 1 ${d.hole[1].map(cardName).join(' ')} · board ${d.board.map(cardName).join(' ')}`);

  const v = verifyDeal(d, a.seed, b.seed);
  check('anyone can verify the deal afterwards', v.ok, v.reason ?? '');

  // a dealer that swaps a card is caught
  const tampered = { ...d, opening: { ...d.opening, deck: [...d.opening.deck] } };
  [tampered.opening.deck[0], tampered.opening.deck[40]] = [tampered.opening.deck[40], tampered.opening.deck[0]];
  check('a tampered deck fails verification', !verifyDeal(tampered, a.seed, b.seed).ok);

  // neither player can change their seed after seeing the other's
  let threw = false;
  try { deal(randomBytes(32), b.seed, { a: a.commitment, b: b.commitment }); } catch { threw = true; }
  check('a seed that breaks its commitment is rejected', threw);
}

{
  // the shuffle must actually be a permutation, and must depend on the seed
  const s1 = shuffle(Buffer.alloc(32, 1));
  const s2 = shuffle(Buffer.alloc(32, 2));
  check('shuffle is a permutation of 52 cards', new Set(s1).size === 52 && s1.length === 52);
  check('a different seed gives a different deck', s1.join() !== s2.join());
  check('the same seed is reproducible', shuffle(Buffer.alloc(32, 1)).join() === s1.join());

  // rough uniformity: no card should sit in position 0 far too often
  const counts = new Array(52).fill(0);
  for (let i = 0; i < 5200; i++) counts[shuffle(randomBytes(32))[0]]++;
  const max = Math.max(...counts), min = Math.min(...counts);
  check('first card is roughly uniform over 5200 deals', max < 220 && min > 40, `min=${min} max=${max}`);
}

console.log(failures === 0 ? '\nbetting and dealing: all checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
