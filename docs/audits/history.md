# Security Audit History

## 2026-08-29 — midnight

- Mode: Daily, full audit
- Snapshot: `64034560bc16e6f53ad8609fda10c37f1ec2ea32`
- Findings: 10 (C: 5, H: 3, M: 1, L: 1, I: 0)
- New: 10 | Resolved: 0 | Persistent: 0
- Confidence gate: 8/10

## 2026-08-29 — midnight re-audit

- Mode: Comprehensive full repository re-audit
- Snapshot: `1683e5a`
- Findings: 18 (C: 5, H: 7, M: 3, L: 2, I: 1)
- Prior audit status: 6 resolved, 2 partially resolved, 2 persistent/reshaped
- Active proofs: 8 (cage drain, false escrow winner, dealer nonce grind, impossible duplicate cards, oracle drain, cross-cage double issue, unauthenticated hand open, unequal all-in deadlock)
- Confidence gate: 2/10
- Report: `midnight-2026-08-29-reaudit.md`

## 2026-08-29 — midnight remediation verification

- Mode: Daily remediation verification
- Snapshot: `9fada51` (security remediation at `5099c0f`)
- Findings: 14 (C: 3, H: 4, M: 4, L: 2, I: 1)
- Original 18: Fixed 5 | Partial 6 | Open 6 | Accepted/not implemented 1
- Active proofs: 8 (two cage drains, pending-deposit insolvency, receipt nonce collision, oracle-role insolvency, cross-seat duplicate card, invalid real-proof witnesses, shown-card rendering)
- Confidence gate: 8/10
- Report: `midnight-2026-08-29-remediation-verification.md`
