# Product Spec: fix-ohlcv-chunk-lock-oom

**Type**: bug
**Defect Report**: `docs/reports/2026-08-24-ohlcv-lock-table-exhaustion-recurrence-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-24

---

## Problem Statement

`marketdata.ohlcv` bars queries intermittently fail with `ERROR: out of shared memory (SQLSTATE
53200)`, surfacing to callers as gRPC `INTERNAL: query bars: ...`. Observed live in staging
(2026-08-24T19:51:06Z) from `EvaluateReadiness`; symbols whose bars fetch fails are silently skipped
for that cycle's readiness/opportunity scoring.

**Observed:** a 400-day analysis bars fetch triggers a TimescaleDB lock-table exhaustion in the
marketdata query path.
**Expected:** every requested symbol's bars fetch succeeds; no Postgres resource exhaustion.

This is a **recurrence** of launched feature 141 (`fix-opportunities-bars-fetch-oom`). 141's design
(Open Risk 1) explicitly anticipated this: "if a real staging incident recurs after this ships,
escalate to the deferred Postgres-tuning / chunk-interval alternatives rather than re-guessing." 141
only guarded `_compute_opportunities`; the error now comes from `EvaluateReadiness`, an unguarded
path.

## Reproduction Steps

1. Let a live opportunity/readiness cycle run in staging with a normal watchlist/held/live-strategy set.
2. Watch `xstockstrat-analysis` RUN logs for `EvaluateReadiness: bars fetch failed for <SYM>` with
   `details = "internal: query bars: ERROR: out of shared memory (SQLSTATE 53200)"`.

## Root Cause Hypothesis

**Confirmed (high confidence).** Lock-table exhaustion. The lock table is sized
`max_locks_per_transaction × (max_connections + max_prepared_transactions)` in shared memory. Two
facts combine:

1. `marketdata.ohlcv` is chunked at `INTERVAL '1 day'`
   (`services/xstockstrat-marketdata/migrations/001_marketdata_hypertables.up.sql:23-28`); each daily
   chunk is a child table with PK + 2 indexes, each needing its own `AccessShareLock` during a scan.
2. Every analysis bars fetch uses `_READINESS_LOOKBACK_DAYS = 400`
   (`services/xstockstrat-analysis/app/handlers/servicer.py:250`), so a single `QueryBars`
   (`internal/repository/marketdata_repo.go:98-108`) spans ~400 daily chunks.

On the `db-s-1vcpu-1gb` cluster (PG 18, `max_prepared_transactions=0`, ~13–22 connections) the stock
`max_locks_per_transaction=64` yields a lock table of ~1,600 slots — a single 400-day query nears it
and any concurrency across unguarded call sites tips it over.

## Affected Services

- **xstockstrat-marketdata** — query target / root cause (chunk interval); `QueryBars`,
  migration `001`.
- **xstockstrat-analysis** — caller (`EvaluateReadiness` and other unguarded 400-day bars paths).
- **DO managed PostgreSQL cluster `xstockstrat`** — `max_locks_per_transaction` tuning target.

## Consumer Surface(s)

**None — internal / platform-only (C-14).** This is a reliability/infrastructure fix: it widens a
TimescaleDB hypertable chunk interval and raises a Postgres server parameter to clear resource
exhaustion. It adds no new RPC, request/response field, computed value, config key, or UI/agent
surface — it *restores* existing `GetBars` / `EvaluateReadiness` / `ListOpportunities` behavior that
was intermittently failing, rather than adding a capability. The optional feature-141-style
dedup/`_bars_fetch_sem` guard (if folded in at design) is likewise an internal resource-consumption
bound with no observable surface change.

## Fix Scope

- [x] No proto changes anticipated
- [ ] **DB migration anticipated** — new numbered marketdata migration widening the ohlcv chunk
  interval (`set_chunk_time_interval('marketdata.ohlcv', INTERVAL '30 days')`); DBA + service-owner
  approval (root CLAUDE.md § Approval Flow). Re-chunking of existing chunks vs. future-only must be
  decided at design.
- [ ] **Infra/config change anticipated (non-WatchConfig)** — raise `max_locks_per_transaction` on
  the DO cluster. NOT an app config key (not a `<service>.<category>.<key>` WatchConfig value); it is
  a Postgres server parameter. Open question for design: whether it is settable via
  `db-cluster-update-psql-config` (it was absent from the current `get-postgresql-config` response) or
  needs another mechanism.

Optional (to fold in at design): extend feature 141's per-symbol dedup + `_bars_fetch_sem` guard to
`EvaluateReadiness` and other unguarded 400-day fetch sites, bounding blast radius independent of DB
tuning.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing marketdata/analysis tests pass; the
marketdata migration applies cleanly (`up` + `down`) via `scripts/db-migrate.sh`; staging readiness
cycle runs with no 53200 error across a full compute pass.

## Out of Scope

- Shrinking the 400-day readiness lookback (feature 141 rejected this — it seeds long indicators).
- General bars-query performance work beyond clearing the resource exhaustion.
- Changing feature 131/132 candidate-set attribution semantics.
