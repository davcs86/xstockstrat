# Implementation Spec: chart-data-freshness

**Created**: 2026-08-18
**Source**: design.md (approved 2-round debate) + recon.md
**Note**: Implemented directly from the approved design (the mandated SDD minimum — `/sdd-story` +
`/sdd-design quick` + ledger touch — was satisfied). Steps below record what was built, with statuses.

---

## Step 1 — FR-7: `GetBars` returns the newest page for implicit-window reads ✅ DONE

- `internal/repository/marketdata_repo.go`: extracted `scanBars(rows)` (DRY — shared row→proto
  mapping) and refactored `QueryBars` to use it; added `QueryRecentBars(ctx, symbol, tf, end,
  pageSize)` — `WHERE time <= end ORDER BY time DESC LIMIT pageSize`, reversed to ascending.
- `internal/service/marketdata_service.go` `GetBars`: compute `startImplicit := req.Range == nil ||
  req.Range.Start == nil` before the implicit-window default; on `startImplicit && pageToken == ""`
  read via `QueryRecentBars`, else the unchanged `QueryBars` (backtest pagination preserved).
- `fetchAndCacheBars` gained a `recent bool` param → re-reads via `QueryRecentBars` when recent;
  added `truncateBars(live, pageSize, recent)` (newest slice when recent) for the cache-fail fallback.
- **Tests**: `TestTruncateBars` (newest/oldest/short). (DB-backed `QueryRecentBars` ordering is not
  unit-testable in the existing harness — repo tests are pure-function only; SQL is simple + reviewed.)

## Step 2 — FR-2: always-on ingester keeps `1d` fresh ✅ DONE

- `marketdata_service.go`: `defaultBarIngestTimeframe "15m" → "1d"`; bar-ingester
  `defaultIntervalMs 60000 → 300000` (5m); `bar_ingest_lookback_ms` default `900000 → 345600000`
  (4 days) at both the read and the `<=0` reclamp. Updated the surrounding comments.
- Docs: marketdata CLAUDE.md config table (3 defaults) + the ingester/GetBars behavior prose.
- **Config-store guard**: verified no migration seeds `marketdata.stream.bar_ingest*` (code-default
  flip is effective); operator must confirm no explicit row via
  `SELECT … WHERE key LIKE 'marketdata.stream.bar_ingest%'` in dev + prod before relying on it.
- **Tests**: `TestResolveIngestTimeframe` subtests updated `15m → 1d` for the empty + unresolvable
  cases (red-first).

## Step 3 — FR-3: `GetBars` staleness fallback ✅ DONE

- `marketdata_service.go` `GetBars`: on the implicit-window first page, if `time.Since(bars[len-1]) >
  timeframe.Interval(tf)` and `staleCheckDue(symbol,tf,interval,now)`, refetch through
  `fetchAndCacheBars(..., recent=true)`; keep the stale-but-present bars if the refetch yields nothing.
- Added `staleCheckDue` (map+mutex `lastStaleCheck`) — atomic check-and-mark, one live fetch per
  `(symbol,tf)` per interval (weekend guard). Struct field + constructor init added.
- **Tests**: `TestStaleCheckDue` (first due, suppressed within interval, due after, per-key isolation).

## Step 4 — FR-1: UI daily-chart auto-refresh ✅ DONE

- `ChartPanel.tsx`: added `'1Day': 300_000` to `POLL_INTERVALS_MS` (the existing generic interval
  effect consumes it); fixed the stale "daily does not refresh" comments.
- `positions/[symbol]/page.tsx`: fetch body moved into a ref-held `loadBars` (reassigned every render;
  `latestReqRef` stale-response guard replaces the old `cancelled` flag); a `[symbol]`-keyed
  `setInterval(300_000)` effect with cleanup polls without resetting on avg/stop ticks; preserves the
  `setBarSeries` indicator-overlay feed.
- **Tests**: e2e `chart-panel.spec.ts` — clock-virtualized poll test asserting a second `GetBars`
  after 5 min (verified via `tsc --noEmit` + `next lint`; the browser suite runs in CI).

## Step 5 — FR-6: analysis missing-data WARN logs ✅ DONE

- `live_loop.py`: `_eval_pair` returns `_EVAL_NO_BARS` on empty bars; `_run_cycle` accumulates
  data-less `(strategy,symbol)` pairs and logs one summarized WARN/cycle with a bounded sample.
- `servicer.py` `EvaluateReadiness`: per-symbol WARN on the fetch-succeeded-but-empty case only.
- `screener.py`: per-scan summarized WARN with a bounded sample; `bars_errored` flag excludes symbols
  whose `GetBars` raised (already logged) from the summary.
- `evaluator.py`: comment documenting that empty-bars logging is the caller's responsibility (the
  shared `evaluate_conditions_traced` stays silent — it is also driven by the 100-symbol
  `_compute_opportunities` background compute, which would flood).
- **Tests**: `test_live_loop.py` (`_EVAL_NO_BARS` return; one summary/cycle; none when bars present);
  `test_screener.py` (summarized WARN; RpcError not double-counted); `test_analysis_servicer.py`
  (readiness successful-but-empty WARN). All green; ruff clean; full analysis suite 524 passed.

## Step 6 — Autonomous-freshness regression guards ✅ DONE (follow-up)

Locks the invariant that indicator/strategy calculation stays fresh **without any portal/chart view**:
querying a symbol warms it, the ingester refreshes exactly the warm set, and the live loop queries
every symbol it evaluates.

- `marketdata_service.go`: extracted `warmSnapshot()` (the set `ingestRecentBars` consumes) beside
  `markWarm`, with a doc comment stating the autonomous-freshness contract.
- **Go guards** (`marketdata_service_test.go`): `TestMarkWarmFeedsIngestSet` (markWarm populates
  exactly the ingester's `warmSnapshot`); `TestGetBarsMarksSymbolWarm` (structural check that
  `GetBars` calls `s.markWarm(req.Symbol)` — GetBars needs a live pool, so a source-level guard).
- **Analysis guard** (`test_live_loop.py`): `test_cycle_queries_getbars_for_every_universe_symbol`
  (a `_run_cycle` over a 2-symbol universe issues `GetBars` for both, at `1d`) — so the loop can't
  silently stop warming its symbols via a batching/caching refactor.

## Verification summary

- **marketdata** (Go): `go build`, `go vet`, `gofmt -l` clean; `go test ./internal/...` green (new
  `TestStaleCheckDue`, `TestTruncateBars`, updated `TestResolveIngestTimeframe`).
- **ui** (TS): `tsc --noEmit` + `next lint` clean incl. the new e2e spec.
- **analysis** (Py): `ruff check` clean; `pytest` 524 passed (incl. new FR-6 tests).
