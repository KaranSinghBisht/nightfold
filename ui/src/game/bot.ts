// A simple opponent so one person can play a whole hand on camera.
//
// Deliberately not clever: it calls small bets, folds to large ones, and takes
// a free card when it can. Nightfold's claim is about privacy, not about poker
// AI, and a bot that plays plausibly is enough to make a hand watchable.

import type { Action, Engine } from './engine';
import { legalActions } from './engine';

interface Legal {
  type: string;
  amount?: number;
  min?: number;
  max?: number;
}

/** Choose an action for the seat to act. */
export function botAction(e: Engine): Action {
  const acts = legalActions(e.betting) as Legal[];
  const me = e.betting.toAct as 0 | 1;
  const them = me === 0 ? 1 : 0;
  const toCall = e.betting.committed[them] - e.betting.committed[me];
  const stack = e.betting.stacks[me];

  const can = (t: string) => acts.find((a) => a.type === t);

  // Free card: always take it.
  if (can('check')) {
    // Occasionally lead out on a later street to keep hands interesting.
    const raise = can('bet');
    if (raise && e.betting.street !== 'preflop' && Math.random() < 0.35) {
      return { type: 'bet', amount: Math.min(raise.min! * 2, Math.floor(stack / 4) || raise.min!) };
    }
    return { type: 'check' };
  }

  // Facing a bet. Fold to pressure — a bot that never folds makes every hand
  // reach showdown, which is neither realistic nor good for a demo.
  const potNow = e.betting.pot + e.betting.committed[0] + e.betting.committed[1];
  const price = toCall / Math.max(potNow, 1);
  if (price > 0.5 || toCall > stack * 0.4 || Math.random() < 0.18) return { type: 'fold' };
  if (can('call')) return { type: 'call' };
  return { type: 'fold' };
}

/** At showdown the bot shows if it thinks it won, and mucks otherwise. */
export function botShowdown(e: Engine, rankOf: (ids: number[]) => number): 'show' | 'muck' {
  const mine = rankOf([...e.hole[1], ...e.board]);
  const theirs = rankOf([...e.hole[0], ...e.board]);
  // Losing hands muck — which is exactly the behaviour Nightfold makes private.
  return mine >= theirs ? 'show' : 'muck';
}
