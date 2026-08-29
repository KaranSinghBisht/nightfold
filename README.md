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

Two independent audits. The first found ten issues; eight are fixed and
regression-tested. The second, on 2026-08-29, re-tested those and went further,
confirming five criticals with executed proofs.

**What is fixed and tested:** seat actions require per-seat authorisation,
players cannot substitute hole cards or a caller-chosen board, `beatOpponent`
reads the opponent's recorded rank, payouts are pull-based so a rejecting
recipient cannot wedge anyone else, private state fails closed off the local
devnet, images are digest-pinned, and unequal-stack all-ins terminate.

**What is NOT fixed, and matters:**

| | |
|---|---|
| Relayer can drain a cage | `creditRemote` trusts relayer-supplied fields; replay protection only stops reusing the same invented tuple. It can credit itself and cash out. |
| Relayer can pick the winner | `expectedAttestation` is a pure function of `(handId, winner)`, so the relayer computes it for whichever winner it likes. The challenge window has no challenge function. |
| Dealer can grind the deck | The dealer supplies its nonce after seeing both player seeds, and `deckCommit` is stored but never read. Nothing proves the dealt cards form one valid permutation. |
| Oracle can compound moves | The 20% bound is per-post with no minimum interval, so a sequence of legal posts repriced a cage to near-zero float. |
| Chips conserve per cage, not globally | Each deployment has its own ledger. One source deposit can be credited on two cages. |

All five need a real cross-chain message protocol and a dealing scheme no last
mover can grind — protocol design, not a patch. **Nightfold is a demonstration
of what the muck buys you, not a system for real money.**

`docs/security.md` and `.superstack/security-reports/` carry both audits in
full, including the executed evidence for each finding.

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
a relayer reports outcomes. It is TRUSTED to report them honestly — a
2026-08-29 re-audit demonstrated it can name a winner the hand did not produce
and can credit itself chips against a fabricated deposit. Both need a real
cross-chain message, not a hash the relayer can recompute. Treat this as a
trusted-relayer design until that exists. It cannot invent an outcome
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

## Chains

The cage credits chips against an opaque `(sourceChainId, sourceDepositId)`
pair, so it never needed to know which chain a deposit came from. Adding a
chain is a watcher, not a new contract. Two modes, and the difference is real:

| Chain    | Mode     | What that means                                              |
|----------|----------|--------------------------------------------------------------|
| Base     | native   | the cage contract custodies the deposit — `buyIn()` is payable |
| Ethereum | native   | same bytecode; every EVM chain is one adapter                 |
| Solana   | attested | a watcher posts the deposit reference; the cage replay-protects it |
| Cardano  | attested | as above                                                      |
| Bitcoin  | attested | as above                                                      |
| NEAR     | attested | as above                                                      |

`npm run check:chains` proves it: six chains credit one chip ledger, each
deposit is single-use, a shared deposit id across two chains is NOT a replay
(the pair is the key), every credit emits its source so anyone can check it
against that chain, and chips bought on five chains cash out on a sixth.

Non-EVM chain ids are CAIP-2 strings hashed into the same `uint256` space, so
the source string is recoverable from the event.

### What a chip costs

A chip is the unit of account and it costs **$0.20**, whichever chain you bring.
Rates are **derived**, never chosen per chain:

    chipsPerToken(asset) = priceUsd(asset) / chipUsd

That is not cosmetic. Rates picked by hand disagree, and disagreeing rates are
free money — the first version priced Solana at 100 chips per SOL against
Ethereum's 20,000 per ETH, which valued a chip at $0.20 going in and several
dollars coming out. `npm run check:pricing` is the regression test, and it
still asserts the size of the hole the old numbers left.

`pricing.json` is the one table both the contracts' tests and the UI read, so a
rate cannot drift in one place and not the other. `npm run prices` refreshes it
from CoinGecko; it is committed rather than fetched at runtime because tests
have to be deterministic and a contract cannot call an HTTP API.

A committed table is a snapshot, and snapshots go stale — which is why
`NightfoldCage` takes an optional oracle. With one set, `postRate()` moves the
rate under a staleness window and a 20% per-post circuit breaker; a stale price
stops the cage minting chips but deliberately still lets players redeem the
ones they hold, because trapping a balance is the worse failure. With no oracle
the launch rate is fixed for the life of that cage, which is what every cage in
the test suite uses.

Live watchers exist for the EVM leg. The other four are exercised through the
relayer's attestation path in tests and are not watching mainnets — that is the
honest limit, and `docs/security.md` records what the relayer can and cannot do.

## Licence

MIT.

Card art is Kenney's [Playing Cards Pack](https://kenney.nl/assets/playing-cards-pack),
released CC0 and cropped to the 42x60 card. The hero background is React Bits'
`CRTWarp`, retuned to Midnight's blue.
