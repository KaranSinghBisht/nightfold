import type { Card } from '../game/types';
import { EYE, CHEVRON, BAR, LOCK, HASH } from './PixelMark';

/** Every string the landing page says, in one place. */

export const TICKER = [
  'NO HOLE CARD EVER PUBLISHED',
  'MIDNIGHT COMPACT CIRCUITS',
  'SIX CHAINS · ONE CAGE',
  'ONE CHIP STACK',
];

export const ENDINGS = [
  {
    n: '1',
    name: 'SHOW',
    circuit: 'revealHand',
    glyph: EYE,
    text: 'Publish your rank and take the pot. What a winner normally does — and the only ending that tells anybody anything.',
    tone: '',
  },
  {
    n: '2',
    name: 'BEAT IT',
    circuit: 'beatOpponent',
    glyph: CHEVRON,
    text: 'Prove in circuit that you beat the rank already on the table, without publishing your own. You win; nobody learns with what.',
    tone: 'mid',
  },
  {
    n: '3',
    name: 'MUCK',
    circuit: 'muckHand',
    glyph: BAR,
    text: 'Concede face down. No cards, no rank, no proof of holdings. The hand settles and the ledger records nothing about your hand.',
    tone: 'best',
  },
];

export const PROTOCOL = [
  {
    name: 'COMMITTED DEAL',
    glyph: LOCK,
    text: 'The deck, the board and both hole hands are fixed as hashes before a single card moves. Nothing can be swapped once betting starts.',
  },
  {
    name: 'RANK-ONLY REVEAL',
    glyph: HASH,
    text: 'A winner publishes a packed rank, not cards. Five cards collapse into one number the contract can compare — and cannot deal from.',
  },
  {
    name: 'THE MUCK',
    glyph: BAR,
    text: 'A loser publishes nothing at all. Two of the three endings leave the ledger with no readable statement about a hand.',
  },
];

/* The cage ledger, at the rates the contracts actually use:
   1 ETH = 20,000 chips and 1 SOL = 100 chips (src/evm/cage.test.mjs). Two
   buy-ins of 1,000 make a 2,000 chip table; Alice leaves with 1,850 of it. */
export const CAGE_LEDGER = {
  in: [
    { chain: 'BASE', tone: 'base', from: '0.05 ETH', to: '1,000 CHIPS' },
    { chain: 'SOLANA', tone: 'sol', from: '10 SOL', to: '1,000 CHIPS' },
  ],
  table: '2,000 CHIPS IN PLAY',
  out: [{ chain: 'SOLANA', tone: 'sol', from: '1,850 CHIPS', to: '18.5 SOL' }],
  punchline: 'Alice bought in on Base. She left on Solana.',
};

export const LANES = [
  {
    name: 'SIX MONEY CHAINS',
    text: 'Cages hold the money — EVM natively, Bitcoin, Cardano, Solana and NEAR by attested provenance. Betting settles in seconds.',
  },
  {
    name: 'MIDNIGHT',
    text: 'Hole cards stay client-side as witnesses. Only commitments and, at most, a rank ever reach the ledger.',
  },
  {
    name: 'THE RELAYER',
    text: 'Carries a proven outcome between them. It can stall — it cannot take the money or name a winner the hand did not produce.',
  },
];

/* Both of these are permanent properties rather than a test count that goes
   stale the next time a suite grows. */
export const STATS = [
  { value: '6', label: 'MONEY CHAINS' },
  { value: '0', label: 'HOLE CARDS LEAKED' },
];

/** The frozen hand shown on the hero monitor. */
export const DEMO = {
  handId: 'LIVE_HAND_#0A4F',
  pot: 'POT: 1,240 CHIPS',
  board: [
    { rank: 'A', suit: 's' },
    { rank: 'K', suit: 'h' },
    { rank: 'T', suit: 'd' },
  ] as Card[],
  log: [
    { key: 'DEAL_COMMIT', value: 'VERIFIED', tone: 'ok' },
    { key: 'HOLE_CARDS', value: 'CLIENT-SIDE WITNESS', tone: 'ok' },
    { key: 'SHOWDOWN', value: 'beatOpponent', tone: 'phos' },
    { key: 'LOSING_HAND', value: '██████ NEVER PUBLISHED', tone: 'sealed' },
  ],
};
