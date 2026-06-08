# Feature: backfill-backtest-coverage

**Lifecycle Status**: `draft`
**Development Branch**: `feature/backfill-backtest-coverage`
**Created**: 2026-06-08
**Last Updated**: 2026-06-08

**Priority Bucket**: P1 — Close the backfill↔backtest loop (2 of 3 in the backfill-hardening initiative)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-08 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backfill-backtest-coverage`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make backtests aware of data coverage. Add a `GetDataCoverage` RPC on `xstockstrat-marketdata`,
have `RunBacktest` return a structured "insufficient data" result (range, bars-have, bars-need)
instead of a silent flat-equity no-op, and normalize the timeframe vocabulary (`"1d"` vs `"1Day"`)
that currently differs between the backfill and backtest paths.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass (new `GetDataCoverage` RPC + messages; possible timeframe enum) |
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, coverage-query correctness over the `marketdata.ohlcv` hypertable |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, no look-ahead bias, correct surfacing of insufficient-data without silently faking equity |

## Next Action

`/sdd-review backfill-backtest-coverage product-spec` — AI review of product spec before running /sdd-spec
