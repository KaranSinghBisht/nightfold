# Nightfold Security and Logic Re-audit

**Date:** 2026-08-29  
**Mode:** Comprehensive full repository re-audit, 2/10 confidence gate  
**Snapshot:** `1683e5a` (`Keep the felt green, and give the cage a door`)  
**Previous audited snapshot:** `64034560bc16e6f53ad8609fda10c37f1ec2ea32`  
**Scope:** Compact and Solidity contracts, relayer and dealer, poker engine, React UI (including the newly committed cage UI), dependency locks, generated-contract consistency, local Docker/Anvil surface, tests, docs, and git-history secret review.

## Executive summary

Nightfold is still **not safe for real funds or adversarial play**. Several concrete fixes from the first audit are good: seat actions now require private authorization, players can no longer substitute their own committed hole cards or caller-selected board, `beatOpponent` reads the opponent's rank, pull payments remove rejecting-recipient denial of service, private-state storage fails closed off devnet, and the local images/proxy are hardened.

The money and fairness boundaries remain broken, however. Five critical issues were actively confirmed:

1. A relayer can fabricate a remote deposit, credit itself, and empty a funded cage.
2. A relayer can choose a false poker winner, compute the escrow's expected attestation itself, wait through a challenge period that has no challenge function, and take the pot.
3. The dealer can grind its uncommitted nonce to choose a favorable deck, while the Compact contract never checks the stored deck commitment or card uniqueness. The contract accepted a hand containing seven copies of the ace of spades.
4. An oracle can post any number of individually valid 20% moves without delay and reprice a small chip position to consume essentially all cage float.
5. The supposed global chip ledger is local to each cage. One source deposit can leave chips spendable on the source cage while the relayer credits the same economic claim on a destination cage.

The complete declared `npm run check` suite passes despite these issues. Some regression tests encode the vulnerable behavior as success, so a green result currently overstates security.

## Severity summary

| Severity | Count |
|---|---:|
| Critical | 5 |
| High | 7 |
| Medium | 3 |
| Low | 2 |
| Informational | 1 |
| **Total** | **18** |

## Status of the first audit

| Prior finding | Re-audit status | Notes |
|---|---|---|
| NF-001 cage drain | **Persistent / reshaped** | Arbitrary relayer withdrawal became arbitrary relayer credit followed by holder cash-out. The same key can still drain the cage. |
| NF-002 unauthorized seat actions | **Resolved** | Every player resolution action passes through `authoriseSeat`. |
| NF-003 self-selected hole cards | **Partially resolved** | Players are bound to dealer commitments, but the dealer/opening is unauthenticated and commitments are not bound to a valid deck. |
| NF-004 caller-selected board | **Partially resolved** | Callers must use the stored board commitment, but an unauthenticated opener can store an arbitrary or impossible board. |
| NF-005 attacker-selected beat threshold | **Resolved** | `beatOpponent` reads the opponent's shown rank from the ledger. |
| NF-006 arbitrary relayer winner | **Persistent** | The escrow validates a value the relayer can compute for any chosen winner; no Midnight state is verified. |
| NF-007 private outcomes not relayed | **Resolved** | Muck and beat combinations are read by the relayer. |
| NF-008 rejecting recipient DoS | **Resolved** | Pull payments isolate recipient failures. |
| NF-009 private-state password fallback | **Resolved** | Non-local use fails closed and state directories are ignored. |
| NF-010 mutable images / broad proxy | **Resolved** | Images are digest pinned; proxy is loopback-bound with a request cap. |

## Attack surface and trust boundaries

| Boundary | Intended trust | Effective trust found |
|---|---|---|
| Dealer → Midnight | Dealer sees cards but cannot choose or alter them | Dealer controls an uncommitted nonce, can choose the deck, and can open arbitrary/invalid commitments |
| Midnight → EVM escrow | Relayer provides a binding Midnight outcome | Single relayer chooses the winner; EVM verifies only a self-computable keccak value |
| External chain → cage | Relayer reports a real, single-use deposit | Single relayer chooses player, amount, chain, and deposit ID without proof |
| Cage → cage | One globally conserved chip balance | Each deployment has an independent ledger and independent replay map |
| Oracle → cage | Bounded current market price | Single key can compound unlimited 20% moves in one block |
| Betting → settlement | Money-chain betting determines the payable pot | Betting is local JavaScript and is not connected to cage balances or escrow stakes |

## Findings

### [CRITICAL] RA-001: The relayer can still drain a funded cage through fabricated credit

**Confidence:** 10/10  
**Location:** `evm/NightfoldCage.sol:203-233`, `evm/NightfoldCage.sol:238-276`, `src/evm/security.test.mjs:51-80`

`creditRemote` trusts the relayer to name the recipient, chip amount, source chain, and source deposit ID. Replay protection proves only that the relayer has not reused the same invented tuple. The epoch cap limits accounting units, not loss relative to reserves, and the configured test cap of 10,000,000 chips is enough to exceed typical cage liquidity.

The claim that the relayer cannot drain because it initially holds no chips is circular: the same key is authorized to credit itself immediately before calling `cashOut` as the new chip holder.

**Executed evidence:** a fresh cage was funded with 1 ETH. No source deposit or game was created. The relayer credited itself 20,000 chips against `fabricated-deposit`, cashed out, and withdrew.

```json
{
  "fabricatedSourceDeposit": true,
  "queuedWei": "1000000000000000000",
  "cageBalanceAfter": "0",
  "relayerChipsAfter": "0"
}
```

**Remediation:** verify a finalized source-chain message rather than relayer-provided fields. Bind source/destination chain IDs, both cage addresses, transaction/log index, depositor, asset amount, derived chip amount, and a nonce. Prefer a light client or threshold attestation with independent watchers. Cap credit by a small percentage of unencumbered reserves, add a pause, and test the full `creditRemote(relayer) → cashOut → withdraw` sequence.

### [CRITICAL] RA-002: The escrow relayer can choose any winner; the challenge window cannot challenge

**Confidence:** 10/10  
**Location:** `evm/NightfoldEscrow.sol:76-80`, `evm/NightfoldEscrow.sol:107-148`, `contracts/nightfold.compact:322-330`, `src/relayer.mjs:19-27`, `src/relayer.mjs:92-95`, `src/crosschain.e2e.mjs:99-107`

`expectedAttestation` is a public pure function of `(handId, winner)`. A malicious relayer chooses a winner, calls that function, and supplies the result. Nothing verifies that Midnight produced that winner. The Compact side uses `persistentHash`, while the EVM side uses `keccak256`, so the two values are not even the same hash construction.

The relayer code discards `outcome.attestation`; the cross-chain test asks the EVM contract to compute a fresh value instead. The ten-minute window has no `challenge` or `dispute` entry point, and `timeout` is disabled once the hand enters `Settling`. A false proposal therefore becomes inevitable payout after ten minutes.

**Executed evidence:** with Bob designated as the assumed Midnight winner, the relayer selected Alice, self-computed the EVM value, and Alice received the full 0.2 ETH pot.

```json
{
  "assumedMidnightWinner": 1,
  "relayerChosenWinner": 0,
  "selfComputedAttestationAccepted": true,
  "challengeFunctionInAbi": false,
  "aliceWithdrawableWei": "200000000000000000",
  "bobWithdrawableWei": "0"
}
```

**Remediation:** specify one canonical cross-domain message and one verifiable bridge mechanism. Do not treat recomputing a hash of relayer-controlled inputs as verification. Add an actual dispute path, challenger proof/bond rules, and a refund or escape hatch from `Settling`. Use a threshold signer set or light client until native Midnight verification exists, with role rotation and emergency pause.

### [CRITICAL] RA-003: Deal integrity is not enforced; dealer can choose or fabricate cards

**Confidence:** 10/10  
**Location:** `src/game/dealer.mjs:93-111`, `contracts/nightfold.compact:34-49`, `contracts/nightfold.compact:144-185`, `contracts/nightfold.compact:194-216`

The dealer supplies `nonce` only after seeing both player seeds, so it can try nonces until the shuffle favors a target seat. Commit-reveal by the players does not prevent this dealer-controlled last-mover grind.

Separately, `deckCommit` is stored but never read by any circuit. `openHand` accepts arbitrary board and hole commitments, and `verifiedClaim` requires distinct source *positions* rather than distinct card IDs. It does not require the board, both holes, and deck commitment to describe one 52-card permutation.

**Executed evidence:** fixed player seeds produced pocket aces for seat 0 after trying 963 dealer nonces. A second simulator proof opened and settled a hand whose seven available positions were all `As`:

```json
{
  "impossibleSevenCopiesAccepted": true,
  "seat0Rank": "5315623",
  "seat1Rank": "5315623",
  "settlementWinner": "2"
}
```

**Remediation:** commit the dealer contribution before player reveals, or derive the final seed from contributions that no single last mover can grind. Prove that the deck is a permutation, bind board/hole positions to it, and require all dealt card IDs to be unique. Store and verify the same commitment produced by the dealer module. Add tests for duplicate cards, invalid permutations, mismatched openings, and nonce grinding.

### [CRITICAL] RA-004: Unlimited sequential oracle updates bypass the 20% circuit breaker

**Confidence:** 10/10  
**Location:** `evm/NightfoldCage.sol:54-64`, `evm/NightfoldCage.sol:145-165`, `evm/NightfoldCage.sol:185-190`, `evm/NightfoldCage.sol:238-250`

`postRate` limits each call but imposes no minimum interval or cumulative movement limit. A compromised oracle can post repeatedly in the same block, drive `chipsPerToken` down, and make each existing chip redeem for far more native asset.

**Executed evidence:** 21 allowed updates changed the rate from 20,000 to 186. Alice's honest 0.05 ETH buy-in then queued 5.048387 ETH, consuming nearly all 5 ETH of house float.

```json
{
  "rateBefore": "20000",
  "rateAfter": "186",
  "sequentialUpdatesWithoutDelay": 21,
  "aliceOriginalBuyInEth": "0.05",
  "queuedCashOutEth": "5.048387096774193548",
  "cageBalanceAfterEth": "0.001612903225806452"
}
```

**Remediation:** bound cumulative movement per time window, require elapsed time between updates, use a multi-source TWAP/median, and pause on deviation rather than accepting an arbitrary sequence. Enforce solvency against outstanding liabilities at both the proposed and previous rates.

### [CRITICAL] RA-005: Chip conservation is local, allowing cross-cage double issuance

**Confidence:** 10/10  
**Location:** `evm/NightfoldCage.sol:79-92`, `evm/NightfoldCage.sol:203-233`, `src/evm/chains.test.mjs:57-98`, `README.md:195-213`

Every cage deployment has its own `chips`, `totalChips`, `creditedProvenance`, and epoch accounting. There is no canonical global ledger, source burn/lock, or atomic transfer protocol. The six-chain test sends six alleged sources into one Anvil contract; it does not deploy cages on six chains or prove cross-chain conservation.

**Executed evidence:** one 0.05 ETH source deposit was credited locally for 1,000 chips. The same deposit reference then credited 1,000 chips on a second cage, while the source balance remained spendable.

```json
{
  "sourceChipsRemain": "1000",
  "destinationChipsCredited": "1000",
  "totalClaimsFromOneDeposit": "2000",
  "sourceBurnOrLockRequired": false
}
```

**Remediation:** choose a canonical ledger or implement burn-and-mint messages with source finality and globally unique nonces. A destination credit must prove the source balance was burned or locked, not merely that a deposit event exists. Track global liabilities and reserve ownership explicitly.

### [HIGH] RA-006: `openHand` is unauthenticated and can be front-run

**Confidence:** 10/10  
**Location:** `contracts/nightfold.compact:190-216`

Comments say the dealer opens the hand, but no circuit proves dealer authority or binds the setup to EVM seats. Anyone who learns an intended hand ID can open it first with attacker-controlled seat keys and commitments. The legitimate dealer is then rejected by the write-once check. This is both a denial of service and a hand-state hijack.

**Executed evidence:** an unauthenticated simulator caller installed its setup for a chosen hand ID; the legitimate second open failed.

```json
{
  "unauthenticatedOpenAccepted": true,
  "attackerSetupStored": true,
  "legitimateDealerRejected": true
}
```

**Remediation:** authenticate a dealer/threshold dealer signature or require both seats to authorize the full setup. Bind contract/network, EVM escrow, hand ID, both seat identities, all commitments, and an expiry.

### [HIGH] RA-007: The unsalted board commitment can reveal all future streets

**Confidence:** 9/10  
**Location:** `contracts/nightfold.compact:95-105`, `contracts/nightfold.compact:194-214`

The full five-card board is committed before betting using a public, unsalted function that is identical across hands. The preimage space for ordered distinct boards is only `52 × 51 × 50 × 49 × 48 = 311,875,200`. A reusable lookup table or targeted brute force can recover flop, turn, and river before betting completes. Hash output length does not restore entropy absent from the input.

**Remediation:** add a high-entropy per-hand salt hidden until the appropriate reveal, include `handId` in the domain, and preferably commit/reveal streets progressively. Do not publish a deterministic low-entropy commitment to future public randomness.

### [HIGH] RA-008: Unequal-stack all-ins deadlock and never reach payout

**Confidence:** 10/10  
**Location:** `src/game/betting.mjs:60-86`, `src/game/betting.mjs:123-152`, `ui/src/Table.tsx:44-61`

Raises are capped only by the acting player's stack, not the opponent's effective stack. If the larger stack pushes 200 chips and the short stack can call only 20, both stacks reach zero but commitments remain `[200, 20]`. `matched` is false, the turn returns to a zero-stack player, and the hand cannot advance. There is no unmatched-bet refund or side-pot logic.

The newly added cage UI makes unequal stacks directly reachable by seating the user with 500/1,000/2,500 chips while retaining Bob's current stack.

**Executed evidence:** the engine ended at preflop with both stacks zero, `done: false`, commitments `[200,20]`, and a nonsensical zero-sized bet action.

**Remediation:** cap heads-up action at the opponent's effective stack, return unmatched excess immediately, then run out the board. Add asymmetric blind/all-in tests for both button positions and every street.

### [HIGH] RA-009: UI and Compact settlement state machines disagree

**Confidence:** 10/10  
**Location:** `ui/src/game/engine.ts:110-117`, `ui/src/game/engine.ts:121-145`, `contracts/nightfold.compact:292-320`, `src/relayer.mjs:33-62`

The UI settles immediately when one seat mucks, while Compact requires both seats to record show/muck/beat before `settle`. A UI fold pays immediately, but Compact has no fold circuit or state. If both seats muck, Compact and the relayer award seat 0 due to condition order, while comments say split and the UI's unreachable `decide` branch says split.

In a real integration these differences create stuck hands or different winners across components.

**Remediation:** define one lifecycle specification and generate/derive each implementation from it. Add an explicit fold resolution, specify whether the other seat must acknowledge a muck, and choose one deterministic both-muck rule. Test the full resolution matrix across UI, Compact, relayer, and EVM.

### [HIGH] RA-010: The advertised real-money path is not implemented end to end

**Confidence:** 10/10  
**Location:** `src/game/betting.mjs:1-5`, `evm/NightfoldEscrow.sol:82-148`, `evm/NightfoldCage.sol:169-280`, `ui/src/arcade/CageModal.tsx:108-112`, `README.md:31-45`

Betting is JavaScript state, not a money-chain contract. The escrow accepts a fixed native-asset stake and knows nothing about cage chips or per-street bets. The cage tracks chips but has no stake, hand, bet, or payout interface. The cross-chain test funds the escrow directly with ETH. The UI buy-in is clearly labeled simulated and sends no transaction.

This is an implementation/completeness finding rather than an additional exploit in the demo, but it means the architecture described in README cannot yet protect or settle actual gameplay.

**Remediation:** decide the canonical funds flow first. Implement an on-chain or signed-state-channel betting state machine that locks cage chips, caps liabilities, handles folds/all-ins, and consumes exactly one Midnight outcome. Make the demo explicitly simulator-only until that path exists.

### [HIGH] RA-011: Security tests encode vulnerable behavior as success

**Confidence:** 10/10  
**Location:** `src/evm/security.test.mjs:51-107`, `src/crosschain.e2e.mjs:93-107`, `src/evm/chains.test.mjs:57-98`

The NF-001 regression test credits the relayer itself and treats event provenance plus an epoch cap as the fix, but never cashes those chips out. The NF-006/cross-chain test obtains `expectedAttestation` from the EVM escrow rather than forwarding or verifying Midnight's `outcome.attestation`. The six-chain test uses one cage, so it cannot detect cross-cage supply duplication.

The result is a green full suite that explicitly prints “every confirmed EVM exploit is now rejected” even though the same exploit sequence succeeds when completed.

**Remediation:** adversarial tests must pursue value to the terminal state: credit, cash out, withdraw; propose false winner, challenge/refund; transfer across two independent cages; and compare the exact Midnight bytes to the EVM-accepted bytes.

### [HIGH] RA-012: Real-proof harness and generated assets target the previous contract

**Confidence:** 10/10  
**Location:** `src/midnight/realproof.mjs:21-22`, `src/midnight/realproof.mjs:82-98`, `src/midnight/realproof.mjs:112-119`, `src/witnesses.mjs:25-50`, `contracts/managed/nightfold/`, `contracts/managed/nightfold-tc/`

`proof:real` imports `contracts/managed/nightfold`, whose current local artifact still exposes removed `commitDeal`. The harness calls `commitDeal`, reads removed `holeCommits`, and supplies no `seatSecret` witness. `npm run check` refreshes only `nightfold-tc`, so it cannot detect this release mismatch.

The claimed real-ZK validation therefore does not exercise the contract now under review.

**Remediation:** update the harness to `openHand`, stage seat secrets, and assert the new ledger shape. Regenerate both artifact directories from the same source in CI and fail if generated circuit names or source hashes differ.

### [MEDIUM] RA-013: Buy-in price is not fixed at deposit time and stale exit pricing can socialize loss

**Confidence:** 9/10  
**Location:** `evm/NightfoldCage.sol:145-151`, `evm/NightfoldCage.sol:169-200`

`buyIn` emits a chip quote at the current rate but stores only native amount. `creditLocal` recalculates chips later, allowing rate movement or relayer delay to change what the depositor receives. `exitRate` deliberately accepts a stale price indefinitely; if the asset moves materially while the oracle stalls, early redeemers can consume reserves at the stale rate and leave later holders insolvent.

**Remediation:** store the accepted rate/chip amount at deposit time or require `minChips` and a deadline. Define a bounded stale-redemption policy with reserves, pause/withdrawal limits, or a last-good TWAP rather than unlimited first-come redemption.

### [MEDIUM] RA-014: Critical roles are immutable and deployment parameters are not validated

**Confidence:** 9/10  
**Location:** `evm/NightfoldCage.sol:120-132`, `evm/NightfoldEscrow.sol:67-74`

Constructors accept zero relayer, zero rate, zero cap, and arbitrary oracle values. Relayer/oracle compromise cannot be rotated or paused, and there is no incident-response path for funded contracts. Zero rate can make conversion unusable; a zero relayer permanently disables required operations.

**Remediation:** validate nonzero/range invariants, use a multisig-controlled two-step role rotation, add scoped pause controls, and document a migration/escape process. Keep emergency authority unable to seize player balances.

### [MEDIUM] RA-015: Private cards are present in the same browser runtime

**Confidence:** 10/10  
**Location:** `ui/src/game/engine.ts:35-50`, `ui/src/game/engine.ts:183-210`, `ui/src/game/types.ts:1-5`

`view()` keeps opponent cards out of rendered seat props and the DOM, which is useful presentation hygiene. The complete `Engine`, however, contains both hole-card arrays in the local React state because the opponent is an in-browser bot. A user can inspect runtime state or instrument the bundle and read Bob's cards.

This is acceptable only while the UI is explicitly a local simulator. It is not a privacy boundary suitable for peer play.

**Remediation:** keep each player's witnesses in a separate wallet/client process and never deliver opponent plaintext to the browser. Update comments to distinguish DOM minimization from cryptographic privacy.

### [LOW] RA-016: Root `npm test` is broken and no CI gate exists

**Confidence:** 10/10  
**Location:** `package.json:14`, repository root (no `.github/workflows`)

`npm test` invokes `vitest`, but Vitest is not declared or installed. The command exits 127. The custom `npm run check` works, but there is no project CI workflow to enforce it, regenerated-artifact consistency, builds, audits, or exploit tests before merge.

**Remediation:** either declare/configure Vitest or remove the dead script. Add CI pinned to a supported Node version with lockfile installs, compile/artifact-diff checks, `npm run check`, UI build/lint, and dependency auditing.

### [LOW] RA-017: Root dependency tree retains vulnerable `tmp@0.0.33`

**Confidence:** 9/10  
**Location:** `package-lock.json`, `node_modules/solc/smtsolver.js`

`npm audit` reports one high and one low advisory through `solc -> tmp@0.0.33`. The observed project compile path uses repository-controlled Solidity, and Solc's discovered `tmp.fileSync` call uses a fixed `.smt2` postfix, so direct exploitability in this application was not demonstrated. It should nevertheless remain build-only and be removed or isolated.

**Remediation:** track an upstream Solc resolution, isolate compilation in a disposable workspace/container, and avoid exposing compiler parameters to untrusted users. Do not apply npm's suggested downgrade to Solc 0.5.0.

### [INFORMATIONAL] RA-018: Operational and documentation drift

**Confidence:** 10/10

- README says all ten findings are fixed and that the relayer cannot invent outcomes; active proofs contradict both statements.
- README's layout still lists removed Compact entry points.
- UI build succeeds but produces an 884 KB JavaScript chunk; lint reports nine React warnings.
- No live production secrets were found in the current tree or searched history. Anvil keys, the Midnight genesis seed, and Compose passwords are recognizable dev fixtures.
- No direct DOM injection, `eval`, `tx.origin`, `delegatecall`, or unsafe Solidity push-payment pattern was found.

## Positive controls verified

- Compact player actions are bound to per-seat secrets.
- A player cannot open a different hole commitment or substitute a caller-selected board after setup.
- `beatOpponent` reads the recorded opponent rank.
- Resolution actions are exclusive per seat.
- Solidity payouts/refunds use checks-effects-interactions pull payments.
- Witness stores fail closed outside the explicit local devnet and are gitignored.
- Docker images are pinned by digest and services bind loopback.
- The proof proxy has an 8 MB request cap.
- UI dependency audit reports zero known advisories.
- No obvious XSS sink or live secret was found.

## Verification performed

### Passed

- `npm run check` in full, including Compact typecheck, 22 rank checks, 20,000 rank comparisons, game/engine tests, EVM cage/escrow/pricing/chains/security suites, and the cross-chain happy path.
- UI `npm run build`.
- UI `npm run lint` (warnings only).
- Root and UI `npm audit`; UI clean, root advisories described in RA-017.
- Git-history secret pattern review.
- Eight targeted adversarial proofs across Anvil, the Compact simulator, and the JavaScript engine: cage drain, false escrow winner, oracle drain, cross-cage double issue, unauthenticated hand open, impossible duplicate cards, dealer nonce grinding, and unequal-stack all-in deadlock.

### Failed or not valid

- Root `npm test` fails because `vitest` is unavailable.
- `proof:real` was not treated as valid evidence because its source and compiled asset target the removed contract API. A lengthy devnet run against that artifact would prove the wrong contract.
- Existing EVM “security” and six-chain tests do not test the terminal exploit or multiple independent cages.

## Remediation roadmap

### P0 — before any real-value deployment

1. Replace discretionary remote credit and settlement with one canonical, domain-separated, verifiable cross-chain message protocol (RA-001, RA-002, RA-005).
2. Redesign dealing so no last mover can grind the deck and prove all cards come from one valid permutation (RA-003, RA-006, RA-007).
3. Redesign oracle controls around cumulative/time-bounded movement and provable solvency (RA-004, RA-013).
4. Specify and implement a globally conserved chip ledger with burn/lock on source and mint/unlock on destination (RA-005).

### P1 — before a public adversarial demo

1. Implement the actual cage → betting → Midnight outcome → payout path, including unequal all-ins and folds (RA-008 through RA-010).
2. Replace the false-positive regression tests with terminal exploit tests and repair the real-proof harness (RA-011, RA-012).
3. Add role rotation, pause, parameter validation, and a recovery design (RA-014).

### P2 — engineering hardening

1. Separate player-private browser/runtime state for any peer mode (RA-015).
2. Repair the root test script and add CI/artifact consistency gates (RA-016).
3. Isolate or update the Solc `tmp` dependency and keep compiler tooling off production paths (RA-017).
4. Correct README/security documentation only after the new exploit tests pass.

## Final assessment

The card evaluator and several local authorization fixes are solid improvements, but Nightfold's core security property is not yet end-to-end. Today, fairness depends on an unbounded dealer choice, custody depends on an unverified relayer and oracle, and global chip conservation exists only inside each individual contract instance. These are protocol-design issues, not surface-level checks; fixing them requires a single explicit state/conservation model across every chain and component.
