# Defect: Live loop and screener technical criteria evaluate against frozen daily OHLCV bars

**Recorded**: 2026-08-16
**Severity**: SEV-2
**Impact type**: stale-indicator-input
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-marketdata, xstockstrat-analysis
**Config-only fix possible**: no

## Observed

The live evaluation loop (`app/engine/live_loop.py`'s `_eval_pair`) and the screener's
technical criteria (`app/services/screener.py`'s per-symbol bars fetch) both query
`GetBars` with `timeframe="1d"` on every cycle (`analysis.engine.eval_interval_seconds`,
default 60s) and feed the result directly into indicator/condition evaluation. On the
marketdata side, `GetBars`'s only self-healing live-Alpaca fetch
(`fetchAndCacheBars`) is gated on the **first page of the DB cache being completely
empty** (`len(bars) == 0 && pageToken == ""`). The only continuous background refresh —
`StartBarIngestPoller` / `ingestRecentBars` — fetched a **single** configured timeframe
(`marketdata.stream.bar_ingest_timeframe`, default `"15m"`), never `"1d"`. So once a symbol
had **any** `1d` row cached (from its first on-demand fetch or an initial backfill), that
symbol's `1d` series was never refreshed again by anything: the live loop and the screener
silently evaluated indicators against a daily bar series frozen at whatever day it first got
backfilled, with no error surfaced anywhere in the call chain.

## Expected

A continuously-running consumer of `1d` OHLCV bars (the live loop, screener technical
criteria) must see the current trading day's bar once ingested, not a bar series that stops
advancing after the first fetch.

## Reproduction

1. Chart or otherwise trigger a `GetBars(symbol, timeframe=1d)` call for a symbol with no
   prior `1d` history — this populates one page of `1d` bars via the empty-cache
   live-fallback and marks the symbol "warm".
2. Wait past the next trading session close (a new `1d` bar should now exist upstream at
   Alpaca).
3. Call `GetBars(symbol, timeframe=1d)` again (or let the live loop's next
   `eval_interval_seconds` cycle run) — before the fix, the response's latest bar is still
   the one from step 1; the new session's bar never appears because the DB cache is no
   longer empty on page 1, so the live-fallback never re-fires, and the always-on poller
   never fetched `1d` at all.

## Evidence

`services/xstockstrat-analysis/app/engine/live_loop.py:430-438` (pre-fix) — `_eval_pair`
requests `timeframe="1d"` every cycle and feeds `bars` straight into
`self._evaluator.evaluate(...)`.

`services/xstockstrat-analysis/app/services/screener.py:198-202` (pre-fix) — the per-symbol
technical-criteria bars fetch, same `timeframe="1d"`.

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:176-178` (pre-fix)
> ```go
> if len(bars) == 0 && pageToken == "" {
>     bars, nextToken = s.fetchAndCacheBars(ctx, req.Symbol, canonicalTf, start, end, pageSize)
> }
> ```
> Once any `1d` row exists, this branch never fires again for that symbol+timeframe.

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:509-511,549`
(pre-fix) — `defaultBarIngestTimeframe = "15m"`; `ingestRecentBars` fetched exactly that one
configured timeframe per cycle, excluding `1d` from the always-on ingester at the documented
default.

`services/xstockstrat-marketdata/docs/context-constitution.md:15` (MARKETDATA-2, pre-fix) —
asserted "15m/1h/1d storage is owned by `StartBarIngestPoller`", which overstated what the
code actually did (doc drift relative to the single-timeframe ingester).

## Root cause hypothesis

The always-on bar ingester (`StartBarIngestPoller`) was designed to continuously refresh
exactly one configured timeframe, and `GetBars`'s live-fallback was designed only to handle
a **cold** cache (a symbol never queried before), not a **stale** one. `1d` was never added
to the continuously-ingested set, so any `1d`-timeframe consumer had no path to a fresh bar
after the very first fetch — the two refresh mechanisms (poller, live-fallback) each assumed
the other covered this case, and neither did.

## Confidence

high — traced the full call chain from both `1d` consumers (`live_loop.py`,
`screener.py`) through `GetBars` to `StartBarIngestPoller`/`ingestRecentBars`, and confirmed
via new regression tests (`TestResolveIngestTimeframes`, `TestMinIngestLookback`,
`services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`) that the
pre-fix single-timeframe/flat-lookback behavior reproduced the gap and the fix closes it.

---

**Status: fixed in this report's companion PR** (`claude/null-fundamentals-ohlcv-gaps-l2v4x5`).

## Fix

`services/xstockstrat-marketdata/internal/service/marketdata_service.go`:

- `marketdata.stream.bar_ingest_timeframe` becomes a **comma-separated list**, not a single
  value (default changed from `"15m"` to `"15m,1d"`). `resolveIngestTimeframe` (single
  return) is replaced by `resolveIngestTimeframes` (`[]string`, dedup, per-entry WARN +
  skip on an unresolvable entry, whole-list fallback to the default only when nothing
  resolves) — an existing single-value config (`"15m"`) remains valid, it just becomes a
  one-element list.
- `ingestRecentBars` now loops over every resolved timeframe and ingests each independently
  (`ingestRecentBarsForTimeframe`), instead of fetching one hardcoded timeframe.
- Each timeframe's actual lookback window is `max(configured bar_ingest_lookback_ms, 2 ×
  that timeframe's own interval)` (`minIngestLookback`) — the configured default
  (900000ms = 15min) is sized for `"15m"` and would fetch an almost-always-empty window for
  `"1d"` (whose own interval is 24h) if applied unmodified; this was the second half of the
  bug (adding `"1d"` to the ingest list alone would not have fixed anything without also
  widening its window).
- `1h` is deliberately **not** added to the default ingest list — it has no continuously-live
  consumer in this codebase (only on-demand UI chart backfills), so continuously polling it
  would be pure overhead with no consumer to benefit; it stays on-demand-only via `GetBars`'
  live-fallback, same as before.
- Doc corrections: `services/xstockstrat-marketdata/CLAUDE.md`'s config table and Alpaca
  Integration section, and `docs/context-constitution.md`'s MARKETDATA-2 entry, no longer
  claim `1h` is continuously ingested (they didn't test true before this fix either — this
  was pre-existing doc drift the investigation surfaced, corrected in the same PR per this
  repo's Teardown convention).

## Tests added

- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`:
  `TestResolveIngestTimeframes` (replaces `TestResolveIngestTimeframe`, covers list parsing,
  whitespace, dedup, partial-failure, and whole-list-fallback), `TestMinIngestLookback`
  (asserts the per-timeframe window floor, specifically that `1d`'s effective lookback
  exceeds the 15-min-sized configured default — the concrete regression this bug describes).

## Not in scope / known residual gap

- `ingestRecentBars`/`ingestRecentBarsForTimeframe`'s DB-touching behavior (the actual
  `InsertBars` upsert call) has no unit test in either the pre-fix or post-fix code — the
  service's `repo` field is a concrete `*repository.MarketDataRepo` (not an interface), and
  no Postgres/TimescaleDB instance was available in this execution environment to run an
  integration test against. The pure per-timeframe logic this fix adds
  (`resolveIngestTimeframes`, `minIngestLookback`) is fully covered; the DB round-trip is
  exercised only implicitly by existing repo-layer tests for `InsertBars`/`QueryBars`
  (unrelated to the timeframe list). A follow-up that gives `MarketDataService.repo` a
  narrow interface seam would let this gap close without a live DB.
