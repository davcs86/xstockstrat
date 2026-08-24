# Defect: "out of shared memory" (SQLSTATE 53200) recurs on ohlcv bars queries after feature 141

**Recorded**: 2026-08-24
**Severity**: SEV-2
**Impact type**: readiness/opportunity bars-fetch failing → symbols silently skipped
**Environment**: staging (xstockstrat-staging)
**Affected service(s)**: xstockstrat-marketdata (query target / root cause), xstockstrat-analysis (caller), DO managed PostgreSQL cluster `xstockstrat` (`db-s-1vcpu-1gb`)
**Config-only fix possible**: partial — a `max_locks_per_transaction` bump is a cluster-config change (immediate relief); the durable fix is a marketdata schema migration (chunk interval)
**Relates to**: feature 141 (`fix-opportunities-bars-fetch-oom`, launched 2026-08-19) — this is the recurrence 141's design.md Open Risk 1 explicitly anticipated.

## Observed

Live in staging RUN logs (deployment `8027bc2c-84af-418e-907d-fec18ef3d4a8`, 2026-08-24):

```
xstockstrat-analysis 2026-08-24T19:51:06Z WARNING app.handlers.servicer
  EvaluateReadiness: bars fetch failed for AMD: <AioRpcError of RPC that terminated with:
  details = "internal: query bars: ERROR: out of shared memory (SQLSTATE 53200)"
  grpc_status:13
```

The originating error is raised inside `xstockstrat-marketdata` at
`internal/repository/marketdata_repo.go:107` (`QueryBars` → `fmt.Errorf("query bars: %w", err)`),
wrapped by the service layer at `internal/service/marketdata_service.go:201`, and surfaces to the
caller as gRPC `INTERNAL`.

Note the call site: **`EvaluateReadiness`** (`servicer.py:2791`), **not** `_compute_opportunities`.
Feature 141's dedup + `_bars_fetch_sem` semaphore was scoped only to `_compute_opportunities`; the
other 400-day bars-fetch paths — `EvaluateReadiness` (`:2782`/`:2791`), the live loop, the
per-symbol readiness fetch at `:2782` region — were not guarded and still issue unbounded queries.

## Expected

Bars fetches for all requested symbols succeed; no Postgres resource exhaustion (SQLSTATE 53200).

## Root cause (now confirmed — no longer the low-confidence hypothesis of 141)

TimescaleDB "out of shared memory" (SQLSTATE 53200) is lock-table exhaustion. The lock table is
sized `max_locks_per_transaction × (max_connections + max_prepared_transactions)` in shared memory.
Two facts combine to exhaust it:

1. **Chunk granularity.** `marketdata.ohlcv` is a hypertable chunked at **`INTERVAL '1 day'`**
   (`services/xstockstrat-marketdata/migrations/001_marketdata_hypertables.up.sql:23-28`). Each
   daily chunk is a separate child table with its own indexes (PK + `idx_ohlcv_symbol_time` +
   `idx_ohlcv_timeframe_time`), each needing its own `AccessShareLock` during a scan.

2. **Query window.** Every analysis bars fetch uses `_READINESS_LOOKBACK_DAYS = 400`
   (`services/xstockstrat-analysis/app/handlers/servicer.py:250`) via `_recent_range(...)` →
   `_fetch_bars_paged`. A 400-calendar-day range spans on the order of **~400 daily chunks**, so a
   single `QueryBars` can require several hundred to ~1,600 lock-table entries by itself.

On the managed cluster (`db-s-1vcpu-1gb`, PostgreSQL 18, 1 vCPU / 1 GB RAM) `max_prepared_transactions`
is `0` and the platform runs at ~13–22 backend connections. With the stock `max_locks_per_transaction`
(64), the whole cluster lock table is roughly `64 × ~25 ≈ 1,600` slots — a single 400-day query
approaches that ceiling, and any concurrency across the unguarded call sites tips it over → 53200.

Feature 141's dedup + semaphore reduced the *number* and *concurrency* of these queries out of
`_compute_opportunities`, but each individual query still locks ~400 chunks, and other call sites
(`EvaluateReadiness`, live loop) were never brought under the same guard — exactly the "escalate to
the deferred Postgres-tuning / chunk-interval alternatives" path 141's design.md Open Risk 1 said to
take if the incident recurred.

## Evidence

- Call site (caller): `services/xstockstrat-analysis/app/handlers/servicer.py:2791` (EvaluateReadiness),
  `:250` (`_READINESS_LOOKBACK_DAYS = 400`), `:1041` (`_fetch_bars_paged`, `timeframe="1d"`).
- Error origin (target): `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:98-108`
  (`QueryBars`), wrapped at `internal/service/marketdata_service.go:201`.
- Chunk config: `services/xstockstrat-marketdata/migrations/001_marketdata_hypertables.up.sql:23-28`
  (`chunk_time_interval => INTERVAL '1 day'`).
- Cluster: DO DB `xstockstrat` id `1b5ad082-8145-4e09-bdcf-936adfc21f2a`, size `db-s-1vcpu-1gb`,
  PG 18, `max_prepared_transactions=0` (from `db-cluster-get-postgresql-config`).
- Live log: staging deployment `8027bc2c-84af-418e-907d-fec18ef3d4a8`, `xstockstrat-analysis` RUN,
  2026-08-24T19:51:06Z (one `EvaluateReadiness` occurrence in the last ~100 min window observed;
  no `_compute_opportunities` occurrences — 141's guard is holding on that path).
- Direct DB introspection (chunk count, `SHOW max_locks_per_transaction`) was **not** possible from
  the CI sandbox — the cluster trusted-sources firewall blocks it and only HTTPS is proxied. The
  chunk-per-query math above is derived from the migration + lookback constant, not a live
  `timescaledb_information.chunks` count; a confirming count should be taken during the fix.

## Proposed remediation (both, per operator decision 2026-08-24)

1. **Immediate relief — raise `max_locks_per_transaction` on the cluster** (e.g. 64 → 256) so the
   lock table is large enough to absorb a 400-day scan plus concurrency. Caveat to verify in triage:
   `max_locks_per_transaction` was **not** present in the DO `db-cluster-get-postgresql-config`
   response, so it may not be settable through the standard advanced-config API on this plan and may
   need a different mechanism (support/plan). It also costs a little shared RAM on a 1 GB box and
   requires a cluster restart (brief downtime). This does not fix the chunk explosion.

2. **Durable root-cause fix — widen the ohlcv chunk interval** via a new numbered marketdata
   migration: `SELECT set_chunk_time_interval('marketdata.ohlcv', INTERVAL '30 days');` so a 400-day
   query locks ~14 chunks instead of ~400. `set_chunk_time_interval` only affects **future** chunks;
   re-chunking existing data (or accepting a mixed layout until old chunks age out) must be scoped in
   the fix. Daily is the only requestable timeframe (feature 143), so a wider chunk does not harm the
   trading path. DBA + service-owner approval per root CLAUDE.md § Approval Flow (DB migration).

Also worth folding in (not chosen as primary, note for the fix): extend feature 141's dedup +
`_bars_fetch_sem` guard to `EvaluateReadiness` and the other unguarded 400-day fetch sites so the
blast radius is bounded regardless of DB tuning.

## Confidence

high (root cause), vs. the 2026-08-16 report's low — the chunk-interval × lookback × lock-table math
is now grounded in the migration, the lookback constant, and the confirmed cluster size/PG settings.
