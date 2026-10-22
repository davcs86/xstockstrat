# Feature: fix-after-hours-positions-priced

**Type**: bug
**Development Branch**: `feature/fix-after-hours-positions-priced` (triage committed on harness branch `ccr-9f55a8ac-dtw4iv`; see context.md)
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-19
**Last Updated**: 2026-10-20
**Committed to main**: 65bbc3cbf93a03f5359b60228398a25e6f297f05
**Launched date**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-19 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md` |
| 2026-10-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved (8 warnings, carried to design) |
| 2026-10-19 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved with conditions; recon.md + design.md written |
| 2026-10-19 | `design-approved` (unchanged) | /sdd-review | Post-design product-spec re-review: PASS WITH WARNINGS (10), all addressed |
| 2026-10-19 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps |
| 2026-10-19 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode (operator: no checkpoints); Step 1 done |
| 2026-10-20 | `in-progress` → `code-completed` | /sdd-execute | All 13 steps done (sequential, one commit per step); integration PR #1256 → `main-dev` |

| 2026-10-20 | `code-completed` → `launched` | CI workflow | Promoted via PR #1258; committed 65bbc3cbf93a03f5359b60228398a25e6f297f05 |
---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-19). Stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk, BSR publication readiness | 3, 4 |
| `packages/proto` owner | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), naming conventions | 3, 4 |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability | 1, 2 |
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 3, 4, 5–10 |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 3, 4, 11, 12 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — codebase dossier, existing business rules (C-16)
- [Design](design.md) — approved design (3 rounds), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 13 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

After the market close, a one-sided IEX quote (one of ask or bid is 0) is averaged as `(ask + bid) / 2`, so
quote-priced positions, persisted equity snapshots, risk valuation and the fundamentals price overlay
read at about half the real price.

## Next Action

Merge integration PR #1256 into `main-dev`; then the after-close staging check (Claude, via the staging MCP); half-priced EDGAR cache rows self-expire within 24h (`context.md` § Rollout decision). `/promote` flips to `launched`.
