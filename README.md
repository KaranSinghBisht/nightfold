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

Three passes: an audit, a re-audit, and an independent verification of the
remediations. All three reports and their runnable proof-of-concepts are in
`.superstack/security-reports/`.

The third pass is the one worth reading, because it disproved a claim this
README made. Every finding was reported as fixed; executed evidence drained the
cage twice, settled a globally impossible deal, and showed the proof harness
could not construct its own contract. It also found that one of this repo's
regression tests passed for the wrong reason — `check:exploits` credited 20,000
chips against a cage backing 12,175, so it stopped at the solvency ceiling
without ever reaching the check it named. At exactly 12,175 the cage emptied.

Everything that pass found is now closed, and every fix has a test that probes
the boundary rather than stepping over it. `npm run check:nfv` re-runs each
drain and asserts it is refused *for the stated reason*; caps are checked one
unit over, at the cap, and one unit under.

| Was | Now |
|---|---|
| any contract answering `issuedReceipt` was a valid source | same-chain sources must be registered, and registration waits a day |
| one receipt could mint the entire backed float | a single credit is capped at 20% of unencumbered reserves |
| pending deposits counted as spare reserves | they are liabilities from `buyIn` until credited or reclaimed |
| replay keyed on `(chain, nonce)`, so every cage's first transfer collided | keyed on the whole receipt digest |
| `setOracle` moved the redemption rate unchecked | solvency-checked like any other price move |
| admin could add its own watchers and drop the threshold to one | changes are delayed; the threshold has a floor of two |
| a burn to a bad destination destroyed chips forever | reclaimable after six hours, receipt revoked first |
| both seats could hold the same card | `openHand` proves all nine dealt cards are real and different |
| the dealer's nonce commitment was optional | mandatory; omitting it is refused |
| four copies of the witness bundle, two of them wrong | one bundle, and CI constructs the real contract with it |
| a shown hand rendered as `2s 2s` | shown cards have a public home and are checked against the vault |
| four components disagreed on how a hand ends | one matrix in `src/game/lifecycle.mjs`, walked entirely by a test |
| challenging a settlement was free | it costs a bond equal to the stake |
| `solc` sat in production dependencies | moved to devDependencies; production audit is clean and CI gates on it |

**What is still true, and is a trust assumption rather than a bug:**

- **The dealer chooses the cards.** It can no longer deal one card twice or
  grind its nonce, but nothing proves the nine cards came from a fair shuffle.
  A real deck proof is protocol work this project has not done.
- **The watcher quorum is trusted.** Verifying a Midnight result on an EVM chain
  needs a light client nobody has built. The quorum raises the bar from one key
  to several, the reserve cap bounds what one bad receipt can take, and a bonded
  challenge lets a player stop a false settlement — but a colluding quorum can
  still misreport.
- **Betting is not on-chain.** The cage holds chips and the escrow holds a
  stake; per-street betting is JavaScript. This is a simulator over real
  contracts, not a real-money path.

**Nightfold is a demonstration of what the muck buys you. Do not put real money
in it.**

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
