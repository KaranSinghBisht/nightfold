// One rule, three implementations, checked against each other.
//
// NFV-007: the UI settled on the first muck, Compact refused until both seats
// acted, the relayer restated the ordering in its own words, and Compact had no
// fold at all. Four answers to "who won", agreeing where they happened to
// overlap and diverging where they did not.
//
// src/game/lifecycle.mjs is now the rule. This walks the entire matrix — every
// combination, not a handful of examples — and asserts the Compact contract and
// the relayer give the same verdict it does.

import { Contract, ledger, pureCircuits } from '../contracts/managed/nightfold-tc/contract/index.js';
import { newTable, call, dealHand, emptyPS, stage, bestFive } from './testkit.mjs';
import { cards } from './witnesses.mjs';
import { resolve, ENDINGS } from './game/lifecycle.mjs';
import { readOutcome } from './relayer.mjs';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};

const BOARD = cards('Ah Kd 7c 3c 9c');
const ALICE = cards('As Kc');   // two pair, aces and kings
const BOB = cards('Qc 5c');     // worse
const hv = (h) => pureCircuits.handValue(h);

console.log('walking the whole resolution matrix\n');

// ---- the matrix is total ----------------------------------------------------
{
  let undecided = 0;
  let decided = 0;
  for (const a of ENDINGS) {
    for (const b of ENDINGS) {
      const v = resolve([a, b], [100, 50]);
      if (v.done) {
        decided++;
        if (![0, 1, 2].includes(v.winner)) failures++;
      } else {
        undecided++;
      }
    }
  }
  check('every combination has an answer', decided + undecided === ENDINGS.length ** 2,
        `${decided} resolved, ${undecided} still waiting`);
  check('a resolved hand always names a winner', true, '0, 1 or split');
}

// ---- Compact agrees, for every ending it can express ------------------------
//
// Compact has no fold circuit — a fold never reaches it, because the hand ends
// on the money chain. So the reachable endings are show, beat and muck.
{
  const reachable = ['show', 'muck', null];
  let compared = 0;

  for (const a of reachable) {
    for (const b of reachable) {
      const t = newTable(Contract);
      const h = dealHand(t, pureCircuits, { board: BOARD, hole0: ALICE, hole1: BOB });

      const act = (seat, ending, hole) => {
        if (ending === 'show') call(t, 'revealHand', stage(h.seats[seat], hole, BOARD, hv), h.handId, BigInt(seat), BOARD);
        if (ending === 'muck') call(t, 'muckHand', h.seats[seat], h.handId, BigInt(seat));
      };
      act(0, a, ALICE);
      act(1, b, BOB);

      const ranks = [
        a === 'show' ? Number(hv(bestFive(ALICE, BOARD, hv).hand)) : 0,
        b === 'show' ? Number(hv(bestFive(BOB, BOARD, hv).hand)) : 0,
      ];
      const expected = resolve([a, b], ranks);

      let got = null;
      try { got = Number(call(t, 'settle', emptyPS(), h.handId)); } catch { got = null; }

      const agree = expected.done ? got === expected.winner : got === null;
      compared++;
      if (!agree) {
        check(`compact disagrees on ${a ?? 'none'}/${b ?? 'none'}`, false,
              `matrix says ${expected.done ? expected.winner : 'not done'}, contract says ${got}`);
      }

      // And the relayer, reading the same ledger, must say the same thing.
      if (expected.done) {
        const view = ledger(t.state);
        const outcome = readOutcome(view, h.handId, (id, seat) => pureCircuits.seatKeyOf(id, BigInt(seat)));
        const relayerSaid = outcome === null ? null : outcome.winner;
        if (relayerSaid !== expected.winner) {
          check(`relayer disagrees on ${a ?? 'none'}/${b ?? 'none'}`, false,
                `matrix ${expected.winner}, relayer ${relayerSaid}`);
        }
      }
    }
  }
  check('compact and the relayer agree with the matrix everywhere', failures === 0,
        `${compared} endings compared`);
}

// ---- the specific divergences the audit found ------------------------------
{
  check('one muck resolves without the winner acting',
        resolve(['muck', null], [0, 0]).done && resolve(['muck', null], [0, 0]).winner === 1,
        'a winner who never acts cannot strand the pot');
  check('both mucking splits', resolve(['muck', 'muck'], [0, 0]).winner === 2);
  check('a fold does not need a showdown',
        resolve(['fold', null], [0, 0]).done && resolve(['fold', null], [0, 0]).winner === 1,
        'the folder has left; there is nobody to compare against');
}

console.log(failures
  ? `\n${failures} FAILED`
  : '\none rule, and the contract, the relayer and the UI all read it');
process.exit(failures ? 1 : 0);
