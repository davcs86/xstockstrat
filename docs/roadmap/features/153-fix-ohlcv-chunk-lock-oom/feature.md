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

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ohlcv-chunk-lock-oom`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

TimescaleDB "out of shared memory" (SQLSTATE 53200) recurs on `marketdata.ohlcv` bars queries: a
400-day analysis lookback against a hypertable chunked at 1 day locks ~400 chunks per query and
exhausts the small lock table on the `db-s-1vcpu-1gb` cluster. Recurrence of launched feature 141,
whose fix only covered `_compute_opportunities`; now also failing from `EvaluateReadiness`.

## Next Action

`/sdd-design fix-ohlcv-chunk-lock-oom` — recommended design depth: **full** (DB migration + affected
services ≥ 2). See context.md.
