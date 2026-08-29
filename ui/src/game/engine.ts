// Orchestrates one playable hand of Nightfold.
//
// Combines the dealer, the betting rules and the hand evaluator — the same
// modules the test suites verify — into something a person can sit down and
// play. The opponent is a simple bot so one player can drive a whole hand on
// camera without a second machine.
//
// The privacy model is enforced structurally: `view()` returns what a given
// seat is allowed to see, and the opponent's hole cards are simply absent from
// it unless they have chosen to show.

// @ts-expect-error — plain JS module shared with the test suites
import { newHand, act as bet, legalActions, payout, endedOnFold } from '@shared/game/betting.mjs';
// @ts-expect-error — plain JS module shared with the test suites
import { commitSeed, deal, cardName } from '@shared/game/dealer.mjs';

import type { Card, LedgerEvent, Seat, Phase } from './types';

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number };

export type Showdown = 'show' | 'muck';

/** card id 0..51 -> the UI's Card shape */
function toCard(id: number): Card {
  const s = cardName(id) as string;
  return { rank: s[0] as Card['rank'], suit: s[1] as Card['suit'] };
}

export interface Engine {
  handId: string;
  phase: Phase;
  /** both hands live here; `view()` decides what a seat may see */
  hole: [number[], number[]];
  board: number[];
  /** how many board cards are face up right now */
  revealed: number;
  betting: ReturnType<typeof newHand>;
  events: LedgerEvent[];
  shown: [Showdown | null, Showdown | null];
  winner: 0 | 1 | 2 | null;
  deckCommitment: string;
}

const shortHex = (b: Uint8Array, n = 16) =>
  Array.from(b.slice(0, n / 2)).map((x) => x.toString(16).padStart(2, '0')).join('') + '…';

/** Start a fresh hand: both players seed the deck, the dealer commits to it. */
export function startHand(button: 0 | 1 = 0, stacks: [number, number] = [200, 200]): Engine {
  const a = commitSeed();
  const b = commitSeed();
  const d = deal(a.seed, b.seed, { a: a.commitment, b: b.commitment });

  return {
    handId: '0x' + shortHex(d.deckCommitment, 12).replace('…', ''),
    phase: 'dealt',
    hole: [d.hole[0], d.hole[1]],
    board: d.board,
    revealed: 0,
    betting: newHand({ stackA: stacks[0], stackB: stacks[1], button }),
    shown: [null, null],
    winner: null,
    deckCommitment: shortHex(d.deckCommitment, 16),
    events: [
      { chain: 'base', label: 'openHand', detail: 'seat 0 buys in — 0.05 ETH' },
      { chain: 'solana', label: 'joinHand', detail: 'seat 1 buys in — 1.2 SOL' },
      { chain: 'midnight', label: 'commitDeal', detail: `seat 0 → ${shortHex(d.deckCommitment, 20)}`, opaque: true },
      { chain: 'midnight', label: 'commitDeal', detail: `seat 1 → ${shortHex(a.commitment, 20)}`, opaque: true },
    ],
  };
}

/** How many board cards are face up for a given street. */
const BOARD_FOR: Record<string, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** Apply a betting action and advance the hand. */
export function applyAction(e: Engine, action: Action): Engine {
  const before = e.betting.street;
  const betting = bet(e.betting, action);
  const events = [...e.events];

  const label = action.type === 'bet' || action.type === 'raise'
    ? `${action.type} ${action.amount}`
    : action.type;
  events.push({
    chain: e.betting.toAct === 0 ? 'base' : 'solana',
    label,
    detail: `seat ${e.betting.toAct} · pot ${betting.pot + betting.committed[0] + betting.committed[1]}`,
  });

  if (betting.street !== before && BOARD_FOR[betting.street] !== undefined) {
    events.push({
      chain: 'base',
      label: betting.street,
      detail: `${BOARD_FOR[betting.street] - BOARD_FOR[before]} card(s) dealt face up`,
    });
  }

  const next: Engine = {
    ...e,
    betting,
    revealed: BOARD_FOR[betting.street] ?? e.revealed,
    events,
  };

  if (betting.done) {
    if (endedOnFold(betting)) {
      // Nobody shows on a fold — that is the cheapest privacy in poker.
      const w = (betting.folded === 0 ? 1 : 0) as 0 | 1;
      return settle({ ...next, phase: 'settled', winner: w, revealed: BOARD_FOR[betting.street] ?? next.revealed });
    }
    return { ...next, phase: 'showdown', revealed: 5 };
  }
  return next;
}

/** At showdown a seat either shows a rank or mucks and reveals nothing. */
export function resolveShowdown(e: Engine, seat: 0 | 1, choice: Showdown, rankOf: (ids: number[]) => number): Engine {
  const shown: [Showdown | null, Showdown | null] = [...e.shown] as never;
  shown[seat] = choice;
  const events = [...e.events];

  if (choice === 'show') {
    const rank = rankOf([...e.hole[seat], ...e.board]);
    events.push({ chain: 'midnight', label: 'revealHand', detail: `seat ${seat} shows → rank ${rank}` });
  } else {
    events.push({ chain: 'midnight', label: 'muckHand', detail: `seat ${seat} concedes · nothing published`, opaque: true });
  }

  const next = { ...e, shown, events };

  // A muck is a concession. The opponent takes the pot and never has to show —
  // which is the cheapest privacy in poker and the whole point of the feature.
  if (choice === 'muck') {
    const other = (seat === 0 ? 1 : 0) as 0 | 1;
    if (shown[other] === null) {
      events.push({
        chain: 'midnight',
        label: 'settle',
        detail: `seat ${other} wins uncontested · neither hand published`,
        opaque: true,
      });
    }
    return settle({ ...next, phase: 'settled', winner: other });
  }

  if (shown[0] && shown[1]) return decide(next, rankOf);
  return next;
}

function decide(e: Engine, rankOf: (ids: number[]) => number): Engine {
  const [s0, s1] = e.shown;
  let winner: 0 | 1 | 2;

  if (s0 === 'muck' && s1 === 'muck') winner = 2;
  else if (s0 === 'muck') winner = 1;
  else if (s1 === 'muck') winner = 0;
  else {
    const r0 = rankOf([...e.hole[0], ...e.board]);
    const r1 = rankOf([...e.hole[1], ...e.board]);
    winner = r0 > r1 ? 0 : r1 > r0 ? 1 : 2;
  }
  return settle({ ...e, phase: 'settled', winner });
}

function settle(e: Engine): Engine {
  const paid = payout(e.betting, e.winner ?? undefined);
  const pot = e.betting.pot + e.betting.committed[0] + e.betting.committed[1];
  const who = e.winner === 2 ? 'split' : `seat ${e.winner}`;

  return {
    ...e,
    betting: paid,
    events: [
      ...e.events,
      { chain: 'midnight', label: 'settle', detail: `winner ${who} · attestation written`, opaque: true },
      { chain: 'base', label: 'payout', detail: e.winner === 0 || e.winner === 2 ? `pot ${pot} → seat 0` : 'no payout' },
      { chain: 'solana', label: 'payout', detail: e.winner === 1 || e.winner === 2 ? `pot ${pot} → seat 1` : 'no payout' },
    ],
  };
}

/** What a given seat is allowed to see. The opponent's cards are ABSENT. */
export function view(e: Engine, you: 0 | 1): { seats: [Seat, Seat]; board: Card[] } {
  const names: [string, string] = ['Alice', 'Bob'];
  const chains = ['base', 'solana'] as const;

  const seats = ([0, 1] as const).map((i) => {
    const isYou = i === you;
    const showedCards = e.shown[i] === 'show';
    const mucked = e.shown[i] === 'muck';
    const canSee = isYou || showedCards;

    const status: Seat['status'] =
      e.phase === 'settled' && e.winner === i ? 'won'
        : mucked ? 'mucked'
        : showedCards ? 'revealed'
        : e.phase === 'dealt' || e.betting.street ? 'committed'
        : 'seated';

    return {
      name: names[i],
      chain: chains[i],
      stake: String(e.betting.stacks[i]),
      hole: canSee ? ([toCard(e.hole[i][0]), toCard(e.hole[i][1])] as [Card, Card]) : undefined,
      status,
    } satisfies Seat;
  }) as [Seat, Seat];

  return { seats, board: e.board.slice(0, e.revealed).map(toCard) };
}

export { legalActions };
