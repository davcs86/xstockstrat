# Recon: fix-ctx-cancel-warn-flood

**Created**: 2026-11-04
**From**: product-spec.md
**Affected services**: xstockstrat-portfolio, xstockstrat-marketdata

---

## Objective

When a context is canceled, portfolio's `account.positions.synced` handler and marketdata's `GetBars` /
warm-poller cache-write paths keep working and log one WARN per item (3.3k portfolio + 557 marketdata lines
in 7 days). Stop the per-item flood and the wasted DB calls without altering the retry/park/self-heal contract
(portfolio) or the log-and-return-empty contract (marketdata), and without silencing genuine failures.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Only caller: `go svc.ConsumePositionSyncs(ctx)` — `cmd/server/main.go:73`; ctx is process-wide `context.WithCancel(context.Background())` (`main.go:38`), canceled only at shutdown; `streamEventsFrom` passes it to the handler unchanged.
  - Consumer: `ConsumePositionSyncs` — `internal/service/portfolio_service.go:1236-1238` → `consumeEventStream` (`:191-208`, `ctx.Err()` early return at `:197`) → `streamEventsFrom` (`:212-239`; `lastSeq` not advanced on handler error, `:232`).
  - Fix site: `processPositionSync` — `portfolio_service.go:1381`; per-symbol loop `:1409-1425` (WARN `:1421`, failures appended `:1422`, no `ctx.Err()` check); delete step `:1426-1430` (WARN `:1428`); offline realized WARN `:1438-1439`; broker sync returns nil (warn-and-continue), offline sync returns `errors.Join(failures...)` (`:1443-1446`); whole call holds `positionsMu` (`:1399-1400`).
  - Retry: `boundedRetry` `:1297-1330`, `classifyConsumerErr` `:1267-1293` (`context.Canceled`/`DeadlineExceeded`/pg timeout/net error → `retryTransient`, never parks, cursor withheld; `:1279`). `boundedRetry` does not look at `ctx.Err()`. Park → `slog.ErrorContext "event parked"` `:1325-1326`.
  - Same warn-per-write shape: `processAccountDeregistered` `:1332-1366` (WARNs `:1358`, `:1362`). Single-item (not loops): `processBalanceSync` `:1535`, `processBracketUpdate` `:1476`, `processOrderFill` (`:281` is parse-only).
  - Repo: `UpsertPositionFromSync` `internal/repository/portfolio_repo.go:319-335`, `DeletePositionsNotInSync` `:351-367` — return pgx's raw error; processor wraps with `%w` (`:1422`, `:1429`) so `errors.Is(err, context.Canceled)` matches.
- **`xstockstrat-marketdata`** (Go) — all in `internal/service/marketdata_service.go`
  - `fetchAndCacheBars` `:356-388` (doc: "On any failure it logs and returns no bars"): cache insert `:371` on request `ctx` via `s.repo.InsertBars(ctx, live)`; re-read `:375-386` (`QueryRecentBars`/`QueryBars`) on request `ctx`; on cache or re-read failure returns `truncateBars(live, pageSize, recent), ""` (caller still gets data, nil error).
  - Repo wrapping with `%w`: `InsertBars` `marketdata_repo.go:57` (`begin tx`), `QueryBars` `:109`, `QueryRecentBars` `:179` (verified).
  - Warm poller `:1152`, `:1173` (`cacheQuote(ctx, …)`, poller loop ctx — canceled on shutdown); `cacheQuote` `:1081`.
  - Same shape, not in the report: `GetLatestQuote: cache insert failed` `:564` (request ctx); `bar ingest: insert failed` `:1305`, `:1326`; fetch-failed WARNs `:359`, `:364`, `:1157`, `:1179`, `:1311`, `:1318`.
  - **Deliberately detached — do not change:** `GetLatestQuotes` singleflight (`fctx` `:606`, insert `:627`, WARN `:628` logged with outer ctx) and `BatchGetBars` (`fctx` `:851`/`:884`, insert `:791`, WARN `:792`).
  - Only existing ctx-aware WARN pattern: `GetLatestQuotes: mark lookup failed` logs `"ctx_done", ctx.Err() != nil` (`:664`).
  - Seams: `quoteStore` (`:121-124`) and `barsBatchStore` (`:127-130`) are interfaces (wired `:238-239`); `s.repo` is the concrete `*repository.MarketDataRepo` (`:38`) — `fetchAndCacheBars` (`:371`, `:375`, `:382`) and ingest (`:1305`, `:1326`) have **no seam**.

## Patterns to REUSE

- Cancel detection → no shared helper exists; reuse the inline idiom `errors.Is(err, context.Canceled)` / `ctx.Err() != nil` already used at `portfolio_service.go:197`, `:1171`, `:1279`, `internal/handler/portfolio_handler.go:428-431`, `fmp_client.go:315,333`. A new helper would be a first (see Risks) — only justified if both services need it, and they are separate Go modules.
- Cancel-aware log field → `"ctx_done", ctx.Err() != nil` — `marketdata_service.go:664`.
- ctx-class log label → `enrichmentClass` returns `"ctx"` — `internal/fmp/fmp_client.go:329-333` (fmp-private).
- WARN assertions in tests → portfolio `warnRecorder`/`recordWarns`/`find` (`portfolio_quote_deadline_test.go:32-69`; no `t.Parallel()`); marketdata `countingWarnHandler` (`marketdata_service_test.go:1002`), `recordingLogHandler` (`:1854`).
- Portfolio RED harness → `newFillSvc` (`portfolio_fill_errors_test.go:56`), `errDBBlip` (`:22`), `syncEvent`/`offlineSyncPayload` (`portfolio_sync_retry_test.go:21,30`), `runOfflineSync` with `syncRecorderDB` (`portfolio_offline_test.go:249`), pgxmock `WillReturnError(context.Canceled)`.
- Marketdata fakes → `fakeQuoteStore` (`:3330`), `fakeBarsStore` (`:4060`), `newQuoteSvc` (`:3357`); precedent for waiter-survives-cancel: `TestBatchGetBars_PartialWaiterSurvivesLeaderCancel` (`:4203`).
- C-13: Go fixtures home is `internal/testdata/` (portfolio `ledger.go`; marketdata only `marks.go`); fakes are otherwise inline in the test files — keep to one consumer inline.

## Existing Business Rules (preserve / extend)

No EXTEND, no CHANGE. Every row is PRESERVE (source: scenario-recon; both services have an `acceptance/` suite).

- **PRESERVE** `@AC-1 @FR-1 @regression @feature-256` "A failed offline realized-P&L write is retried, not acked" (`services/xstockstrat-portfolio/acceptance/fix-offline-book-consistency.feature`) — a cancel-stop must withhold the cursor and never ack.
- **PRESERVE** `@AC-6 @FR-3 @regression @feature-256` "A persistently failing offline sync event is parked…" (same) — cancel must not accrue park attempts.
- **PRESERVE** `@AC-9 @FR-3 @regression @feature-256` "A transient write failure never parks…" (same) — canceled/deadline stays in the never-park class.
- **PRESERVE (conditional on touching `boundedRetry`)** `@AC-2 @FR-2 @feature-256` (same) + platform `@AC-15 @FR-1 @feature-157`, `@AC-18 @FR-8 @feature-163` (`docs/sdd/business-rules/platform.feature`).
- **PRESERVE** `@AC-4 @regression @feature-206` (`…/fix-reconciliation-false-halt.feature`) — empty-snapshot delete guard; cancel handling must not change when `DeletePositionsNotInSync` runs.
- **PRESERVE** `@AC-7`, `@AC-10`, `@AC-11 @FR-6 @feature-157` (`…/offline-account-portfolios.feature`); `@AC-14 @feature-163` (`…/snapshot-offline-positions.feature`) — absolute-recompute sync, idempotent replay, full-close purge.
- **PRESERVE** `@AC-3 @regression @feature-229` "Coalesced quote waiters are not failed by the first caller's cancellation" (`services/xstockstrat-marketdata/acceptance/fix-book-portfolio-page.feature`) — most important marketdata guard: the detached flight is untouched.
- **PRESERVE** `@AC-8 @feature-229` (cold-fetch failure still WARNs `GetLatestQuotes: cold fetch failed`), `@AC-7 @feature-229` (out-of-window quote not cached) (same).
- **PRESERVE** `@AC-8 @FR-2 @feature-196`, `@AC-3 @FR-3 @feature-178`, `@AC-53/@AC-54 @feature-240`, `@AC-2/@AC-3 @feature-191`, `@AC-1 @feature-153`, `@AC-7 @FR-6 @feature-147`, `@AC-3 @feature-227`, `@AC-11 @feature-231` — GetBars→InsertBars persistence, single-flight coalescing, allow_partial semantics, omit-not-fabricate, and "genuine failures still WARN".
- Note (scenario-recon): no scenario asserts log volume on the sync consumer, so per-item WARN suppression conflicts with none; the `@AC-6 @feature-256` "event parked" Error log is log-only and must neither be produced nor hidden by a cancel. Suppress only cancel-caused repeats (the caller's own canceled ctx); a real vendor/feed/credential failure must keep logging.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none anticipated (F-07: no hardcoded values — nothing tunable is introduced)
- Inter-service edges: none new
- New env vars / ports: none

## Risks / Not-found

- **Root cause of the portfolio cancel is unresolved.** The handler ctx is process-wide and canceled only at shutdown (`main.go:38`), so the report's "ledger stream cancel" hypothesis does not map to a ctx cancel in this code. Bursts of 300–580 lines/hour are larger than one shutdown's in-flight event would explain. Candidates: SIGTERM mid-event during a rolling deploy; pgx pool teardown surfacing `context canceled`; a replay of many events at shutdown. Not resolvable by reading — needs a log check (trace/instance id around a burst) or accepting that the fix is correct for every candidate (stop on `ctx.Err()`).
- **Not found:** no shared `isCanceled`/log-downgrade helper in any Go package; no test driving `processPositionSync` with a canceled ctx; no test of `fetchAndCacheBars`, warm-poller insert failure, or ingest insert failure; no fake for `*repository.MarketDataRepo`; no documented log-level convention for expected cancel/shutdown.
- `boundedRetry` must keep classifying cancel as transient; a stop-on-cancel that returns an error must not reach the park branch (`@AC-9`).
- Marketdata invariant MARKETDATA-3 (`services/xstockstrat-marketdata/docs/context-constitution.md:19`): failures log and return empty, never error — the fix may change classification/log level only, not what the caller receives. Do not "fix" `:628`/`:792` by moving to the request ctx.
- Test-seam gap forces a decision: `:371`/`:375`/`:382` need a new seam (e.g. a store interface) or can only be covered structurally (existing GetBars tests are source-text checks).
- `toGRPCError` collapsing `Canceled`/`DeadlineExceeded` to `Internal` (`docs/context-constitution-findings.md:21`) is a separate defect — out of scope.
- Ledger: no `fails.md`/`insights.md` entry about ctx-cancel logging was found by grep.

## Recommended Scope

Two independent fix sites (separate Go modules, separate PRs/steps):
1. Portfolio: `ctx.Err()` short-circuit in `processPositionSync` (loop + delete + offline realized) returning the cancel once (transient class), with RED tests; decide whether `processAccountDeregistered` shares the fix.
2. Marketdata: classify cancel-caused cache-insert / re-read / warm-poller failures (`:371`, `:377`, `:384`, `:1152`, `:1173`, optionally `:564`, ingest `:1305`/`:1326`) so they stop WARN-flooding while genuine failures keep WARNing; leave detached closures untouched.
