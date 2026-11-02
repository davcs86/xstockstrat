# Implementation Spec: fix-etf-flag-fill

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/230-fix-etf-flag-fill/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/fix-etf-flag-fill`

---

## Execution Summary

The work follows design.md § Chosen Approach. It is SEV-3, Track C, and touches only `xstockstrat-marketdata`. There
is no proto, migration, config-key, env-var or port change.

`255-fix-marketdata-fundamentals-cache` is a **hard predecessor and must be merged first**. It owns the root-cause
fix (D-51 source-filtered seed, `seedFMPBudget`) and the unexported classifier `enrichmentClass` (255 impl-spec
Step 11). 230 exports that classifier as `fmp.ErrorClass` (Steps 1–2), and only then reshapes the filler (Steps
3–4). Steps 1–2 come first because Step 3 imports `fmp.ErrorClass`.

The filler change (Step 3) makes four edits to `etf_flags.go`:
- it carries the enqueuing request's trace id on the queue item;
- it turns the bool gate into a reason-returning gate;
- it adds three mutex-guarded rate-limit slots;
- it emits three Info records after the mutex is released.

Step 4 proves the change against @AC-3–@AC-7. Step 5 is the @AC-2 regression guard. Step 6 updates the marketdata
`CLAUDE.md`. Step 7 is the read-only C-14 consumer-surface check.

**Scenario coverage (C-15):**

| Scenario | Covered by |
|---|---|
| `@AC-2` (labelled once the gate reopens) | Step 5 (marketdata), Step 7 (consumer mapping) |
| `@AC-3` (skip reason at Info) | Step 4 (a) |
| `@AC-4` (unlabelled record, negative cache kept) | Step 4 (c) |
| `@AC-5` (fail class only, never raw text, never empty) | Step 2 (classifier), Step 4 (b) |
| `@AC-6` (per-slot rate limit) | Step 4 (d) |
| `@AC-7` (trace_id from the enqueuing request) | Step 4 (e) |

`@AC-1` is retired and delegated to 255 `@AC-3`.

**Consumer surface (C-14):** the product spec names three consumer surfaces:
- backtest `fundamentals_gap`, read by the agent `run_backtest` summary and the UI diagnostics;
- `list_opportunities` `fundamentals_gap`;
- operator logs.

No UI or agent code step is needed. The first two surfaces read the existing, unchanged analysis mapping
`_fundamentals_gap_labels` (`services/xstockstrat-analysis/app/handlers/servicer.py:2042-2062`) over the unchanged
`GetEtfFlags` RPC. They move from `UNSPECIFIED` to `ETF` only through the cache that Step 5 proves gets populated.
Step 7 pins that no change is needed. The log surface is Step 3/4.

## Step Dependencies

- **Pre-execution gate (not a step):** `255-fix-marketdata-fundamentals-cache` must be merged into `main-dev`.
  `feature/fix-etf-flag-fill` must be rebased onto it before Step 1. Check with
  `grep -n "func enrichmentClass" services/xstockstrat-marketdata/internal/fmp/fmp_client.go` (exactly one hit).
  If 255 has not merged, stop under C-11; do not re-create its classifier.
  **Gate result (re-spec 2026-11-02, branch merged with `origin/main-dev` at `cfd240af`): PASSES.**
  `func enrichmentClass` has exactly one hit (`internal/fmp/fmp_client.go:329`), and its stage-less fallback returns
  `"other"` (`:344`). 255 `status.md` is `code-completed`. 254 is launched, and its `*url.Error` rewrap is present in
  `getJSON` (`:243-248`). No later 215 commit touched `etf_flags.go`; the last one is still `08d63011`.
- **Docs PR (not a step; operator 2026-10-22):** two edits land through a docs-only PR to `main-dev`, never through
  a 230 step PR (F-03):
  - the `docs/roadmap/features/merge-order.md` row `fix-etf-flag-fill` (230) → must wait for
    `fix-marketdata-fundamentals-cache` (255);
  - the note in 255's `context.md` Open Threads that `enrichmentClass` returns `other` for stage-less errors.
- Step 1 requires 255 merged: it exports 255's `enrichmentClass`.
- Step 2 [test] covers Step 1 [service].
- Step 3 requires Step 1, because it calls `fmp.ErrorClass`.
- Step 4 [test] covers Step 3 [service]. Step 4 also generalises the shared log-capture handler in
  `marketdata_service_test.go`.
- Step 5 requires Step 3, because it drains `etfFillItem` values. It is a regression guard that passes on trunk
  semantics (P-06 waiver, recorded in context.md at execute).
- Step 6 requires Step 3, because it documents the shipped tokens.
- Step 7 has no code dependency; run it last.
- **Red-before-green order (P-06).** Steps 1 and 3 are `red-green required`, but their RED lives in the following
  test step. Execute each pair test-first: author Step 2's table extension before Step 1's export (RED = `undefined:
  ErrorClass`), and author Step 4's tests on the pre-Step-3 tree, without Step 3's `:226` call-site edit (RED =
  runtime failures (a)–(e); the drains and `GetEtfFlags` calls compile against `chan string`). Capture each RED
  output, then apply the service step and re-run to GREEN.
- Steps 3, 4 and 5 all modify `etf_flags_test.go`; run them in order, never in parallel.
- `block-fundamentals-strategy-on-etf` (215) is `in-progress`, but its marketdata code (`etf_flags.go`,
  `etf_flags_test.go`) is already on `main-dev` (#1243, `08d63011`); only its Step 26 measurement remains. The
  existing merge-order row puts 215 before 255, so 230 (after 255) follows 215 transitively. Re-check on rebase that
  no later 215 commit touched `etf_flags.go`.
- Line numbers cited below were re-anchored on 2026-11-02 against `cfd240af` (the branch after its merge of
  `origin/main-dev`, which includes 255, 254 and 215's marketdata code). `etf_flags.go` has no drift from 255, but
  `fmp_client.go` and `marketdata_service_test.go` do. Re-anchor by symbol name if they drift again.
- 255's step citations: impl-spec Step 11 is now `:595-676`, Step 12 is `:677-732`.
- Overlap with `254-fix-marketdata-secret-exposure` (`fmp_client.go:243-251`). 254 has landed, so its `*url.Error`
  rewrap must still classify as `transport` (Step 2 checks this).

---

### Step 1 — service: export the FMP error classifier as `fmp.ErrorClass`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- 255 impl-spec Step 11 (`docs/roadmap/features/255-fix-marketdata-fundamentals-cache/implementation-spec.md:595-676`)
  added three pieces, now on the branch:
  - an unexported `func enrichmentClass(err error) string` (`internal/fmp/fmp_client.go:329-345`) that returns
    `cap` / `ctx` / `http_<code>` / the `stageError` stage (`transport`, `read`, `decode`), using
    `errors.Is`/`errors.As` only, and `"other"` for a stage-less error (`:344`);
  - the `statusError` type;
  - the `stageError` type.
- Stage-less errors are the build-request error, now 254's `fmt.Errorf("fmp: %s build request: %w", path, ue.Err)`
  (`fmp_client.go:246`) or a bare `fmt.Errorf("fmp: %s build request", path)` when the error is not a `*url.Error`
  (`:248`), and the limiter error (`:251` `fmt.Errorf("fmp: rate limiter: %w", err)`). The operator chose the token
  `other` for these at the 230 round-3 gate (context.md § "Operator decisions at the design gate").
- The service package already imports `internal/fmp`: `internal/service/marketdata_service.go:1734` and `:1788`
  `errors.Is(err, fmp.ErrFMPDailyCapExceeded)`, and `classification_service.go:200`.
- `enrichmentClass` exists (`:329`) and `func ErrorClass` does not: the correct precondition for this step.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Precondition: `grep -n "func enrichmentClass" internal/fmp/fmp_client.go` returns exactly one hit (255 merged).
   Read its body and confirm that a stage-less error returns `other`. If it returns `""` or any other token, **stop**
   (C-11 / P-03). The token must come from 255 per the operator, so report the gap and do not add a fallback in 230.
2. Directly below `enrichmentClass` (after its closing brace at `:345`), add the export:
   ```go
   // ErrorClass is the secret-free class of an FMP error (never its text, which can carry apikey=).
   func ErrorClass(err error) string { return enrichmentClass(err) }
   ```
   Do not rename `enrichmentClass`, change its token set, or touch its callers (F-09: 255's code is not re-specced
   here).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/fmp/
grep -n "^func ErrorClass(err error) string" services/xstockstrat-marketdata/internal/fmp/fmp_client.go   # exactly 1
```

---

### Step 2 — test: extend 255's classifier table to pin `fmp.ErrorClass`, never empty (AC-5, classifier half)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence** (re-specced 2026-11-02, operator decision (1)):
- `internal/fmp/fmp_client_test.go:1` is `package fmp`. Its import block (`:3-19`) already imports `context`,
  `errors` and `fmt` (`:7`).
- `ErrFMPDailyCapExceeded` is at `internal/fmp/fmp_client.go:28`.
- 255 Step 12 (impl-spec `:677-732`) landed `TestEnrichmentClassifier_StagesAndOther` (comment `:443`, func
  `:444-468`). Its rows are: `transport cause` → `transport`, `transport un-wrapped` → `transport`,
  `transport deadline` → `ctx`, `build request` (`errors.New("fmp: p build request")`) → `other`, `cap` → `cap`,
  and `http 404` → `http_404`. Every class Step 2 planned (`ctx`, `cap`, `other`) is already represented, and so is
  `transport`.
- The table asserts the unexported `enrichmentClass` (`:458`) and `enrichmentExpires`. It does not assert the
  exported `ErrorClass` and has no never-empty assertion.
- 254 is present (`*url.Error` rewrap in `getJSON`, `fmp_client.go:243-248`), so the transport sub-check is in
  scope. The `transport cause` row is the shape `getJSON` returns after that rewrap (a `stageError` over the inner
  cause), and `TestEnrichment_WarnDoesNotLeakAPIKey` (`:471`) already drives a URL-bearing transport failure
  through a real client to the `transport` class. The `recordingRT`/`newTestClient` helpers are at `:22` and `:53`.

**TDD**: `red-green required`. RED: before Step 1, the test does not compile (`undefined: ErrorClass`).

**Covers**: `AC-5`

**Instructions**:
1. Do **not** add a new classifier test or table (operator decision (1), C-18). Extend the loop body of
   `TestEnrichmentClassifier_StagesAndOther` so every row also asserts:
   - `ErrorClass(tc.err) == tc.class` (the exported name agrees with `enrichmentClass`);
   - `ErrorClass(tc.err) != ""` (AC-5: never empty).
2. Add a row only for an AC-5 class (`ctx`, `cap`, `other`, `transport`) the table lacks. At `cfd240af` it lacks
   none, so expect no new rows. Do not add a separate client-driven transport test: the existing `transport cause`
   row plus `TestEnrichment_WarnDoesNotLeakAPIKey` cover the 254 path.
3. C-13: the error values stay per-row inline literals with one consumer.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/fmp/ -run 'TestEnrichmentClassifier_StagesAndOther|TestEnrichment_WarnDoesNotLeakAPIKey' -count=1 -v
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 3 — service: the ETF filler carries the trace id, reports a gate reason, and emits rate-limited Info records

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/etf_flags.go` — modify
- `services/xstockstrat-marketdata/internal/service/etf_flags_test.go` — modify (one call-site compile fix only, at `:226`)

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence** (all in `internal/service/etf_flags.go` unless noted):
- Const block `:17-25`: `etfFlagTTL`, `etfFlagCacheMax`, `etfFlagQueueCap`.
- `type etfFlagState` `:33-40`: `src`, `mu`, `entries`, `pending`, `queue chan string`, `now`.
  `SetEtfFlagSource` `:44-51` makes the maps and `make(chan string, etfFlagQueueCap)` (`:50`). `clock()` is at `:53`.
- `GetEtfFlags(_ context.Context, …)` `:62` discards its ctx. It locks `mu` at `:66-67` and calls
  `s.etf.enqueueLocked(sym)` at `:76`.
- `enqueueLocked(sym string)` `:83-95`: the `pending` dedup at `:87-89`, then `case e.queue <- sym:` at `:91`.
- `StartEtfFlagFiller` `:98-113`: `case sym := <-q: s.fillEtfFlag(ctx, sym)` (`:109-110`) on the loop ctx from
  `cmd/server/main.go:166`.
- `fillEtfFlag(ctx, sym string)` `:115-136`:
  - the deferred `pending` delete at `:116-120`;
  - the silent `if !s.etfFillAllowed() { return }` at `:121-123`;
  - the raw-error Debug record `slog.DebugContext(ctx, "etf flag fill failed", "symbol", sym, "error", err)` at
    `:126`;
  - the cache write at `:129-135`, under `s.etf.mu.Lock(); defer s.etf.mu.Unlock()` (`:130-131`).
- `etfFillAllowed() bool` `:140-146` checks, in order: `src == nil || fundCfg == nil || !GetBool("marketdata.fmp.enabled", false) || fmpBudget == nil`,
  then `used, cap := s.fmpBudget.BudgetSnapshot()`, then `cap > 0 && !atQuotaAlertThreshold(used, cap)`.
- `atQuotaAlertThreshold` is at `internal/service/marketdata_service.go:1998`. `BudgetSnapshot` takes
  `fmp.Client.mu` (`internal/fmp/fmp_client.go:102`), so the gate must not run under `etf.mu`.
- Trace source: `middleware.FromContext(ctx).TraceID` (`internal/middleware/propagation.go:20-23`). It is set by
  `UnaryServerInterceptor` (`:27-35`), which is wired at `cmd/server/main.go:183`. The service package already imports
  `github.com/xstockstrat/marketdata/internal/middleware` (`marketdata_service.go:28`, used at `:522`). The gRPC
  handler forwards the request ctx to `svc.GetEtfFlags` (`internal/handler/marketdata_handler.go:161`).
- `FetchIsEtf` returns `(nil, nil)` when the profile is empty or has no `isEtf` (`internal/fmp/fmp_client.go:460-466`).
- The only test call site that passes a bare string is `etf_flags_test.go:226`
  `svc.fillEtfFlag(context.Background(), "NEW")`. The four `<-svc.etf.queue` drains (`:136,156,183,200`) compile
  unchanged once the channel element type changes.
- The process logger runs at Info (`cmd/server/main.go:42-43`, `slog.NewJSONHandler(os.Stdout, nil)`; `:52` wraps
  it in `telemetry.WrapLogHandler`).

**TDD**: `red-green required` (the RED run is Step 4's suite against the pre-change tree)

**Covers**: —

**Instructions**:
1. **Constant.** Add `etfFlagLogEvery = time.Minute` to the `:17-25` const block, with a ≤2-line comment: the fill
   log rate-limit window, a fixed invariant, not a config key (FR-2, F-07).
2. **Queue item (C-03).**
   - Add `type etfFillItem struct{ sym, traceID string }`.
   - Change `etfFlagState.queue` to `chan etfFillItem`, and the `make` at `:50` to
     `make(chan etfFillItem, etfFlagQueueCap)`.
   - Rename `GetEtfFlags`'s `_` parameter to `ctx`. Read `tid := middleware.FromContext(ctx).TraceID` once, before
     `s.etf.mu.Lock()`, and call `s.etf.enqueueLocked(sym, tid)`.
   - Change `enqueueLocked(sym, traceID string)` to send `etfFillItem{sym: sym, traceID: traceID}`. The dedup is
     unchanged.
   - In `StartEtfFlagFiller`, change the receive to `case item := <-q: s.fillEtfFlag(ctx, item)`. It keeps the loop
     ctx; the request ctx never crosses over.
   - Change the signature to `fillEtfFlag(ctx context.Context, item etfFillItem)`. Use `item.sym` wherever `sym` was
     used.
   - In `etf_flags_test.go:226`, change `"NEW"` to `etfFillItem{sym: "NEW"}`. No other test edit belongs in this
     step.
3. **Gate with a reason.**
   - Replace `etfFillAllowed() bool` with `etfFillGate() (reason string, used, cap int, snap bool)`, evaluated in the
     existing order:
     1. `src == nil || fundCfg == nil` → `"not_wired"`;
     2. `!GetBool("marketdata.fmp.enabled", false)` → `"fmp_disabled"`;
     3. `fmpBudget == nil` → `"not_wired"`;
     4. take `used, cap = BudgetSnapshot()` and set `snap = true`;
     5. `cap <= 0` → `"no_cap"`;
     6. `atQuotaAlertThreshold(used, cap)` → `"budget"`;
     7. otherwise `""`, which means the gate is open.
   - Call it from `fillEtfFlag` outside `etf.mu`, as today. `etfFillAllowed` has no other caller (grep), so remove it.
4. **Rate-limit slots.**
   - Add fields to `etfFlagState`, all guarded by `mu`:
     - `lastSkipReason string`;
     - `budgetLoggedAt time.Time`;
     - `failLoggedAt map[string]time.Time`, initialised in `SetEtfFlagSource` next to `pending`;
     - `unlabelledLoggedAt time.Time`.
   - Add three `…Locked` decision helpers on `*etfFlagState`. Each takes `now := e.clock()` and returns whether to
     log:
     - **skip**: when `reason != lastSkipReason`, log. When `reason == "budget"` and
       `now.Sub(budgetLoggedAt) >= etfFlagLogEvery`, log. Otherwise do not. When logging, set
       `lastSkipReason = reason`, and for `budget` also set `budgetLoggedAt = now`.
     - **fail**: log when `now.Sub(failLoggedAt[class]) >= etfFlagLogEvery`, then set `failLoggedAt[class] = now`.
       This is a per-class slot (operator, round-3 gate). The map is bounded by the classifier's finite output.
     - **unlabelled**: log when `now.Sub(unlabelledLoggedAt) >= etfFlagLogEvery`, then set
       `unlabelledLoggedAt = now`.
   - An open gate clears `lastSkipReason` (set it to `""` under `mu`) before the fetch.
5. **Records.** All records are `slog.InfoContext(ctx, …)` on the loop ctx. Build the attrs as a slice, and append
   `"trace_id", item.traceID` only when it is non-empty. Each decision is taken under `mu`; `mu` is released before
   any `slog` call. Never pass `err` or `err.Error()` to a record.
   - Skip (replaces the silent return at `:121-123`): `"etf flag fill skipped"` with `"symbol"` and `"reason"`.
     Add `"used"` and `"cap"` only when `snap` is true (`no_cap`, `budget`). Then return. `src` is not called
     (215 @AC-14).
   - Fail (replaces `:126`): `class := fmp.ErrorClass(err)`, then `"etf flag fill failed"` with `"symbol"` and
     `"class"`. Then return. The error is not cached, as today.
   - Unlabelled (FR-3):
     - In the cache write at `:129-135`, replace `defer s.etf.mu.Unlock()` with an explicit unlock.
     - Under the lock: evict, write the entry exactly as today (negative cache unchanged), and when `isEtf == nil`
       take the unlabelled decision.
     - Unlock, then emit `"etf flag fill unlabelled"` with `"symbol"` (plus `trace_id`) only.
6. Keep the deferred `pending` delete. Do not change `etfFlagTTL`, `etfFlagCacheMax`, the 80% threshold, or the
   cache-only RPC (215 @AC-14, 217 @AC-4).
7. Comments: ≤2 lines, constraints only (root `CLAUDE.md` § How to Act #5).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/
grep -n "slog.DebugContext\|\"error\", err\|err.Error()" services/xstockstrat-marketdata/internal/service/etf_flags.go   # no hits
grep -n "etfFillAllowed" -r services/xstockstrat-marketdata/internal/                                                  # no hits
grep -n "middleware.FromContext(ctx).TraceID\|chan etfFillItem\|fmp.ErrorClass(err)\|etfFlagLogEvery" services/xstockstrat-marketdata/internal/service/etf_flags.go   # each present
```

---

### Step 4 — test: fill visibility — reasons, class, unlabelled, rate limit, trace (AC-3, AC-4, AC-5, AC-6, AC-7)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (one level-aware log-capture handler; fold `infoRecorder` into it)
- `services/xstockstrat-marketdata/internal/service/etf_flags_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence** (re-specced 2026-11-02, operator decision (2)):
- `recordingWarnHandler` (`marketdata_service_test.go:1880-1920`; type `:1882`):
  - its `Handle` (`:1893-1906`) drops every record whose level is not `slog.LevelWarn` (`:1894`);
  - `recordedWarn{msg, attrs map[string]string}` is at `:1887`;
  - `find(msg)` is at `:1910`;
  - `installWarnRecorder` (`:1922-1929`) calls `slog.SetDefault`, which is process-global, so callers must not use
    `t.Parallel()`.
- `installWarnRecorder` has 12 existing callers (`:1169,1186,1999,2025,2049,2095,2115,3535,3625,3649,3658,3824`),
  and `rec.recs` is read at `:2009,2039,2083,2105,2124,3660-3661`.
- A second, Info-only copy of the same handler exists: `infoRecorder` (`:1202-1225`; comment `:1202-1203`, type
  `:1204` with `recs []recordedWarn` at `:1206`, `Handle` `:1210` with a `LevelInfo` filter at `:1211`). Its only
  user is `TestIngestRecentBars_LogsHeartbeatEveryCycle` (func `:1229`): `h := &infoRecorder{}` at `:1243` and an
  inline `SetDefault`/`Cleanup` at `:1244-1246`; it reads `h.recs` at `:1248-1251`.
- `countingWarnHandler` (`:1002-1011`) only counts records and is out of scope.
- The ETF harness in `etf_flags_test.go`:
  - `fakeEtfSource{calls, resp, err}` with `total()` (`:15-43`);
  - `newEtfSvc(src, budget, fmpOn)` returns `*etfClock` (`:51-60`);
  - `etfFlags` (`:62-69`) calls `GetEtfFlags(context.Background(), …)`;
  - the existing `@AC-14` table with the `"no budget wired", nil` case (`:118-148`).
- `fakeBudget{used, cap}` has a value receiver (`marketdata_service_test.go:2368-2370`), and `fakeCfg` is used by
  `newEtfSvc` (`:54`).
- The interceptor-routed ctx pattern is in `internal/middleware/propagation_test.go:70-82`:
  `metadata.NewIncomingContext` → `middleware.UnaryServerInterceptor(…, handler)` captures the server ctx. A bare
  `metadata.NewIncomingContext` is not enough, because `FromContext` reads the unexported `propKey{}`
  (`propagation.go:10,21`).
- Fails ledger `fails.md` 2026-10-22 fix-marketdata-secret-exposure: `*url.Error` carries `apikey=`. Check every
  attribute value, not only `msg`.

**TDD**: `red-green required`. RED: run against the pre-Step-3 tree, (a)–(e) fail. There is no Info record, the
Debug record carries the raw `error`, there is no unlabelled record, and there is no `trace_id`. Each RED assertion
names its `@AC-*`.

**Covers**: `AC-3, AC-4, AC-5, AC-6, AC-7`

**Instructions**:
1. **One level-aware capture handler (C-18, no copy; operator decision (2)).** Rename `recordingWarnHandler` →
   `recordingLogHandler` and `recordedWarn` → `recordedLog`.
   - Add a `level slog.Level` field. `Handle` keeps records with `r.Level == h.level`. That is exact-level matching:
     a record captured at exact Info satisfies AC's "Info or higher".
   - Add `installLogRecorder(t, level)` with the current install/cleanup body. Keep `installWarnRecorder(t)` as a
     one-line wrapper, `return installLogRecorder(t, slog.LevelWarn)`, so its 12 callers and the `rec.recs` reads
     stay untouched.
   - Add a `count(msg string) int` helper next to `find`.
   - **Fold `infoRecorder` in.** Delete `infoRecorder` and its comment (`:1202-1225`). In
     `TestIngestRecentBars_LogsHeartbeatEveryCycle`, replace `h := &infoRecorder{}` and the inline
     `SetDefault`/`Cleanup` (`:1243-1246`) with `h := installLogRecorder(t, slog.LevelInfo)`. Its `h.recs` reads
     (`:1248-1251`) compile unchanged against `[]recordedLog`. After the fold, `grep -n "infoRecorder"` finds nothing.
2. In `etf_flags_test.go`, add an `etfInfo(t)` helper that calls `installLogRecorder(t, slog.LevelInfo)`. Add a
   `noSecret(t, rec)` helper that fails when `msg` or any attribute value contains `apikey=` or `SECRET`. None of the
   new tests call `t.Parallel()`. Each asserts a `src.total()` delta, so logging adds no fetch.
3. (a) **AC-3** `TestEtfFlagFiller_SkipReasonLogged_AC3`: a table with these rows:
   - `fmp_disabled`: `fakeBudget{0,100}`, `fmpOn=false`;
   - `no_cap`: `{0,0}`;
   - `budget`: `{80,100}`;
   - `not_wired`: `nil` budget.

   For each row: `etfFlags(SCHD)`, then drain with `svc.fillEtfFlag(ctx, <-svc.etf.queue)`. Assert:
   - exactly one `etf flag fill skipped` record with `symbol=SCHD` and the row's `reason`;
   - `used`/`cap` attrs present only for `no_cap` and `budget`, and for `budget` equal to `80`/`100`;
   - `src.total()==0`;
   - `pending` cleared.
4. (b) **AC-5** `TestEtfFlagFiller_FailLogsClassOnly_AC5`: a table whose `fakeEtfSource.err` values are inline
   errors for `ctx`, `cap` and `other`, each with `apikey=SECRET` in the text:
   `fmt.Errorf("fmp: /stable/profile?apikey=SECRET: %w", context.DeadlineExceeded)`,
   `fmt.Errorf("fmp: /stable/profile?apikey=SECRET: %w", fmp.ErrFMPDailyCapExceeded)` and
   `errors.New("fmp: /stable/profile?apikey=SECRET build request")`. For each row assert:
   - exactly one `etf flag fill failed` record with `symbol=SCHD` and that `class`;
   - `class != ""`;
   - no `error` attribute;
   - `noSecret`;
   - the entry is not cached, and the next `etfFlags(SCHD)` re-queues it.
5. (c) **AC-4** `TestEtfFlagFiller_UnlabelledLogged_AC4`: `resp: map[string]*bool{}`, so the profile is empty.
   - Fill `NOPROF`. Assert one `etf flag fill unlabelled` record whose attr keys are exactly `{symbol}`. There is no
     trace in this test, so `trace_id` is absent.
   - Advance `*etfClock` by 24h, call `etfFlags(NOPROF)`, and assert it is unset, the queue is empty, and
     `src.total()==1`. The negative cache is kept.
   - Fill a second empty symbol inside the window: still one record.
   - Advance past `etfFlagLogEvery` and fill a third: two records.
6. (d) **AC-6** `TestEtfFlagFiller_RateLimitSlots_AC6`: one sub-test per `acceptance.feature` example row, each on
   distinct symbols. Use `svc.fmpBudget = fakeBudget{…}` reassignment and `svc.fundCfg` swaps between fills:
   - 5 budget skips → 1;
   - 5 budget skips, clock + `etfFlagLogEvery`, 1 budget skip → 2;
   - 5 `fmp_disabled` skips with the clock advanced 1 minute between each → 1;
   - `fmp_disabled`, `budget`, `fmp_disabled` → 3;
   - budget skip, a successful fill with gate `{0,100}`, budget skip → 2 (an open gate clears `lastSkipReason`);
   - 2 `ctx` failures then 1 `cap` failure → 2 `failed`;
   - budget skip + `ctx` failure + empty profile → 1 + 1 + 1. The slots are independent.
7. (e) **AC-7** `TestEtfFlagFiller_CarriesTraceID_AC7`.
   - Build a server ctx through `middleware.UnaryServerInterceptor` with `metadata.Pairs("x-trace-id", "t-1")`, as
     `propagation_test.go:70-82` does.
   - Call `svc.GetEtfFlags(serverCtx, …SCHD…)` with the gate closed by `budget`, then drain. Assert the `skipped`
     record has `trace_id=t-1`.
   - Then, in a fresh `newEtfSvc`, enqueue via `etfFlags` (`context.Background()`, no trace), drain, and assert the
     logged record has no `trace_id` key.
8. C-13: every fake error and response is an inline per-test literal. The only shared harness is the existing
   `fakeEtfSource`/`newEtfSvc`/`fakeBudget`, and no second copy is introduced.
9. Every existing `@AC-14` test (`TestEtfFlagFiller_HeadroomGate_AC14`, `TestGetEtfFlags_TTL`,
   `TestGetEtfFlags_EmptyProfileNegativeCached`, `TestEtfFlagFiller_ErrorNotCached`,
   `TestEtfFlagFiller_EvictsOldestAtBound`, `TestEtfFlags_ConcurrentReadersAndFiller`) must pass unchanged under
   `-race` (C-16).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -run 'EtfFlag|EtfFlags' -race -count=1 -v
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1   # the 12 installWarnRecorder callers and TestIngestRecentBars_LogsHeartbeatEveryCycle still pass
grep -n "t.Parallel()" services/xstockstrat-marketdata/internal/service/etf_flags_test.go                    # no hits
grep -n "infoRecorder\|recordingWarnHandler\|recordedWarn" services/xstockstrat-marketdata/internal/service/marketdata_service_test.go   # no hits
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in `internal/service`, a package excluded from CI coverage measurement, so no coverage threshold
applies to it. The coverage command above still guards the measured total.

---

### Step 5 — test: an ETF skipped while the gate was closed is labelled once it reopens (AC-2 regression guard)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/etf_flags_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- The cache write that the later call reads is `etf_flags.go:135`
  `s.etf.entries[sym] = etfFlagEntry{isEtf: isEtf, fetchedAt: now}`.
- `fakeBudget` has a value receiver (`marketdata_service_test.go:2370`), so `svc.fmpBudget = fakeBudget{used: 5, cap: 250}`
  reassigns the snapshot.
- Overlapping tests are `TestEtfFlagFiller_HeadroomGate_AC14` (`etf_flags_test.go:118-148`) and
  `TestGetEtfFlags_TTL` (`:151-176`). Neither combines closed → reopened on one symbol. `boolp` is at
  `etf_flags_test.go:45`.
- The FMP-only seed that makes `used` small in production is 255's `seedFMPBudget` (`cmd/server/main.go:262`). Its
  test, `TestSeedFMPBudget_CountsOnlyFMPRows_AC3`, is at `cmd/server/main_test.go:94`.

**TDD**: `regression-guard`. P-06 waiver: this test passes on trunk semantics, because the fix for this path is
255's seed. Record the waiver in context.md when this step executes.

**Covers**: `AC-2`

**Instructions**:
1. Add `TestEtfFlagFiller_LabelledAfterGateReopens_AC2`, with no new helpers. Set up
   `src := &fakeEtfSource{resp: map[string]*bool{"SCHD": boolp(true)}}` and
   `svc, _ := newEtfSvc(src, fakeBudget{used: 200, cap: 250}, true)`.
2. `etfFlags(SCHD)`, then drain. Assert `IsEtf == nil` and `src.total()==0`.
3. `svc.fmpBudget = fakeBudget{used: 5, cap: 250}`. Then `etfFlags(SCHD)` (re-enqueued, because there is no entry),
   and drain. Assert `src.total()==1`.
4. Call `etfFlags(SCHD)` again. Assert `IsEtf != nil && GetIsEtf()`, and that the queue is empty.
5. Add a ≤2-line comment naming the overlap with `TestEtfFlagFiller_HeadroomGate_AC14`/`TestGetEtfFlags_TTL`, and
   that the 210/5 seed half is 255 `@AC-3`.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -run TestEtfFlagFiller_LabelledAfterGateReopens_AC2 -race -count=1 -v
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — docs: marketdata `CLAUDE.md` — fill log records and the window invariant

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-marketdata/CLAUDE.md:165-176` is the `GetEtfFlags` (feature 215, FR-11) paragraph.
- The "Fixed invariants (not config keys)" bullet is at `:174-175`.
- "An empty profile is negative-cached; a fetch error is not cached." is at `:176`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Append `etfFlagLogEvery` 1 minute (the fill-log rate-limit window) to the Fixed invariants bullet at `:174-175`.
2. Add one bullet after `:176`. It says that the filler logs at Info:
   - `etf flag fill skipped`, with the reason `fmp_disabled` / `no_cap` / `budget`. `used`/`cap` appear only for
     `no_cap`/`budget`. Config reasons log on change and `budget` logs once per window. Leave `not_wired`
     undocumented.
   - `etf flag fill failed`, with the error `class` only. It is never the error text, and the fallback class is
     `other`. There is one record per class per window.
   - `etf flag fill unlabelled` for an empty profile, which is still negative-cached. There is one record per window.
   - Each record carries the enqueuing request's `trace_id` when present.
3. Do not restate the gate rules already in the paragraph. Keep the bullet within about 4 lines.

**Verification**:
```bash
grep -n "etfFlagLogEvery\|etf flag fill skipped\|etf flag fill failed\|etf flag fill unlabelled" services/xstockstrat-marketdata/CLAUDE.md   # each present
grep -n "not_wired" services/xstockstrat-marketdata/CLAUDE.md   # no hits
```

---

### Step 7 — test: consumer-surface read-only verification (C-14)

**Status**: `pending`
**Service**: `xstockstrat-analysis` (read-only), `xstockstrat-ui` / `xstockstrat-agent` (read-only)
**Files**:
- none (read-only verification; no file is staged)

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_fundamentals_gap_labels` (`services/xstockstrat-analysis/app/handlers/servicer.py:2042`) calls `GetEtfFlags`
  with `metadata=propagation_meta` (`:2046-2049`). On error it logs a warning and returns `{}` (`:2050-2052`). It
  maps unset → `UNSPECIFIED`, true → `ETF`, false → `NOT_ETF` (`:2054-2061`).
- The product spec states that there is no proto, UI text or agent-tool contract change.

**TDD**: `N/A (read-only verification of an unchanged consumer)`. Coverage threshold: N/A, no code changes in
this step; the analysis ≥40% gate is untouched because no analysis file is in the diff.

**Covers**: `AC-2` (consumer half: a populated `is_etf=true` reaches `FUNDAMENTALS_GAP_ETF` through the unchanged
mapping)

**Instructions**:
1. Confirm that the feature diff touches no consumer code.
2. Confirm that the analysis mapping still maps `is_etf` true to the ETF gap.
3. Record in context.md that the end-to-end consumer check is the post-deploy feature 215 Step 26(a) re-run on dev
   (SCHD → `FUNDAMENTALS_GAP_ETF` after a first miss). That re-run must read `marketdata.fmp.enabled` and
   `marketdata.fundamentals.provider` directly, because a default `fmp_disabled` gate logs once per process
   (design.md Open Risks).

**Verification**:
```bash
git diff --name-only origin/main-dev...HEAD -- services/xstockstrat-analysis services/xstockstrat-ui services/xstockstrat-agent packages/proto   # empty
grep -n "_fundamentals_gap_labels\|FUNDAMENTALS_GAP_ETF" services/xstockstrat-analysis/app/handlers/servicer.py   # mapping present
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

## Deviation Log

- **2026-11-02 — re-spec at sdd-execute setup** (branch merged with `origin/main-dev`, `cfd240af`). Pre-execution
  gate passes (255 `code-completed`, `enrichmentClass` at `fmp_client.go:329` returns `other`, 254 landed).
  - Step 2 (operator decision (1)): no new classifier table. Extend 255's `TestEnrichmentClassifier_StagesAndOther`
    to assert `ErrorClass` and a never-empty class; add only missing rows (none at re-spec). Stale evidence
    (`does not pin other`, `add fmt`, pre-254 build-request text) dropped.
  - Step 4 (operator decision (2)): one level-aware `recordingLogHandler`; `infoRecorder` is folded into it and
    `TestIngestRecentBars_LogsHeartbeatEveryCycle` moves onto `installLogRecorder(t, slog.LevelInfo)`. 12 (not 10)
    `installWarnRecorder` callers re-anchored.
  - Steps 0, 1, 3, 5, 7 and the Execution Summary: line-drift re-anchors only. Step 6: no drift.
- **2026-11-02 — Step 4 execute (SEV-3).** (c) AC-4: the unlabelled window checks (second empty symbol inside the
  window → still 1; past `etfFlagLogEvery` → 2) run *before* the 24h advance, not after it as instruction 5 orders
  them. The 24h advance itself exceeds the 1-minute window, so the spec's order cannot yield "still one record". The
  negative-cache assertion follows, with `src.total()==3` (three distinct fills). Test-order only; no behaviour change.
