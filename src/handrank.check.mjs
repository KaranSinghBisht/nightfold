// Correctness check for the Nightfold hand evaluator.
//
// evaluate5 is a pure circuit, so it runs directly here with no proof server
// and no chain. If the packed values don't order real poker hands correctly,
// the muck is unsound — a losing player could prove a winning rank.

import { pureCircuits } from '../contracts/managed/handrank-tc/contract/index.js';

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

// "As" -> { id, rank, suit } with rank = 0..12, suit = 0..3, id = rank*4+suit
function card(str) {
  const rank = RANKS.indexOf(str[0]);
  const suit = SUITS.indexOf(str[1]);
  if (rank < 0 || suit < 0) throw new Error(`bad card: ${str}`);
  return { id: BigInt(rank * 4 + suit), rank: BigInt(rank), suit: BigInt(suit) };
}

const hand = (s) => s.split(' ').map(card);
const value = (s) => pureCircuits.evaluate5(hand(s));

// Hands in strictly ascending strength. Each must evaluate above the previous.
const ladder = [
  ['high card',            '2s 7d 9h Jc Kd'],
  ['high card, better kick','2s 7d 9h Qc Kd'],
  ['pair of twos',         '2s 2d 9h Jc Kd'],
  ['pair of kings',        'Ks Kd 2h 7c 9d'],
  ['two pair, 9s and 2s',  '2s 2d 9h 9c Kd'],
  ['two pair, kings up',   'Ks Kd 9h 9c 2d'],
  ['trip fives',           '5s 5d 5h Jc Kd'],
  ['wheel straight',       'As 2d 3h 4c 5d'],
  ['six-high straight',    '2s 3d 4h 5c 6d'],
  ['broadway straight',    'Ts Jd Qh Kc Ad'],
  ['flush',                '2s 5s 9s Js Ks'],
  ['full house, 5s o/ 9s', '5s 5d 5h 9c 9d'],
  ['full house, 9s o/ 5s', '9s 9d 9h 5c 5d'],
  ['quad fives',           '5s 5d 5h 5c 9d'],
  ['steel wheel',          'As 2s 3s 4s 5s'],
  ['royal flush',          'Ts Js Qs Ks As'],
];

let failures = 0;
console.log('rank ladder — each row must beat the one above\n');
let prev = -1n, prevName = null;
for (const [name, cards] of ladder) {
  const v = pureCircuits.evaluate5(hand(cards));
  const ok = v > prev;
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok ' : 'FAIL '}${name.padEnd(24)} ${cards.padEnd(16)} ${String(v).padStart(8)}` +
    (ok ? '' : `   <= ${prevName} (${prev})`)
  );
  prev = v; prevName = name;
}

// Ties and near-ties: the tiebreaker ordering has to be right too.
const pairs = [
  ['same hand, suits swapped are equal', '5s 5d 9h Jc Kd', '5h 5c 9s Jd Kh', '=='],
  ['ace kicker beats king kicker',       '5s 5d 9h Jc Ad', '5h 5c 9s Jd Kh', '>'],
  ['aces up beats kings up',             'As Ad 9h 9c 2d', 'Ks Kd 9h 9c 2d', '>'],
  ['higher two-pair second beats lower', 'As Ad Th Tc 2d', 'As Ad 9h 9c Kd', '>'],
  ['wheel loses to six-high',            'As 2d 3h 4c 5d', '2s 3d 4h 5c 6d', '<'],
  ['flush beats straight',               '2s 5s 9s Js Ks', 'Ts Jd Qh Kc Ad', '>'],
];

console.log('\ncomparisons\n');
for (const [name, a, b, op] of pairs) {
  const va = value(a), vb = value(b);
  const got = va === vb ? '==' : va > vb ? '>' : '<';
  const ok = got === op;
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '}${name.padEnd(36)} ${String(va).padStart(8)} ${got} ${String(vb).padEnd(8)} expected ${op}`);
}

console.log(failures === 0
  ? `\nall ${ladder.length + pairs.length} checks passed`
  : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
