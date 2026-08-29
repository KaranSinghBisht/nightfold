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

## Each chain does one job

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
| `check:nfv` | every exploit an independent verification pass **executed** against this repo is refused, and refused for the stated reason |
| `check:exploits` | the re-audit's cage drains, followed to withdrawal rather than stopping at the first check |
| `check:lifecycle` | the contract, the relayer and the UI give the same verdict for every ending in the matrix |
| `check:security` | the first audit's Compact exploits, including a deal where both seats hold the same card |
| `check:evmsec` | the relayer's authority boundary on both EVM contracts |
| `check:pricing` | one USD table, so no chain can be arbitraged against another |
| `check:chains` | six chains credit one chip ledger; each deposit is single-use |
| `check:rank` | 22 ordered poker hands rank correctly |
| `check:fuzz` | 20,000 random hands order identically to an independent reference evaluator |
| `check:hand` | a full hand deals, reveals and settles; four cheating paths are rejected |
| `check:muck` | a published rank is decoded to *demonstrate* the leak, then both private alternatives are shown to leave nothing behind |
| `check:game` | heads-up betting, unequal-stack all-ins, and dealing anyone can verify afterwards |
| `check:engine` | 400 hands of random legal play; chips conserved, no mucked card ever rendered |
| `check:escrow` | strangers and players cannot settle; a stalled relayer cannot trap funds; a challenge costs a bond |
| `check:crosschain` | a private Midnight outcome moves real ETH, and the transcript is grepped for the losing cards |

Real ZK proofs run against a local devnet:

```bash
./scripts/devnet.sh          # node, indexer, proof server
npm run proof:real           # deploy + play a hand with real proofs
```

**Be precise about what that last one has and has not shown.** The harness
constructs the current contract and CI proves it does — an audit caught it
silently targeting a removed API, which is why that check exists. The timings
below come from earlier runs against an earlier version of the circuits. The
deal circuit has since more than tripled in size, and those numbers have not
been re-measured end to end on a devnet.

## Measured, not assumed

On the build machine, from 35 real proof runs plus fresh compiles:

| Quantity | Value | Why it matters |
|---|---|---|
| Transaction round-trip | **31s** | Only ~6s is proving; 25s is block time and indexer sync. This is what forces a low transaction count. |
| Proving cost | 0.70 s/MB | Linear in prover-key size across a 7× range, so a circuit can be priced before it is written. |
| Verifier key | 1,591 B | Flat regardless of complexity. Deploy cost is per *circuit*, never per gate. |
| Midnight tx per hand | 5 | Deal and showdown are per player. |

Circuit costs. Key sizes are measured from the current build; prove times are
derived from the 0.70 s/MB rate above rather than re-timed, and are marked `~`
for that reason.

| Circuit | Prover key | Prove (derived) |
|---|---|---|
| `beatOpponent` | 19.5 MB | ~13.7s |
| `revealHand` | 19.5 MB | ~13.6s |
| `openHand` | 19.5 MB | ~13.6s |
| `settle` | 10.0 MB | ~7.0s |
| `muckHand` | 5.2 MB | ~3.6s |

`openHand` is the expensive one, and it is expensive *on purpose*. It grew from
5.2 MB to 19.5 MB when it started proving the deal is possible — that all
nine dealt cards are real and distinct, and that the three published
commitments open to exactly them. Before that check, two players could settle a
hand while both holding the ace of spades, and every proof verified. Roughly ten
seconds on the deal is what that costs.

Verifier keys are flat at ~2.1 KB per circuit regardless of complexity, so the
whole contract still costs less than a JPEG thumbnail to deploy.

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

## Layout

```
contracts/
  HandRank.compact       five-card evaluator (module)
  nightfold.compact      openHand, revealHand, beatOpponent, muckHand, settle
evm/
  NightfoldCage.sol      the chip ledger: buy in anywhere, cash out anywhere
  NightfoldEscrow.sol    per-hand escrow, quorum settlement, bonded challenge
src/
  game/betting.mjs       heads-up no-limit betting
  game/dealer.mjs        committed, verifiable dealing
  game/lifecycle.mjs     ONE resolution rule, read by contract, relayer and UI
  pricing.mjs            chips priced through USD so no chain can be arbitraged
  witnesses.mjs          the one witness bundle every component uses
  relayer.mjs            carries a Midnight outcome to N chains
  evm/nfv.test.mjs       every verified exploit, run to the money
ui/                      the landing page, the lobby and the table
scripts/devnet.sh        starts the local stack in an order that works
.superstack/             three security audits and their runnable evidence
```

## Taking a seat

`#play` opens a lobby with two lanes, because the questions a first-time
visitor has ("whose chips are these, do I need a wallet") deserve an answer
before a hand starts rather than after.

- **Guest table** — 1,000 house chips, dealt immediately, no wallet. Nothing is
  deposited and nothing settles on a chain; the seat plate says `house chips`
  rather than dressing them up as a deposit that never happened. The poker and
  the muck, with the money left out.
- **Cash table** — connect, pick one of six chains, deposit, and the cage
  credits chips at the derived rate. Both seats are dealt the same stack,
  because that is what the cage is for.

`#play?demo=muck` and `#play?demo=showdown` skip the lobby and land on a frozen
beat — the shot is the hand, not the entrance.

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
pair, so it never needed to know which chain a deposit came from. What differs
between chains is not the accounting — it is **whether a cage can run there at
all**.

`NightfoldCage.sol` is Solidity. It deploys unchanged to any EVM chain, and
there `buyIn()` is payable: the money sits *inside the contract*. No other chain
can run it. Solana would need a Rust program, Cardano a Plutus script, NEAR its
own contract, and Bitcoin cannot hold a general contract at all. That is a
property of those chains, not of where the effort went.

| Chain | Mode | What that means |
|---|---|---|
| Base | **native** | the cage runs here and holds the deposit |
| Ethereum | **native** | same bytecode — every EVM chain is one adapter |
| Solana | **watched** | no cage here, but a real watcher reads devnet and reports deposits it has seen |
| Cardano | attested | no cage and no watcher yet — a signed claim would be accepted |
| Bitcoin | attested | as Cardano, and it cannot be native at all |
| NEAR | attested | as Cardano |

### Solana is watched, not simulated

`src/solana/watcher.mjs` reads Solana devnet over JSON-RPC — dependency-free,
because the watcher only ever reads and four HTTP calls do not need an SDK. It
finds real transfers into the cage's deposit address, reads the depositor's EVM
address from the SPL memo, converts lamports to chips at the published rate, and
produces the receipt the EVM cage verifies.

```bash
npm run solana:watch                              # real deposits, live
npm run solana:deposit -- 0.05 0xYourAddress      # make one
```

`npm run check:solana` runs the parser over **live devnet transactions** — it
pulls recent memo-program transactions off the chain and asserts none of them is
mistaken for a deposit — then credits a Solana-derived receipt on an EVM cage
and proves it cannot be credited twice. The network-dependent checks skip rather
than fail when devnet is unreachable, because a third party being down is not a
regression.

One manual step remains: the devnet faucet refuses programmatic airdrops, so the
player address has to be funded once at <https://faucet.solana.com> before
`solana:deposit` can run. Everything either side of that is live.

**Cardano, Bitcoin and NEAR are still attested.** The cage's side of it is real
and tested:
it verifies a threshold of watcher signatures over a receipt binding both
chains, both cages, the player, the amount and a nonce; replay-protects the
whole digest; caps a single credit at 20% of unencumbered reserves; and refuses
to name the relayer as recipient. `npm run check:chains` credits six chains into
one ledger, and `npm run check:nfv` proves a forged or oversized receipt is
refused.

What does not exist for those three is a watcher. Nothing here reads Cardano,
Bitcoin or NEAR, and their attestation path runs on test keys standing in for
observers. Making any of them `watched` is the same shape of work the Solana
watcher was; making them `native` needs a Plutus script or a NEAR contract, and
Bitcoin cannot be native at all.

`check:cage`'s "solana cage" is still a second Solidity cage at Solana's rate on
the same local EVM — its header says so. That test is about the chip ledger, not
about Solana.

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

MIT — see [LICENSE](LICENSE).

Card art is Kenney's [Playing Cards Pack](https://kenney.nl/assets/playing-cards-pack),
released CC0 and cropped to the 42x60 card. The hero background is React Bits'
`CRTWarp`, retuned to Midnight's blue.
