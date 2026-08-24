# Feature: fix-ohlcv-chunk-lock-oom

**Type**: bug
**Development Branch**: `feature/fix-ohlcv-chunk-lock-oom`
**Defect Report**: `docs/reports/2026-08-24-ohlcv-lock-table-exhaustion-recurrence-defect.md` (GitHub Issues disabled on this repo — report path stands in for the issue URL)
**Severity**: SEV-2
**Created**: 2026-08-24
**Last Updated**: 2026-08-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-24 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report 2026-08-24-ohlcv-lock-table-exhaustion-recurrence-defect.md |
| 2026-08-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings; overlap CLEAN). Consumer-surface warning fixed; other 2 deferred to design |
| 2026-08-24 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written. A+B: max_locks 64→1024 + ohlcv migration 004 (30d), no app-code change |
| 2026-08-24 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps (migration 004 @ 30d; Piece A runbook + AC-1 invariant; chunk-interval doc consistency) |
| 2026-08-24 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done — migration 004 widen ohlcv chunk interval to 30d (offline up/down verified) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — 3 steps (migration + docs; no app-code change)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

TimescaleDB "out of shared memory" (SQLSTATE 53200) recurs on `marketdata.ohlcv` bars queries: a
400-day analysis lookback against a hypertable chunked at 1 day locks ~400 chunks per query and
exhausts the small lock table on the `db-s-1vcpu-1gb` cluster. Recurrence of launched feature 141,
whose fix only covered `_compute_opportunities`; now also failing from `EvaluateReadiness`.

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at `/sdd-spec` time (governs this feature's
review criteria even if the registry later changes). Only Step 1 (migration) carries reviewers; the
two `docs` steps have none.

| Reviewer | Scope / focus |
|---|---|
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair present, hypertable partitioning strategy, run-order compliance with `scripts/db-migrate.sh` |
| xstockstrat-marketdata (service owner) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |

## Next Action

`/sdd-review fix-ohlcv-chunk-lock-oom impl-spec` — validate the implementation spec, then
`/sdd-execute fix-ohlcv-chunk-lock-oom`.
