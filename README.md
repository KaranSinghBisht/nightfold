# Nightfold

**Cross-chain Texas Hold'em where the losing hand is never revealed.**

Built for the **Midnight Hackathon, August 2026 — Cross-Chain Track**.

---

## The idea

In a real card room, when you lose you *muck*: you slide your cards face down
into the discard pile and nobody ever learns what you were holding. That isn't
politeness, it's strategy — every hand you show is a permanent read on how you
play, and good players pay for that information.

On-chain poker throws it away. Showdown means publishing your hole cards to a
public ledger where they are indexed, free, and permanent. Your opponents don't
need tracking software. **The chain is the tracking software.**

Nightfold settles a hand without either player's cards ever reaching a chain.

| At showdown you can | What reaches the ledger |
|---|---|
| `revealHand` | Your hand's rank. |
| `beatOpponent` | That you beat a rank already on the table. Nothing about your own. |
| `muckHand` | **Nothing.** No cards, no rank, no proof of holdings. |

Meanwhile the chips come from wherever you already keep them — one player
staking ETH on Base, the other SOL on Solana, at the same table.

## Three chains, each doing one job

```
  Base / Solana (public)              Midnight (private)
  ────────────────────────            ──────────────────────────
  buy-ins escrowed                    hole cards as commitments
  betting — seconds, cheap            showdown proves a RANK
  pot pays out                        cards are never published
        ▲                                      │
        └────── relayer carries the proof ─────┘
```

Only what needs privacy gets it. **Board cards are public** — poker already
shows them — so no privacy budget is spent there, which is what keeps a hand to
five Midnight transactions instead of twenty-seven.

## What's actually verified

Everything below is asserted by a test in this repo, not claimed.

```bash
npm run check      # every suite below, no chain required
```

| Suite | What it proves |
|---|---|
| `check:security` | every Compact exploit an external audit **confirmed** is now rejected |
| `check:evmsec` | the cage drain, the escrow trust boundary, and the refund block are closed |
| `check:rank` | 22 ordered poker hands rank correctly |
| `check:fuzz` | 20,000 random hands order identically to an independent reference evaluator |
| `check:hand` | a full hand deals, reveals and settles; four cheating paths are rejected |
| `check:muck` | a published rank is decoded to *demonstrate* the leak, then both private alternatives are shown to leave nothing behind |
| `check:game` | heads-up betting rules, and dealing that anyone can verify afterwards |
| `check:escrow` | the escrow's trust boundary — strangers and players cannot settle, a stalled relayer cannot trap funds |
| `check:crosschain` | a private Midnight outcome moves real ETH, and the combined transcript is grepped for the losing cards |

Plus real ZK proofs against a local devnet:

```bash
./scripts/devnet.sh          # node, indexer, proof server
npm run proof:real           # deploy + play a hand with real proofs
```

## Measured, not assumed

On the build machine, from 35 real proof runs plus fresh compiles:

| Quantity | Value | Why it matters |
|---|---|---|
| Transaction round-trip | **31s** | Only ~6s is proving; 25s is block time and indexer sync. This is what forces a low transaction count. |
| Proving cost | 0.70 s/MB | Linear in prover-key size across a 7× range, so a circuit can be priced before it is written. |
| Verifier key | 1,591 B | Flat regardless of complexity. Deploy cost is per *circuit*, never per gate. |
| Midnight tx per hand | 5 | Deal and showdown are per player. |

Circuit costs, measured:

| Circuit | Prover key | Prove |
|---|---|---|
| `openHand` | — | dealer fixes deck, board and both hands |
| `revealHand` | ~10 MB | ~7.0s |
| `beatOpponent` | ~10 MB | ~7.0s |
| `muckHand` | ~2.8 MB | ~2.0s |
| `settle` | ~10 MB | ~7.0s |

Verifier keys are flat at ~2 KB per circuit regardless of complexity, so the
whole contract costs less than a JPEG thumbnail to deploy.

## Security

Audited 2026-08-29: **10 findings, 5 critical**, four of them confirmed by
executing them — a fabricated royal flush, a forced muck of someone else's seat,
self-selected hole cards, and a drained cage.

**All ten are fixed**, and every confirmed exploit has a regression test that
re-runs the attack and asserts it now fails. Full write-up, including what
changed and why, in [`docs/security.md`](docs/security.md).

The headline change: a hand is now **opened by the dealer** with commitments to
the deck, the board and both seats' hole cards, plus a seat authorisation key
per player. Nothing can be acted on until all of that is fixed, so a player
cannot choose their cards, substitute a board, act for a seat they do not hold,
or pick the threshold they must beat.

## Limitations

Stated plainly, because a hackathon project that hides its trust assumptions is
worth less than one that names them.

**The dealer sees the cards.** It cannot *choose* the deck — the shuffle seed is
`H(seedA, seedB, nonce)` with both players committing before either reveals —
and it cannot change the deal afterwards, because it publishes a commitment to
the whole deck before delivering a card and the opening once the hand is over.
Any misdeal is provable by anyone. But it knows the cards while the hand runs.

Removing that needs a trustless shuffle. We built two and measured both:

| Construction | Deck | Prover key | Per shuffle |
|---|---|---|---|
| Oblivious match, O(N²) | 52 | 84.8 MB | ~59s |
| Benes network, O(N log N) | 64 (52 padded) | 42.1 MB | ~29.5s |

A 2× win, not the 4× needed. Two shuffles a hand plus two more transactions
would take a hand from 155s to ~280s. **The roadmap path is peer-to-peer
verification** — each player checks the other's Benes shuffle proof directly,
which costs 29.5s once and *zero transactions*.

**A published rank reveals the hand's composition.** `2169397` decodes to "two
pair, aces and kings, nine kicker." That is correct for a player choosing to
show. `muckHand` and `beatShownRank` exist for players who don't want to.

**The relayer can stall.** No EVM chain can verify a Midnight proof natively, so
a relayer reports outcomes. It cannot take funds and cannot invent an outcome
undetectably — the attestation is the exact bytes Midnight wrote, and anyone can
compare. It *can* delay, so the escrow has a timeout that always returns both
stakes.

**Not built:** multi-table lobbies, more than two players, side pots, and a
dispute path beyond the escrow timeout.

## Layout

```
contracts/
  HandRank.compact       five-card evaluator (module)
  nightfold.compact      commitDeal, revealHand, beatShownRank, muckHand, settle
evm/
  NightfoldEscrow.sol    per-hand escrow with a timeout path
src/
  game/betting.mjs       heads-up no-limit betting
  game/dealer.mjs        committed, verifiable dealing
  midnight/              devnet providers + the real-proof harness
  relayer.mjs            carries a Midnight outcome to N chains
ui/                      the table
scripts/devnet.sh        starts the local stack in an order that works
```

## Running it

```bash
npm install                  # .npmrc pins legacy-peer-deps; the SDK needs it
npm run compile              # compile the Compact contracts
npm run check                # all suites, no chain needed

./scripts/devnet.sh          # local Midnight devnet
npm run proof:real           # real proofs

npx anvil &                  # local EVM
npm run check:escrow
cd ui && npm run dev         # the table
```

Notes that cost us time, so they don't cost you any:

- npm **silently skips** the Midnight SDK without `--legacy-peer-deps`.
- Indexer 4.3.3 serves GraphQL at `/api/v3/graphql`; `/api/v1` returns a 308 the
  wallet client does not follow, which presents as a 90s sync timeout.
- The indexer dies with `Cannot construct OnlineClientAtBlock: block number 1
  not found` unless the node has produced blocks first. `scripts/devnet.sh`
  waits.
- A local devnet degrades after roughly 600 blocks and wallet sync then stalls
  silently. `./scripts/devnet.sh reset`.
- Compact has no module-level `const`, no mutable locals, no `/` or `%`, and no
  runtime vector indexing.

## Licence

MIT.

Card art is Kenney's [Playing Cards Pack](https://kenney.nl/assets/playing-cards-pack),
released CC0 and cropped to the 42x60 card. The hero background is React Bits'
`CRTWarp`, retuned to Midnight's blue.
