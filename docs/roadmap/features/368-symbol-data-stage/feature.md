# Feature: symbol-data-stage

**Development Branch**: `feature/symbol-data-stage`
**Created**: 2026-11-28
**Last Updated**: 2026-11-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-28 | `idea` → `draft` | /sdd-story | Product spec generated. Feature 2 of 9 in `docs/roadmap/program-job-graph-analysis-pipeline.md` |
| 2026-11-28 | `draft` → `spec-ready` | /sdd-review | Product spec approved (round 1 failed on criteria 6 and 8/9; round 2 passed with advisory warnings, fixed in the spec). Overlap clean |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec symbol-data-stage`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A daily stage on the analysis job graph that snapshots the symbol universe and runs one data job
per symbol: daily bars brought up to the last closed session with an automatic backfill, fundamentals
refreshed by staleness with EDGAR as the default source, and a durable coverage verdict and bar
record per symbol that program feature 3 evaluates from.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` service owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-marketdata` service owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-ingest` service owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-portfolio` service owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-config` service owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| Proto Reviewer (only if the design adds an RPC) | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk |

## Next Action

`/sdd-design symbol-data-stage` — full design recommended (DB migration, 5 affected services, changed default on a shared key)
