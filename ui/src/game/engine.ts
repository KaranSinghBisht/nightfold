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

import { unitsForChips } from '../arcade/chains';
// @ts-expect-error — plain JS module shared with the test suites
import { newHand, act as bet, legalActions, payout, endedOnFold } from '@shared/game/betting.mjs';
// @ts-expect-error — plain JS module shared with the test suites
import { commitSeed, commitNonce, deal, cardName } from '@shared/game/dealer.mjs';
// @ts-expect-error — plain JS module shared with the test suites
import { resolve as resolveLifecycle } from '@shared/game/lifecycle.mjs';

import type { Card, Chain as ChainId, LedgerEvent, Seat, Phase } from './types';
import { seal, reveal } from './vault';

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
  /**
   * ONLY the local player's cards. The opponent's are sealed in ./vault and
   * never enter this object, so they cannot be read out of React state
   * (RA-015).
   */
  hole: [number[], number[]];
  /**
   * What each seat CHOSE to show. Null until they do.
   *
   * NFV-011: view() used to render the opponent from the deliberately-empty
   * hole slot, and toCard(undefined) coerced to card zero — so a shown hand
   * displayed as `2s 2s` while the rank published beside it came from the real
   * cards. Showing is a public act, so what was shown gets a public home
   * rather than being reconstructed from a private one.
   */
  revealedHole: [number[] | null, number[] | null];
  board: number[];
  /** which chain each seat bought its chips on */
  seatChains: [ChainId, ChainId];
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
export function startHand(
  button: 0 | 1 = 0,
  stacks: [number, number] = [200, 200],
  /** Which chain each seat's chips were bought on. */
  seatChains: [ChainId, ChainId] = ['base', 'solana'],
  /** False for a guest table: house chips, so there is no deposit to report. */
  funded = true,
): Engine {
  const a = commitSeed();
  const b = commitSeed();
  // The dealer is bound to its nonce before either seed is revealed, so no
  // party moves last with a free choice (RA-003).
  const n = commitNonce();
  const d = deal(a.seed, b.seed, { a: a.commitment, b: b.commitment, n: n.commitment }, n.nonce);

  const handId = '0x' + shortHex(d.deckCommitment, 12).replace('…', '');
  // The opponent's cards go into the vault, not into this object.
  seal(handId, d.hole[1]);

  return {
    handId,
    phase: 'dealt',
    hole: [d.hole[0], []],
    board: d.board,
    revealed: 0,
    betting: newHand({ stackA: stacks[0], stackB: stacks[1], button }),
    seatChains,
    shown: [null, null],
    revealedHole: [null, null],
    winner: null,
    deckCommitment: shortHex(d.deckCommitment, 16),
    events: [
      ...(funded
        ? ([
            { chain: 'base' as ChainId, label: 'buyIn', detail: `${unitsForChips('ETH', 1000)} → 1,000 chips · Alice` },
            { chain: 'solana' as ChainId, label: 'buyIn', detail: `${unitsForChips('SOL', 1000)} → 1,000 chips · Bob` },
          ] as LedgerEvent[])
        : ([
            { chain: 'house' as ChainId, label: 'guestSeat', detail: 'practice chips — nothing on any chain' },
          ] as LedgerEvent[])),
      { chain: 'midnight', label: 'commitDeal', detail: `seat 0 · ${shortHex(d.deckCommitment, 18)}`, opaque: true, masked: ['cards'] },
      { chain: 'midnight', label: 'commitDeal', detail: `seat 1 · ${shortHex(a.commitment, 18)}`, opaque: true, masked: ['cards'] },
    ],
  };
}

/** How many board cards are face up for a given street. */
const BOARD_FOR: Record<string, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** Apply a betting action and advance the hand. */
export function applyAction(e: Engine, action: Action): Engine {
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

  const revealedHole: [number[] | null, number[] | null] = [...e.revealedHole] as never;

  if (choice === 'show') {
    // Seat 1's cards live in the vault; showing is the one path that opens it.
    const own = seat === 0 ? e.hole[0] : (reveal(e.handId) ?? []);
    // The same cards the rank is computed from, so the two cannot disagree.
    revealedHole[seat] = own;
    const rank = rankOf([...own, ...e.board]);
    events.push({ chain: 'midnight', label: 'revealHand', detail: `seat ${seat} shows → rank ${rank}` });
  } else {
    events.push({ chain: 'midnight', label: 'muckHand', detail: `seat ${seat} concedes`, opaque: true, masked: ['cards', 'rank'] });
  }

  const next = { ...e, shown, revealedHole, events };

  // NFV-007: this used to settle the instant one seat mucked, while Compact
  // refused until both had acted — two lifecycles for one game. The rule now
  // lives in one place and every component asks it.
  const ranks: [number, number] = [
    shown[0] === 'show' ? rankOf([...(revealedHole[0] ?? e.hole[0]), ...e.board]) : 0,
    shown[1] === 'show' ? rankOf([...(revealedHole[1] ?? []), ...e.board]) : 0,
  ];
  const verdict = resolveLifecycle(shown, ranks);
  if (!verdict.done) return next;

  return settle({ ...next, phase: 'settled', winner: verdict.winner },
                verdict.winner === 2 && shown[0] === 'muck' ? 'uncontested' : undefined);
}

function settle(e: Engine, note?: string): Engine {
  const paid = payout(e.betting, e.winner ?? undefined);
  const pot = e.betting.pot + e.betting.committed[0] + e.betting.committed[1];
  const who = e.winner === 2 ? 'split' : `seat ${e.winner}`;

  const events: LedgerEvent[] = [
    ...e.events,
    {
      chain: 'midnight',
      label: 'settle',
      detail: `winner ${who}${note ? ` · ${note}` : ''} · attestation written`,
      opaque: true,
      ...(note === 'uncontested' ? { masked: ['both hands'] } : {}),
    },
  ];
  if (e.winner === 0 || e.winner === 2) events.push({ chain: 'base', label: 'payout', detail: `pot ${pot} → seat 0` });
  if (e.winner === 1 || e.winner === 2) events.push({ chain: 'solana', label: 'payout', detail: `pot ${pot} → seat 1` });

  return { ...e, betting: paid, events };
}

/**
 * The cards a seat may render: your own from the engine, an opponent's only
 * from what they published when they showed.
 */
function holeFor(e: Engine, i: 0 | 1, isYou: boolean): [Card, Card] | undefined {
  const ids = isYou ? e.hole[i] : e.revealedHole[i];
  if (!ids || ids.length < 2) return undefined;
  return [toCard(ids[0]), toCard(ids[1])];
}

/** What a given seat is allowed to see. The opponent's cards are ABSENT. */
export function view(e: Engine, you: 0 | 1): { seats: [Seat, Seat]; board: Card[] } {
  const names: [string, string] = ['Alice', 'Bob'];
  const chains = e.seatChains;

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
      hole: canSee ? holeFor(e, i, isYou) : undefined,
      status,
    } satisfies Seat;
  }) as [Seat, Seat];

  return { seats, board: e.board.slice(0, e.revealed).map(toCard) };
}

export { legalActions };
