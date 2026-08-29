// Heads-up no-limit Texas Hold'em betting.
//
// This runs on the money chain, not on Midnight — bets are amounts, not
// secrets, and a chain that settles in seconds should carry them. Midnight is
// touched only for the cards.
//
// Heads-up rules that differ from a full ring and are easy to get wrong:
//   - the button posts the SMALL blind, not the big one
//   - the button acts FIRST preflop and LAST on every later street
//   - a hand ends the moment one player folds; no cards are ever shown

export const SB = 1;
export const BB = 2;

export const STREETS = ['preflop', 'flop', 'turn', 'river'];

/**
 * @param {object} opts
 * @param {number} opts.stackA  seat 0 starting stack, in chips
 * @param {number} opts.stackB  seat 1 starting stack
 * @param {0|1}    opts.button  which seat has the button this hand
 */
export function newHand({ stackA = 200, stackB = 200, button = 0 } = {}) {
  const stacks = [stackA, stackB];
  const bb = button === 0 ? 1 : 0;

  // Blinds are posted before anyone acts. A short stack posts what it has.
  const sbAmt = Math.min(SB, stacks[button]);
  const bbAmt = Math.min(BB, stacks[bb]);
  stacks[button] -= sbAmt;
  stacks[bb] -= bbAmt;

  const committed = [0, 0];
  committed[button] = sbAmt;
  committed[bb] = bbAmt;

  return {
    street: 'preflop',
    button,
    stacks,
    /** chips put in on the CURRENT street */
    committed,
    /** chips already collected from earlier streets */
    pot: 0,
    /** seat to act */
    toAct: button, // button acts first preflop
    /** the size of the last full raise, for min-raise sizing */
    lastRaise: BB,
    /** seats that have acted since the last aggressive action */
    acted: new Set(),
    folded: null,
    allIn: false,
    done: false,
    log: [`blinds posted: seat ${button} ${sbAmt}, seat ${bb} ${bbAmt}`],
  };
}

const other = (s) => (s === 0 ? 1 : 0);

/** What the seat to act is allowed to do right now. */
export function legalActions(h) {
  if (h.done) return [];
  const me = h.toAct;
  const them = other(me);
  const toCall = h.committed[them] - h.committed[me];
  const acts = [];

  if (toCall > 0) {
    acts.push({ type: 'fold' });
    acts.push({ type: 'call', amount: Math.min(toCall, h.stacks[me]) });
  } else {
    acts.push({ type: 'check' });
  }

  // A raise needs chips beyond the call, and at least a min-raise unless it
  // puts the player all in.
  const maxExtra = h.stacks[me] - Math.min(toCall, h.stacks[me]);
  if (maxExtra > 0) {
    const min = Math.min(toCall + h.lastRaise, h.stacks[me]);
    acts.push({
      type: toCall > 0 ? 'raise' : 'bet',
      min,
      max: h.stacks[me],
    });
  }
  return acts;
}

/**
 * Apply an action. Returns a NEW state; the input is not mutated, so the UI can
 * keep a history and step backwards on camera.
 * @param {object} h
 * @param {{type: 'fold'|'check'|'call'|'bet'|'raise', amount?: number}} action
 */
export function act(h, action) {
  if (h.done) throw new Error('hand is over');
  const s = structuredClone(h);
  s.acted = new Set(h.acted);
  const me = s.toAct;
  const them = other(me);
  const toCall = s.committed[them] - s.committed[me];

  switch (action.type) {
    case 'fold':
      s.folded = me;
      s.done = true;
      s.log.push(`seat ${me} folds`);
      return collect(s);

    case 'check':
      if (toCall > 0) throw new Error('cannot check facing a bet');
      s.log.push(`seat ${me} checks`);
      break;

    case 'call': {
      const amt = Math.min(toCall, s.stacks[me]);
      s.stacks[me] -= amt;
      s.committed[me] += amt;
      s.log.push(`seat ${me} calls ${amt}`);
      break;
    }

    case 'bet':
    case 'raise': {
      const total = action.amount;
      if (total === undefined) throw new Error('bet/raise needs an amount');
      if (total > s.stacks[me]) throw new Error('not enough chips');
      const min = Math.min(toCall + s.lastRaise, s.stacks[me]);
      if (total < min) throw new Error(`min ${action.type} is ${min}`);

      s.stacks[me] -= total;
      s.committed[me] += total;
      s.lastRaise = s.committed[me] - s.committed[them];
      // An aggressive action reopens the betting for the opponent.
      s.acted = new Set();
      s.log.push(`seat ${me} ${action.type}s to ${s.committed[me]}`);
      break;
    }

    default:
      throw new Error(`unknown action ${action.type}`);
  }

  s.acted.add(me);
  if (s.stacks[me] === 0) s.allIn = true;

  const matched = s.committed[0] === s.committed[1];
  const bothActed = s.acted.has(0) && s.acted.has(1);

  if (matched && bothActed) return nextStreet(s);
  s.toAct = them;
  return s;
}

/** Move committed chips into the pot and clear the street. */
function collect(s) {
  s.pot += s.committed[0] + s.committed[1];
  s.committed = [0, 0];
  return s;
}

function nextStreet(s) {
  collect(s);
  const i = STREETS.indexOf(s.street);
  if (i === STREETS.length - 1) {
    s.done = true;
    s.log.push('showdown');
    return s;
  }
  s.street = STREETS[i + 1];
  s.acted = new Set();
  s.lastRaise = BB;
  // Postflop the button acts LAST, so the non-button acts first.
  s.toAct = other(s.button);
  // Nothing left to bet once someone is all in; run the board out.
  if (s.allIn || s.stacks[0] === 0 || s.stacks[1] === 0) {
    s.acted = new Set([0, 1]);
    return nextStreet(s);
  }
  s.log.push(`--- ${s.street} ---`);
  return s;
}

/**
 * Pay out a finished hand.
 * @param {object} h
 * @param {0|1|2|null} winner  seat, 2 for a split, or null to use the fold
 */
export function payout(h, winner = null) {
  if (!h.done) throw new Error('hand is not over');
  const s = structuredClone(h);
  const w = h.folded !== null ? other(h.folded) : winner;
  if (w === null) throw new Error('showdown needs a winner');

  if (w === 2) {
    const half = Math.floor(s.pot / 2);
    s.stacks[0] += half;
    s.stacks[1] += s.pot - half;
    s.log.push(`split pot of ${s.pot}`);
  } else {
    s.stacks[w] += s.pot;
    s.log.push(`seat ${w} wins ${s.pot}`);
  }
  s.pot = 0;
  return s;
}

/** Did the hand end without anyone having to show? */
export const endedOnFold = (h) => h.folded !== null;
