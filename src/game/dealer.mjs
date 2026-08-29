// The deal service.
//
// TRUST MODEL — stated plainly, because this is the one place Nightfold trusts
// something.
//
// The dealer shuffles and therefore SEES the deck. What it cannot do:
//
//   - It cannot choose the deck. The shuffle seed is H(seedA, seedB, nonce),
//     with both players committing to their seed before any is revealed, so no
//     party can pick a seed after seeing another's.
//   - It cannot change the deal after the fact. It publishes a commitment to
//     the whole shuffled deck before any card is delivered, and the opening is
//     published at the end of the hand. Any misdeal is provable by anyone.
//
// What it can do: know the cards during the hand. Removing that needs a
// trustless shuffle, and we measured two constructions (84.8 MB / 59s for an
// oblivious match, 42.1 MB / 29.5s for a Benes network) — both too slow to put
// on-chain. The roadmap path is peer-to-peer verification of a Benes shuffle
// proof, which costs zero transactions. See docs/limitations.
//
// Until then this is honest, verifiable-after-the-fact dealing, not a claim of
// trustlessness.

import { createHash, randomBytes } from 'node:crypto';

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' ? Buffer.from(p, 'utf8') : p);
  return h.digest();
};

export const cardName = (id) => RANKS[id >> 2] + SUITS[id & 3];

/** A player's pre-deal commitment to their seed. */
export function commitSeed(seed = randomBytes(32)) {
  return { seed, commitment: sha('nf:seed:', seed) };
}

/** Deterministic stream of 32-bit values from a seed. */
function* prng(seed) {
  let counter = 0;
  for (;;) {
    const block = sha(seed, Buffer.from([counter++, 0, 0, 0]));
    for (let i = 0; i + 4 <= block.length; i += 4) yield block.readUInt32BE(i);
  }
}

/** Fisher-Yates over a 52-card deck, driven entirely by the seed. */
export function shuffle(seed) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const rand = prng(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    // rejection sampling keeps the draw uniform
    const limit = Math.floor(0x100000000 / (i + 1)) * (i + 1);
    let r;
    do { r = rand.next().value; } while (r >= limit);
    const j = r % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Run a deal.
 *
 * @param {Buffer} seedA  seat 0's revealed seed
 * @param {Buffer} seedB  seat 1's revealed seed
 * @param {object} commitments  { a, b } — the commitments published beforehand
 */
export function deal(seedA, seedB, commitments, nonce = randomBytes(32)) {
  // Neither player may change their seed after seeing the other's.
  if (!sha('nf:seed:', seedA).equals(commitments.a)) throw new Error('seat 0 seed does not match its commitment');
  if (!sha('nf:seed:', seedB).equals(commitments.b)) throw new Error('seat 1 seed does not match its commitment');

  const deckSeed = sha('nf:deck:', seedA, seedB, nonce);
  const deck = shuffle(deckSeed);

  // Published BEFORE any card is delivered. Binds the dealer to this exact deck.
  const deckCommitment = sha('nf:deckcommit:', Buffer.from(deck), nonce);

  return {
    deckCommitment,
    // delivered privately to each seat
    hole: [[deck[0], deck[2]], [deck[1], deck[3]]],
    // burn one, then the flop / turn / river, as a real dealer does
    board: [deck[5], deck[6], deck[7], deck[9], deck[11]],
    /** Published after the hand so anyone can re-run the deal and check it. */
    opening: { deck, nonce, deckSeed },
  };
}

/**
 * Re-run a published deal and confirm it matches what was committed.
 * Anyone can call this after a hand — that is what makes the dealer accountable.
 */
export function verifyDeal({ deckCommitment, opening }, seedA, seedB) {
  const { deck, nonce } = opening;
  const expectedSeed = sha('nf:deck:', seedA, seedB, nonce);
  if (!expectedSeed.equals(opening.deckSeed)) return { ok: false, reason: 'deck seed does not match the players\' seeds' };

  const expectedDeck = shuffle(opening.deckSeed);
  if (expectedDeck.join() !== deck.join()) return { ok: false, reason: 'deck is not the shuffle of that seed' };

  const expectedCommit = sha('nf:deckcommit:', Buffer.from(deck), nonce);
  if (!expectedCommit.equals(deckCommitment)) return { ok: false, reason: 'deck does not open the published commitment' };

  return { ok: true };
}
