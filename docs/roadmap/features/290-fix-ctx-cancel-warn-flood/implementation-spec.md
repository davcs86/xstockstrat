# Implementation Spec: fix-ctx-cancel-warn-flood

**Status**: `pending`
**Created**: 2026-11-04
**Feature**: `docs/roadmap/features/290-fix-ctx-cancel-warn-flood/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/fix-ctx-cancel-warn-flood`

---

## Execution Summary

Two independent fixes in separate Go modules (portfolio, marketdata), then one docs step. Portfolio goes first
(Steps 1-2, smallest blast radius: one function, one local closure); marketdata second (Steps 3-4: one function plus
one fixed constant and one atomic slot); Step 5 reconciles the docs that describe the changed behavior (Teardown rule).
Each `service` step is paired with a `test` step placed immediately after it; the test is authored to fail on the
pre-implementation tree (P-06) and `/sdd-execute` captures that red run before the service edit.

Consumer surface: **None — internal/platform-only** (log hygiene and cache persistence; C-14 decision stated in
`product-spec.md` § Consumer Surface(s), not an omission). No proto, migration, config key, env var or port change
(so no `docker-compose.yml` / `.do/*.yaml` edit). Trading-domain constraints (`step-constraints.md` §A): portfolio is
in scope for the survey but no order placement, broker dispatch, order type, `TRADING_MODE` or fill-state logic is
touched — "broker/order/fill handling unaffected by this step".

### Scenario Coverage (C-15)

| Scenario | Tags | Covered by |
|---|---|---|
| `@AC-1` canceled ctx stops the position-sync loop after one error | FR-1 regression | Step 2 |
| `@AC-2` a write that discovers the cancellation stops without a WARN | FR-1 regression | Step 2 |
| `@AC-3` canceled offline sync through `boundedRetry` is never parked | FR-1 | Step 2 |
| `@AC-4` genuine write failure with a live ctx still warns | FR-1 characterization | Step 2 |
| `@AC-5` empty-broker-snapshot skip path unchanged by a done ctx | FR-1 characterization | Step 2 |
| `@AC-6` fetched bars persisted after the client cancels, no WARN | FR-2 regression | Step 4 |
| `@AC-7` live client's cache write gets no new deadline | FR-2 regression | Step 4 |
| `@AC-8` genuine cache-insert failure with a live client still warns, live page returned | FR-2 characterization | Step 4 |
| `@AC-9` only one departed-client cache write at a time | FR-2 | Step 4 |

### Spec-time decisions that refine `design.md` (flag for `/sdd-review impl-spec`)

These keep every design constraint and every `@AC-*` intact; they close gaps the design left implicit.

1. **`grace` mechanism has two branches, not one.** `design.md` specifies `WithCancel(WithoutCancel(ctx))` +
   `context.AfterFunc(ctx, time.AfterFunc(grace, cancel))` for every write. That context never carries a
   `Deadline()`, but `@AC-6` (and the design's own RED test) assert "a deadline no later than the grace". So: when the
   request ctx is **already done** at write start (the `@AC-6` case and every cancel-burst case), use
   `context.WithTimeout(context.WithoutCancel(ctx), grace)` — a real deadline, no timer or goroutine. When the ctx is
   **live** at write start, keep the design's `WithCancel(WithoutCancel(ctx))` + `AfterFunc` form (no deadline while the
   client is live, `@AC-7`; capped at `grace` only if the client leaves mid-write). Same semantics, testable literally.
2. **The one-writer slot is an `atomic.Bool`, not a buffered channel.** Test literals (`&MarketDataService{...}`) leave
   fields zero; a nil channel in a non-blocking `select` would always take `default` and skip every departed write. An
   `atomic.Bool` (`CompareAndSwap(false, true)`) is zero-value usable and needs no constructor change.
3. **A write error is WARNed whatever the ctx state.** The write runs on a detached ctx, so a failure is never the
   client's cancel — it is a genuine DB error or the `grace` expiring (which would signal an undersized `grace`). Departed
   writers are capped at one, so this is at most one WARN per `grace`. `design.md` only states the live-ctx case.
4. **`grace` = 5 s, justified by trace evidence, not by a direct `InsertBars` p99.** `InsertBars` has no span (the pgx
   pool is not instrumented — `grep otelpgx|Tracer internal/repository` finds nothing), so the p99 the design asked for
   cannot be measured directly. Tempo (`grafanacloud-traces`, service `marketdata`, 2026-11-03 14:00Z to 2026-11-04
   14:00Z): `GetBars` root-span p99 = 195 ms over the 10:00Z-10:15Z window; the slowest `GetBars` requests over 24 h
   (every one that exceeded 1 s, n = 10) peaked at **2.70 s end to end** — a ceiling that includes the Alpaca fetch,
   the write and the re-read. 5 s is 1.85x that ceiling. Worst case at the bound: one departed-client writer holds one
   pooled client connection for at most 5 s (marketdata is PgBouncer-pooled, root `CLAUDE.md` § Connection Pool Budget);
   it adds no direct backend slot, so no pool maximum changes (F-06). Step 3 records this in the `context.md` log.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]; Step 4 [test] covers Step 3 [service] (C-08 pairing).
- Step 1 and Step 3 are independent (separate Go modules); Steps 1-2 are ordered first only for blast-radius.
- Step 5 [docs] requires Steps 1 and 3 (it describes their final behavior).
- Overlap with feature **291** (`fix-marketdata-dead-symbol-ingest`, `design-approved`): 291 also edits
  `marketdata_service.go` — the ingester inserts (`:1304`, `:1325`) and a one-line comment on the `barsStore` field
  (`:109`) — and its `design.md:26` states `fetchAndCacheBars`' `InsertBars` (`:370`) is left untouched. Step 3 also edits
  the `barsStore` field comment (`:109`) and `fetchAndCacheBars`; the two land as an ordinary textual rebase, no hard
  ordering (not a `merge-order.md` entry: no migration, proto field or config key shared). Whichever merges second
  re-reads the `:109` comment so it states both consumers.
- `docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md` is the named follow-up for every site left out of scope.
- Promotion of `acceptance.feature` into the durable suites
  (`services/xstockstrat-portfolio/acceptance/`, `services/xstockstrat-marketdata/acceptance/`, **C-16**) happens in the
  `/sdd-execute` integration PR, not in a step here.

---

### Step 1 — service: stop `processPositionSync` once its context is done

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `grep -n "func (s \*PortfolioService) processPositionSync" services/xstockstrat-portfolio/internal/service/portfolio_service.go` → `:1381`; doc comment `:1379-1380` ("returns an error only for an offline sync (RealizedPnl != nil): every offline write is attempted and the failures joined. A broker sync stays warn-and-continue.").
- Per-symbol loop `:1409` (`for _, p := range sync.Positions`); upsert `s.repo.UpsertPositionFromSync(...)` then `if err != nil { slog.WarnContext(ctx, "upsert position from sync failed", ...) ; failures = append(...) }` at `:1420-1423`; `presentSymbols = append(presentSymbols, p.Symbol)` `:1424`.
- Delete branch `if shouldReconcileSyncDeletions(len(sync.Positions), sync.RealizedPnl) {` `:1426`, `DeletePositionsNotInSync` `:1427`, its WARN `:1428`; feature-206 `else { slog.DebugContext(ctx, "skipping delete on empty broker position snapshot", ...) }` `:1431-1433` (gets **no** check — unchanged by construction).
- Realized branch `if sync.RealizedPnl != nil {` `:1437`, `UpsertOfflineRealized` `:1438`, WARN `:1439`; `if sync.RealizedPnl == nil { return nil }; return errors.Join(failures...)` `:1443-1446`. Whole call holds `positionsMu` (`:1399-1400`, `defer Unlock`).
- Existing ctx idiom to reuse (no shared helper exists): `consumeEventStream` `if ctx.Err() != nil { return }` at `:197`; classification `classifyConsumerErr` treats `errors.Is(err, context.Canceled|DeadlineExceeded)` as `retryTransient` (`:1279`) so `boundedRetry` (`:1297-1330`) returns the error without parking; `streamEventsFrom` returns on handler error with `lastSeq` not advanced (`:232-233`).
- Local closure only: portfolio and marketdata are separate Go modules (`go.mod` per service), so no cross-module helper (design Rejected Alternatives).
- Lint: `sloglint` with `context: scope` (`services/xstockstrat-portfolio/.golangci.yml`) — log calls must use the `*Context` variants with `ctx`.

**TDD**: `red-green required`

**Covers**: — (behavior verified by Step 2)

**Instructions**:
1. Inside `processPositionSync`, directly after `presentSymbols := make(...)` (before the loop at `:1409`), add one local closure:
   `stop := func(sym string) error { slog.DebugContext(ctx, "position sync stopped: context done", "account_id", sync.AccountID, "symbol", sym); return ctx.Err() }`
   (`sym` is `""` at the delete/realized sites). Debug, not Info/Warn.
2. Check sites — each is `if ctx.Err() != nil { return stop(<sym>) }`, **return, never `break`** (a break would run the delete on a truncated `presentSymbols`):
   - (a) first statement of the per-symbol loop body (`:1409`), before building `val`/calling `UpsertPositionFromSync`;
   - (b) at the top of the upsert error branch (`:1420`), **before** the `slog.WarnContext` — a write that itself discovered the cancellation stops silently;
   - (c) **inside** the `shouldReconcileSyncDeletions` true branch (`:1426`), immediately before `DeletePositionsNotInSync`, and at the top of its error branch before the WARN (`:1428`);
   - (d) **inside** `if sync.RealizedPnl != nil` (`:1437`), immediately before `UpsertOfflineRealized`, and at the top of its error branch before the WARN (`:1439`).
3. Do **not** add any check to the feature-206 `else` skip branch (`:1431-1433`), and do not use `errors.Is(err, context.Canceled)` as the stop test: the decision keys on the caller's `ctx.Err()` so a ctx-alive driver-reported cancel still WARNs (`@AC-4`).
4. Rewrite the doc comment at `:1379-1380` to: `// Returns ctx.Err() as soon as ctx is done (before the next write, any sync); otherwise an offline sync attempts every write and joins the failures, and a broker sync stays warn-and-continue.` (2 lines, constraint-only per root `CLAUDE.md` § How to Act #5.)
5. Do not touch `boundedRetry`, `classifyConsumerErr`, `consumeEventStream`, `processAccountDeregistered` or any other consumer (follow-up report). Broker sync (`RealizedPnl == nil`) now returns the cancel error instead of nil when ctx is done — intended: it stops the shutdown drain; the cursor is irrelevant because `lastSeq` is in memory (`:192`) and full history replays from 0 at boot.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/ && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "position sync stopped: context done\|ctx.Err() != nil" internal/service/portfolio_service.go   # confirms sites (a)-(d) + the :197 original
```
Confirm the `else` branch for the feature-206 skip contains no `ctx.Err()` reference and no `break` was introduced inside the loop.

---

### Step 2 — test: portfolio cancel behavior (RED first)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_sync_cancel_test.go` — create

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Harness to reuse, all in package `service` (confirmed by grep): `syncRecorderDB` (records every `Exec`; `QueryRow`/`Query` find no rows; `find(substr)`) and `recordedExec` at `portfolio_offline_test.go:220-247`, injected via `repository.NewPortfolioRepoWithDB(db)` (`internal/repository/portfolio_repo.go:49`; `queryRower` = `QueryRow`/`Query`/`Exec`, `:22-26`); service literal pattern `&PortfolioService{repo: repository.NewPortfolioRepoWithDB(db), ledger: &fakeLedger{}, cfg: &config.Watcher{}}` at `portfolio_offline_test.go:~258` (`runOfflineSync`); `fakeLedger` `watchlist_service_test.go:254`.
- `syncEvent(t, seq, payload)` and `offlineSyncPayload(positions)` (`portfolio_sync_retry_test.go:21,30`); `warnRecorder` / `recordWarns(t)` / `.find(msg)` (`portfolio_quote_deadline_test.go:32-69`; records only WARN and above in `.recs`; process-global `slog.SetDefault` — **no `t.Parallel()`**); `parkedCount(rec)` counts `"event parked"` (`portfolio_sync_retry_test.go:~54`, note it reads the same recorder, and `"event parked"` is an Error so it is recorded); `newFillSvc(t)` (pgxmock-backed, `portfolio_fill_errors_test.go:56`); `errDBBlip`; pgxmock `WillReturnError(context.Canceled)` precedent in the same suites.
- `boundedRetry(consumer, h)` returns an `eventHandler`; `s.clock()` is nil-safe (`offline_valuation.go:72`, `now` nil means `time.Now`).
- C-13: `cancelingDB` has exactly **one** consumer (this file) → inline, compliant; it embeds `syncRecorderDB` rather than copying it (DRY). No `internal/testdata/` addition.
- Trading-domain: no order/fill/broker-dispatch logic is exercised — "fill handling unaffected by this step".

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5` — `AC-1`, `AC-2`, `AC-3` are the RED regression assertions; `AC-4` and `AC-5` are **characterization guards** (they pass before and after; labelled as such in the test names/comments, per the design).

**Instructions**:
1. New file, package `service`. Declare one inline fake:
   ```go
   type cancelingDB struct {
       syncRecorderDB
       cancel       context.CancelFunc
       cancelAtExec int  // 1-based Exec index at which cancel() fires
       failOnCancel bool // that Exec also returns ctx.Err()
   }
   ```
   with `func (d *cancelingDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)` that calls `d.syncRecorderDB.Exec(ctx, sql, args...)`, then if `len(d.execs) == d.cancelAtExec` calls `d.cancel()` and (when `failOnCancel`) returns `pgconn.CommandTag{}, ctx.Err()`; otherwise returns `pgconn.CommandTag{}, nil`. `QueryRow`/`Query` are promoted from the embedded recorder.
2. Test name convention: `TestProcessPositionSync_AC<N>_<Behavior>` (mirrors `TestProcessPositionSync_AC1_RealizedUpsertFailureIsRetryable`). Each test calls `rec := recordWarns(t)` first, builds a service as in `runOfflineSync`, and uses a 3-position offline payload (`offlineSyncPayload` with three `{"symbol","qty","avg_cost"}` maps) unless stated.
3. `AC-1` (RED): `ctx, cancel := context.WithCancel(...)`; `db := &cancelingDB{cancel: cancel, cancelAtExec: 1}` (first upsert succeeds, then cancels). Call `processPositionSync(ctx, syncEvent(...))`. Assert `len(db.execs) == 1` (no second upsert, no delete, no realized), `errors.Is(err, context.Canceled)`, `rec.find("upsert position from sync failed") == nil` and `rec.find("delete positions not in sync failed") == nil`.
4. `AC-2` (RED): same but `failOnCancel: true`. Assert `len(db.execs) == 1`, `db.find("DELETE FROM portfolio.positions") == nil`, `len(rec.recs) == 0` (no WARN at all — read under `rec.mu`), `errors.Is(err, context.Canceled)`.
5. `AC-3` (RED): `ctx` already canceled; `db := &syncRecorderDB{}`; `handle := svc.boundedRetry("position sync", svc.processPositionSync)`; call `handle(ctx, offlineSyncEvent)`. Assert `err != nil` (and `errors.Is(err, context.Canceled)`), `db.find("offline_account_realized") == nil`, `len(db.execs) == 0`, `parkedCount(rec) == 0`.
6. `AC-4` (characterization): live ctx; use `pgxmock` via `newFillSvc(t)`: `mock.ExpectExec("INSERT INTO portfolio.positions").WithArgs(anyArgs(15)...).WillReturnError(context.Canceled)` for a **broker** payload (no `realized_pnl`, one position, `"account_id":"brk-1"`) and `mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs(anyArgs(3)...).WillReturnResult(pgxmock.NewResult("DELETE", 0))`. Assert `rec.find("upsert position from sync failed") != nil` and `processPositionSync` returns nil (broker stays warn-and-continue) — the negative control that pins "key on ctx state, not error text".
7. `AC-5` (characterization): broker payload with `"positions": []interface{}{}` and no `realized_pnl`, ctx already canceled, `db := &syncRecorderDB{}`. Assert `len(db.execs) == 0` and `err == nil` (the feature-206 skip path returns before any check).
8. Red-first note for `/sdd-execute`: on the pre-Step-1 tree `AC-1`/`AC-2`/`AC-3` fail by assertion (the loop keeps writing and WARNing); `AC-4`/`AC-5` pass. Cite the `@AC-*` ID in each RED assertion message.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestProcessPositionSync' -v
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
grep -rn "type cancelingDB" --include="*_test.go" services/xstockstrat-portfolio   # C-13: exactly one declaration site
```
New logic is in `internal/service`, an excluded package — no coverage threshold applies to it; the behavioral tests above are the verification. Existing `TestProcessPositionSync_*`, `TestShouldReconcileSyncDeletions` and the `boundedRetry` suites must still pass.

---

### Step 3 — service: persist `GetBars` live-fallback bars after the client leaves

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Confirmed via: `grep -n "func (s \*MarketDataService) fetchAndCacheBars" services/xstockstrat-marketdata/internal/service/marketdata_service.go` → `:356`; stale doc `:354-355` ("On any failure it logs and returns no bars (GetBars → empty response)" — already false on insert failure).
- Today's write: `if err := s.repo.InsertBars(ctx, live); err != nil { slog.WarnContext(ctx, "GetBars: cache insert failed", "symbol", symbol, "error", err); return truncateBars(live, pageSize, recent), "" }` at `:370-373`; re-reads `s.repo.QueryRecentBars(ctx, ...)` `:375` and `s.repo.QueryBars(ctx, ...)` `:382`, WARN `"GetBars: re-read after cache failed"` at `:377` and `:384`, each returning `truncateBars(live, pageSize, recent), ""`.
- Existing seam to reuse (no new interface): `barsBatchStore` declares `QueryBarsBatch` and `InsertBars(ctx, bars []*marketdatav1.Bar) error` at `:126-130`; the field `barsStore barsBatchStore` at `:109-110` (comment: "BatchGetBars' bar cache read/write seam; nil (test literals) treats every symbol as cold"); wired in the constructor `svc.barsStore = repo` at `:239` under `if repo != nil`. `*repository.MarketDataRepo.InsertBars` (`marketdata_repo.go:51`) opens `r.pool.Begin(ctx)` ("begin tx" — the error in the Loki flood), loops `tx.Exec` per bar, then `tx.Commit(ctx)`; upsert `ON CONFLICT (symbol, timeframe, time) DO UPDATE` → idempotent, rollback on ctx death (`defer tx.Rollback`).
- Existing detach idiom: `context.WithTimeout(context.WithoutCancel(ctx), …)` at `:606`, `:851`, `:884`; existing fixed invariant constant `const barsPartialMargin = 250 * time.Millisecond` at `:838`. Imports: `"sync"` present (`:11`), **`"sync/atomic"` absent** — add it. Struct has `staleMu`/`lastStaleCheck` at `:50-52` (field-group style).
- **Must stay synchronous**: `truncateBars` → `omitDeprecatedTimeframe` (`:404-408`, clears `b.Timeframe` in place) shares the `live` bars with `InsertBars`; a fire-and-forget write would race it and could persist an empty `timeframe` (`@AC-8 @feature-196`, MARKETDATA-1).
- Callers: single call site `GetBars` → `s.fetchAndCacheBars(...)` at `:326`; the detached singleflight closures (`:604-632`, `:774-860`) are **not** touched (`@AC-3 @feature-229`).
- Downstream hazard the design guards against: a live caller's write must not gain a deadline — a truncated full page with an empty next-page token reads as end-of-data in analysis (`services/xstockstrat-analysis/app/handlers/servicer.py:1482-1484`, `@feature-272`).
- Config: **none** (F-07 note — `grace` is a fixed resource-protection invariant, operator-approved in `context.md` 2026-11-04 round-2; it decides neither what the caller receives nor how old data can be; fallback if the operator wants it tunable is one key `marketdata.bars.cache_write_timeout_ms` with config-team approval). Same fixed-invariant precedent as `barsPartialMargin` (`:838`), `etfFlagTTL`, `etfFlagQueueCap` (marketdata `CLAUDE.md` § Fundamentals Integration).
- Measurement for `grace`: see § "Spec-time decisions" item 4 (Tempo, 24 h, slowest whole-request `GetBars` = 2.70 s; no `InsertBars` span exists).

**TDD**: `red-green required`

**Covers**: — (behavior verified by Step 4)

**Instructions**:
1. Add `"sync/atomic"` to the import block. Next to `barsPartialMargin` (`:838`) — or directly above `fetchAndCacheBars` — add `const barsCacheWriteGrace = 5 * time.Second` with a ≤2-line constraint comment: grace applies only after the client has left; never lengthen it without re-checking pooled-connection hold time.
2. Add one field next to `lastStaleCheck` (struct group `:50-52`): `departedBarsWrite atomic.Bool` with a ≤2-line comment: at most one departed-client cache write runs at a time; zero value usable by test literals.
3. Update the `barsStore` field comment (`:109`) so it names both consumers: `BatchGetBars` and `fetchAndCacheBars` (the latter requires it non-nil — no nil-guard; a nil store must panic, never silently drop bars; same stance as feature 291's ingester).
4. Add an unexported helper on `*MarketDataService`:
   `func (s *MarketDataService) cacheLiveBars(ctx context.Context, live []*marketdatav1.Bar) (skipped bool, err error)` that writes via `s.barsStore.InsertBars`:
   - **Departed at start** (`ctx.Err() != nil`): `if !s.departedBarsWrite.CompareAndSwap(false, true) { return true, nil }`; `defer s.departedBarsWrite.Store(false)`; `wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), barsCacheWriteGrace)`; `defer cancel()`; return `false, s.barsStore.InsertBars(wctx, live)`.
   - **Live at start**: `wctx, cancel := context.WithCancel(context.WithoutCancel(ctx))`; `defer cancel()`; `stop := context.AfterFunc(ctx, func() { time.AfterFunc(barsCacheWriteGrace, cancel) })`; `defer stop()`; return `false, s.barsStore.InsertBars(wctx, live)`. No deadline is ever attached while the client is live (`@AC-7`); only a client that leaves mid-write bounds the write at `barsCacheWriteGrace`.
5. In `fetchAndCacheBars`, replace `:370-373` with:
   ```go
   skipped, err := s.cacheLiveBars(ctx, live)
   if skipped {
       return truncateBars(live, pageSize, recent), ""   // departed client, slot busy: silent, as today
   }
   if err != nil {
       slog.WarnContext(ctx, "GetBars: cache insert failed", "symbol", symbol, "error", err)
       return truncateBars(live, pageSize, recent), ""
   }
   if ctx.Err() != nil {
       return truncateBars(live, pageSize, recent), ""   // client gone: skip both re-reads, no DB call, no WARN
   }
   ```
   leaving the existing re-read block (`:374-387`) unchanged below it. Keep the write synchronous and **before** `truncateBars`.
6. Rewrite the stale doc comment at `:354-355` to a ≤2-line constraint: *persists the fetched bars even if the client leaves (bounded by `barsCacheWriteGrace` after departure); on write/re-read failure it logs and returns the live page, never an error (MARKETDATA-3).*
7. Do not change `BackfillBars`, the ingester inserts (`:1304`/`:1325` belong to feature 291), `GetLatestQuote` (`:564`), the warm poller (`:1152`/`:1173`), or any singleflight closure.
8. At execute time append the `grace` evidence in "Spec-time decisions" item 4 to this feature's `context.md` (closes the Open Thread "Size `grace` from a measured `InsertBars` p99") and, if the operator can supply a direct `InsertBars` timing from staging, re-confirm 5 s against it before the PR.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/ && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "barsCacheWriteGrace\|departedBarsWrite\|cacheLiveBars\|s.repo.InsertBars(ctx, live)" internal/service/marketdata_service.go
```
Confirm `s.repo.InsertBars(ctx, live)` no longer appears inside `fetchAndCacheBars`, the only remaining `s.repo.InsertBars` call sites are `BackfillBars` and the ingester, and no `go func` was introduced around the write.

---

### Step 4 — test: marketdata cache-write detachment (RED first)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (append the two fakes and the tests at the end of the file, after `partialSvc`/`batchReq`, `:~4100`)

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- **No existing test reaches `fetchAndCacheBars`** (`grep -n "fetchAndCacheBars" internal/service/*_test.go` → none). The obvious candidates would pass vacuously: `fakeMultiSource.GetBars` returns `nil, nil` (`marketdata_service_test.go:~1345`), `fakeBackfillSource.GetBars` returns `nil, nil` (`:~904-907`), and `fakeBarsStore.InsertBars` is a stateless no-op (`:~4074`). Hence two new inline fakes (design § RED tests).
- Reuse: `fakeBackfillSource`'s four unused `DataSourceClient` methods via embedding (`type scriptedBarsSource struct{ *fakeBatchBarsSource ... }` at `:~4076` is the embedding precedent); `source.NewRegistry()` + `reg.Register("alpaca", src)` and `Registry.Get("")` → `"alpaca"` (`internal/source/source.go:175-185`, `partialSvc` `:~4090`); `installWarnRecorder(t)` returning `*recordingLogHandler` with `.count(msg)` / `.find(msg)` (`:1907-1920`, `:1895`) — process-global `slog.SetDefault`, **no `t.Parallel()`**; `timestamppb`, `sync`, `sync/atomic`, `errors`, `context`, `time` already imported (`:3-31`).
- `s.repo` stays nil in these literals (`&MarketDataService{registry: reg, barsStore: store}`): a code path that still reaches `s.repo.QueryRecentBars/QueryBars` or the old `s.repo.InsertBars` **panics** — that panic is the guard that "no re-read is made" (`@AC-6`) and the reason `@AC-6`/`@AC-9` go RED on today's tree by nil-`s.repo` panic at `:370` rather than a failed assertion (record this in the Deviation Log if the executor observes it).
- Stored-bar timeframe is mutated after the write (`omitDeprecatedTimeframe`, `:404-408`), so the fake must snapshot `Timeframe` **at call time**.
- C-13: both fakes have a single consumer (this file's new tests) → inline, compliant; marketdata's only `internal/testdata/` file is `marks.go` and no home is created.
- No test seam exists for the re-read (`s.repo` is the concrete `*MarketDataRepo`, `:38`); a client leaving during the single indexed re-read can still produce one WARN — accepted residual, not tested (C-18).

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7, AC-8, AC-9` — `AC-6`, `AC-7` regression; `AC-8` characterization (live-ctx failing write still WARNs and returns the live page; plus the Spec-time-decision-3 subcase); `AC-9` one-writer slot. An additional mid-write-departure case is filed under `AC-6` (same FR-2 guarantee: the write survives the client leaving).

**Instructions**:
1. Append two inline fakes:
   - `barsCancelSource` — `struct { *fakeBackfillSource; bars []*marketdatav1.Bar; cancel context.CancelFunc }`; `GetBars(...)` calls `f.cancel()` when non-nil (client leaves **after** the live fetch begins and before the write), then returns `f.bars`. Test bars: two `*marketdatav1.Bar{Symbol: "AAPL", Timeframe: "1d", Time: timestamppb.New(...)}` (the Alpaca client writes the canonical string back before `InsertBars`, MARKETDATA-1).
   - `recordingBarsStore` — implements `barsBatchStore` (`QueryBarsBatch` returns `nil, nil`); `InsertBars(ctx, bars)` records, under a mutex: call count, `ctx.Err()`, `ctx.Deadline()` (value, ok), a snapshot of each stored bar's `Timeframe`, and the captured ctx; then optionally `entered <- struct{}{}` and `<-release` (block gates), then returns `err`.
2. `TestFetchAndCacheBars_AC6_DepartedClientBarsStillPersisted`: `ctx, cancel := context.WithCancel(context.Background())`; source cancels in `GetBars`; store ok. Call `svc.fetchAndCacheBars(ctx, "AAPL", "1d", start, end, 500, true)` and assert: store called exactly once; its `ctx.Err() == nil` at call time; `hasDeadline && deadline <= callTime.Add(barsCacheWriteGrace)`; stored `Timeframe == "1d"` for every bar; `installWarnRecorder(t).count("GetBars: cache insert failed") == 0` and no `"re-read after cache failed"`; returned bars have length 2 and next token `""`. (No `s.repo` → a re-read would panic.)
3. `TestFetchAndCacheBars_AC6_ClientLeavesMidWriteStillPersists`: live ctx; store with `entered`/`release` gates; run `fetchAndCacheBars` in a goroutine; after `<-entered` call `cancel()`; assert the store's captured ctx is **not** done after a short wait (e.g. `select { case <-wctx.Done(): t.Fatal; case <-time.After(50 * time.Millisecond): }`); then `close(release)`; assert the call returns the live page, 0 WARN, and no re-read panic (client gone after write).
4. `TestFetchAndCacheBars_AC7_LiveClientWriteHasNoDeadline`: live `context.Background()`-derived ctx; the store returns `errors.New("stop")` so the call returns at the write error and never reaches the concrete re-read; assert recorded `hasDeadline == false` and `ctx.Err() == nil`. (Equivalent to today's behavior for a live client: no new truncation trigger.)
5. `TestFetchAndCacheBars_AC8_GenuineInsertFailureStillWarns` (characterization), table of two subtests: (i) live ctx + failing store → `count("GetBars: cache insert failed") == 1` at WARN, returned slice is the live page (`len == len(src.bars)`), token `""`; (ii) departed ctx (already canceled) + failing store → the WARN **also** fires (Spec-time decision 3) and the live page is returned.
6. `TestFetchAndCacheBars_AC9_OnlyOneDepartedWriteAtATime`: one `svc`, one blocking store; call 1 with an already-canceled ctx in a goroutine, wait `<-entered`; call 2 with another already-canceled ctx runs synchronously (guard with a goroutine + `time.After(2 * time.Second)` so a bug fails instead of hanging) and must return the live page; assert store call count is still 1 while call 1 is blocked, 0 WARN; then `close(release)` and join call 1; assert call 1 persisted (count == 1 total) and a third departed call after release **does** write (slot freed → count == 2).
7. Red-first note: on the pre-Step-3 tree these tests fail at `s.repo.InsertBars` (nil receiver panic, `:370`); the `/sdd-execute` red capture records that, and the green run shows all five passing. Cite the `@AC-*` ID in each assertion message.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestFetchAndCacheBars' -v
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
grep -rn "type recordingBarsStore\|type barsCancelSource" --include="*_test.go" services/xstockstrat-marketdata   # C-13: one declaration site each
```
New logic is in `internal/service`, an excluded package — no coverage threshold applies to it. All existing marketdata suites (`BatchGetBars`, `GetLatestQuotes` singleflight/detached-closure tests, `TestBatchGetBars_PartialWaiterSurvivesLeaderCancel`) must still pass, proving the `@AC-3 @feature-229` guard is intact.

---

### Step 5 — docs: reconcile the context files that describe the changed behavior

**Status**: `pending`
**Service**: `docs` (service `CLAUDE.md` / constitution files)
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (the `GetBars` bullet)
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify (MARKETDATA-3 prose and its `fetchAndCacheBars` anchor)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (the `account.positions.synced` row)
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify (PORTFOLIO-3 consumer-helper note only if its text states broker syncs never return an error; otherwise leave)

**Reviewers**: none

**Codebase Evidence**:
- Marketdata `CLAUDE.md` `GetBars` bullet ("... Two first-page live-fallbacks (both routed through `fetchAndCacheBars` → live fetch → cache → re-read) ... A live-fetch/credential/feed failure is logged and yields an empty (but valid) response rather than an error.") — confirmed present in `services/xstockstrat-marketdata/CLAUDE.md` § Alpaca Integration.
- MARKETDATA-3 row: "**Cache-miss idiom is live-fallback → persist → re-read, and failures log + return empty, never error.**" with anchor `#fetchAndCacheBars (~L334)` — stale line anchor (function is at `:356`) — `services/xstockstrat-marketdata/docs/context-constitution.md:19`.
- Portfolio `CLAUDE.md` `account.positions.synced` row: "**Retry/park (feature 256):** a write failure returns through `boundedRetry` (cursor withheld, redelivered) ..." — the place to state the cancel-stop.
- Teardown rule (root `CLAUDE.md` § Teardown): a session that changes context files or behavior they describe runs `/context-forge:context-constitution refresh` scoped to what it touched as the last step before pushing; if the plugin is unavailable, re-read each touched file against current code, reconcile the drift, and record in the PR body **both** that the plugin was unavailable **and** the manual reconciliation.

**TDD**: `N/A (docs-only step; no code-bearing change)`

**Covers**: —

**Instructions**:
1. Marketdata `CLAUDE.md` `GetBars` bullet: add one sentence — the live-fallback cache write is detached from the request (`context.WithoutCancel`) so fetched bars persist even if the client cancels; it is unbounded while the client is live and bounded by the fixed invariant `barsCacheWriteGrace` (5 s, not a config key) only after the client leaves, with at most one departed-client write at a time (others skipped silently); the re-reads are skipped when the client is gone; failures still log and return the live page, never an error.
2. MARKETDATA-3 prose: append the detached-write / post-departure-grace / one-writer-slot clause and the fixed-invariant status (resource protection only; decides neither content nor data age); refresh the `fetchAndCacheBars` anchor to the current line (`~L356`).
3. Portfolio `CLAUDE.md` `account.positions.synced` row: add that once the consumer ctx is done `processPositionSync` returns `ctx.Err()` before the next write (any sync, broker included), logging only a Debug line; `boundedRetry` classes it transient so it never parks and the cursor is withheld — irrelevant at shutdown because `lastSeq` is in memory and history replays from 0 at boot.
4. Check portfolio `docs/context-constitution.md` PORTFOLIO-3 / PORTFOLIO-10 / PORTFOLIO-14 text for any statement that a broker sync always returns nil; edit only if such a statement exists (the line anchors `processPositionSync (~L1121)` there are already stale — refresh the one(s) you touch).
5. Do not create new docs, and do not edit `docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md` (already filed). Do not restate facts the code already shows (root `CLAUDE.md` litmus test).
6. Teardown: as the last step before pushing, run `/context-forge:context-constitution refresh` scoped to the four files above. If the plugin is unavailable, re-read each touched file against the final Step 1 / Step 3 code and put **both** "plugin unavailable" and the manual reconciliation performed into the PR body.

**Verification**:
```bash
grep -n "barsCacheWriteGrace\|WithoutCancel" services/xstockstrat-marketdata/CLAUDE.md services/xstockstrat-marketdata/docs/context-constitution.md
grep -n "ctx.Err()\|context is done\|context done" services/xstockstrat-portfolio/CLAUDE.md
grep -n "fetchAndCacheBars" services/xstockstrat-marketdata/docs/context-constitution.md   # anchor now ~L356
```
Each grep must hit the new text; the cited symbols (`barsCacheWriteGrace`, `fetchAndCacheBars`, `processPositionSync`) must exist in the code from Steps 1 and 3.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
