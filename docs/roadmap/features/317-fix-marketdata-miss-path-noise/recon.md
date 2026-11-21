# Recon: fix-marketdata-miss-path-noise

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached@c4fd48b0a ≡ origin/main-dev (no `origin/feature/fix-marketdata-miss-path-noise` existed at recon time)
**Affected services**: xstockstrat-marketdata, xstockstrat-portfolio

---

## Objective

Silence the cancel-caused per-item WARNs that feature 290 did not cover (marketdata `GetBars` live fetch, the
`GetLatestQuote` cache insert, bar-ingest and re-read sites; portfolio `processAccountDeregistered` and the
`ackAlways` consumers draining at shutdown), while genuine failures keep their WARN. Also stop `GetBars` from
live-fetching and WARNing on every call for a servable symbol that recently returned no bars: add a negative
cache / back-off on the miss path and report the WARN once per state change. The bug is SEV-3 and the reports
are low-confidence, so which sites still flood (Open Question 1) has to be settled during design.

## Codebase Map

- **`xstockstrat-marketdata`** (Go). All paths below are under `services/xstockstrat-marketdata/`.
  - Handler: `GetBars` at `internal/service/marketdata_service.go:264`. Servability snapshot comes from `snap := s.markWarmIfServable(req.Symbol)` (`:281`; `markWarmIfServable` is at `internal/service/asset_servability.go:81`).
  - Miss / refetch decision: `refetch := len(bars) == 0` at `:338`. The stale branch is `:339-346` and is gated by `s.staleCheckDue(...)` at `:342`.
  - Live-fetch guard: `if refetch && liveFetchAllowed(snap, req.Symbol) {` at `:347`. `liveFetchAllowed` is at `internal/service/asset_servability.go:66` (the feature-282 servability gate).
  - Miss-path WARN: `slog.WarnContext(ctx, "GetBars: no bars stored and live fetch returned none", ...)` at `:353`. It fires once per call and has no dedupe.
  - Stale back-off: `staleCheckDue` at `:367-376`. It uses fields `staleMu sync.Mutex` / `lastStaleCheck map[string]time.Time` (`:58-59`, initialised `:239`) and the key `symbol+"|"+tf`. It is consulted only for stored-but-stale bars, never for an empty result.
  - `fetchAndCacheBars` at `:403`:
    - `:411` `GetBars: live fetch failed` WARN. It has no `ctx.Err()` check (this is AC-1).
    - `:422` `GetBars: cache insert failed`.
    - `:425` `if ctx.Err() != nil` skips the re-read.
    - `:431`/`:438` `GetBars: re-read after cache failed` (residual: the error can still arrive after the re-read starts).
  - Feature-290 detached write: `barsCacheWriteGrace = 5 * time.Second` at `:380`, `cacheLiveBars` at `:384` (returns early on a done ctx, `:385`).
  - Quote cache insert: `GetLatestQuote: cache insert failed` WARN at `:630`. Siblings: `BatchGetBars: cache insert failed` `:856`, and `GetLatestQuotes: mark lookup failed` `:730`, which already logs `ctx_done`.
  - Warm poller: the per-symbol cache-insert lines are already `DebugContext` (`:1239`, `:1263`). They roll into the aggregate WARN `warm poller: cache insert failures` at `:1286`, which marketdata `CLAUDE.md` calls load-bearing, so keep it.
  - Bar ingest:
    - Entry points: `ingestRecentBars` `:1366` and `ingestRecentBarsForTimeframe` `:1393`. The hold window `d := resolveBarIngestBackoff(s.budgetCfg)` is read at `:1395`.
    - WARNs: `bar ingest: insert failed` `:1409`/`:1429`, `multi-bar fetch failed, falling back to per-symbol` `:1413`, `bar ingest: live fetch failed` `:1421`. None of them checks `ctx.Err()`.
    - These loops run on the process ctx, which is cancelled only at shutdown.
  - Feature-291 hold: `internal/service/bar_hold.go`, with key `barIngestBackoffKey = "stream.bar_ingest_backoff_ms"` (`:9`) and `resolveBarIngestBackoff` (`:35`). It covers ingest only; GetBars/BatchGetBars are untouched.
  - Last service migration: `009_symbol_classification.up.sql` (`services/xstockstrat-marketdata/migrations/`).
  - Config-read pattern: `resolveBarIngestBackoff(cfg intGetter)` at `internal/service/bar_hold.go:35`.
- **`xstockstrat-portfolio`** (Go). All paths below are under `services/xstockstrat-portfolio/`.
  - Consumer wrappers: `ackAlways` at `internal/service/portfolio_service.go:185` (the handler returns nothing and the event is always acked); `observed(...)` at `:231` (any non-nil return counts as outcome `error`).
  - Consume loop: `consumeEventStream` already returns on `ctx.Err() != nil` (`:274`).
  - `processAccountDeregistered` at `:1540`. Two unguarded WARNs: `deregister: delete positions failed` `:1566` and `deregister: delete offline realized failed` `:1570`. It returns `errors.Join(failures...)` at `:1573`.
  - Feature-290 reference: `processPositionSync`, with `stop` closure / `slog.DebugContext(ctx, "position sync stopped: context done", ...)` at `:1618` and `errors.Join` at `:1676`.
  - Bracket consumer: wired `:1693` via `ackAlways(s.processBracketUpdate)`; the handler is at `:1696`, with WARN `update position bracket failed` at `:1706`.
  - Balance consumer: wired `:1741` via `ackAlways(s.processBalanceSync)`; the handler is at `:1744`, with WARN `upsert account balance failed` at `:1765`.
  - Order fill: `processOrderFill` at `:373`. It is NOT wrapped by `ackAlways` (it returns `error`). Its only WARNs in `:373-520` are `parse order fill payload` (`:383`, a parse error, not cancel-caused) and `batch latest quotes unavailable` in `latestQuotesFor`. The product spec's "order-fill" ackAlways site may not exist as described; see Risks.
  - Retry classification: `:1482` classes `context.DeadlineExceeded` / `context.Canceled` / `pgconn.Timeout` / `net.Error` as transient, so a returned `ctx.Err()` is never parked.
  - Last service migration: `018_watchlist_signal_expiry.up.sql`. None is needed.
  - Config-read pattern: n/a. No portfolio config key is involved.

## Patterns to REUSE

- Cancel-stop for a per-item WARN. Reuse feature 290's `stop` closure / `if ctx.Err() != nil { return stop(...) }` guard before and after each write (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1618`), plus the marketdata variant `if ctx.Err() != nil` at `marketdata_service.go:425`. Genuine non-cancel errors with a live ctx keep their WARN. That negative control is feature 290's @AC-4 / @AC-8.
- GetBars miss-path negative cache. Model it on `staleCheckDue` (mutex plus `map[string]time.Time`, key `symbol|tf`) at `marketdata_service.go:367`, together with its unit-test shape `TestStaleCheckDue` (`marketdata_service_test.go:1164`, built from `&MarketDataService{lastStaleCheck: make(...)}`).
- Window length (Open Question 3): either reuse `timeframe.Interval(canonicalTf)` as the stale path does (`:340`), or read a config window through the `resolveBarIngestBackoff(s.budgetCfg)` pattern (`bar_hold.go:35`). If design picks a key, ledger insight 2026-11-04 fix-marketdata-dead-symbol-ingest says any staleness-deciding window is a config key with `SetConfig` bounds and a snapshot-built reader test, never an F-07 exception.
- Once-per-state-change WARN. Feature 291's hold already logs `holding` once per transition (`marketdata_service.go` aggregates near the ingest loop; the hold lives in `bar_hold.go`).
- Portfolio cancel tests. Copy `services/xstockstrat-portfolio/internal/service/portfolio_sync_cancel_test.go`:
  - helpers: `cancelingDB` `:16`, `warnCount` `:52`, `canceledCtx` `:58`
  - test template `TestProcessPositionSync_AC1..AC5, AC10` (`:64-162`), with AC4 as the live-ctx negative control
  - `warnRecorder` / `recordWarns` (`portfolio_quote_deadline_test.go:33`, `:63`)
  - deregistration test `TestProcessAccountDeregistered_AC2_DeleteFailureIsRetryable` (`portfolio_sync_retry_test.go:134`)
- Marketdata GetBars tests:
  - The existing tests are structural, because GetBars needs a live pool: `TestGetBarsMarksSymbolWarm` (`marketdata_service_test.go:1252`) and `TestGetBarsWarnsWhenMissAndLiveFetchEmpty` (`:1273`, which asserts the exact WARN literal) use the `funcBody` helper (`:1378`).
  - Available fakes: `fakeBarsStore` (`:4214`) and `recordingBarsStore` (`:5400`, which snapshots at call entry per the fails.md 2026-11-10 fix-ctx-cancel-warn-flood rule).
  - A behavioural AC-2 test probably needs an extracted pure helper, tested like `TestStaleCheckDue`.

## Existing Business Rules (preserve / extend)

**Marketdata, from feature 290** (`services/xstockstrat-marketdata/acceptance/fix-ctx-cancel-warn-flood.feature`)
- **PRESERVE** `@AC-6 @feature-290` "Fetched bars are persisted after the client cancels, without a WARN": the detached cache write; no WARN and no re-read after a cancel; the live page is still returned.
- **PRESERVE** `@AC-7 @feature-290` "A live client's cache write is not given a new deadline".
- **PRESERVE** `@AC-8 @feature-290` "A genuine cache-insert failure with a live client still warns and returns the live page".
- **PRESERVE** `@AC-9 @feature-290` "Only one departed-client cache write runs at a time".
- **PRESERVE** `@AC-11 @feature-290` "A genuine cache-insert failure after the client has left still warns".
- **PRESERVE** `@AC-12 @feature-290` "A client leaving mid-write does not cancel the persist".

**Portfolio, from feature 290** (`services/xstockstrat-portfolio/acceptance/fix-ctx-cancel-warn-flood.feature`)
- **EXTEND** `@AC-1 @feature-290` "A canceled context stops the position-sync loop after the first upsert", with `@AC-2`, `@AC-3` (a cancel is never parked; cursor withheld) and `@AC-10`. This feature applies the same cancel-stop pattern to `processAccountDeregistered` and the `ackAlways` bracket/balance consumers.
- **PRESERVE** `@AC-4 @feature-290` "A genuine write failure with a live context still warns".
- **PRESERVE** `@AC-5 @feature-290` "The empty-broker-snapshot skip path is unchanged by a done context".

**Marketdata, from feature 282** (`services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature`)
- **PRESERVE** `@AC-4 @feature-282` "GetBars for an unservable symbol does not trigger a live fetch or warm the symbol". The servability gate stays first; the negative cache covers only servable-but-empty symbols.
- **PRESERVE** `@AC-9 @feature-282` "An asset set that has never loaded does not block GetBars or warming". The back-off must not suppress the first live attempt here.
- **PRESERVE** `@AC-12 @feature-282` "Strict BatchGetBars omits unservable cold symbols without a live fetch".
- **PRESERVE** `@AC-14 @feature-282` "Partial BatchGetBars still fetches servable cold symbols within the deadline". This constrains any negative cache that is shared with BatchGetBars.
- **PRESERVE** `@AC-16 @feature-282` "Quote and price paths are not gated". The `GetLatestQuote` WARN fix must not alter the live fetch or warming.
- **PRESERVE** `@AC-23 @feature-282` "Symbols are normalized before classification". The negative-cache key must be the normalized symbol.

**Marketdata, from features 240, 191, 229 and 291**
- **PRESERVE** `@AC-53` / `@AC-54 @feature-240` "allow_partial opts in to returning stored bars when the live fetch fails" (`services/xstockstrat-marketdata/acceptance/offline-account-full-pnl.feature`). Out of scope per the spec.
- **PRESERVE** `@AC-2` / `@AC-3 @feature-191` "BatchGetBars returns bars for multiple symbols in one call" and "BatchGetBars omits symbols with no stored bars" (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`). Omit-not-fabricate.
- **PRESERVE** `@AC-2`, `@AC-3`, `@AC-7 @feature-229` (`services/xstockstrat-marketdata/acceptance/fix-book-portfolio-page.feature`): quote recency window, coalesced waiters not failed by the first caller's cancel, and an out-of-window live quote that is returned but not cached.
- **PRESERVE** `@AC-1..@AC-14 @feature-291` (`services/xstockstrat-marketdata/acceptance/fix-marketdata-dead-symbol-ingest.feature`), especially `@AC-6` "A held symbol stays in the warm set" (GetBars is untouched by the hold). Any bar-ingest WARN change keeps the once-per-transition `holding` WARN, and the `symbols returned no bars` WARN still excludes held symbols.

**Portfolio, from features 256 and 294**
- **PRESERVE** `@AC-2 @feature-256` "A failed offline-realized delete on deregistration is retried" (`services/xstockstrat-portfolio/acceptance/fix-offline-book-consistency.feature`). A genuine failure must still return an error. Also keep `@AC-6` (park and advance) and `@AC-9` "A transient write failure never parks the offline sync event".
- **PRESERVE** the feature-294 consumer-outcome scenario "Portfolio counts a stalled and a parked consumer event" (`services/xstockstrat-portfolio/acceptance/signal-map-instrumentation.feature`): the `portfolio.consumer.events` outcomes stay unchanged. The exact @AC number is unverified; confirm it at design.

**Platform** (`docs/sdd/business-rules/platform.feature`, keyword scan)
- No cross-service guarantee covers these sites.
- Do not regress the established log-reduction pattern `@AC-50 @feature-294`.
- The deregistration purges `@AC-15` / `@AC-18 @feature-157/163` must remain.
- No CHANGE items. Both affected services have existing suites.

## Dependencies

- Proto/RPC: none.
- Migration: none for either service schema. If one were ever needed, the next numbers would be marketdata `010` and portfolio `019`.
- Config keys: none expected. This becomes conditional if design picks a new negative-cache window key (OQ3). That key would be namespace `marketdata`, key `<category>.<key>` (for example under `stream.`, beside `stream.bar_ingest_backoff_ms`), seeded by a config migration whose number is above `047`, the highest on `origin/main-dev` (`services/xstockstrat-config/migrations/047_config_alias_removal_rows.up.sql`). Per fails.md 2026-11-10 fix-marketdata-dead-symbol-ingest, also check `git log --all` and every `origin/feature/*` tail, because sibling batch features may claim 048+.
- Inter-service edges: none new.
- New env vars / ports: none.

## Risks / Not-found

- **OQ1 (Loki re-check) is not done.** Recon had no Loki access. Which sites still flood after features 290 and 282 launched is unverified. Ledger insight 2026-11-04 fix-ctx-cancel-warn-flood: before designing, prove in Loki whether the process's own ctx was done at flood time (client cancel vs shutdown drain are two mechanisms behind one symptom).
- **The warm-poller site already looks resolved.** The per-symbol lines are Debug (`:1239`, `:1263`); only the aggregate `:1286` WARN remains, and it is load-bearing per marketdata `CLAUDE.md`. The fix should probably be a no-op there.
- **The order-fill "ackAlways" site is not confirmed.** `processOrderFill` (`portfolio_service.go:373`) returns `error` and is not `ackAlways`-wrapped. Its WARN at `:383` is a payload-parse failure, not a cancel. The product spec's list may be stale for this site.
- **Outcome metric shift.** If an `ackAlways` handler is changed to return `ctx.Err()`, `observed` (`:231`) would count it as outcome `error`, which changes the `portfolio.consumer.events` series that feature 294 guards. Quieting the log alone (keeping the void signature) avoids this. Design must choose.
- **The structural test pins the WARN literal.** `TestGetBarsWarnsWhenMissAndLiveFetchEmpty` (`marketdata_service_test.go:1273`) requires the exact `slog.WarnContext(ctx, "GetBars: no bars stored and live fetch returned none"` substring. Keep it or update the test in the same step.
- **No behavioural GetBars test seam.** GetBars needs a live DB pool. AC-2 ("exactly one live vendor fetch in three calls") likely needs an extracted pure helper or a repo seam. No existing behavioural test of `GetBars` / `fetchAndCacheBars` with a fake source was found (search not exhaustive).
- **Negative-cache staleness risk.** A never-backfilled symbol must still populate on demand once the back-off expires (marketdata `CLAUDE.md` GetBars "populates a never-backfilled symbol on demand"). The negative-cache key must use the normalized symbol (@AC-23 @feature-282). The insight 2026-11-04 fix-marketdata-dead-symbol-ingest asks for an honest-value statement and a positive control so a never-fetches implementation cannot pass.
- **Unverified scope boundaries:**
  - Whether `GetBars` normalizes `req.Symbol` before `markWarmIfServable(req.Symbol)` (`:281`) or relies on the gate's own normalization.
  - The contents of `bar_hold.go` beyond `:9`/`:35`.
  - The full body of `asset_servability.go`.
- **Applicable fails.md traps:**
  - 2026-11-10 filter-otc-symbols: a Go step that adds an unexported helper (such as a negative-cache helper) must add its production caller in the same step, or `golangci-lint unused` goes red.
  - 2026-11-10 fix-ctx-cancel-warn-flood: recording fakes snapshot ctx and mutable args at call entry.
- **Overlap.** Per sdd-review, marketdata is shared with peers 320/322/323/326 and portfolio with 311/312/315/326. `marketdata_service.go` and `portfolio_service.go` are high-churn files in this batch.

## Recommended Scope

Advisory. Each step is TDD red-before-green.

1. **Marketdata cancel-quiet.**
   - Add a `ctx.Err()` guard to `fetchAndCacheBars` `:411` (AC-1) and to the residual re-read WARNs `:431`/`:438`.
   - Add the same guard to `GetLatestQuote` `:630` and to the bar-ingest WARNs `:1409`/`:1413`/`:1421`/`:1429`, but only for sites that OQ1 / Loki shows are live.
   - A live-ctx negative control must keep each WARN.
2. **Marketdata GetBars miss-path negative cache (AC-2).**
   - Add a mutex-guarded `symbol|tf` map beside `lastStaleCheck`, set when `fetchAndCacheBars` returns empty and consulted at the `:338`/`:347` branch after `liveFetchAllowed`.
   - Emit the WARN once per state change.
   - Choose the window (stale interval vs a config key, OQ3). If it is a key, the config migration and its `SetConfig` bounds belong in this step or a preceding one.
   - Update the structural test `:1273` together with the behaviour change.
3. **Portfolio cancel-quiet.**
   - In `processAccountDeregistered` (`:1566`/`:1570`), return `ctx.Err()` without the WARN when ctx is done, keeping the genuine-failure retry (@AC-2 @feature-256).
   - In `processBracketUpdate` (`:1706`) and `processBalanceSync` (`:1765`), Debug on a done ctx while keeping `ackAlways` semantics unless design decides otherwise.
   - Update portfolio `CLAUDE.md` "Cancel-stop (feature 290)" text.
4. **Docs and acceptance promotion.** Update the marketdata/portfolio `CLAUDE.md` GetBars and consumer notes. Promote the AC scenarios at launch (C-16).
