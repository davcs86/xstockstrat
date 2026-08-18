# Feature: chart-data-freshness

**Lifecycle Status**: `draft`
**Development Branch**: `feature/chart-data-freshness`
**Created**: 2026-08-18
**Last Updated**: 2026-08-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-18 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec chart-data-freshness`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make **daily (1Day)** price charts reflect current daily OHLCV instead of freezing at the last
backfill. Closes three stacked staleness gaps: no UI auto-refresh on the daily view, an always-on
ingester that only refreshes `15m` bars, and a `GetBars` live-fallback that fires only on an empty
DB. Scope is strictly the `1d` timeframe — no `15m`/`1h` data is introduced or refreshed by this work.
Also closes the **observability** half of the same trust problem (FR-6): the steady-state analysis
paths (live loop / evaluator / readiness / screener) today evaluate on empty/insufficient bars
silently — this adds WARN logging so data gaps surface in the runtime logs, not only in an RPC
response field the UI reads.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-ui` owner | Trading UI correctness, Connect-RPC call safety, no secret values rendered in UI |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias (FR-6 log-only, no behavior change) |

## Next Action

`/sdd-review chart-data-freshness product-spec` — AI review of product spec before running /sdd-spec
