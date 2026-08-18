# Recon: chart-data-freshness

**Created**: 2026-08-18
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata (Go), xstockstrat-ui (Next.js), xstockstrat-analysis (Python)

---

## Objective

Make daily (`1d`) price charts reflect current OHLCV instead of freezing at the last backfill, and
make silent missing-data handling in analysis visible in the runtime logs. Three freshness fixes
(UI daily auto-refresh, always-on ingester refreshing `1d`, `GetBars` staleness fallback) plus one
observability fix (WARN logging on the steady-state empty-bar branches). Scope is strictly `1d` — no
new/continuous `15m`/`1h` pull.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Always-on ingester: `StartBarIngestPoller` loop `internal/service/marketdata_service.go:483-507`
    (reads `bar_ingest_interval_ms` live each cycle, line 496); `ingestRecentBars`
    `marketdata_service.go:535-585`.
  - Ingest timeframe read (single string, live): `marketdata_service.go:549` via `resolveIngestTimeframe`
    `:519-529`; default const `defaultBarIngestTimeframe = "15m"` `:511`.
  - Ingest lookback read (live): `marketdata_service.go:550-555` (default `900000` ms = 15m).
  - Fetch+upsert each cycle: multi `ms.GetBarsMulti(...)` `:558` → `s.repo.InsertBars` `:563`;
    per-symbol fallback `src.GetBars(...)` `:573` → `InsertBars` `:581`.
  - `GetBars` RPC: `marketdata_service.go:121-184`; DB read `s.repo.QueryBars` `:166`; **empty-only
    live-fallback trigger** `:176-178` (`if len(bars) == 0 && pageToken == "" { fetchAndCacheBars(...) }`);
    `fetchAndCacheBars` (live→persist→re-read) `:191`.
  - Idempotent upsert: `MarketDataRepo.InsertBars` `internal/repository/marketdata_repo.go:37`;
    `ON CONFLICT (symbol, timeframe, time) DO UPDATE` `:50-52`.
  - Warm-symbol set: declared `marketdata_service.go:42-46`; `markWarm` writer `:389-395` (called from
    `GetBars` `:123`, `GetLatestQuote` `:366`); ingester reads set `:536-541`.
  - Interval→duration mapper: `internal/timeframe/timeframe.go:45-56` (`Interval("1d")` → 24h,
    unknown → 0).
  - Config live-read plumbing: `internal/config/config.go:126-151` (mutex-guarded live snapshot).
  - Last migration: `003_canonicalize_ohlcv_timeframe.up.sql` (per service CLAUDE.md; no new migration
    needed — table exists, writes are upserts).
  - Legacy stream path writes **nothing** persistent: `internal/alpaca/stream.go:29` (`streamBarTimeframe = "1m"`,
    forward-only, never persisted).

- **`xstockstrat-ui`** (Next.js)
  - Trader ChartPanel: `src/components/trader/ChartPanel.tsx`; `POLL_INTERVALS_MS` (intraday-only)
    `:22-26`; generic auto-refresh interval effect `:77-82` (reads `POLL_INTERVALS_MS[timeframe]`);
    `fetchBars` `:52-69`; default timeframe `'1Day'` `:33`.
  - Position-detail chart: `src/app/trader/positions/[symbol]/page.tsx`; hand-rolled bars effect
    (fetch-once, no poll) `:149-206`; dep array `:206`; feeds indicator overlays via `setBarSeries`
    `:165-168`; chart div has **no** `data-testid` `:371`; fixed `timeframe='1Day'` `:94` (no picker).
  - Chart lib: `src/lib/chart.ts` — `Timeframe` `:11`, `TIMEFRAMES` `1Day`→`1d` `:16`, `TIMEFRAME_ENUM`
    `1Day`→`TIMEFRAME_1DAY` `:26`, `mapBars` `:48-59`. `1Day` fully supported.
  - Shared chart lifecycle hook: `src/hooks/useCandlestickChart.ts:12` (creates chart/series; no fetch/poll).

- **`xstockstrat-analysis`** (Python)
  - Log config: `app/main.py:23` (`logging.basicConfig(level=logging.INFO)` — WARNING/INFO both surface).
  - Silent empty-bar branches (FR-6 targets): live loop `app/engine/live_loop.py:439-441`; shared
    evaluator `app/services/evaluator.py:136-137` and `:197-198`; `EvaluateReadiness` empty branch
    `app/handlers/servicer.py:2114-2117`; screener short/empty branch `app/services/screener.py:211-219`.
  - Existing (reuse-for-consistency) missing-data logs on the backtest path: `servicer.py:497`, `:792`,
    `:1026`.
  - All GetBars fetch sites hardcode `"1d"`: `live_loop.py:431-437`, `servicer.py:691-698`
    (`_fetch_bars_paged`), `screener.py:198-205`.

## Patterns to REUSE

- UI daily auto-refresh (ChartPanel) → **reuse the existing generic interval effect**
  `ChartPanel.tsx:77-82`; only add a `'1Day'` key to `POLL_INTERVALS_MS` `:23-26` (+ fix the stale
  "daily does not [refresh]" comment `:22,:76`). No new effect.
- Idempotent bar writes → reuse `MarketDataRepo.InsertBars` upsert `marketdata_repo.go:37-52` (re-writing
  the same window is safe).
- Staleness "one interval" threshold → reuse `timeframe.Interval(canonicalTf)` `timeframe.go:45-56`
  (no new config key — OQ-2 resolves to "derive from interval").
- Live-fetch→cache→re-read ordering → reuse `fetchAndCacheBars` `marketdata_service.go:191` (FR-3 must
  route through it, not bypass the cache — preserves the marketdata invariant).
- Warm-symbol iteration → reuse the existing `warmSymbols` set + `ingestRecentBars` copy-under-lock
  `marketdata_service.go:536-541`.
- Analysis missing-data log phrasing/level → reuse the backtest path's existing `log.warning(...)`
  style (`servicer.py:497`) for consistency across the service.
- UI unit test → extend `src/lib/chart.test.ts` pattern; e2e → `e2e/trader/chart-panel.spec.ts`,
  `e2e/trader/position-detail.spec.ts`, mock `GetBars` in `e2e/mock-backend.ts:428-464`.

## Dependencies

- Proto/RPC: none — `GetBars` contract unchanged; no proto edits.
- Migration: none — `marketdata.ohlcv` exists; writes are upserts.
- Config keys: **no new keys.** Change **defaults only** of existing
  `marketdata.stream.bar_ingest_timeframe` (`15m` → `1d`) and `marketdata.stream.bar_ingest_lookback_ms`
  (`900000` → a multi-day value; OQ-3-adjacent). Both are live-read each cycle, so a running deploy
  picks up the change without restart.
- Inter-service edges: marketdata `GetBars` (unchanged) consumed by ui charts + analysis; marketdata →
  Alpaca REST (existing). No new edges.
- New env vars / ports: none.

## Risks / Not-found

- **No service-level Go tests** for `StartBarIngestPoller`/`ingestRecentBars` ingestion or the `GetBars`
  live-fallback branch (nearest homes: `internal/service/marketdata_service_test.go` —
  `TestResolveIngestTimeframe:711`, `TestDefaultBarLookback:63`, `TestBackfillBars_EnumOnlyRequestResolves:671`;
  `internal/timeframe/timeframe_test.go` `TestInterval:39`). FR-2/FR-3 tests are net-new here.
- **No standalone bars fixture** — the e2e bars fixture is inline in `e2e/mock-backend.ts` (2-bar AAPL
  array); position-detail chart div has no `data-testid` (e2e keys on `Price · <symbol>` header text).
- **FR-3 scope guard (design must resolve):** the staleness refetch must fire **only** for the
  recent/current window (`pageToken == ""`, implicit end ≈ now), never for an explicitly historical
  range — else old-window queries would pointlessly hit Alpaca every call. Insert the staleness check
  beside the existing empty-check at `marketdata_service.go:176-178`, gated on the same "current window"
  condition.
- **Manual 15m tab self-heal:** flipping the ingester to `1d` stops background 15m refresh; a human
  picking `15Min` relies on `GetBars` fallback. Today that fires only on an empty DB (`:176`), so
  stale-but-present 15m rows would be served stale — but FR-3 (staleness fallback) fixes this for
  *all* timeframes, so the flip + FR-3 together leave the manual 15m path better off, not worse.
- **Ledger trap C-10(b) (parity):** confirmed `GetBars` is the single read path the charts use; no
  second daily-bar read path to bring to parity. Trap does not bite here.
- **FR-6 rate-safety (OQ-4):** live loop + screener iterate many symbols; per-symbol WARN could flood.
  Summarize per cycle (live loop) / per-call (single-symbol RPCs).

## Recommended Scope

Advisory step boundaries for `/sdd-spec`:
1. **marketdata FR-2** — flip `defaultBarIngestTimeframe` → `1d` + widen lookback default; adjust
   `resolveIngestTimeframe` fallback; Go unit test for a 1d ingest cycle.
2. **marketdata FR-3** — add newest-bar-age-vs-`Interval` staleness check beside the empty-check
   (`:176-178`), current-window-gated, routing through `fetchAndCacheBars`; Go unit test for
   stale-present vs fresh-present.
3. **ui FR-1** — add `'1Day'` to `POLL_INTERVALS_MS` (ChartPanel) + new interval on the position-detail
   page preserving `setBarSeries`; update stale comments; unit/e2e assertions.
4. **analysis FR-6** — rate-safe WARN on the four silent branches; Python unit tests asserting the log
   record; response fields untouched.
