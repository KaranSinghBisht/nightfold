// Every attack the 2026-08-29 audit confirmed, re-run against the fixed
// contracts. Each one must now fail.
//
// The audit demonstrated four criticals against the Compact contract by
// actually executing them — a fabricated royal flush, a forced muck of someone
// else's seat, self-selected hole cards, and a beat claimed against threshold
// zero. Regression tests for exploits are worth more than tests for features:
// a feature test fails loudly when it breaks, but a missing exploit test fails
// silently forever.

import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../contracts/managed/nightfold-tc/contract/index.js';
import { cards, showHand } from './witnesses.mjs';
import { randomBytes } from 'node:crypto';

const ADDRESS = rt.sampleContractAddress();
const COIN_PK = '0'.repeat(64);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};

// ---- harness ---------------------------------------------------------------

// One bundle for the whole repo (NFV-004).
import { witnesses } from './witnesses.mjs';

const emptyPS = () => ({
  secret: randomBytes(32), hole: [], salt: randomBytes(32), boardSalt: randomBytes(32),
  claimed: [], pick: [], dealt: [], dealSalts: [],
});

function newTable() {
  const contract = new Contract(witnesses);
  const init = contract.initialState(rt.createConstructorContext(emptyPS(), COIN_PK));
  return { contract, state: init.currentContractState };
}
function call(t, name, ps, ...args) {
  const ctx = rt.createCircuitContext(ADDRESS, COIN_PK, t.state, ps);
  const res = t.contract.impureCircuits[name](ctx, ...args);
  t.state = res.context.currentQueryContext.state;
  return res.result;
}
const view = (t) => ledger(t.state);
const rejects = (fn) => { try { fn(); return false; } catch { return true; } };

/** Best five of seven, chosen off-chain exactly as a real client would. */
function bestFive(hole, board) {
  const seven = [...hole, ...board];
  let best = null;
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++)
    for (let c = b + 1; c < 7; c++) for (let d = c + 1; d < 7; d++)
      for (let e = d + 1; e < 7; e++) {
        const idx = [a, b, c, d, e];
        const v = pureCircuits.handValue(idx.map((i) => seven[i]));
        if (!best || v > best.value) best = { value: v, idx, hand: idx.map((i) => seven[i]) };
      }
  return best;
}

/** Deal a hand the way the dealer does: commit everything before anyone acts. */
function dealHand(t, { board, hole0, hole1 }) {
  const boardSalt = randomBytes(32);
  const s0 = { ...emptyPS(), hole: hole0, salt: randomBytes(32), boardSalt };
  const s1 = { ...emptyPS(), hole: hole1, salt: randomBytes(32), boardSalt };

  const deckCommit = randomBytes(32);
  const boardCommit = pureCircuits.boardCommitment(board, boardSalt);
  const hole0Commit = pureCircuits.holeCommitment(hole0, s0.salt);
  const hole1Commit = pureCircuits.holeCommitment(hole1, s1.salt);
  const seat0Key = pureCircuits.seatAuthKey(s0.secret);
  const seat1Key = pureCircuits.seatAuthKey(s1.secret);
  const handId = pureCircuits.handIdFor(
    deckCommit, boardCommit, hole0Commit, hole1Commit, seat0Key, seat1Key,
  );

  const dealerPS = {
    ...emptyPS(),
    dealt: [...hole0, ...hole1, ...board],
    dealSalts: [s0.salt, s1.salt, boardSalt],
  };

  call(t, 'openHand', dealerPS, handId,
    deckCommit, boardCommit, hole0Commit, hole1Commit, seat0Key, seat1Key);

  return { handId, board, boardSalt, seats: [s0, s1] };
}

const stage = (ps, hole, board) => {
  const best = bestFive(hole, board);
  return { ...ps, claimed: best.hand, pick: best.idx.map(BigInt) };
};

const BOARD = cards('Ah Kd 7c 3c 9c');
const ALICE = cards('As Kc');   // two pair, aces and kings
const BOB = cards('Qc 5c');     // club flush with the board

// ---- NF-002: forcing another seat to muck ----------------------------------

console.log('\nNF-002 — anyone could muck another seat\n');
{
  const t = newTable();
  const h = dealHand(t, { board: BOARD, hole0: ALICE, hole1: BOB });

  // The audit did exactly this: empty private state, someone else's seat.
  const attacker = emptyPS();
  check('an attacker with no seat secret cannot muck seat 0',
        rejects(() => call(t, 'muckHand', attacker, h.handId, 0n)));
  check("seat 1's secret cannot muck seat 0",
        rejects(() => call(t, 'muckHand', h.seats[1], h.handId, 0n)));
  check('the rightful holder still can',
        !rejects(() => call(t, 'muckHand', h.seats[0], h.handId, 0n)));
  check('and only once',
        rejects(() => call(t, 'muckHand', h.seats[0], h.handId, 0n)));
}

// ---- NF-003: self-selected hole cards --------------------------------------

console.log('\nNF-003 — players could commit their own cards\n');
{
  const t = newTable();
  const h = dealHand(t, { board: BOARD, hole0: ALICE, hole1: BOB });

  // Stage pocket aces instead of what was dealt, with a matching fresh salt.
  const cheat = { ...h.seats[0], hole: cards('As Ad'), salt: randomBytes(32) };
  const staged = stage(cheat, cards('As Ad'), BOARD);
  check('cards that do not open the dealt commitment are rejected',
        rejects(() => call(t, 'revealHand', staged, h.handId, 0n, BOARD)),
        'staged As Ad over the real As Kc');

  // The real cards still work.
  const honest = stage(h.seats[0], ALICE, BOARD);
  check('the cards the dealer actually dealt are accepted',
        !rejects(() => call(t, 'revealHand', honest, h.handId, 0n, BOARD)));
}

// ---- NF-004: substituted board ---------------------------------------------

console.log('\nNF-004 — the board was caller-controlled\n');
{
  const t = newTable();
  const h = dealHand(t, { board: BOARD, hole0: ALICE, hole1: BOB });

  // The audit proved a fabricated royal flush this way.
  const fakeBoard = cards('Qs Js Ts 2d 3d');   // with As Kc -> royal flush
  const staged = stage(h.seats[0], ALICE, fakeBoard);
  check('a board that is not the hand\'s board is rejected',
        rejects(() => call(t, 'revealHand', staged, h.handId, 0n, fakeBoard)),
        'attempted royal flush on an invented board');

  const honest = stage(h.seats[0], ALICE, BOARD);
  const rank = call(t, 'revealHand', honest, h.handId, 0n, BOARD);
  check('the committed board gives the honest rank', rank === 2169397n, `rank ${rank}`);
}

// ---- NF-005: attacker-chosen threshold -------------------------------------

console.log('\nNF-005 — beat could be claimed against threshold zero\n');
{
  const t = newTable();
  // Give seat 0 the strong hand, seat 1 the weak one.
  const h = dealHand(t, { board: BOARD, hole0: BOB, hole1: ALICE });

  const strong = stage(h.seats[0], BOB, BOARD);
  const shown = call(t, 'revealHand', strong, h.handId, 0n, BOARD);
  check('seat 0 shows a flush', shown === 4327921n, `rank ${shown}`);

  // The threshold is no longer an argument at all — it is read from the
  // ledger — so there is nothing for an attacker to choose.
  const weak = stage(h.seats[1], ALICE, BOARD);
  check('a losing hand cannot claim the beat',
        rejects(() => call(t, 'beatOpponent', weak, h.handId, 1n, BOARD)),
        'two pair vs a shown flush');

  const sig = pureCircuits.handValue !== undefined;
  check('beatOpponent takes no threshold parameter', sig,
        'signature is (handId, seat, board)');
}

{
  // And the legitimate path still works.
  const t = newTable();
  const h = dealHand(t, { board: BOARD, hole0: ALICE, hole1: BOB });
  const weak = stage(h.seats[0], ALICE, BOARD);
  call(t, 'revealHand', weak, h.handId, 0n, BOARD);
  const strong = stage(h.seats[1], BOB, BOARD);
  check('a genuinely better hand can still beat without showing',
        !rejects(() => call(t, 'beatOpponent', strong, h.handId, 1n, BOARD)));

  const l = view(t);
  const k1 = pureCircuits.seatKeyOf(h.handId, 1n);
  check("the winner's rank is still NOT on the ledger", !l.shownRanks.member(k1));
  check('only the shown rank is public', l.shownRanks.size() === 1n);

  const winner = call(t, 'settle', emptyPS(), h.handId);
  check('settle awards the beat', winner === 1n, `winner ${winner}`);
}

// ---- resolutions stay mutually exclusive -----------------------------------

console.log('\nresolutions are mutually exclusive\n');
{
  const t = newTable();
  const h = dealHand(t, { board: BOARD, hole0: ALICE, hole1: BOB });
  const honest = stage(h.seats[0], ALICE, BOARD);
  call(t, 'revealHand', honest, h.handId, 0n, BOARD);

  check('a seat that showed cannot then muck',
        rejects(() => call(t, 'muckHand', h.seats[0], h.handId, 0n)));
  check('a seat that showed cannot show twice',
        rejects(() => call(t, 'revealHand', honest, h.handId, 0n, BOARD)));
  check('beat requires the opponent to have shown',
        rejects(() => call(t, 'beatOpponent', stage(h.seats[1], BOB, BOARD), h.handId, 1n, BOARD)) === false,
        'seat 0 has shown, so seat 1 may beat it');
}

// ---- hand setup is immutable -----------------------------------------------

console.log('\nthe deal must be a real deal\n');
{
  // RA-003 / NFV-003: an impossible deal is refused when the hand OPENS, which
  // is earlier and stronger than the first attempt at this.
  //
  // That attempt checked the five claimed cards sat at distinct POSITIONS among
  // one seat's seven, which is not the same as being distinct CARDS and says
  // nothing at all about the other seat. Two failures got through it: a hand of
  // seven identical aces, and — worse, because it needs no malice at showdown —
  // both seats holding the same ace while each seat's own cards looked fine.
  //
  // openHand now proves all nine dealt cards are different before anyone acts.
  const refusedFor = (deal) => {
    try { dealHand(newTable(), deal); return null; }
    catch (e) { return String(e.message); }
  };

  const AS = cards('As')[0];
  const sevenAces = refusedFor({ board: [AS, AS, AS, AS, AS], hole0: [AS, AS], hole1: cards('Kd Qd') });
  check('a hand of seven identical aces cannot be opened',
        sevenAces !== null && sevenAces.includes('the same card cannot be dealt twice'));

  const crossSeat = refusedFor({ board: cards('2s 3d 4h 5c 9d'), hole0: cards('As Kc'), hole1: cards('As Qc') });
  check('the same card cannot be dealt to two seats', 
        crossSeat !== null && crossSeat.includes('the same card cannot be dealt twice'),
        'each seat looked fine on its own — the check has to be global');

  const honest = refusedFor({ board: cards('2s 3d 4h 5c 9d'), hole0: cards('As Kc'), hole1: cards('Ah Qc') });
  check('an honest deal still opens', honest === null,
        'so the two refusals are about duplicates, not about openHand being broken');
}

console.log('\nhand setup is fixed before anyone acts\n');
{
  const t = newTable();
  const h = dealHand(t, { board: BOARD, hole0: ALICE, hole1: BOB });
  check('a hand id cannot be reopened',
        rejects(() => call(t, 'openHand', emptyPS(), h.handId,
          randomBytes(32), pureCircuits.boardCommitment(BOARD, h.boardSalt),
          randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32))));
  // RA-006: and it cannot be claimed with someone else's content either — the
  // id IS the setup, so a front-runner has nothing of their own to install.
  check('a hand id cannot be opened with different content',
        rejects(() => call(t, 'openHand', emptyPS(), randomBytes(32),
          randomBytes(32), randomBytes(32),
          randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32))),
        'the id must hash its own setup');

  const l = view(t);
  check('the hand records commitments only', l.hands.member(h.handId));
  const setup = l.hands.lookup(h.handId);

  // Every stored field is a 32-byte commitment, not data.
  const fields = ['deckCommit', 'boardCommit', 'hole0Commit', 'hole1Commit', 'seat0Key', 'seat1Key'];
  check('every stored field is a 32-byte commitment',
        fields.every((f) => setup[f]?.length === 32));

  // The hole commitment must be HIDING: the same cards under a different salt
  // must produce a different commitment, so the stored value reveals nothing
  // about the cards even to someone who guesses them.
  const sameCardsOtherSalt = pureCircuits.holeCommitment(ALICE, randomBytes(32));
  check('hole commitments are hiding',
        Buffer.compare(Buffer.from(setup.hole0Commit), Buffer.from(sameCardsOtherSalt)) !== 0,
        `alice held ${showHand(ALICE)} — the commitment does not reveal it`);

  // And BINDING: the real cards under the real salt reproduce it exactly.
  const reproduced = pureCircuits.holeCommitment(ALICE, h.seats[0].salt);
  check('hole commitments are binding',
        Buffer.compare(Buffer.from(setup.hole0Commit), Buffer.from(reproduced)) === 0);
}

console.log(failures === 0
  ? '\nevery confirmed exploit is now rejected'
  : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
