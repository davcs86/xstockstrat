# Product Spec: chart-data-freshness

**Created**: 2026-08-18

---

## Problem Statement

Daily price charts in `xstockstrat-ui` (the trader dashboard `ChartPanel` and the position-detail
page) display stale, months-old candles even while the header "last price" is current, because the
candle path and the quote path are independent. This erodes trust in any indicator or strategy
readiness signal that evaluates on daily bars.

## User Story

As a trader, I want daily price charts to reflect the current day's OHLCV, so that I can trust the
indicators and strategy-readiness reads drawn from daily bars.

## Root Cause (three stacked gaps)

1. **UI never auto-refreshes the daily view.** `ChartPanel.tsx:22-26` polls only `15Min`/`1Hour`;
   `1Day` is intentionally excluded. The position-detail page (`positions/[symbol]/page.tsx:149-206`)
   fetches bars once on mount with no polling on any timeframe.
2. **The always-on bar ingester only refreshes `15m`.** `StartBarIngestPoller`
   (`marketdata_service.go:483-585`) fetches a single timeframe — default `marketdata.stream.bar_ingest_timeframe = 15m` —
   so `1d` bars are never continuously refreshed; the current day's daily bar only appears via an
   explicit backfill.
3. **`GetBars` live-fallback fires only on an empty DB.** `marketdata_service.go:176-178` reaches out
   to Alpaca only when the first page returns zero rows. A symbol with stale-but-present daily bars
   keeps serving the cache and never fetches today's bar.

## Functional Requirements

FR-7. **(PRIMARY — the actual root cause.) `GetBars` must return the *newest* page for
implicit-window requests.** Today `QueryBars` (`marketdata_repo.go:78,90`) cursors from `start` and
returns `ORDER BY time ASC LIMIT pageSize` — the **oldest** page of a window sized
`pageSize × interval × 3` (`defaultBarLookback`, `marketdata_service.go:228-238`). Any symbol with
more stored daily bars than one page therefore renders its *oldest* bars, and the UI only fetches page
1 (ignores `nextToken`). When a caller supplies **no explicit range start** (the chart and screener
case), `GetBars` must instead return the most-recent `pageSize` bars (`ORDER BY time DESC LIMIT
pageSize`, reversed to ascending for display). Explicit-range / paginated callers (backtest) keep the
existing ascending-from-start pagination unchanged. This is what actually makes the latest bars reach
the chart — and it fixes the screener, which also passes no range and today evaluates technical
criteria on the oldest ~500 bars (`screener.py:198-206`).

FR-1. The daily (`1Day`) chart view must auto-refresh on a bounded interval on **both** the trader
`ChartPanel` and the position-detail page, so a user leaving the page open sees new daily bars appear
without a manual reload. (Fix #1)

FR-2. The always-on bar ingester must continuously refresh **daily (`1d`)** bars for warm symbols, so
the current/most-recent daily bar is written to `marketdata.ohlcv` without an explicit backfill.
(Fix #3)

FR-3. `GetBars` must refresh from Alpaca when the newest stored bar for the requested window is
**older than one bar interval** (i.e. stale), not only when the DB returns zero rows — so a
stale-but-present daily series updates to include today's bar. (Fix #2) With FR-7 returning the newest
page, the staleness check reads the last returned bar directly (`bars[len-1]` is the true newest on
the implicit-window path); it is current-window-gated and rate-limited by a per-`(symbol,tf)` cooldown
so a weekend/holiday (newest real bar legitimately > 1 interval old) does not refetch on every poll.

FR-4. The staleness/refresh behavior must be **idempotent** — an upsert-on-conflict write, never a
duplicate or a partial-bar corruption of a completed bar (marketdata invariant: Alpaca feed
idempotency).

FR-5. Existing backtest / historical-read behavior must be unchanged: backtests read the full
historical OHLCV from backfills and must not regress. This feature only affects freshness of the
recent/most-recent bar.

FR-6. **Missing-data observability (analysis).** The steady-state analysis paths that today swallow
empty/insufficient bar data silently must emit a **WARN runtime log** (symbol + timeframe + how many
bars were expected vs received) when they evaluate on zero or insufficient bars, so a data gap is
visible in the container logs rather than only in an RPC response field the UI reads. The silent
spots are: the live evaluation loop (`live_loop.py:439-441`), the shared evaluator
(`evaluator.py:136-137`, `:197-198`), `EvaluateReadiness`'s successful-but-empty branch
(`servicer.py:2114-2117`), and the screener's short/empty-but-successful branch
(`screener.py:211-219`). The backtest path already logs (`servicer.py:497`, `:792`, `:1026`) — reuse
that phrasing/level for consistency; do not duplicate or regress it. Logging must be **rate-safe** —
a WARN per data-less symbol per evaluation cycle in a hot loop must not flood logs (dedupe/summarize
per cycle; design to decide the exact shape — see OQ-4).

## Out of Scope

- **Any timeframe other than `1d`.** No `15m` or `1h` data is introduced or refreshed by this work.
  (Explicit user constraint.) See Open Question OQ-1 for the one decision this forces.
- Removing the 15-minute IEX source delay (a free-plan floor; the platform is intentionally not a
  real-time trader).
- WebSocket/streaming bars (streamed 1m bars are forwarded-not-persisted by design).
- Any change to the intraday (`15Min`/`1Hour`) chart auto-refresh already present in `ChartPanel`.

## Affected Services

- `xstockstrat-marketdata` (Go) — the `GetBars` newest-page read path (FR-7, primary), the always-on
  bar ingester (FR-2), and the `GetBars` staleness fallback (FR-3).
- `xstockstrat-ui` (Next.js) — daily-chart auto-refresh on `ChartPanel` and the position-detail page
  (FR-1).
- `xstockstrat-analysis` (Python) — WARN logging on the steady-state empty/insufficient-bar branches
  (FR-6). Response-field behavior (coverage_gaps / INSUFFICIENT_DATA / no_trade_reason) is unchanged;
  this only *adds* runtime-log visibility.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: the `ChartPanel` (trader dashboard) and the
  `/trader/positions/[symbol]` price chart both gain daily auto-refresh. No new route/nav entry — these
  are existing, already-reachable surfaces (C-10(a) satisfied; not a new page).
- [ ] **Agent** — no MCP tool change.
- [ ] **None**.

The marketdata changes (FR-2/FR-3) are internal but are consumed through the existing `GetBars`
RPC that the UI chart already calls — no new consumer surface is created.

## Proto Contract Changes

- [x] No proto changes required.

## Config Key Changes

Depends on OQ-1 (design decision). Candidate keys, all under the existing `marketdata.stream.*` /
`marketdata.*` namespaces:

- Possibly change the **default** of `marketdata.stream.bar_ingest_timeframe` (`15m` → `1d`) and
  `marketdata.stream.bar_ingest_lookback_ms` (900000 → a value covering ≥1–2 daily bars) — **no new
  key**, just default changes — OR
- Possibly a new `marketdata.stream.bar_ingest_timeframes` (plural, comma list) if the ingester must
  serve more than one timeframe. The user constraint ("1d only, no 15m/1h") points away from this and
  toward the single-timeframe flip; recorded here only for the design adversary to rule on.
- Possibly a new staleness threshold key for FR-3 (e.g. `marketdata.bars.stale_after_intervals`,
  default 1) — or derive it from the interval with no key. Design to decide (prefer no new key).

Final key list is fixed at `/sdd-spec` time.

## Database Changes

- [x] No schema changes. `marketdata.ohlcv` already exists; writes are upserts.

## Feature Workflow Notes

Branch to create: `feature/chart-data-freshness` (branch from `main-dev`). _Note: harness session is
on `claude/chart-data-freshness-pe7mvm`, which is where this work is developed and PR'd to `main-dev`._

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — `xstockstrat-marketdata` (config-default + service logic change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

0. **(FR-7)** For a symbol with more stored `1d` bars than one page, an implicit-window `GetBars`
   (no explicit range) returns the **most-recent** `pageSize` bars in ascending order — verified by a
   Go unit test — so the chart draws current price action, not the oldest page. An explicit-range /
   paginated `GetBars` (backtest) is byte-for-byte unchanged (regression test). The screener, which
   passes no range, is fixed by the same change (it evaluates technicals on recent bars).
1. With a warm symbol whose newest stored `1d` bar is from a prior day, opening its daily chart (or
   leaving it open across the ingester interval) results in the current/most-recent daily bar being
   fetched and drawn — no manual backfill, no page reload required.
2. The daily chart on both `ChartPanel` and the position-detail page visibly updates its candles on a
   bounded interval while left open (FR-1), verified by an e2e/unit assertion of a re-fetch.
3. `GetBars` issues a live Alpaca fetch when the newest stored bar in the window is stale (older than
   one interval), and does **not** when the newest bar is current (FR-3), verified by a Go unit test.
4. The always-on ingester writes `1d` bars for warm symbols each cycle (FR-2), verified by a Go unit
   test; no `15m`/`1h` fetch is introduced (Out of Scope honored).
5. Writes are idempotent — re-running a cycle over the same window does not duplicate or corrupt a
   completed bar (FR-4).
6. Backtest/historical reads are unchanged (FR-5) — existing marketdata + analysis tests stay green.
7. When a steady-state analysis path (live loop / evaluator / readiness / screener) evaluates on zero
   or insufficient bars, a WARN line naming the symbol, timeframe, and bars-expected-vs-received is
   written to the runtime log (FR-6), verified by a Python unit test asserting the log record. The
   backtest path's existing logs are unchanged. Logging is rate-safe (no per-symbol flood in the hot
   loop — one summarized/deduped line per cycle).

## Open Questions

- [ ] **OQ-1 (the key design fork).** Fix #3 (FR-2) requires the always-on ingester to refresh `1d`.
  The ingester currently fetches a **single** timeframe (`15m`). The user constraint is "1d only — no
  15m/1h." Does anything on the platform depend on `15m` bars being **continuously refreshed** (e.g.
  a strategy/indicator/readiness path that evaluates on stored `15m` bars)? If **no**, cleanly flip
  the single ingester timeframe `15m → 1d` (+ widen lookback). If **yes**, flipping silently staled
  those `15m` consumers — surface to the user before choosing. **Design Phase 0 recon must resolve
  this**; if a real `15m` consumer exists, gate the decision with the user (behavior #1).
- [ ] **OQ-2.** FR-3 staleness threshold: derive "one interval" from the requested timeframe with no
  new config key (preferred), or introduce a config key? Prefer no new key unless design shows a need.
- [ ] **OQ-3.** FR-1 daily poll interval: pick a bounded value (daily bars change at most a few times
  intraday given the 15-min IEX delay). A conservative interval (e.g. a few minutes) avoids hammering
  Alpaca while still surfacing the day's bar. Exact value set in design/spec.
- [ ] **OQ-4.** FR-6 log shape/rate-safety: the live loop and screener iterate many symbols per cycle;
  a WARN per data-less symbol could flood. Decide between (a) one summarized WARN per cycle listing the
  data-less symbols, vs (b) a per-symbol WARN gated by a "only when the set changes" guard. Also decide
  whether FR-6 stays log-only or also emits a `notify` alert (the marketdata feed-disconnect path
  already uses notify; a *data-gap* alert may be noisy). Default: log-only, summarized-per-cycle, no new
  alert — design to confirm.

## Known Traps (from the Ledger)

- **C-10(b) parity.** `GetBars` is the single read path the chart uses, but confirm no *second* read
  path serves the same daily bars with different freshness (the 056 parity fail). If a second path
  exists, it must reach parity or the tables disagree.
- **Marketdata live-fallback→cache→reread invariant** (`marketdata` context-constitution): FR-3 must
  preserve the "live fetch → cache → re-read" ordering, not bypass the cache.
