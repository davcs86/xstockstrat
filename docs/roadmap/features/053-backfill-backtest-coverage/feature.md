# Feature: backfill-backtest-coverage

**Lifecycle Status**: `launched`
**Committed to main**: 0b503103817c8d8d2089c057a10db12fb7a098a5
**Launched date**: 2026-06-09
**Development Branch**: `feature/backfill-backtest-coverage`
**Created**: 2026-06-08
**Last Updated**: 2026-06-09

**Priority Bucket**: P1 — Close the backfill↔backtest loop (2 of 3 in the backfill-hardening initiative)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved; timeframe normalization chosen as shared proto enum (breaking → elevated approval gate); 4 open questions resolved |
| 2026-06-08 | `spec-ready` (revised) | user | Scope change: UI "backfill this range" action (FR-6) moved IN scope; `xstockstrat-ui` added as affected service + reviewer |
| 2026-06-09 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-06-09 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential stacked run (on 052). Re-spec: Step 1 ingest `BackfillJob.timeframe_enum` 11→12 (052 took field 11) |
| 2026-06-09 | `in-progress` → `code-completed` | /sdd-execute | All 12 steps done; marketdata go test cov 66.9%, analysis pytest 94 passed (cov 60.4%), UI tsc+lint clean. Breaking `Timeframe` enum — Platform Lead approval required before merge |

| 2026-06-09 | `code-completed` → `launched` | CI workflow | Promoted via PR #649; committed 0b503103817c8d8d2089c057a10db12fb7a098a5 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 12 steps, status `pending`
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make backtests aware of data coverage. Add a `GetDataCoverage` RPC on `xstockstrat-marketdata`,
have `RunBacktest` return a structured "insufficient data" result (range, bars-have, bars-need)
instead of a silent flat-equity no-op, normalize the timeframe vocabulary (`"1d"` vs `"1Day"`)
that currently differs between the backfill and backtest paths, and surface a "backfill this range"
action in the `xstockstrat-ui` backtest view that triggers the gap fill.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, **breaking-change deprecation path for the `Timeframe` enum migration**, `buf lint`/`buf breaking` pass (new `GetDataCoverage` RPC + messages; `common/v1` `Timeframe` enum) |
| Platform Lead | **Required — breaking proto change** (per `docs/runbooks/approval-flow.md`): cross-service `Timeframe` enum migration, deprecation cycle, contract consistency across marketdata + analysis |
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, coverage-query correctness over the `marketdata.ohlcv` hypertable |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, no look-ahead bias, correct surfacing of insufficient-data without silently faking equity |
| `xstockstrat-ui` (service owner) | Trading UI correctness, BFF Connect-RPC call safety, header propagation on the `TriggerBackfill` call, no secret values rendered, Playwright E2E for the gap message + backfill action (FR-6) |

## Next Action

`/sdd-review backfill-backtest-coverage impl-spec` — validate implementation spec, then `/sdd-execute backfill-backtest-coverage`
