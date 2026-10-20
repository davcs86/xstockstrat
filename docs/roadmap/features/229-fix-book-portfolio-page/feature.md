# Feature: fix-book-portfolio-page

**Type**: bug
**Development Branch**: `ccr-9f55a8ac-dtw4iv` (harness-assigned; see context.md)
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-16-portfolio-page-stuck-loading-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-16
**Last Updated**: 2026-10-18
**Committed to main**: 65bbc3cbf93a03f5359b60228398a25e6f297f05
**Launched date**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-16-portfolio-page-stuck-loading-defect.md` |
| 2026-10-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved on round 2 (7 warnings carried to design) |
| 2026-10-18 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, quick extended by operator) and approved; recon.md + design.md written |
| 2026-10-18 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |
| 2026-10-18 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode; Steps 1–2 done |
| 2026-10-18 | `in-progress` → `code-completed` | /sdd-execute | All 11 steps done; staging gates G1–G4 pending (operator) before merge |

| 2026-10-20 | `code-completed` → `launched` | CI workflow | Promoted via PR #1258; committed 65bbc3cbf93a03f5359b60228398a25e6f297f05 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — codebase dossier, existing business rules (C-16)
- [Design](design.md) — approved design (4 rounds), rejected alternatives, open risks, staging gates G1–G4
- [Implementation Spec](implementation-spec.md) — 11 steps (config bounds, marketdata repo/quote path/retention, portfolio deadline + GetPnL, docs)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at `/sdd-spec` time (2026-10-18). Stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-config owner | Config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, secret encryption + redaction, WatchConfig stream stability | 1, 2 |
| xstockstrat-marketdata owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 3, 4, 5, 6, 7, 8 |
| xstockstrat-portfolio owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 9, 10 |

Not a registry reviewer, but a merge gate: DBA acknowledgement **G4** (automated, irreversible quote deletion) is recorded in `context.md` before Step 7 merges.

---

## Summary

Book → Portfolio stays on "Loading portfolio…" forever. Portfolio's quote enrichment waits with no deadline on marketdata
`GetLatestQuotes`, whose batch query scans every hourly chunk of the never-pruned `marketdata.quotes` hypertable and starves
marketdata's 2-connection pool.

## Next Action

Operator: run staging gates G1–G4 and record them in context.md, then merge integration PR #1251; dev smoke-test Book → Portfolio + MCP `get_positions`; flip the defect sidecar to `resolved`.
