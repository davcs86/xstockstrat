# Feature: chart-data-freshness

**Development Branch**: `feature/chart-data-freshness`
**Created**: 2026-08-18
**Last Updated**: 2026-08-19
**Committed to main**: 1d97c6c78caa532a24265dae2fa79c674b3b69dd
**Launched date**: 2026-08-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-18 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-18 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick→upgraded) and approved; recon.md + design.md written; FR-7 read-path root cause folded in |
| 2026-08-18 | `design-approved` → `code-completed` | direct-impl | FR-7/FR-2/FR-3 (marketdata), FR-1 (ui), FR-6 (analysis) implemented + tested; go/tsc/ruff/pytest green |

| 2026-08-19 | `code-completed` → `launched` | status reconciliation | Reconciled to launched: code in production (main==main-dev @ 1d97c6c7); CI status automation (ci-validate-feature-status.yml) missed the slug grep-match. PR #981. |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — completed-step record
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

Open the integration PR to `main-dev` (branch `claude/chart-data-freshness-pe7mvm`). Operator TODO
before/at rollout: verify no explicit `marketdata.stream.bar_ingest*` config row exists in dev + prod
(else set `bar_ingest_timeframe=1d` via config rollout — the code-default flip is a no-op if a row exists).
