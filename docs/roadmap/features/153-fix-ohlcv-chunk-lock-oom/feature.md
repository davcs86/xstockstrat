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

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ohlcv-chunk-lock-oom`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

TimescaleDB "out of shared memory" (SQLSTATE 53200) recurs on `marketdata.ohlcv` bars queries: a
400-day analysis lookback against a hypertable chunked at 1 day locks ~400 chunks per query and
exhausts the small lock table on the `db-s-1vcpu-1gb` cluster. Recurrence of launched feature 141,
whose fix only covered `_compute_opportunities`; now also failing from `EvaluateReadiness`.

## Next Action

`/sdd-spec fix-ohlcv-chunk-lock-oom` — generate the implementation spec from the approved design
(migration 004 @ 30d; the max_locks 64→1024 operator runbook; countable-invariant verification).
