# Feature: fix-marketdata-miss-path-noise

**Type**: bug
**Development Branch**: `feature/fix-marketdata-miss-path-noise`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md, docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |
| 2026-11-26 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); steps 8,11 re-spec'd against main-dev `f802b184` |
| 2026-11-27 | `in-progress` → `code-completed` | /sdd-execute | All 11 steps done (sequential, sdd-batch-execute); `check-config-wiring.mjs --final` exit 0 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 11 numbered steps (units: 1+2, 3+4, 5+6, 7+8+9+10; 11 docs)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at `/sdd-spec` (2026-11-20); stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-marketdata owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 1, 2, 9, 10 |
| xstockstrat-portfolio owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 3, 4 |
| xstockstrat-config owner | Config key naming, environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability | 5, 6, 7, 8 |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` | 8 |

Step 11 (docs) has no reviewer.

---

## Summary

Repeated WARN noise masks real failures: cancel-caused WARN sites feature 290 left in marketdata and portfolio, and
`GetBars` live-refetching (plus a WARN) on every call for symbols that have no stored bars and return none.

## Next Action

`/sdd-review fix-marketdata-miss-path-noise impl-spec` — validate implementation spec, then `/sdd-execute fix-marketdata-miss-path-noise`
