// The scripted hand the demo walks through.
//
// Same cards as src/crosschain.e2e.mjs, so what the video shows is what the
// test proves: Alice makes two pair, Bob makes a club flush and takes it.
//
// Each step is a full HandState, so the UI is a pure function of a step index
// and there is no hidden mutable game state to get out of sync on camera.

import type { Card, HandState } from './types';

const c = (s: string): Card => ({ rank: s[0] as Card['rank'], suit: s[1] as Card['suit'] });

const HAND_ID = '0x7f3a91e4c2b8';
const ALICE_HOLE: [Card, Card] = [c('As'), c('Kc')];
const BOARD = [c('Ah'), c('Kd'), c('7c'), c('3c'), c('9c')];

const base = (): HandState => ({
  handId: HAND_ID,
  phase: 'waiting',
  board: [],
  pot: '0',
  you: 0,
  seats: [
    { name: 'Alice', chain: 'base',   stake: '0.05', status: 'empty' },
    { name: 'Bob',   chain: 'solana', stake: '1.2',  status: 'empty' },
  ],
  events: [],
});

/** Every beat of the demo, in order. */
export const STEPS: HandState[] = [
  // 0 — an empty table
  { ...base() },

  // 1 — both players buy in, from different chains
  {
    ...base(),
    phase: 'staked',
    pot: '0.10',
    seats: [
      { ...base().seats[0], status: 'seated' },
      { ...base().seats[1], status: 'seated' },
    ],
    events: [
      { chain: 'base', label: 'openHand', detail: '0.05 ETH escrowed · Alice' },
      { chain: 'solana', label: 'openHand', detail: '1.2 SOL escrowed · Bob' },
    ],
  },

  // 2 — cards dealt. Only YOUR hand is known to this client.
  {
    ...base(),
    phase: 'dealt',
    pot: '0.10',
    seats: [
      { ...base().seats[0], status: 'committed', hole: ALICE_HOLE },
      { ...base().seats[1], status: 'committed' },
    ],
    events: [
      { chain: 'midnight', label: 'commitDeal', detail: 'seat 0 → bdb14920f4b9fde0…', opaque: true },
      { chain: 'midnight', label: 'commitDeal', detail: 'seat 1 → dfb973edac3cbbec…', opaque: true },
    ],
  },

  // 3–5 — the board. Public by the rules of poker, so no privacy is spent here.
  ...(['flop', 'turn', 'river'] as const).map((phase, i) => ({
    ...base(),
    phase,
    pot: ['0.20', '0.34', '0.52'][i],
    board: BOARD.slice(0, [3, 4, 5][i]),
    seats: [
      { ...base().seats[0], status: 'committed' as const, hole: ALICE_HOLE },
      { ...base().seats[1], status: 'committed' as const },
    ] as HandState['seats'],
    events: [
      { chain: 'base' as const, label: 'bet', detail: `pot → ${['0.20', '0.34', '0.52'][i]} ETH` },
      { chain: 'solana' as const, label: 'call', detail: 'matched' },
    ],
  })),

  // 6 — showdown. Alice shows. Bob proves he beats it WITHOUT publishing his
  // own rank, so the chain learns the comparison and nothing about how.
  {
    ...base(),
    phase: 'showdown',
    pot: '0.52',
    board: BOARD,
    seats: [
      { ...base().seats[0], status: 'revealed', hole: ALICE_HOLE, rank: 2169397, handName: 'two pair, aces and kings' },
      { ...base().seats[1], status: 'beat' },
    ],
    events: [
      { chain: 'midnight', label: 'revealHand', detail: 'seat 0 shows → rank 2169397' },
      { chain: 'midnight', label: 'beatShownRank', detail: 'seat 1 beats 2169397 · rank not published', opaque: true },
    ],
  },

  // 7 — THE MUCK. Bob wins. Alice's cards go face down and stay there.
  {
    ...base(),
    phase: 'settled',
    pot: '0.52',
    board: BOARD,
    winner: 1,
    seats: [
      // Alice showed, so her rank is public — that was her choice.
      { ...base().seats[0], status: 'mucked', rank: 2169397, handName: 'two pair, aces and kings' },
      // Bob won without ever publishing a rank or a card.
      { ...base().seats[1], status: 'won' },
    ],
    events: [
      { chain: 'midnight', label: 'settle', detail: 'winner seat 1 · attestation 9c4e11a7…', opaque: true },
      { chain: 'solana', label: 'payout', detail: '1.2 SOL → Bob' },
      { chain: 'base', label: 'payout', detail: '0.05 ETH → Bob' },
    ],
  },
];

export const LAST_STEP = STEPS.length - 1;
