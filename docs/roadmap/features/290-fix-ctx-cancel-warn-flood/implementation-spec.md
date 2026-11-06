# Implementation Spec: fix-ctx-cancel-warn-flood

**Status**: `complete`
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
| `@AC-1` canceled ctx stops the position-sync loop after the first upsert | FR-1 regression | Step 2 |
| `@AC-2` a write that discovers the cancellation stops without a WARN | FR-1 regression | Step 2 |
| `@AC-3` canceled offline sync through `boundedRetry` is never parked | FR-1 regression | Step 2 |
| `@AC-4` genuine write failure with a live ctx still warns | FR-1 characterization | Step 2 |
| `@AC-5` empty-broker-snapshot skip path unchanged by a done ctx | FR-1 characterization | Step 2 |
| `@AC-6` fetched bars persisted after the client cancels, no WARN | FR-2 regression | Step 4 |
| `@AC-7` live client's cache write gets no new deadline | FR-2 characterization | Step 4 |
| `@AC-8` genuine cache-insert failure with a live client still warns, live page returned | FR-2 characterization | Step 4 |
| `@AC-9` only one departed-client cache write at a time | FR-2 regression | Step 4 |
| `@AC-10` a canceled broker sync with positions stops without writing and returns the cancellation | FR-1 regression | Step 2 |
| `@AC-11` a genuine cache-insert failure after the client left still warns, live page returned | FR-2 characterization | Step 4 |
| `@AC-12` a client leaving mid-write does not cancel the persist | FR-2 regression | Step 4 |

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
  the `barsStore` field comment (`:109`) and `fetchAndCacheBars`; the two land as an ordinary textual rebase. Soft, rebase-only rows now exist in `merge-order.md` (291 ↔ 290, 290 ↔ 294):
  merge 290 before 291 and 294 — 291's `barsStore.InsertBars` verification presupposes 290's swap, and 294's position_sync
  outcome expectations must reflect Step 1's cancel return (a shutdown-time sync now records an `error` outcome, not `ok`).
  Whichever of 290/291 merges second re-reads the `:109` comment so it states both consumers.
- `docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md` is the named follow-up for every site left out of scope.
- Promotion of `acceptance.feature` into the durable suites
  (`services/xstockstrat-portfolio/acceptance/`, `services/xstockstrat-marketdata/acceptance/`, **C-16**) happens in the
  `/sdd-execute` integration PR, not in a step here.

---

### Step 1 — service: stop `processPositionSync` once its context is done

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `grep -n "func (s \*PortfolioService) processPositionSync" services/xstockstrat-portfolio/internal/service/portfolio_service.go` → `:1387`; doc comment `:1385-1386` ("returns an error only for an offline sync (RealizedPnl != nil): every offline write is attempted and the failures joined. A broker sync stays warn-and-continue.").
- Per-symbol loop `:1415` (`for _, p := range sync.Positions`); upsert `s.repo.UpsertPositionFromSync(...)` at `:1426`, then its error branch `slog.WarnContext(ctx, "upsert position from sync failed", ...)` `:1427` and `failures = append(...)` `:1428`; `presentSymbols = append(presentSymbols, p.Symbol)` `:1430`.
- Delete branch `if shouldReconcileSyncDeletions(len(sync.Positions), sync.RealizedPnl) {` `:1432`, `DeletePositionsNotInSync` `:1433`, its WARN `:1434`; feature-206 `else { slog.DebugContext(ctx, "skipping delete on empty broker position snapshot", ...) }` `:1437-1439` (gets **no** check — unchanged by construction).
- Realized branch `if sync.RealizedPnl != nil {` `:1443`, `UpsertOfflineRealized` `:1444`, WARN `:1445`; `if sync.RealizedPnl == nil { return nil }; return errors.Join(failures...)` `:1449-1452`. Whole call holds `positionsMu` (`:1405-1406`, `defer Unlock`).
- Existing ctx idiom to reuse (no shared helper exists): `consumeEventStream` `if ctx.Err() != nil { return }` at `:197`; classification `classifyConsumerErr` treats `errors.Is(err, context.Canceled|DeadlineExceeded)` as `retryTransient` (`:1285`) so `boundedRetry` (`:1303-1336`) returns the error without parking; `streamEventsFrom` returns on handler error with `lastSeq` not advanced (`:232-233`).
- Local closure only: portfolio and marketdata are separate Go modules (`go.mod` per service), so no cross-module helper (design Rejected Alternatives).
- Anchors re-derived 2026-11-05 (re-spec): every line from `classifyConsumerErr` down moved +6 since `/sdd-spec`; `:192`/`:197`/`:232-233` unchanged. Re-derive with the `grep` above before editing if the file has moved again.
- Lint: `sloglint` with `context: scope` (`services/xstockstrat-portfolio/.golangci.yml:14`) — log calls must use the `*Context` variants with `ctx`.

**TDD**: `red-green required`

**Covers**: — (behavior verified by Step 2)

**Instructions**:
1. Inside `processPositionSync`, directly after `presentSymbols := make(...)` (before the loop at `:1415`), add one local closure:
   `stop := func(sym string) error { slog.DebugContext(ctx, "position sync stopped: context done", "account_id", sync.AccountID, "symbol", sym); return ctx.Err() }`
   (`sym` is `""` at the delete/realized sites). Debug, not Info/Warn.
2. Check sites — each is `if ctx.Err() != nil { return stop(<sym>) }`, **return, never `break`** (a break would run the delete on a truncated `presentSymbols`):
   - (a) first statement of the per-symbol loop body (`:1415`), before building `val`/calling `UpsertPositionFromSync`;
   - (b) at the top of the upsert error branch (`:1426-1427`), **before** the `slog.WarnContext` — a write that itself discovered the cancellation stops silently;
   - (c) **inside** the `shouldReconcileSyncDeletions` true branch (`:1432`), immediately before `DeletePositionsNotInSync` (`:1433`), and at the top of its error branch before the WARN (`:1434`);
   - (d) **inside** `if sync.RealizedPnl != nil` (`:1443`), immediately before `UpsertOfflineRealized` (`:1444`), and at the top of its error branch before the WARN (`:1445`).
3. Do **not** add any check to the feature-206 `else` skip branch (`:1437-1439`), and do not use `errors.Is(err, context.Canceled)` as the stop test: the decision keys on the caller's `ctx.Err()` so a ctx-alive driver-reported cancel still WARNs (`@AC-4`).
4. Rewrite the doc comment at `:1385-1386` to: `// Returns ctx.Err() as soon as ctx is done (before the next write, any sync); otherwise an offline sync attempts every write and joins the failures, and a broker sync stays warn-and-continue.` (2 lines, constraint-only per root `CLAUDE.md` § How to Act #5.)
5. Do not touch `boundedRetry`, `classifyConsumerErr`, `consumeEventStream`, `processAccountDeregistered` or any other consumer (follow-up report). Broker sync (`RealizedPnl == nil`) now returns the cancel error instead of nil when ctx is done — intended: it stops the shutdown drain; the cursor is irrelevant because `lastSeq` is in memory (`:192`) and full history replays from 0 at boot.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/ && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "position sync stopped: context done\|ctx.Err() != nil" internal/service/portfolio_service.go   # confirms sites (a)-(d) + the :197 original
```
Confirm the `else` branch for the feature-206 skip contains no `ctx.Err()` reference and no `break` was introduced inside the loop.

---

### Step 2 — test: portfolio cancel behavior (RED first)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_sync_cancel_test.go` — create

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Harness to reuse, all in package `service` (confirmed by grep): `syncRecorderDB` (records every `Exec`; `QueryRow`/`Query` find no rows; `find(substr)`) and `recordedExec` at `portfolio_offline_test.go:220-245`, injected via `repository.NewPortfolioRepoWithDB(db)` (`internal/repository/portfolio_repo.go:49`; `queryRower` = `QueryRow`/`Query`/`Exec`, `:22-26`); service literal pattern `&PortfolioService{repo: repository.NewPortfolioRepoWithDB(db), ledger: &fakeLedger{}, cfg: &config.Watcher{}}` at `portfolio_offline_test.go:256` (`runOfflineSync`); `fakeLedger` `watchlist_service_test.go:267`.
- `syncEvent(t, seq, payload)` and `offlineSyncPayload(positions)` (`portfolio_sync_retry_test.go:21,30`); `warnRecorder` / `recordWarns(t)` / `.find(msg)` (`portfolio_quote_deadline_test.go:32-69`; records only WARN and above in `.recs`; process-global `slog.SetDefault` — **no `t.Parallel()`**); `parkedCount(rec)` counts `"event parked"` (`portfolio_sync_retry_test.go:47`, note it reads the same recorder, and `"event parked"` is an Error so it is recorded); `newFillSvc(t)` (pgxmock-backed, `portfolio_fill_errors_test.go:56`); `errDBBlip` (`:22`); `anyArgs(n)` (`:36`). **No** existing test feeds `context.Canceled` through pgxmock (the only `context.Canceled` in the service tests is the `classifyConsumerErr` table row at `portfolio_sync_retry_test.go:263`), so `AC-4`'s `WillReturnError(context.Canceled)` is new usage of the standard pgxmock API, not a copied precedent. `UpsertPositionFromSync`'s INSERT binds 15 args and the 1-symbol `DELETE` binds 3 (`anyArgs(15)` / `anyArgs(3)`).
- `boundedRetry(consumer, h)` returns an `eventHandler`; `s.clock()` is nil-safe (`offline_valuation.go:72`, `now` nil means `time.Now`).
- C-13: `cancelingDB` has exactly **one** consumer (this file) → inline, compliant; it embeds `syncRecorderDB` rather than copying it (DRY). No `internal/testdata/` addition.
- Trading-domain: no order/fill/broker-dispatch logic is exercised — "fill handling unaffected by this step".

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-10` — `AC-1`, `AC-2`, `AC-3`, `AC-10` are the RED regression assertions; `AC-4` and `AC-5` are **characterization guards** (they pass before and after; labelled as such in the test names/comments, per the design).

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
3. `AC-1` (RED): `ctx, cancel := context.WithCancel(...)`; `db := &cancelingDB{cancel: cancel, cancelAtExec: 1}` (first upsert succeeds, then cancels). Call `processPositionSync(ctx, syncEvent(...))`. Assert `len(db.execs) == 1` (no second upsert, no delete, no realized), `errors.Is(err, context.Canceled)`, `len(rec.recs) == 0` (no WARN at all — read under `rec.mu`, as AC-2 does).
4. `AC-2` (RED): same but `failOnCancel: true`. Assert `len(db.execs) == 1`, `db.find("DELETE FROM portfolio.positions") == nil`, `len(rec.recs) == 0` (no WARN at all — read under `rec.mu`), `errors.Is(err, context.Canceled)`.
5. `AC-3` (RED): `ctx` already canceled; `db := &syncRecorderDB{}`; `handle := svc.boundedRetry("position sync", svc.processPositionSync)`; build `ev := syncEvent(t, 1, offlineSyncPayload([]interface{}{<one position map>}))` and call `handle(ctx, ev)`. Assert `err != nil` (and `errors.Is(err, context.Canceled)`), `db.find("offline_account_realized") == nil`, `len(db.execs) == 0`, `parkedCount(rec) == 0`.
6. `AC-4` (characterization): live ctx; use `pgxmock` via `newFillSvc(t)`: `mock.ExpectExec("INSERT INTO portfolio.positions").WithArgs(anyArgs(15)...).WillReturnError(context.Canceled)` for a **broker** payload (no `realized_pnl`, one position, `"account_id":"brk-1"`) and `mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs(anyArgs(3)...).WillReturnResult(pgxmock.NewResult("DELETE", 0))`. Assert `rec.find("upsert position from sync failed") != nil` with `["symbol"] == "AAPL"` (the recorder stores attrs as strings) and `processPositionSync` returns nil (broker stays warn-and-continue) — the negative control that pins "key on ctx state, not error text".
7. `AC-5` (characterization): broker payload with `"positions": []interface{}{}` and no `realized_pnl`, ctx already canceled, `db := &syncRecorderDB{}`. Assert `len(db.execs) == 0` and `err == nil` (the feature-206 skip path returns before any check).
8. `AC-10` (RED, review warning: the headline broker change had no asserting test): **broker** payload (no `realized_pnl`) for `"account_id":"brk-1"` with ONE position `AAPL` qty 10, `ctx` already canceled, `db := &syncRecorderDB{}`. Assert `errors.Is(err, context.Canceled)`, `len(db.execs) == 0`, `len(rec.recs) == 0` (no WARN). Contrast with `AC-5` (empty broker snapshot, still `err == nil`). On the pre-Step-1 tree this fails because the broker branch attempts the write and returns nil (`:1449-1451`); the assertions fail on `errors.Is(err, context.Canceled)` and `len(db.execs) == 0`. Name: `TestProcessPositionSync_AC10_CanceledBrokerSyncReturnsCancellation`.
9. Red-first note for `/sdd-execute`: on the pre-Step-1 tree `AC-1`/`AC-2`/`AC-3`/`AC-10` fail by assertion (the loop keeps writing and WARNing; the broker sync returns nil); `AC-4`/`AC-5` pass. Cite the `@AC-*` ID in each RED assertion message.

**Verification**:
```bash
( cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestProcessPositionSync' -v )
( cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod )
( cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40% )
grep -rn "type cancelingDB" --include="*_test.go" services/xstockstrat-portfolio   # C-13: exactly one declaration site
```
New logic is in `internal/service`, an excluded package — no coverage threshold applies to it; the behavioral tests above are the verification. Existing `TestProcessPositionSync_*`, `TestShouldReconcileSyncDeletions` and the `boundedRetry` suites must still pass.

---

### Step 3 — service: persist `GetBars` live-fallback bars after the client leaves

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Source-agnostic: operates on the registry-resolved `DataSourceClient` bars; no BrokerType/IBKR logic, no order/fill/`TRADING_MODE` path touched; broker/order/fill handling unaffected by this step.
- Confirmed via: `grep -n "func (s \*MarketDataService) fetchAndCacheBars" services/xstockstrat-marketdata/internal/service/marketdata_service.go` → `:356`; stale doc `:354-355` ("On any failure it logs and returns no bars (GetBars → empty response)" — already false on insert failure).
- Today's write: `if err := s.repo.InsertBars(ctx, live); err != nil { slog.WarnContext(ctx, "GetBars: cache insert failed", "symbol", symbol, "error", err); return truncateBars(live, pageSize, recent), "" }` at `:370-373`; re-reads `s.repo.QueryRecentBars(ctx, ...)` `:375` and `s.repo.QueryBars(ctx, ...)` `:382`, WARN `"GetBars: re-read after cache failed"` at `:377` and `:384`, each returning `truncateBars(live, pageSize, recent), ""`.
- Existing seam to reuse (no new interface): `barsBatchStore` declares `QueryBarsBatch` and `InsertBars(ctx, bars []*marketdatav1.Bar) error` at `:126-130`; the field `barsStore barsBatchStore` at `:109-110` (comment: "BatchGetBars' bar cache read/write seam; nil (test literals) treats every symbol as cold"); wired in the constructor `svc.barsStore = repo` at `:239` under `if repo != nil`. `*repository.MarketDataRepo.InsertBars` (`marketdata_repo.go:51`) opens `r.pool.Begin(ctx)` ("begin tx" — the error in the Loki flood), loops `tx.Exec` per bar, then `tx.Commit(ctx)`; upsert `ON CONFLICT (symbol, timeframe, time) DO UPDATE` → idempotent, rollback on ctx death (`defer tx.Rollback`).
- Existing detach idiom: `context.WithTimeout(context.WithoutCancel(ctx), …)` at `:606`, `:851`, `:884`; existing fixed invariant constant `const barsPartialMargin = 250 * time.Millisecond` at `:838`. Imports: `"sync"` present (`:11`), **`"sync/atomic"` absent** — add it. Struct has `staleMu`/`lastStaleCheck` at `:53-56` (field-group style).
- **Must stay synchronous**: `truncateBars` → `omitDeprecatedTimeframe` (`:404-408`, clears `b.Timeframe` in place) shares the `live` bars with `InsertBars`; a fire-and-forget write would race it and could persist an empty `timeframe` (`@AC-8 @feature-196`, MARKETDATA-1).
- Remaining `s.repo.InsertBars` sites outside `fetchAndCacheBars` (re-verified 2026-11-05): the ingester `ingestRecentBarsForTimeframe` (`:1289`) at `:1304`/`:1325`, and `BackfillBars` (`:1368`) at `:1426`. `GetLatestQuote` starts at `:544` (its `s.cacheQuote` call is `:563`); the warm poller's `s.cacheQuote` calls are `:1151`/`:1172`.
- Callers: single call site `GetBars` → `s.fetchAndCacheBars(...)` at `:326`; the detached singleflight closures (`:604-632`, `:774-860`) are **not** touched (`@AC-3 @feature-229`).
- Downstream hazard the design guards against: a live caller's write must not gain a deadline — a truncated full page with an empty next-page token reads as end-of-data in analysis (`services/xstockstrat-analysis/app/handlers/servicer.py:1482-1484`, `@feature-272`).
- Config: **none** (F-07 note — `grace` is a fixed resource-protection invariant, operator-approved in `context.md` 2026-11-04 round-2; it decides neither what the caller receives nor how old data can be; fallback if the operator wants it tunable is one key `marketdata.bars.cache_write_timeout_ms` with config-team approval). Same fixed-invariant precedent as `barsPartialMargin` (`:838`), `etfFlagTTL`, `etfFlagQueueCap` (marketdata `CLAUDE.md` § Fundamentals Integration).
- Measurement for `grace`: see § "Spec-time decisions" item 4 (Tempo, 24 h, slowest whole-request `GetBars` = 2.70 s; no `InsertBars` span exists).

**TDD**: `red-green required`

**Covers**: — (behavior verified by Step 4)

**Instructions**:
1. Add `"sync/atomic"` to the import block. Next to `barsPartialMargin` (`:838`) — or directly above `fetchAndCacheBars` — add `const barsCacheWriteGrace = 5 * time.Second` with a ≤2-line constraint comment: grace applies only after the client has left; never lengthen it without re-checking pooled-connection hold time.
2. Add one field next to `lastStaleCheck` (struct group `:53-56`, `staleMu`/`lastStaleCheck`): `departedBarsWrite atomic.Bool` with a ≤2-line comment: at most one departed-client cache write runs at a time; zero value usable by test literals.
3. Update the `barsStore` field comment (`:109`) so it names both consumers: `BatchGetBars` and `fetchAndCacheBars` (the latter requires it non-nil — no nil-guard; a nil store must panic, never silently drop bars; same stance as feature 291's ingester).
4. Add an unexported helper on `*MarketDataService`:
   `func (s *MarketDataService) cacheLiveBars(ctx context.Context, live []*marketdatav1.Bar) (skipped bool, err error)` that writes via `s.barsStore.InsertBars`:
   - **Departed at start** (`ctx.Err() != nil`): `if !s.departedBarsWrite.CompareAndSwap(false, true) { return true, nil }`; `defer s.departedBarsWrite.Store(false)`; `wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), barsCacheWriteGrace)`; `defer cancel()`; return `false, s.barsStore.InsertBars(wctx, live)`.
   - **Live at start**: `wctx, cancel := context.WithCancel(context.WithoutCancel(ctx))`; `defer cancel()`; `stop := context.AfterFunc(ctx, func() { time.AfterFunc(barsCacheWriteGrace, cancel) })`; `defer stop()`; return `false, s.barsStore.InsertBars(wctx, live)`. No deadline is ever attached while the client is live (`@AC-7`); only a client that leaves mid-write bounds the write at `barsCacheWriteGrace`.
5. In `fetchAndCacheBars`, replace `:370-373` with:
   ```go
   skipped, err := s.cacheLiveBars(ctx, live)
   if skipped {
       return truncateBars(live, pageSize, recent), ""   // departed client, slot busy: silent — bars not cached, as for any failed cache write today
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
7. Do not change `BackfillBars` (`:1368`, insert `:1426`), the ingester inserts (`:1304`/`:1325` in `ingestRecentBarsForTimeframe`, belong to feature 291), `GetLatestQuote` (`:544`, `cacheQuote` at `:563`), the warm poller (`cacheQuote` at `:1151`/`:1172`), or any singleflight closure.
8. At execute time append the `grace` evidence in "Spec-time decisions" item 4 to this feature's `context.md` (closes the Open Thread "Size `grace` from a measured `InsertBars` p99") and **BLOCKING before the PR**: obtain a direct staging `InsertBars` timing for a ~1000-bar slice, confirm `barsCacheWriteGrace` (5 s) against it, and record the result in `context.md` (closes the Open Risk "grace value must be sized from measured `InsertBars` p99" in `design.md`). If the measurement exceeds ~2.5 s, stop and re-size before opening the PR. The timing needs staging DB / observability access that spec validation did not exercise; if the executor cannot obtain it, halt at the PR gate and ask the operator rather than skipping it.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/ && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "barsCacheWriteGrace\|departedBarsWrite\|cacheLiveBars\|s.repo.InsertBars(ctx, live)" internal/service/marketdata_service.go
```
The staging `InsertBars` timing from Instruction 8 must be recorded in `context.md` before this step is marked done (blocking pre-PR gate).
Confirm `s.repo.InsertBars(ctx, live)` no longer appears inside `fetchAndCacheBars`, the only remaining `s.repo.InsertBars` call sites are `BackfillBars` and the ingester, and no `go func` was introduced around the write.

---

### Step 4 — test: marketdata cache-write detachment (RED first)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (append the two fakes and the tests at the true end of the file, `~:4481` today, after the `GetFundamentals` tests; `partialSvc` `:4090` / `batchReq` `:4097` are no longer at EOF)

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Source-agnostic: operates on the registry-resolved `DataSourceClient` bars; no BrokerType/IBKR logic, no order/fill/`TRADING_MODE` path touched; broker/order/fill handling unaffected by this step.
- **No existing test reaches `fetchAndCacheBars`** (`grep -n "fetchAndCacheBars" internal/service/*_test.go` → none). The obvious candidates would pass vacuously: `fakeMultiSource.GetBars` returns `nil, nil` (`marketdata_service_test.go:1345`), `fakeBackfillSource.GetBars` returns `nil, nil` (`:904-907`), and `fakeBarsStore.InsertBars` is a stateless no-op (`:4074`). Hence two new inline fakes (design § RED tests).
- Reuse: `fakeBackfillSource`'s four unused `DataSourceClient` methods via embedding (`type scriptedBarsSource struct{ *fakeBatchBarsSource ... }` at `:4077` is the embedding precedent); `source.NewRegistry()` (`internal/source/source.go:162`) + `reg.Register("alpaca", src)` (`:167`) and `Registry.Get("")` → `"alpaca"` (`:175`; usage in `partialSvc` `:4090`); `installWarnRecorder(t)` (`:1916`) returning `*recordingLogHandler` with `.find(msg)` (`:1883`) / `.count(msg)` (`:1895`) — process-global `slog.SetDefault`, **no `t.Parallel()`**; `context`, `errors`, `sync`, `sync/atomic`, `time` and `timestamppb` already imported (`:5-22`).
- `s.repo` stays nil in these literals (`&MarketDataService{registry: reg, barsStore: store}`): a code path that still reaches `s.repo.QueryRecentBars/QueryBars` or the old `s.repo.InsertBars` **panics** — that panic is the guard that "no re-read is made" (`@AC-6`) and the reason `@AC-6`/`@AC-9` go RED on today's tree by nil-`s.repo` panic at `:370` rather than a failed assertion (record this in the Deviation Log if the executor observes it).
- Stored-bar timeframe is mutated after the write (`omitDeprecatedTimeframe`, `:404-408`), so the fake must snapshot `Timeframe` **at call time**.
- C-13: both fakes have a single consumer (this file's new tests) → inline, compliant; marketdata's only `internal/testdata/` file is `marks.go` and no home is created.
- No test seam exists for the re-read (`s.repo` is the concrete `*MarketDataRepo`, `:38`); a client leaving during the single indexed re-read can still produce one WARN — accepted residual, not tested (C-18).

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7, AC-8, AC-9, AC-11, AC-12` — `AC-6`, `AC-9`, `AC-12` regression; `AC-7` and `AC-8` guard behaviour that must not change but are NOT green on the pre-Step-3 tree — they reach the nil `s.repo.InsertBars` and panic like AC-6 (`AC-7`: a live no-deadline client's write gets no new deadline, guarding against a naive `WithTimeout`; `AC-8`: a live-ctx failing write still WARNs and returns the live page); `AC-11` likewise a post-change guard (the Spec-time-decision-3 subcase: a departed client plus a failing detached write still WARNs); `AC-9` one-writer slot (it caps writers that START after the client left — a client that leaves mid-write is covered by `AC-12`, not slotted; an accepted residual, see Open Risks in `design.md`).

**Instructions**:
1. Append two inline fakes:
   - `barsCancelSource` — `struct { *fakeBackfillSource; newBars func() []*marketdatav1.Bar; cancel context.CancelFunc }` (`newBars` builds fresh `*Bar` values — two AAPL `1d` bars — and a fresh slice on every call); `GetBars(...)` calls `f.cancel()` when non-nil (client leaves **after** the live fetch begins and before the write), then returns `f.newBars()`. Test bars (built inside `newBars`): two `*marketdatav1.Bar{Symbol: "AAPL", Timeframe: "1d", Time: timestamppb.New(...)}` (the Alpaca client writes the canonical string back before `InsertBars`, MARKETDATA-1).
   - `recordingBarsStore` — implements `barsBatchStore` (`QueryBarsBatch` returns `nil, nil`); `InsertBars(ctx, bars)` records, under a mutex: call count, `ctx.Err()`, `ctx.Deadline()` (value, ok), a snapshot of each stored bar's `Timeframe`, **`entryTime := time.Now()` taken at entry of `InsertBars`**, and the captured ctx; then optionally `entered <- struct{}{}` and `<-release` (block gates), then returns `err`. **`entered` must be buffered (cap ≥ 3) or sent non-blockingly**: in `AC-9` the third call runs after `close(release)` with nobody receiving, and an unbuffered unconditional send would hang the test.
   - Lint: `Bar.Timeframe` is deprecated and staticcheck is on (`.golangci.yml:7`). Every `Timeframe:` composite-literal field and every `.Timeframe` read in the new tests, including the fake's call-time snapshot, carries `//nolint:staticcheck // SA1019: source bars carry the deprecated string (feature 196)`, matching the composite-literal precedents `marketdata_service_test.go:3170` and `:3199-3200` (for `.Timeframe` reads, the assertion-read wording at `:3187`/`:3204` applies).
2. `TestFetchAndCacheBars_AC6_DepartedClientBarsStillPersisted`: `ctx, cancel := context.WithCancel(context.Background())`; source cancels in `GetBars`; store ok. Call `svc.fetchAndCacheBars(ctx, "AAPL", "1d", start, end, 500, true)` and assert: store called exactly once; its `ctx.Err() == nil` at call time; `hasDeadline && deadline.After(entryTime) && !deadline.After(entryTime.Add(barsCacheWriteGrace))` (`entryTime` = the instant recorded at `InsertBars` entry, never a `time.Now()` taken before the call — `WithTimeout` stamps the deadline inside `fetchAndCacheBars`); stored `Timeframe == "1d"` for every bar; `installWarnRecorder(t).count("GetBars: cache insert failed") == 0` and no `"re-read after cache failed"`; returned bars have length 2 and next token `""`. (No `s.repo` → a re-read would panic.)
3. `TestFetchAndCacheBars_AC12_ClientLeavesMidWriteStillPersists`: live ctx; store with `entered`/`release` gates; run `fetchAndCacheBars` in a goroutine; after `<-entered` call `cancel()`; assert the store's captured ctx is **not** done after a short wait (e.g. `select { case <-wctx.Done(): t.Fatal; case <-time.After(50 * time.Millisecond): }`); then `close(release)`; assert the store was called exactly once, the bars it stored carry `Timeframe == "1d"` (snapshotted at call time), the call returns the live page, 0 WARN, and no re-read panic (client gone after write).
4. `TestFetchAndCacheBars_AC7_LiveClientWriteHasNoDeadline`: live `context.Background()`-derived ctx; the store returns `errors.New("stop")` so the call returns at the write error and never reaches the concrete re-read; assert recorded `hasDeadline == false` and `ctx.Err() == nil`. (Equivalent to today's behavior for a live client: no new truncation trigger.)
5. `TestFetchAndCacheBars_AC8_GenuineInsertFailureStillWarns` (characterization): live ctx + failing store → `count("GetBars: cache insert failed") == 1` at WARN, returned slice is the live page (`len == len(src.bars)`), token `""`, nil error.
5b. `TestFetchAndCacheBars_AC11_DepartedClientFailingWriteStillWarns` (characterization; the Spec-time decision 3 case, previously a subcase of AC-8): ctx already canceled + failing store → the WARN `GetBars: cache insert failed` fires exactly once (the write is detached, so a failure is a genuine DB error or the grace expiring, never the client's cancel) and the live page (2 bars, `AAPL` `1d`) is returned with a nil error.
6. `TestFetchAndCacheBars_AC9_OnlyOneDepartedWriteAtATime`: one `svc`, one blocking store; call 1 with an already-canceled ctx in a goroutine, wait `<-entered`; call 2 with another already-canceled ctx runs synchronously (guard with a goroutine + `time.After(2 * time.Second)` so a bug fails instead of hanging) and must return the live page; assert store call count is still 1 while call 1 is blocked, 0 WARN; then `close(release)` and join call 1; assert call 1 persisted (count == 1 total) and a third departed call after release **does** write (slot freed → count == 2). **`newBars` returns a fresh slice per call, so no slice is shared across the three calls** — `truncateBars` clears `Timeframe` in place on the shared slice, so reusing one slice would make the third call store an empty timeframe (matters only if a timeframe assertion is ever added on that call).
7. Red-first note for `/sdd-execute` (review warning): Instruction 2 references the constant `barsCacheWriteGrace`, which does not exist until Step 3, so on the pre-Step-3 tree the test package **fails to compile** (every test in `internal/service` goes red). That compile failure IS the red capture — record it as such, or declare a stub `const barsCacheWriteGrace = 5 * time.Second` in the test file for the red run and delete it in Step 3. Once the package compiles, `AC-6`/`AC-9`/`AC-12` go red by the nil-`s.repo` panic at `:370` (not a failed assertion); `AC-7`/`AC-8`/`AC-11` also fail on that tree by the same panic (the old code reaches `s.repo.InsertBars`) — they are post-change guards, not pre-change-green. A panic (including one in the AC-9/AC-12 goroutines) aborts the whole test binary, so record the red run per test with `-run '<TestName>$'`. Cite the `@AC-*` ID in each assertion message.

**Verification**:
```bash
( cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestFetchAndCacheBars' -v )
( cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod )
( cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40% )
grep -rn "type recordingBarsStore\|type barsCancelSource" --include="*_test.go" services/xstockstrat-marketdata   # C-13: one declaration site each
```
New logic is in `internal/service`, an excluded package — no coverage threshold applies to it. All existing marketdata suites (`BatchGetBars`, `GetLatestQuotes` singleflight/detached-closure tests, `TestBatchGetBars_PartialWaiterSurvivesLeaderCancel`) must still pass, proving the `@AC-3 @feature-229` guard is intact.

---

### Step 5 — docs: reconcile the context files that describe the changed behavior

**Status**: `done`
**Service**: `docs` (service `CLAUDE.md` / constitution files)
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (the `GetBars` bullet)
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify (MARKETDATA-3 prose and its `fetchAndCacheBars` anchor)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (the `account.positions.synced` row)
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify — PORTFOLIO-3 (`context-constitution.md:22`), unconditional

**Reviewers**: none

**Codebase Evidence**:
- Marketdata `CLAUDE.md` `GetBars` bullet ("... Two first-page live-fallbacks (both routed through `fetchAndCacheBars` → live fetch → cache → re-read) ... A live-fetch/credential/feed failure is logged and yields an empty (but valid) response rather than an error.") — confirmed present in `services/xstockstrat-marketdata/CLAUDE.md` § Alpaca Integration.
- MARKETDATA-3 row: "**Cache-miss idiom is live-fallback → persist → re-read, and failures log + return empty, never error.**" with anchor `#fetchAndCacheBars (~L356)` — `services/xstockstrat-marketdata/docs/context-constitution.md:19` (verified: the file already reads `~L356`; Step 3 inserts a constant, a field and a helper above the function, so the anchor drifts and must be re-derived after Step 3).
- Portfolio `CLAUDE.md` `account.positions.synced` row: "**Retry/park (feature 256):** a write failure returns through `boundedRetry` (cursor withheld, redelivered) ..." — the place to state the cancel-stop.
- PORTFOLIO-10 row (`services/xstockstrat-portfolio/docs/context-constitution.md:29`) also carries stale anchors outside the `processPositionSync` ones: `#shouldReconcileSyncDeletions def ~L1074, doc ~L1067-1073` (function now `portfolio_service.go:1381`, doc comment `:1374-1380`) and `processAccountDeregistered (~L1059)` (now `:1338`) — both above `processPositionSync` (`:1387`), so Step 1's edits leave them unshifted unless Step 1 inserts code above them; re-derive by grep after Step 1 regardless.
- Teardown rule (root `CLAUDE.md` § Teardown): a session that changes context files or behavior they describe runs `/context-forge:context-constitution refresh` scoped to what it touched as the last step before pushing; if the plugin is unavailable, re-read each touched file against current code, reconcile the drift, and record in the PR body **both** that the plugin was unavailable **and** the manual reconciliation.

**TDD**: `N/A (docs-only step; no code-bearing change)`

**Covers**: —

**Instructions**:
1. Marketdata `CLAUDE.md` `GetBars` bullet: add one sentence — the live-fallback cache write is detached from the request (`context.WithoutCancel`) so fetched bars persist even if the client cancels; it is unbounded while the client is live and bounded by the fixed invariant `barsCacheWriteGrace` (5 s, not a config key) only after the client leaves, with at most one departed-client write at a time (others skipped silently); the re-reads are skipped when the client is gone; failures still log and return the live page, never an error.
2. MARKETDATA-3 prose: append the detached-write / post-departure-grace / one-writer-slot clause and the fixed-invariant status (resource protection only; decides neither content nor data age); set the `fetchAndCacheBars` anchor to the post-Step-3 line of the function (`grep -n "func (s \*MarketDataService) fetchAndCacheBars"`).
3. Portfolio `CLAUDE.md` `account.positions.synced` row: add that once the consumer ctx is done `processPositionSync` returns `ctx.Err()` before the next write (any sync, broker included), logging only a Debug line; `boundedRetry` classes it transient so it never parks and the cursor is withheld — irrelevant at shutdown because `lastSeq` is in memory and history replays from 0 at boot.
4. Portfolio `docs/context-constitution.md`: PORTFOLIO-3 (`:22`) says a broker sync "stays warn-and-continue and acks even when its upserts or delete fail (`processPositionSync` returns nil there)" — false after Step 1 once ctx is done. Append "except when ctx is done, where any sync returns ctx.Err() before the next write" to that sentence (unconditional), and refresh the stale line anchors `processPositionSync (~L1078)` at `:28` and `processPositionSync (~L1121)` at `:29` (and the `~L1121` reference inside the `#shouldReconcileSyncDeletions` note) to the post-Step-1 line from `grep -n 'func (s \*PortfolioService) processPositionSync'` (`:1387` before Step 1); In the same PORTFOLIO-10 row (`:29`) also re-stamp `#shouldReconcileSyncDeletions def ~L1074, doc ~L1067-1073` and `processAccountDeregistered (~L1059)` to the post-Step-1 lines from `grep -n 'func shouldReconcileSyncDeletions\|func (s \*PortfolioService) processAccountDeregistered' services/xstockstrat-portfolio/internal/service/portfolio_service.go` (`:1381` with doc `:1374-1380`, and `:1338`, before Step 1) — advisory: optional for this step, otherwise left to the Teardown refresh. `:33` (PORTFOLIO-14) and `:48` (PORTFOLIO-15) mention `processPositionSync` with no line anchor, so leave them unchanged.
5. Do not create new docs, and do not edit `docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md` (already filed). Do not restate facts the code already shows (root `CLAUDE.md` litmus test).
6. Teardown: as the last step before pushing, run `/context-forge:context-constitution refresh` scoped to the four files above. If the plugin is unavailable, re-read each touched file against the final Step 1 / Step 3 code and put **both** "plugin unavailable" and the manual reconciliation performed into the PR body.

**Verification**:
```bash
grep -n "barsCacheWriteGrace" services/xstockstrat-marketdata/CLAUDE.md services/xstockstrat-marketdata/docs/context-constitution.md   # "WithoutCancel" already appears in CLAUDE.md today, so only the new constant name proves the Step 5 edit
grep -n "ctx.Err()\|context is done\|context done" services/xstockstrat-portfolio/CLAUDE.md
grep -n 'func (s \*PortfolioService) processPositionSync\|func shouldReconcileSyncDeletions\|func (s \*PortfolioService) processAccountDeregistered' services/xstockstrat-portfolio/internal/service/portfolio_service.go; grep -n '~L' services/xstockstrat-portfolio/docs/context-constitution.md   # every processPositionSync anchor must equal the function's line; the shouldReconcileSyncDeletions / processAccountDeregistered anchors should too if re-stamped (advisory)
grep -n "func (s \*MarketDataService) fetchAndCacheBars" services/xstockstrat-marketdata/internal/service/marketdata_service.go; grep -n "fetchAndCacheBars" services/xstockstrat-marketdata/docs/context-constitution.md   # the doc anchor must equal the function's line from the first grep
```
Each grep must hit the new text; the cited symbols (`barsCacheWriteGrace`, `fetchAndCacheBars`, `processPositionSync`) must exist in the code from Steps 1 and 3.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 3 — staging `InsertBars` timing gate waived (2026-11-06)
- **Spec said**: Instruction 8 / Verification. Get a direct staging `InsertBars` timing for a ~1000-bar slice before this step is marked done. The gate is BLOCKING before the PR.
- **Actual**: no direct measurement was taken. The executor had no staging DB access, so it raised a blocker. The operator chose **Option C** on 2026-11-06: waive the measurement and accept the Tempo-derived sizing. The slowest whole-request `GetBars` peaked at 2.70 s, and the 5 s grace is 1.85x that.
- **Disposition**: operator waiver, recorded in `context.md` (2026-11-06 decision). `barsCacheWriteGrace` stays at 5 s. The design.md Open Risk and the impl-spec review warning are closed. Tuning from a later measurement is an open thread in `context.md`, not this step's work.

### Step 3 — placement and comment choices (2026-11-06)
- **Spec said**: Instruction 1 puts `barsCacheWriteGrace` next to `barsPartialMargin` *or directly above `fetchAndCacheBars`*. The Instruction 5 sketch has trailing inline comments on the `skipped` and `ctx.Err()` returns.
- **Actual**: the constant and the `cacheLiveBars` helper sit directly above `fetchAndCacheBars`, which is the second option the spec allows. The inline comments from the sketch were left out. Their content is covered by the helper's doc comment (`skipped` meaning) and the rewritten `fetchAndCacheBars` doc comment. This follows root `CLAUDE.md` § How to Act #5 (no mechanism narration).
- **Disposition**: no behaviour change; within the spec's options.

### Step 3 — TDD red run used Step 4's tests (2026-11-06)
- **Spec said**: Step 4 is the paired test step. Its red-first note allows a stub `barsCacheWriteGrace` for the red run.
- **Actual**: Step 4's six tests were drafted per its Instructions and appended temporarily. A temporary stub constant file supplied `barsCacheWriteGrace` for the red run, and was deleted before implementation. All six went red one at a time (`-run '<Test>$'`) with the predicted nil-`s.repo` panic at `marketdata_service.go:370`. After Step 3 all six pass under `-race`. The test file was then restored byte-for-byte and left out of this commit, because it is Step 4's **Files**. Same procedure as Steps 1/2.
- **Disposition**: in line with Step 4 Instruction 7. Nothing from the draft is committed here; Step 4 writes and commits its tests itself.

### Out of scope (operator-ordered) — `scripts/measure-insertbars-cost.py` (2026-11-06)
- **Spec said**: no step creates a script. Step 3's **Files** is `marketdata_service.go` only.
- **Actual**: the operator ordered this as the follow-up tool for the Option C waiver, and it landed as its own commit (`9a9a11cf`). It is a read-only maintenance script with uv inline-script metadata, run via `uv run scripts/measure-insertbars-cost.py`, following the `scripts/manage-users.py` pattern.
  - It reads `DATABASE_URL` from the environment, opens a read-only session, and checks that `pg_stat_statements` is installed.
  - It selects the `INSERT INTO marketdata.ohlcv (...)` statement(s). That upsert runs once per bar inside `InsertBars`, and the ingester and `BackfillBars` use it too.
  - It reports calls, rows/call, mean/max/stddev exec time, and `mean x --slice-bars` (default 1000) as a ratio of `--grace-seconds` (default 5). That figure is a lower bound: it leaves out per-statement round trips, BEGIN/COMMIT and pool wait.
  - It never writes.
  - Checked offline only: `ruff check` and `ruff format` are clean; unset `DATABASE_URL` exits 1; an unreachable DSN fails cleanly. No database was started.
- **Disposition**: operator-ordered out-of-scope change (P-03, announced here and in the checkpoint report). `barsCacheWriteGrace` is unchanged. Tuning from the script's output is an open thread in `context.md`, for a future feature or PR.

### Step 4 — red run, assertion shape and test helpers (2026-11-06)
- **Spec said**: Instruction 7 records the red run on the pre-Step-3 tree, either as the compile failure or with a stub `barsCacheWriteGrace`. Instruction 5 asks AC-8 for a "nil error". Instruction 1 lists the test bars as `{Symbol, Timeframe, Time}`. The Verification coverage command writes `coverage.out` into the service directory.
- **Actual**:
  - Step 3 had already landed, so the red run swapped in the pre-Step-3 `marketdata_service.go` (`git show c0ceb051~1:…`) and a temporary stub constant file. All six tests panicked with a nil pointer dereference at `marketdata_service.go:370`, the old `s.repo.InsertBars`. AC-9 and AC-12 panic inside their goroutine, so the binary aborts with no `--- FAIL` line. The service file was then restored from `HEAD` and the stub deleted.
  - `fetchAndCacheBars` returns `(bars, token)` and has no error result, so AC-8 and AC-11 assert the live page and the `""` token; "nil error" holds by signature.
  - The test bars also carry `TimeframeEnum: TIMEFRAME_1DAY`. `truncateBars` clears the deprecated string on the returned page, so the returned-page check reads the enum. The stored-bar check reads the string, snapshotted at `InsertBars` entry.
  - File-local helpers (single consumer, C-13 compliant): `insertBarsCall`, `aaplDailyBars`, `cacheBarsSvc`, `cachedBarsResult`, `fetchAAPLDaily`, `goFetchAAPLDaily`, `awaitWithin`, `assertLiveAAPLPage`, `assertStoredDaily`.
  - The coverage profile was written to the session scratchpad, not the service directory, so no untracked `coverage.out` is left in the tree. The command is otherwise the same.
- **Disposition**: within Instruction 7's options; no behaviour or scope change.

### Step 5 — Teardown done by hand; anchor re-stamps beyond Instruction 4 (2026-11-06)
- **Spec said**: Instruction 6 runs `/context-forge:context-constitution refresh` on the four files. Instructions 2 and 4 re-stamp only the `fetchAndCacheBars`, `processPositionSync`, `shouldReconcileSyncDeletions` and `processAccountDeregistered` anchors.
- **Actual**:
  - The `context-forge:context-constitution` skill is not available in this session; only `context-forge:context-scrubber` is. The fallback in Instruction 6 was used instead: each touched file was re-read against the final Step 1 / Step 3 code, and every symbol the edited rows cite was confirmed by grep.
  - The Teardown also fixed line hints that Steps 1 and 3 had shifted. These are all inside the four **Files**:
    - Marketdata, hints that matched the code before Step 3 and moved by +35 after it: `StartBarStream` (1523→1558), `StartBarIngestPoller` (1188→1223), `cacheQuote` (1081→1116), `derefOrZero` (2042→2077), `fundamentalsEnabled` (1811→1846), and the MARKETDATA-15 `WithoutCancel`, strict-path and comment hints.
    - Marketdata MARKETDATA-3: the `GetBars` fallback range is now `~L316-337`, and the new `cacheLiveBars`/`barsCacheWriteGrace` anchors were added.
    - Portfolio, hints that Step 1 moved by +22: `requestBindings`, `expiryIntentFor`, `UpdateWatchlistBinding(s)`, `normalizeSymbols` and `applyDefaultStrategy`, plus its SIGNAL gate.
    - Portfolio, rows this step edits: `ConsumeOrderFills` 162→173 and `DeletePositionsNotInSync` 350→351.
  - Guard-test pointers were added to MARKETDATA-3 and PORTFOLIO-3, and a dated "amended" note to each constitution header.
  - Hints that were already stale before this feature are left as they were, for the next full refresh.
- **Disposition**: in scope (the Teardown rule in the root `CLAUDE.md`, inside this step's **Files**). No behaviour change. The integration PR body must state both "plugin unavailable" and this manual reconciliation.
