# Recon: fix-opportunities-bars-fetch-oom

**Created**: 2026-08-16
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-marketdata (query target)

---

## Objective

`_compute_opportunities` fetches bars once per `(symbol, strategy)` candidate — not once per
symbol — with no dedup, no cache, and no concurrency limiter, over a hardcoded 400-day lookback
against a hypertable chunked at 1 day/chunk. Multiple strategies sharing a symbol (watchlist
bindings are uncapped; live-strategy fan-out is capped at 5) each re-issue the same 400-day query,
plausibly exhausting Postgres's shared-memory lock table (chunk-lock pressure) through the small
5-backend PgBouncer pool. Fix: eliminate the redundant re-fetching, and/or cap/shrink the query
footprint.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - `_compute_opportunities` — `services/xstockstrat-analysis/app/handlers/servicer.py:2284-2637`
  - Candidate map keyed by `(symbol, strategy)`, NOT by symbol alone — `servicer.py:2370-2390`
  - Bars-fetch call site (inside the per-candidate loop, no dedup) — `servicer.py:2574-2591`:
    `bars = await self._fetch_bars_paged(sym, range_msg, propagation_meta)`; on failure:
    `log.warning("_compute_opportunities: bars fetch failed for %s: %s", sym, e)`
  - `_fetch_bars_paged` — `servicer.py:668-722`; pages `GetBars` up to `_MAX_BAR_PAGES = 32` ×
    `_BAR_PAGE_SIZE = 1000` (`servicer.py:94,100`)
  - Lookback window — `_READINESS_LOOKBACK_DAYS = 400` (`servicer.py:105`), used at `servicer.py:2569`
    (`range_msg = _recent_range(_READINESS_LOOKBACK_DAYS)`) — a hardcoded module constant, not
    config-driven
  - Live-strategy fan-out cap (existing, feature 131) — `max_live_strats =
    self._cfg.get_int("analysis.opportunity.max_live_strategies_per_symbol", 5)`
    (`servicer.py:2360-2362`), applied only in `_capped_live()`
  - **Watchlist-bound `(symbol, strategy)` pairs have NO per-symbol cap** — every distinct
    watchlist strategy for a symbol becomes its own candidate/bars-fetch (`servicer.py:2396-2405`)
  - No `asyncio.gather`/`Semaphore` anywhere in `_compute_opportunities` or `app/engine/live_loop.py`
    (confirmed via grep) — fetches run sequentially, but each one is independently uncapped in
    query cost
- **`xstockstrat-marketdata`** (Go) — query target, no code change anticipated here
  - `GetBars` handler — `internal/service/marketdata_service.go:121-184`; single symbol per call
    (`GetBarsMulti` batching exists elsewhere but is not what analysis calls)
  - `QueryBars` SQL — `internal/repository/marketdata_repo.go:74-96`:
    `SELECT ... FROM marketdata.ohlcv WHERE symbol=$1 AND timeframe=$2 AND time>=$3 AND time<=$4
    ORDER BY time ASC LIMIT $5` — parameterized, single symbol/timeframe per call
  - `marketdata.ohlcv` hypertable chunk interval — **1 day/chunk** —
    `services/xstockstrat-marketdata/migrations/001_marketdata_hypertables.up.sql:23-28`. A
    400-day query can therefore touch up to ~400 chunks (each an `AccessShareLock`, consuming
    lock-table slots)
  - Pool wiring: both services route through PgBouncer (`:25061`, `DB_PGBOUNCER=true`) in
    staging/production per `docs/patterns/database.md:51,74-86` — pool size is small (5 backends)
    shared across 6 services; many concurrent multi-chunk `GetBars` queries compound the per-query
    chunk-lock pressure onto that small connection budget

## Patterns to REUSE

- `asyncio.Semaphore(max(1, cfg.get_int(...)))` bounding concurrent outbound RPC/DB fan-out —
  already used 3× in this exact service for structurally similar problems:
  - `services/xstockstrat-analysis/app/services/screener.py:84-86` —
    `analysis.screener.max_concurrent_formula_evals` (default 4)
  - `services/xstockstrat-analysis/app/engine/entry_backfill.py:55-57` —
    `analysis.strategy.max_concurrent_entry_backfill` (default 4)
  - `services/xstockstrat-analysis/app/handlers/servicer.py:155-157` —
    `analysis.series.max_concurrent_components` (default 4)
  A fix could reuse this exact idiom for a new `analysis.opportunity.max_concurrent_bars_fetches`
  key — though recon flags (Open Question 4) that *adding* concurrency without first deduping
  could make chunk-lock pressure worse, not better.
- Per-cycle memoization precedent — the live loop already memoizes each owner's watchlist/held
  from portfolio once per cycle (per `services/xstockstrat-analysis/CLAUDE.md` § Decide-surface
  RPCs) — precedent for adding an in-memory per-compute-cycle bars cache keyed by symbol, rather
  than inventing a new caching mechanism from scratch.

## Dependencies

- Proto/RPC: none anticipated — no wire-format change
- Migration: none anticipated at the analysis layer; a `marketdata.ohlcv` chunk-interval change
  (Open Question 6) WOULD require a migration if pursued, but is not the primary candidate fix
- Config keys: candidate new key `analysis.opportunity.max_concurrent_bars_fetches` (if a
  semaphore is added) — undetermined pending grilling
- Inter-service edges: none new — existing analysis → marketdata `GetBars` edge, unchanged
- New env vars / ports: none

## Risks / Not-found

- No existing bars-fetch dedup/cache keyed by symbol within `_compute_opportunities` — confirmed
  absent by grep.
- No bars-window-size config key — `_READINESS_LOOKBACK_DAYS` (400 days) is a hardcoded constant.
- No prior `fails.md`/`insights.md` entry about "shared memory" / TimescaleDB chunk-lock
  exhaustion — grepped both ledgers, no hits on this specific failure mode.
- No `max_locks_per_transaction`/`shared_buffers` tuning references anywhere in the repo — any
  Postgres-level mitigation would be new territory (and on a managed DO cluster, may not even be
  configurable without a support ticket/plan change — outside code-level control).
- **Open risk carried into grilling**: is dedup-by-symbol alone sufficient, or does the
  400-day/1-day-chunk interaction need its own mitigation (shrinking the lookback, or widening the
  hypertable's chunk interval) even after dedup removes the N× redundant fetches?

## Recommended Scope

Primary candidate fix (subject to grilling): memoize bars-fetch results **per symbol** within one
`_compute_opportunities` pass — fetch once, reuse across every `(symbol, strategy)` candidate
sharing that symbol. This alone removes the redundant-fetch multiplier (up to 5× from live
strategies, uncapped× from watchlist bindings) without touching the lookback window, chunk
interval, or Postgres configuration — the smallest change that directly addresses the "N candidates
sharing a symbol re-issue the same query" mechanism recon identified. Whether a concurrency
limiter and/or a lookback-window/chunk-interval change are ALSO needed is left to the grilling
round given the "Open risk" above.
