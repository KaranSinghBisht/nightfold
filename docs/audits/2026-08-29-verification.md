# Nightfold Remediation Verification

**Date:** 2026-08-29  
**Mode:** Daily remediation verification, 8/10 confidence gate  
**Current HEAD:** `9fada510b1c505dfcc9b1b81127d568d74d87f61`  
**Security remediation commit:** `5099c0f06407cd55e8ecfc4444ad6e1d21cea0af`  
**Prior audited snapshot:** `1683e5a`  
**Scope:** All 18 re-audit findings, Solidity and Compact contracts, dealer, relayer, betting engine, UI privacy boundary, proof harness, CI, dependencies, documentation, and active Anvil/Compact/UI reproduction.

> The repository advanced through cosmetic/UI commits and acquired uncommitted lobby work while this verification was running. Those changes were preserved. The contract, proof, dealer, and CI code under the findings did not change after `5099c0f`.

## Verdict

**No-go for real funds and no-go for the claim that all 18 findings are fixed.**

The full declared `npm run check` suite passes with zero failures, and several remediations are sound. Independent execution nevertheless confirmed two complete cage drains, an honest cross-cage transfer that leaves a pending depositor owed 1 ETH from a cage holding 0, an invalid global-card deal that settles, a broken real-proof witness bundle, a genuine receipt collision, and an administrative oracle transition that violates the advertised solvency invariant.

The project remains suitable only as an explicitly non-custodial hackathon simulator. The README's “do not put real money in it” warning is correct; its statement that every confirmed finding is fixed is not.

## Severity summary

| Severity | Count |
|---|---:|
| Critical | 3 |
| High | 4 |
| Medium | 4 |
| Low | 2 |
| Informational | 1 |
| **Total** | **14** |

## Verification of the original 18 findings

| Finding | Status now | Verification result |
|---|---|---|
| RA-001 relayer cage drain | **Open** | A relayer can name an accomplice and use an arbitrary same-chain contract whose `issuedReceipt` always returns true. No watcher signature is required; the accomplice drains the full cage. |
| RA-002 arbitrary escrow winner | **Partial / trusted committee** | Relayer-only settlement is blocked and `challenge()` exists. Correctness still rests on admin-selected watchers, while either loser can challenge a correct result without evidence and force a refund. |
| RA-003 dealer grinding / invalid deck | **Open** | Nonce commitment remains optional and is not verified in the published opening. Compact checks seven cards per seat, not all nine cards globally; both players settled while sharing the same ace of spades. `deckCommit` is never opened or checked by a circuit. |
| RA-004 oracle ratchet | **Partial** | Interval, window cap, and `postRate` solvency stop the original oracle walk. `setOracle` changes the exit rate without a solvency check and was executed into insolvency. |
| RA-005 cross-cage double issuance | **Open** | Real burn receipts exist, but arbitrary same-chain source contracts are trusted, pending destination deposits can fund incoming redemptions, and replay provenance omits `srcCage`. |
| RA-006 `openHand` front-run | **Fixed for content hijack** | `handIdFor` binds the setup. A front-runner cannot install different content under that ID. |
| RA-007 board preimage | **Fixed** | Board commitment includes a 32-byte private salt. |
| RA-008 unequal all-in deadlock | **Fixed** | Effective-stack cap, unmatched-chip return, and asymmetric-stack tests terminate while conserving chips. |
| RA-009 lifecycle mismatch | **Partial** | Both-muck splits in Compact and relayer. UI still settles on the first muck while Compact requires both seats to act, and Compact has no fold path. |
| RA-010 real-money betting path | **Accepted / not implemented** | Correctly documented as JavaScript simulation rather than an on-chain betting flow. It remains architecturally open. |
| RA-011 false-positive tests | **Open** | `check:exploits` reaches withdrawal, but its quorum drain uses 20,000 chips against a cage that backs only 12,165. The same sequence at 12,165 drains it. CI's dependency audit also cannot fail. |
| RA-012 stale proof harness | **Open** | `witnessBundle()` omits required `seatSecret` and `boardSalt`. The generated `Contract` rejects it at construction. CI constructs a different bundle and regexes only call names. |
| RA-013 buy-in price race | **Fixed** | Buy-in stores `chipsQuoted`, enforces `minChips`, and local credit uses the stored quote. |
| RA-014 roles / parameters | **Partial** | Cage validation, pause, and rotation improved. Cage admin can replace the watcher quorum unilaterally; escrow admin and relayer remain immutable. |
| RA-015 browser-private cards | **Partial / simulator limitation** | Cards left React state for a module map, reducing casual exposure. They remain in the same instrumentable process. A shown opponent hand currently renders as `2s 2s`. |
| RA-016 dead test script / no CI | **Fixed, with gaps** | `npm test` invokes the suite and CI exists. Action refs and Compact installer are mutable; high-severity dependency audit is ignored. |
| RA-017 vulnerable `tmp` | **Open** | Root production audit still reports one high and one low advisory through `solc -> tmp`; UI audit is clean. |
| RA-018 documentation drift | **Partial** | Major limitations are named, but README, `docs/security.md`, comments, and landing copy still claim all findings are fixed or that the dealer cannot choose/misdeal. |

## Findings

### [CRITICAL] NFV-001: Arbitrary same-chain receipt contracts bypass the quorum and drain the cage

**Confidence:** 10/10  
**Location:** `evm/NightfoldCage.sol:361-383`

For same-chain receipts, `creditRemote` calls user-supplied `rc.srcCage` and trusts a true return from `issuedReceipt(digest)`. There is no registry, factory attestation, or proof that the address is an authentic cage. A malicious relayer can point at a contract that always returns true, name an accomplice, mint the exact backed amount, and let the accomplice cash out.

**Executed evidence:**

```text
VULNERABLE  fake same-chain source bypasses every watcher — 0 wei remains
```

The PoC also showed a fabricated quorum-signed receipt drains a 1 ETH cage at 12,165 chips. The regression uses 20,000 chips and tests only the solvency ceiling.

**Remediation:** Authenticate source cages through an immutable or governance-delayed registry/factory. Key replay by the complete receipt digest. Interface conformance or a boolean return from an arbitrary address is not authenticity.

**Priority:** P0

### [CRITICAL] NFV-002: Pending deposits are spendable reserves but absent liabilities

**Confidence:** 10/10  
**Location:** `evm/NightfoldCage.sol:193-201`, `evm/NightfoldCage.sol:275-303`, `evm/NightfoldCage.sol:469-478`

`liabilities()` counts issued chips and queued withdrawals but not uncredited deposits reclaimable for two hours. Their native asset is reported as unencumbered and can back incoming credit. The PoC used a genuine source cage and burn: Bob consumed Alice's pending destination deposit, withdrew 1 ETH, and Alice later recorded a reclaim against a zero-balance cage.

```text
VULNERABLE  pending depositor becomes insolvent after reclaim — 1000000000000000000 wei owed, 0 wei held
```

**Remediation:** Track `totalPendingDeposits` as a liability from `buyIn` until `creditLocal` or `reclaim` consumes it. Include it in `liabilities()` and test the invariant after every public transition.

**Priority:** P0

### [CRITICAL] NFV-003: Dealer integrity is voluntary and Compact accepts a globally impossible deal

**Confidence:** 10/10  
**Location:** `src/game/dealer.mjs:101-147`, `contracts/nightfold.compact:149-209`, `contracts/nightfold.compact:233-265`

The nonce check runs only if `commitments.n` is supplied; a dealer can omit it and keep the original grind. `verifyDeal` does not accept or verify a prior nonce commitment. Compact validates uniqueness within each seat's seven cards, not across both holes plus board, and never consumes `deckCommit`.

```text
VULNERABLE  cross-seat duplicate card settles successfully — ranks 3196350/3196350, winner 2
```

**Remediation:** Make the nonce commitment mandatory and bind it into an independently ordered transcript. Verify both holes and board against one committed permutation. If that proof is out of scope, state that the dealer is trusted for card validity and deck choice.

**Priority:** P0

### [HIGH] NFV-004: Real-proof harness is non-runnable and CI proves a different object

**Confidence:** 10/10  
**Location:** `src/midnight/realproof.mjs:128-135`, `.github/workflows/check.yml:36-63`

The current contract requires six witness functions. The real harness omits `seatSecret` and `boardSalt`; the generated contract rejects it before deployment. CI constructs a separate complete object and checks only regex-extracted circuit names.

```text
BROKEN      real-proof witness bundle is rejected at construction — first (witnesses) argument to Contract constructor does not contain a function-valued field named seatSecret
```

**Remediation:** Export one witness bundle used by simulator, real harness, and CI. Have CI construct the actual `CompiledContract` with that bundle; do not claim real-proof validation from a regex check.

**Priority:** P0

### [HIGH] NFV-005: Replay provenance omits the source cage

**Confidence:** 10/10  
**Location:** `evm/NightfoldCage.sol:383`, `evm/NightfoldCage.sol:426-444`

The signed digest includes `srcCage`, but `_credit` derives replay provenance from only `(sourceChainId, nonce)`. Every cage starts `burnNonce` at one, so one source's first accepted transfer blocks every other source's first transfer.

```text
VULNERABLE  source-cage omission creates a nonce collision — second genuine receipt nonce 1 rejected
```

**Remediation:** Use `creditDigest(rc)` as the replay key, or include the full source/destination/player/amount/nonce tuple.

**Priority:** P1

### [HIGH] NFV-006: Any losing player can invalidate a correct settlement without evidence

**Confidence:** 10/10  
**Location:** `evm/NightfoldEscrow.sol:192-210`, `evm/NightfoldEscrow.sol:233-251`

`challenge()` requires only seat membership and no conflicting attestation, bond, or proof. A loser can challenge every valid result and force both stakes to be refunded. The current test executes this path but assumes the challenger is truthful.

**Remediation:** Label settlement cooperative, or require objective contradictory evidence, a slashable bond, or higher-tier adjudication. A free veto does not enforce poker outcomes.

**Priority:** P1

### [HIGH] NFV-007: UI and Compact disagree on muck and fold lifecycles

**Confidence:** 10/10  
**Location:** `ui/src/game/engine.ts:141-166`, `contracts/nightfold.compact:341-400`

The UI settles immediately after the first muck. Compact refuses until both seats act. Compact also has no fold transition while the UI pays a fold immediately. The README statement that lifecycles agree on showdown is false.

**Remediation:** Define one resolution matrix and make each component consume it. Add cross-implementation lifecycle tests rather than independent expectations.

**Priority:** P1

### [MEDIUM] NFV-008: `setOracle` can violate the global invariant

**Confidence:** 10/10  
**Location:** `evm/NightfoldCage.sol:212-226`, `evm/NightfoldCage.sol:524-528`

`exitRate()` switches between live and launch rate based on whether oracle is zero. `setOracle` changes that branch without `_requireSolvent()`.

```text
VULNERABLE  setOracle can violate the global invariant — 1150842581175503493 wei owed, 1000000000000000000 wei held
```

**Remediation:** Preserve last live exit rate when disabling the oracle, or enforce solvency during every oracle transition.

**Priority:** P1

### [MEDIUM] NFV-009: Critical authority remains unilateral and escrow roles are not recoverable

**Confidence:** 9/10  
**Location:** `evm/NightfoldCage.sol:499-545`, `evm/NightfoldEscrow.sol:104-124`

Cage admin can add its own watcher keys and lower threshold to one immediately. Escrow admin and relayer are immutable; escrow has no pause, admin transfer, or watcher removal.

**Remediation:** Put quorum changes behind multisig plus delay, enforce a threshold floor, and add two-step escrow admin/relayer rotation and scoped pause/escape paths.

**Priority:** P1

### [MEDIUM] NFV-010: Cross-cage burns have no failure recovery

**Confidence:** 9/10  
**Location:** `evm/NightfoldCage.sol:314-333`

`burnForRemote` irreversibly destroys chips for any nonzero destination. A typo, unfunded/paused destination, unavailable quorum, or provenance collision can leave the receipt permanently uncreditable.

**Remediation:** Restrict routes, preflight destination capacity, and design explicit failed-transfer recovery with replay/finality protection.

**Priority:** P1

### [MEDIUM] NFV-011: A shown opponent hand renders as `2s 2s`

**Confidence:** 10/10  
**Location:** `ui/src/game/engine.ts:205-232`

Ranking reads seat one's vault cards correctly, but `view()` renders from intentionally empty `e.hole[1]`. Bitwise coercion maps both `undefined` entries to card zero.

```text
BROKEN      opponent show renders the empty Engine slot — actual Qh Jc, rendered 2s 2s
```

**Remediation:** Store an explicit public `revealedHole` on show or let `view()` read the vault only for a shown hand. Assert rendered cards match the cards used for the published rank.

**Priority:** P1

### [LOW] NFV-012: Known high advisory remains and CI ignores it

**Confidence:** 10/10  
**Location:** `package-lock.json`, `.github/workflows/check.yml:67`

Root `npm audit --omit=dev` reports high and low advisories through `solc -> tmp`. Direct application exploitability was not demonstrated. CI appends `|| true`, so even future production advisories cannot gate.

**Remediation:** Keep Solc out of production runtime, track upstream, and use an explicit advisory allowlist instead of ignoring every audit failure.

**Priority:** P2

### [LOW] NFV-013: CI executes mutable third-party code

**Confidence:** 9/10  
**Location:** `.github/workflows/check.yml:14-28`

Actions use mutable major tags, and Compact is installed by piping a `releases/latest` script to a shell. Workflow permissions are not explicitly restricted.

**Remediation:** Pin actions to full SHAs, download a versioned Compact artifact with checksum/signature verification, and set minimal permissions such as `contents: read`.

**Priority:** P2

### [INFORMATIONAL] NFV-014: Security documentation remains contradictory

**Confidence:** 10/10  
**Location:** `README.md:98-162`, `docs/security.md:1-159`, `src/relayer.mjs:1-27`, `ui/src/arcade/Sections.tsx`

README names major limitations but also says every finding is fixed, the invariant covers every value move, the dealer cannot choose/misdeal, and lifecycles agree on showdown. `docs/security.md` more strongly claims the relayer is trusted only for liveness and cannot mint or choose a winner. Executed evidence contradicts these claims.

**Remediation:** Use `fixed`, `partial`, `accepted`, and `open` statuses from this report. Remove current real-proof validation claims until `proof:real` constructs and runs.

**Priority:** P1 before submission copy/video

## Positive controls

- Full declared test suite completes with zero failures; root `npm test` invokes it.
- Compact seat actions require the correct seat secret.
- Caller-selected board and caller-selected beat threshold attacks remain blocked.
- Board commitment uses high-entropy salt.
- Unequal-stack all-ins terminate and conserve chips in tested cases.
- Pull payments use checks-effects-interactions.
- Oracle posts now have per-post, per-window, interval, and direct solvency checks.
- UI build succeeds; UI dependency audit is clean.
- Docker images are digest-pinned and local services/proxy bind loopback.
- No live production secret, obvious DOM injection sink, `eval`, `tx.origin`, `delegatecall`, or unsafe push payment was found in the changed tree.

## Verification performed

### Passed

- `npm run check` — full suite, zero failures.
- `npm run typecheck` — Compact compilation.
- `npm run build --prefix ui` — production build (887 KB main chunk warning).
- `npm run lint --prefix ui` — completes with eight warnings.
- UI production dependency audit — zero vulnerabilities.
- Independent Anvil PoC — exact-size quorum drain, fake-source drain, honest pending-deposit insolvency, source nonce collision, and `setOracle` insolvency.
- Independent Compact PoC — cross-seat duplicate card accepted and settled.
- Generated-contract construction — real-proof witness bundle rejected.
- Independent UI PoC — shown opponent cards render incorrectly.

### Failed / unsafe

- Root production dependency audit — one high and one low advisory through `tmp`.
- Claim that all 18 findings are fixed — contradicted by executed evidence.
- `proof:real` — cannot construct the current generated contract with its witness bundle.

## Evidence

- `.superstack/security-reports/evidence/remediation-poc.mjs`
- `.superstack/security-reports/evidence/compact-remediation-poc.mjs`
- `.superstack/security-reports/evidence/engine-view-poc.ts`

## Remediation roadmap

### P0 — before a security-fix narrative or real funds (4–8 hours excluding a real deck proof)

1. Authenticate same-chain source cages and key replay by full receipt digest.
2. Count pending deposits as liabilities and test every transition.
3. Repair/export the actual witness bundle and make CI construct it.
4. Make dealer nonce commitments mandatory; implement global deck binding or explicitly call the dealer trusted.

These are authorization, conservation, and state-machine invariants. After immediate fixes, use formal invariant/property verification rather than relying only on regression examples.

### P1 — before submission polish (3–6 hours)

1. Align muck/fold lifecycles or label the UI disconnected.
2. Fix shown-card rendering.
3. Prevent unrestricted settlement veto or call settlement cooperative.
4. Guard `setOracle`, harden governance, and document burn recovery.
5. Replace “all fixed” statements with the status table above.

### P2 — engineering hardening (1–3 hours)

1. Isolate Solc and explicitly allowlist the current `tmp` risk rather than disabling audit gating.
2. Pin Actions and Compact installation immutably.
3. Split the large UI bundle and resolve lint warnings as time permits; neither changes the security verdict.

## Confidence calibration

- Total findings: 14
- CRITICAL: 3 (average confidence: 10/10)
- HIGH: 4 (average confidence: 10/10)
- MEDIUM: 4 (average confidence: 9.5/10)
- LOW: 2 (average confidence: 9.5/10)
- INFO: 1 (average confidence: 10/10)
- False positives / accepted limitations filtered: 5
- Mode: Daily remediation verification (8/10 gate)
