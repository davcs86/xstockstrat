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
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps; product-spec FR-1/FR-4/FR-5/FR-6/FR-7 and acceptance AC-1/AC-5 restated per operator sign-off (a)/(b) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), from the per-step `**Reviewers**` lines.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | 2, 3, 4, 5, 8 |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 6, 7 |
| DBA | Only if Step 8 fails and the remedy is ledger index migration `004` (C-07; re-spec required) | Conditional |
| Proto Reviewer | Not required: no `.proto` change (no `QueryEventsRequest` field added) | — |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — approved design (chosen approach, rejected alternatives, open risks)
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Ledger `QueryEvents` emits `nextPageToken` but never reads `pageToken` (D-13). Portfolio `GetPnL` pages it, so it
re-reads page 1 until the deadline and returns an inflated realized P&L as success (D-46). The `StreamEvents` replay
is one unbounded query on ledger's single-connection pool (D-27). **Sequence before or with
`251-fix-getpnl-source-service`**: fixing 251 alone exposes D-46.

## Next Action

`/sdd-review fix-ledger-query-pagination impl-spec` — validate implementation spec, then `/sdd-execute fix-ledger-query-pagination` (only after 263 and 252 are merged into `main-dev` and this branch is merged up; Step 1 writes the merge-order rows)
