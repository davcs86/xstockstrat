# Feature: fix-etf-flag-fill

**Type**: bug
**Development Branch**: `feature/fix-etf-flag-fill`
**GitHub Issue**: n/a (Issues disabled) — defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-15
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md` |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings, overlap WARN); scope narrowed to @AC-2/@AC-3, lands after 255 |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps; acceptance.feature amended (@AC-2 rewritten, @AC-3 split into @AC-3/@AC-5/@AC-6, @AC-4 and @AC-7 added) and product-spec FR-2 trace clause + FR-3 added per design.md |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec (2026-10-22).

| Role | Focus | Steps |
|---|---|---|
| xstockstrat-marketdata owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 1, 2, 3, 4, 5 |
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 7 (read-only) |

---

## Summary

The background ETF-flag fill in xstockstrat-marketdata never labels SCHD on staging, so feature 215's
`fundamentals_gap` stays `FUNDAMENTALS_GAP_UNSPECIFIED`. Nothing at Info level shows why. The prime
suspect, the FMP budget boot seed counting non-FMP fundamentals rows, is fixed by
`255-fix-marketdata-fundamentals-cache`; 230 (narrowed 2026-10-22) lands after 255 and adds the
later-call labelling guard plus rate-limited Info-level fill visibility.

## Next Action

`/sdd-review fix-etf-flag-fill impl-spec` — validate implementation spec, then `/sdd-execute fix-etf-flag-fill` (only after 255 has merged; see implementation-spec.md § Step Dependencies)
