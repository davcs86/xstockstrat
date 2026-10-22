# Feature: fix-ledger-query-pagination

**Type**: bug
**Development Branch**: `feature/fix-ledger-query-pagination`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-ledger-query-pagination-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-ledger-query-pagination-defect.md` (debt-radar D-13, D-27, D-46) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN with 248, 251, 263) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Operator signed off FR-1/FR-7/AC-5 late-commit wording and FR-5 max-cumulative pass 2; 263 merges first |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ledger` owner | Append-only invariant, event ordering, keyset pagination and bounded replay (D-13, D-27) | TBD (/sdd-spec) |
| `xstockstrat-portfolio` owner | P&L calculation accuracy: `GetPnL` exactly-once fold and fail-on-error (D-46) | TBD (/sdd-spec) |
| DBA | Only if design adds an index for the keyset (existing `idx_events_sequence` likely suffices) | Conditional |
| Proto Reviewer | Only if design changes `PageRequest`/`PageResponse` semantics in `common.proto` (not anticipated) | Conditional |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — approved design (chosen approach, rejected alternatives, open risks)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ledger-query-pagination`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Ledger `QueryEvents` emits `nextPageToken` but never reads `pageToken` (D-13). Portfolio `GetPnL` pages it, so it
re-reads page 1 until the deadline and returns an inflated realized P&L as success (D-46). The `StreamEvents` replay
is one unbounded query on ledger's single-connection pool (D-27). **Sequence before or with
`251-fix-getpnl-source-service`**: fixing 251 alone exposes D-46.

## Next Action

`/sdd-spec fix-ledger-query-pagination` — generate implementation spec from the approved design (rebase onto 263 first; restate FR-1/FR-5/FR-7 and AC-1/AC-5 per the operator sign-off; write the merge-order 257 ≤ 251 row)
