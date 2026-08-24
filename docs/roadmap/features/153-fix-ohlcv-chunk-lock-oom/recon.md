# Recon: fix-ohlcv-chunk-lock-oom

**Created**: 2026-08-24
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata, xstockstrat-analysis (+ DO managed PostgreSQL cluster `xstockstrat`, infra)

---

## Objective

Clear the recurring TimescaleDB `out of shared memory` (SQLSTATE 53200) on `marketdata.ohlcv` bars
queries. Root cause: the hypertable is chunked at **1 day**, and analysis scans a **400-day** window
per symbol, so a single `QueryBars` locks ~400 daily chunks (× PK + 2 indexes) and exhausts the small
lock table on the `db-s-1vcpu-1gb` cluster (`max_locks_per_transaction=64`). Feature 141 bounded this
only inside `_compute_opportunities`; it now recurs from the unguarded `EvaluateReadiness` path.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - ohlcv hypertable + chunk config: `migrations/001_marketdata_hypertables.up.sql:23-28`
    (`create_hypertable(..., chunk_time_interval => INTERVAL '1 day')`); PK `(symbol, timeframe, time)`
    `:20`; indexes `idx_ohlcv_symbol_time`/`idx_ohlcv_timeframe_time` `:31,33`. quotes chunk interval
    `INTERVAL '1 hour'` `:49-52`.
  - Last migration: `003_canonicalize_ohlcv_timeframe.up.sql` → **next is `004`** (chain: 000/001/002/003).
  - Read paths: `internal/repository/marketdata_repo.go` — `QueryBars` `:86` (WHERE `time >= $3 AND time
    <= $4` `:101`), `QueryRecentBars` `:169` (no lower bound `:176`), `GetCoverage` `:199-203`,
    `DeleteBars`/`buildDeleteBarsQuery` `:243`/`:222`.
  - Pool / routing: `internal/repository/pool.go:19` (`MaxConns` default 2, `DB_POOL_MAX` `:25-28`);
    PgBouncer exec-mode `pool.go:36-37` (`DB_PGBOUNCER` → `QueryExecModeExec`). Prod service routes
    through PgBouncer `:25061` (`.do/app.yaml:130-141`); **db-migrator job runs PRE_DEPLOY on the
    DIRECT managed URL** (`.do/app.yaml:482-501`), not the pooler.
  - Migration runner: `scripts/db-migrate.sh:90` (`migrate ... up`, golang-migrate `4.17.1`,
    `scripts/Dockerfile.migrate:6`); **each migration file is wrapped in its own transaction**
    (golang-migrate postgres driver; noted `003_...up.sql:27-28`).
  - Config-read: `internal/config/config.go:74` `NewWatcher(...)`, accessors `:149-191`.

- **`xstockstrat-analysis`** (Python) — all `app/handlers/servicer.py` unless noted
  - `_READINESS_LOOKBACK_DAYS = 400` `:250`; `_recent_range(...)` `:3704`; `_BAR_PAGE_SIZE=1000` `:239`,
    `_MAX_BAR_PAGES=32` `:245`.
  - `_fetch_bars_paged(symbol, range_msg, meta)` `:1041` (paged `GetBars`, `timeframe="1d"` `:1064`).
  - Feature-141 guard: `self._bars_fetch_sem = asyncio.Semaphore(max(1, get_int("analysis.opportunity.max_concurrent_bars_fetches", 2)))` `:374-376`; per-pass dedup `bars_by_symbol` `:3323`; guarded fetch `:3346-3350`. Sibling precedent `self._component_series_sem` (`analysis.series.max_concurrent_components`, default 4) `:363-364`.
  - Config accessors: `app/config/watcher.py` `get_int` `:95` (zero-trap), `get_int_present` `:103`.
  - Live loop: `app/engine/live_loop.py` — raw un-paged `GetBars`, `_LOOKBACK_DAYS = 365` `:45`;
    `_eval_pair` `:495-502`; `_load_benchmark_bars` `:452,478-485`.
  - Tests: `tests/test_analysis_servicer.py` — `TestOpportunityBarsFetchDedup` `:4603`,
    `TestEvaluateReadiness` `:3731` (`_svc` `:3732`), helpers `_strat_row` `:3968` /
    `_materialized_svc` `:4029` / `_list_opps` `:4103`.

### 400-day bars-fetch call sites — guarded vs. UNGUARDED (the blast-radius map)

| Call site | `path:line` | Window | Guarded by `_bars_fetch_sem`/dedup? |
|---|---|---|---|
| `_compute_opportunities` | `servicer.py:3316,3348` | 400d | **GUARDED** (feature 141) |
| `EvaluateReadiness` (RPC) | `servicer.py:2782,2791` | 400d | **UNGUARDED** ← failing in prod; also no per-user lock |
| `_load_benchmark_bars_windowed` | `servicer.py:1413,1437/1439` | 400d | guarded only if caller passes `sem`; `EvaluateReadiness` calls it w/o sem `:2784` |
| `_resolve_prefixed_bars` → backtest | `servicer.py:1097,1111/1119` | window+warmup | UNGUARDED (backtest) |
| `_benchmark_series_bars` (`GetIndicatorSeries`) | `servicer.py:1449,1468` | — | UNGUARDED |
| live loop `_eval_pair` / `_load_benchmark_bars` | `live_loop.py:495-502,478-485` | 365d | UNGUARDED (raw un-paged GetBars) |

## Patterns to REUSE

- **New chunk-interval migration** → mirror `003_canonicalize_ohlcv_timeframe.{up,down}.sql` — the one
  prior "touch existing ohlcv" migration: log-table + compressed-chunk pre-flight `DO $$` guard
  (`003_...up.sql:27-40,53`), faithful `.down.sql`. **No `set_chunk_time_interval` / retention /
  compression / CAGG precedent exists in this service** (grep-zero) — this is the first Timescale-admin
  migration here.
- **App-level concurrency guard (if adopted)** → reuse feature 141's exact shape: a process-lifetime
  `asyncio.Semaphore` in `__init__` read once via `get_int(..., default)` with a `max(1, …)` clamp
  (`servicer.py:363-376`), plus per-pass `bars_by_symbol` dedup. Same config-key style
  (`analysis.opportunity.max_concurrent_bars_fetches`) — runtime-registered, **no DB seed**.
- **Migration verification** → SQL/DDL review against DDL facts + DBA/service-owner sign-off is this
  repo's actual bar (see fails trap below); do NOT spec a live-DB round trip as the gate.

## Existing Business Rules (preserve / extend)

- **No promoted `@AC-*` covers the bars/OHLCV/readiness/opportunities path.** The only marketdata suite
  (`services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature`, `@AC-6`/`@AC-7`,
  feature 147) guarantees vendor-credential resolution via `GetSecret` — unrelated. `platform.feature`'s
  single scenario is deploy-surface hygiene. **No `services/xstockstrat-analysis/acceptance/` suite exists yet.**
- This is a **coverage gap, not a guarantee to preserve**: the behavior the fix must not regress
  (daily-bars retrieval returning valid data; readiness/opportunities producing results) is governed by
  structural invariants + per-feature specs, not any promoted `@AC-*`. Treat as "no promoted rule," not
  "no behavior." No CHANGE flagged — internal reliability fix, observable behavior unchanged.

## Dependencies

- Proto/RPC: **none** (no message/field/RPC change; `GetBars`/`EvaluateReadiness` signatures unchanged).
- Migration: next number **`004`** for `services/xstockstrat-marketdata/migrations/` (re-derive against
  the merged tree at `/sdd-spec` time — stale-NNN ledger trap below).
- Config keys: possibly reuse the runtime-registered `analysis.opportunity.max_concurrent_bars_fetches`
  (existing, feature 141) if the guard is extended; **no new WatchConfig key required**. `max_locks_per_transaction`
  is a **Postgres server parameter, not a WatchConfig key** (F-07 not implicated).
- Inter-service edges: none new (analysis → marketdata `GetBars` already exists).
- New env vars / ports: none.
- Infra: DO cluster `xstockstrat` (`1b5ad082-...`), `db-s-1vcpu-1gb`, PG 18. `max_locks_per_transaction`
  bump is out-of-repo (DO config API / support) — no repo file encodes it.

## Risks / Not-found

- **`set_chunk_time_interval` only affects FUTURE chunks.** Existing ~400 one-day chunks stay 1-day
  until re-chunked or aged out (~400 days) — so the chunk-widening migration **alone gives little
  immediate relief** on the existing back-history that readiness queries scan. Re-chunking populated
  data has **no in-place Timescale function**; it requires recreating/moving data (heavier, needs the
  003-style remediation-log/backup + compressed-chunk pre-flight). **Core design question.**
- **`max_locks_per_transaction` settability unknown.** Absent from the DO `get-postgresql-config`
  response → may not be settable via `db-cluster-update-psql-config` on this plan; may need support or a
  plan change, and a **cluster restart** (brief downtime). Not yet confirmed. (Not-found: no repo/API
  evidence it is settable.)
- **A single 400-day query can nearly exhaust the lock table on its own** (~400 chunks × ~4 rel locks ≈
  1,600 ≈ the whole table) — so the app-level guard (concurrency bound) is defense-in-depth, **not** a
  standalone fix; feature 141 already demonstrated concurrency-limiting is insufficient.
- **Blast radius is wider than `EvaluateReadiness`.** Backtest paths, `GetIndicatorSeries` benchmark,
  and the live loop (365d, raw un-paged `GetBars`) are all unguarded — any of them can still trip 53200.
- **Not found:** the specific 400-day caller from marketdata's own tree (it lives in analysis — mapped
  above); no existing `EvaluateReadiness`-semaphore test (path is currently unguarded).
- **fails.md trap — F-05 migration verification** (`2026-08-06 fix-backfill-timeframe-enum`): do NOT mark
  the migration step blocked for lack of a live DB, and do NOT spec a fully-deployed-instance / live-53200
  reproduction as the acceptance gate (`2026-08-13 fundamentals-provider-alternative`). SQL/DDL review +
  clean local up/down + DBA sign-off is the bar. Acceptance AC-1/AC-2 must be phrased accordingly.
- **insights trap — stale NNN & data-moving migration** (`resumable-chunked-backfills`; `fix-backfill-timeframe-enum design`):
  re-derive `004` at execute time; if re-chunking existing data, default to the remediation-log pattern so `.down.sql` is faithful.

## Recommended Scope (advisory — input to grilling)

1. **marketdata migration `004`** — widen ohlcv `chunk_time_interval` (target interval a debate output),
   mirroring 003's transaction/pre-flight/`.down.sql` discipline; decide future-only vs. re-chunk-existing.
2. **Infra** — raise cluster `max_locks_per_transaction` (immediate relief); confirm settability +
   restart impact first. This is the operator-run piece; the repo can only document it (runbook).
3. **analysis guard extension (optional, debate)** — apply feature 141's `_bars_fetch_sem` + dedup to
   `EvaluateReadiness` (and consider the other unguarded 400-day sites) as defense-in-depth.
4. **tests** — SQL/DDL review of the migration (up/down); unit tests for any guard extension mirroring
   `TestOpportunityBarsFetchDedup`; no live-DB reproduction as a gate.
