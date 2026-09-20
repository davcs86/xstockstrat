# Feature: historical-fundamentals-backtest

**Development Branch**: `feature/historical-fundamentals-backtest`
**Created**: 2026-09-20
**Last Updated**: 2026-09-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-20 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec historical-fundamentals-backtest`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Backfill a filing-date-aware, point-in-time historical time series of company fundamentals (income
statement, balance sheet, cash flow, derived ratios — quarterly and annual) from **SEC EDGAR**
(primary, as-reported statements keyed on the SEC `filed` date) enriched with **FMP Free** for
derived ratios, and let backtests reference those fundamentals as they were known at each point in
time — without look-ahead bias.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** (the central constraint here) |
| `xstockstrat-marketdata` owner | TimescaleDB hypertable partitioning for the new fundamentals-history store, vendor feed idempotency |
| `xstockstrat-ingest` owner | Idempotent backfill, resumable chunking, backfill-job schema stability |
| `xstockstrat-agent` owner | MCP tool contract stability (`trigger_backfill`, `run_backtest`), descriptor-parity projections, strat-lab `backtest` skill parity in the same PR |
| `xstockstrat-ui` owner | `/insights` backfills page + backtest strategy builder correctness, no direct DB access |
| Proto Reviewer | Field-number uniqueness, additive-only changes (no field removal/type change), `buf breaking` green |
| DBA | Migration NNN numbering (no gaps), up+down pair, hypertable partitioning strategy for the fundamentals-history table |
| `xstockstrat-config` owner | New config-key naming (`<service>.<category>.<key>`), reuse of feature-147 encrypted vendor credentials |

## Next Action

`/sdd-review historical-fundamentals-backtest product-spec` — AI review of product spec before running /sdd-spec
