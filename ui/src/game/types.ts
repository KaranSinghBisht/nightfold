// The shape of a Nightfold hand as the table sees it.
//
// Note what a Seat does NOT have: the opponent's hole cards. The UI is built so
// that the losing hand is not merely hidden behind CSS — it is never in the
// component tree at all. If it isn't in the DOM, it can't leak.

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** Where a player's chips came from. Any chain the cage credits. */
export type Chain = 'base' | 'ethereum' | 'solana' | 'cardano' | 'bitcoin' | 'near';

export interface ChainInfo {
  id: Chain;
  label: string;
  ticker: string;
  color: string;
}

export const CHAINS: Record<Chain, ChainInfo> = {
  base:     { id: 'base',     label: 'Base Sepolia',  ticker: 'ETH',  color: '#0052FF' },
  ethereum: { id: 'ethereum', label: 'Ethereum',      ticker: 'ETH',  color: '#627EEA' },
  solana:   { id: 'solana',   label: 'Solana devnet', ticker: 'SOL',  color: '#9945FF' },
  cardano:  { id: 'cardano',  label: 'Cardano',       ticker: 'ADA',  color: '#3468D1' },
  bitcoin:  { id: 'bitcoin',  label: 'Bitcoin',       ticker: 'BTC',  color: '#F7931A' },
  near:     { id: 'near',     label: 'NEAR',          ticker: 'NEAR', color: '#00EC97' },
};

/** What we know about a seat right now. `hole` is present only for you. */
export interface Seat {
  name: string;
  chain: Chain;
  stake: string;
  /** Present only when these cards are yours to see, or after a voluntary show. */
  hole?: [Card, Card];
  /** Published at showdown. Everything else about the hand stays private. */
  rank?: number;
  handName?: string;
  status: 'empty' | 'seated' | 'committed' | 'revealed' | 'beat' | 'mucked' | 'won';
}

export type Phase =
  | 'waiting'     // seats open
  | 'staked'      // both buy-ins escrowed on their chains
  | 'dealt'       // hole cards committed on Midnight
  | 'flop' | 'turn' | 'river'
  | 'showdown'    // both ranks proven
  | 'settled';    // pot paid out cross-chain

export interface LedgerEvent {
  chain: 'midnight' | Chain;
  label: string;
  detail: string;
  /** true when the row shows an opaque value rather than a readable one. */
  opaque?: boolean;
  /**
   * Fields whose VALUES are hidden on this chain, rendered as redaction blocks.
   * The blocks are a constant glyph string — the real value is never in the
   * DOM, so there is nothing behind the mask to inspect.
   */
  masked?: string[];
}

export interface HandState {
  handId: string;
  phase: Phase;
  board: Card[];
  pot: string;
  seats: [Seat, Seat];
  /** Which seat the local viewer occupies. */
  you: 0 | 1;
  events: LedgerEvent[];
  winner?: 0 | 1 | 2;
}

export const PHASE_LABEL: Record<Phase, string> = {
  waiting:  'waiting for players',
  staked:   'buy-ins escrowed',
  dealt:    'hole cards committed',
  flop:     'flop',
  turn:     'turn',
  river:    'river',
  showdown: 'showdown',
  settled:  'settled',
};
