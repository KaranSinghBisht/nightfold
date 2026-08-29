# Security

Nightfold was audited on 2026-08-29 against commit `6403456`. The audit found
**10 findings: 5 critical, 3 high, 1 medium, 1 low**, and confirmed four of the
criticals by actually executing them — a fabricated royal flush, a forced muck
of someone else's seat, self-selected hole cards, and a drained cage.

Every finding is fixed. Every confirmed exploit has a regression test that
re-runs the attack and asserts it now fails:

```bash
npm run check:security    # the four Compact criticals
npm run check:evmsec      # the cage drain, the escrow trust boundary, the refund block
```

Exploit tests matter more than feature tests here. A feature test fails loudly
when someone breaks it; a *missing* exploit test fails silently forever.

---

## What was wrong, and what changed

### NF-001 · CRITICAL · The relayer could drain the entire cage

`cashOut` let the relayer name any recipient and any amount, with no chip
ledger behind it. The audit deployed a fresh cage, funded it with 1 ETH,
created no deposit and no game, and emptied it in one call.

**Fixed by changing the shape of the authority, not adding a check to it.**

- There is a real **chip ledger**. Chips exist only where they were credited,
  and cashing out burns them. `totalChips` is a conservation invariant, asserted
  in the tests against the sum of individual balances.
- The relayer can only **credit**, never move funds. `cashOut` burns the
  **caller's** chips — so the relayer, holding none, can withdraw nothing.
- Every credit carries a **provenance** `(sourceChainId, sourceDepositId)` with
  global replay protection, so a credit is attributable to a deposit anyone can
  check on that chain.
- Credits are **capped per epoch**, bounding a key compromise to a known,
  observable amount rather than all liquidity instantly.

### NF-002 · CRITICAL · Anyone could resolve another player's seat

`muckHand` consumed no private witness at all. Any caller who knew the public
`handId` could muck an opponent's seat and hand themselves the pot.

**Fixed:** every hand now fixes two **seat authorisation keys** at open time,
each `H("nf:seatkey:", secret)`. Every state-changing circuit routes through
`authoriseSeat`, which proves knowledge of the matching secret. The audit's
exact call — empty private state, someone else's seat — is now rejected, and so
is using seat 1's secret against seat 0.

### NF-003 · CRITICAL · Players chose their own hole cards

`commitDeal` hashed whatever cards the caller supplied. Nothing tied them to the
dealer's deck, so a player could commit pocket aces regardless of the deal.

**Fixed:** `commitDeal` is gone. The **dealer** opens the hand with per-seat
hole-card commitments, and a player proves their cards **open** that commitment.
You can no longer invent a hand; you can only reveal the one you were dealt.

### NF-004 · CRITICAL · The showdown board was caller-controlled

Both showdown circuits took the five board cards as arguments and checked only
that each encoding was valid. The audit proved a royal flush against an invented
board.

**Fixed:** the hand stores a `boardCommit`, and `verifiedClaim` recomputes
`boardCommitment(board)` and requires it to match. The board is public by the
rules of poker, so the commitment is unsalted and anyone can check it.

### NF-005 · CRITICAL · `beatShownRank` took the threshold from the caller

A losing hand won by passing threshold `0`. Any valid poker hand beats zero.

**Fixed:** the threshold is no longer a parameter. `beatOpponent` derives the
opponent's seat key, requires that they have shown, and reads the threshold
**from the ledger**. There is nothing left for a caller to choose.

### NF-006 · HIGH · The escrow paid whatever winner the relayer named

It checked `msg.sender` and `winner <= 2`, and recorded an unverified
attestation — making a false settlement detectable, but not preventable.

**Fixed:** three changes.

1. The attestation is **checked, not recorded**. The contract recomputes
   `keccak256("nf:payout:" ++ handId ++ keccak256(winner))` and rejects anything
   that does not match — so an attestation for seat 0 cannot be used to pay
   seat 1.
2. Settlement opens a **challenge window** (`proposeSettlement` →
   `finaliseSettlement`) instead of paying instantly.
3. Payouts are **pull, not push**.

What remains: the relayer can stall. `timeout` always returns both stakes.

### NF-007 · HIGH · Private outcomes could not be relayed

`readOutcome` returned `null` unless both seats had published ranks — so a hand
that settled privately via muck or beat, which is the entire privacy story, sat
in the escrow until timeout.

**Fixed:** the relayer resolves every combination of show / beat / muck exactly
as the contract's `settle` does. `check:crosschain` now demonstrates a **mucked**
hand being relayed and paid.

### NF-008 · HIGH · A rejecting seat could block refunds

`timeout` pushed both refunds in one transaction, so a contract seat that
rejected transfers rolled back the honest player's refund too.

**Fixed:** pull payments throughout, in both the escrow and the cage. The test
deploys a contract that refuses native asset, seats it, and confirms the honest
player is still credited and can withdraw. The hostile seat can only fail its
own withdrawal.

### NF-009 · MEDIUM · Private-state encryption fell back to a public password

The witness store holds hole cards and salts. It silently used a
repository-public fallback password whenever `NIGHTFOLD_STATE_PASSWORD` was
absent, and the state directories were not ignored.

**Fixed:** the provider **fails closed** off the local devnet — it throws rather
than encrypting private data with a published password. `.nightfold-state/` and
`.probe-state/` are gitignored.

### NF-010 · LOW · Unpinned images and a broadly-bound proxy

**Fixed:** all three container images are pinned **by digest**, and the
diagnostic proof proxy binds `127.0.0.1` explicitly with an 8 MB request cap.

---

## Known limitations that are *not* bugs

These are design trade-offs, stated so nobody mistakes them for oversights.

**The dealer sees the cards.** It cannot choose the deck — the seed is
`H(seedA, seedB, nonce)` with both players committing before either reveals —
and it cannot change the deal, because it publishes a deck commitment before
delivering a card. Any misdeal is provable afterwards. But it knows the cards
during the hand. Removing that needs a trustless shuffle; we built two and
measured both (84.8 MB / ~59s oblivious match, 42.1 MB / ~29.5s Benes network)
and neither is fast enough to put on-chain. The roadmap path is peer-to-peer
verification of a Benes proof, which costs zero transactions.

**A published rank reveals the hand's composition.** `2169397` decodes to "two
pair, aces and kings, nine kicker." That is correct for a player *choosing* to
show. `muckHand` and `beatOpponent` exist for players who don't want to.

**The relayer is trusted for liveness, not for correctness.** It cannot take
funds, cannot name a winner the hand did not produce, and cannot mint chips
without attributable, capped, replay-protected provenance. It *can* stall —
every path has a timeout or reclaim.

**Not built:** multi-table lobbies, more than two players, side pots, and a
dispute path beyond the escrow timeout and challenge window. A production
deployment would want a threshold or light-client bridge in place of the single
relayer.
