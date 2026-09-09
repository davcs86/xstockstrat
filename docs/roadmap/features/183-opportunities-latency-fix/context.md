# Context: opportunities-latency-fix

**Feature**: `docs/roadmap/features/183-opportunities-latency-fix/feature.md`
**Product Spec**: `docs/roadmap/features/183-opportunities-latency-fix/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/183-opportunities-latency-fix/implementation-spec.md`

---

## Session 2026-09-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Root cause analysis performed via DigitalOcean runtime logs: identified 6 bottlenecks (P0–P5) in the ListOpportunities call chain.
- Ledger scan: feature 141 (semaphore sizing to downstream capacity) directly relevant — batch RPCs eliminate the per-symbol fan-out entirely, and the Go batch handler must use `WHERE symbol = ANY($1)` single-query pattern (not per-symbol goroutine fan-out) to respect the pool budget.

## Session 2026-09-09 — sdd-design

- Phase 0 Recon: wrote recon.md (services: packages/proto, xstockstrat-marketdata, xstockstrat-analysis, xstockstrat-ui; key reuse patterns: GetLatestQuotesBatch single-query template, MultiSymbolSource.GetBarsMulti interface).
- Phase 1 Grilling: 4 rounds (full). Chosen approach: 8-step additive batch RPCs (LATERAL JOIN BatchGetBars, ROW_NUMBER BatchGetLatestPrice) + Phase 0 asyncio.gather + TTL 10→20 + BFF per-call timeoutMs. Rejected: streaming BatchGetBars (unnecessary complexity), flat ANY without per-symbol LIMIT (unbounded rows), raise sem 2→5 (insufficient).
- Constitution rules touched: C-04, C-08, C-11, C-14, C-16, F-01, F-04, F-11, P-03, P-05. Floor breaches: none.
- Status: draft → design-approved.

## Decisions

- **LATERAL JOIN over ROW_NUMBER for BatchGetBars** — LATERAL pushes per-symbol LIMIT into the index scan, avoids materializing all rows; ROW_NUMBER reserved for BatchGetLatestPrice (prev close) where only 1 row/symbol is needed.
- **`timeframe = "1d"` enforcement** — BatchGetBars rejects non-daily timeframes to avoid combinatorial lock-budget risk; only consumer (analysis Phase 1) uses daily bars exclusively.
- **TTL 20s (not 15s)** — React Query v5 counts refetchInterval from completion, not start; 20s provides margin over 15s poll + ~5s response time.
- **Type-assert fallback for GetLatestTradesMulti** — Alpaca source may not implement the multi-trade interface; runtime type-assert with per-symbol fallback preserves non-Alpaca compatibility.
- **8 MB gRPC receive limit** — worst case 100 symbols × 400 bars × ~80 bytes ≈ 3.2 MB; 8 MB provides 2.5× headroom over default 4 MB.
- **`now_utc` captured AFTER `asyncio.gather`** — prevents timestamp staleness equal to the duration of the slowest drain.
- **Enrichment batch try/except with per-symbol fallback** — preserves @AC-11 (omit-not-fabricate) when batch transport fails.
- **C-16 CHANGE sign-off**: `@AC-5 @FR-4 @feature-177` TTL default raised 10→20s; guarantee shape preserved, only threshold changes.

## Open Threads

- [ ] EXPLAIN ANALYZE the LATERAL JOIN on staging with ~100 symbols, 400-day range — target: /sdd-spec Step 2.
- [ ] Verify Alpaca multi-symbol trades endpoint exists and its rate limits — target: /sdd-spec Step 3.
- [ ] Verify Connect-es `CallOptions.timeoutMs` emits `DeadlineExceeded` status code — target: /sdd-spec Step 8.

## Session 2026-09-09 — sdd-spec

- Implementation spec generated: 13 steps (4 proto/gen, 4 marketdata Go service+test, 4 analysis Python service+test, 2 UI BFF service+test, 1 config).
- All 9 acceptance scenarios (AC-1 through AC-9) mapped to test steps: AC-1→Step 13, AC-2/AC-3→Step 4, AC-4/AC-5→Step 6, AC-6/AC-7/AC-8/AC-9→Step 11.
- Consumer surface `/insights` reached by Step 12 (BFF deadline plumbing) per C-14.
- Test-step pairing (C-08) satisfied: Steps 3→4, 5→6, 7/8/9/10→11, 12→13.
- Cross-cutting constraints applied: lint gates in all test step verifications, header propagation cited for Steps 8/9 (reuses existing channel/stub), C-13 single-consumer inline literals noted for test data.
- Note: Go `service` steps (3, 5) land new logic in handler/repository/service packages — handler and repository are excluded from CI coverage measurement, so integration test verification is sufficient per spec-template.md; service-layer tests in Steps 4/6 cover the service package.
- Status: design-approved → implementation-ready.

## Session 2026-09-09 — sdd-review product-spec

- Product spec reviewed (retroactive — status already design-approved). Result: PASS WITH WARNINGS (1 warning, 0 blockers).
- Warning: criterion 9 — unchecked open-question checkbox for ledger 141 trap; resolved by checking box (substance was already resolved in design.md/recon.md).
- Overlap findings: CLEAN — no collisions with 7 in-flight features.
- Trading domain checks: skipped (non-trading feature).

## Session 2026-09-09 — sdd-review impl-spec (advisory)

- Result: 0 failures, 4 warnings, 1 note (advisory — did not block).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 4: ⚠ Missing explicit coverage threshold in Verification command (C-08) — [x] addressed (added `-coverprofile` + ≥40% gate)
  - Step 6: ⚠ Missing explicit coverage threshold in Verification command (C-08) — [x] addressed (added `-coverprofile` + ≥40% gate)
  - Step 11: ⚠ Missing explicit coverage threshold in Verification command (C-08) — [x] addressed (added `--cov=app --cov-fail-under=40`)
  - Step 12: Note — forward() opts merge imprecision (conflated `forward`'s own options with callback opts) — [x] addressed (clarified `forwardOpts` second param → merged into `callOpts` → threaded to callback)
  - Step 2: ⚠ Wildcard paths for codegen stubs (`*.go`, `*_pb2*.py`, `*`) — [ ] accepted (codegen output; exact filenames depend on `buf.gen.yaml` template and are not stable to pin)
- Overlap findings: CLEAN — no collisions with 7 in-flight features.

## Session 2026-09-09T — sdd-execute (unattended, all steps)

**Mode**: unattended execution — user approved skipping per-step Phase 2 confirmation for all steps.
**Open review warnings**: 0 failures, 1 accepted wildcard note (Step 2, codegen output).

### Step 1 — proto: BatchGetBars and BatchGetLatestPrice definitions
- Added 2 RPCs (BatchGetBars, BatchGetLatestPrice) and 5 messages to marketdata.proto
- Verification: `buf lint` pass, `buf breaking --against main-dev` pass
- TDD: N/A (proto — non-code-bearing)
- Status: implementation-ready → in-progress

### Step 2 — proto-gen: regenerate stubs
- Ran `./scripts/buf-gen.sh` — generated Go, Python, TS stubs (13 files changed, 1786 insertions)
- TS build (`pnpm run build`) passed
- TDD: N/A (proto-gen — non-code-bearing)

### Step 3 — service: Marketdata Go — BatchGetBars handler/service/repo
- Repo: added `QueryBarsBatch` with LATERAL JOIN (`unnest($1::text[]) CROSS JOIN LATERAL … LIMIT $5`), reuses `scanBars`, clamps maxBarsPerSymbol to [1, 5000]
- Service: added `BatchGetBars` method following warm-DB → cold-singleflight → `MultiSymbolSource.GetBarsMulti` pattern; added `barsSingleflight singleflight.Group` field; normalizes timeframe, rejects non-`1d`
- Handler: added Connect handler `BatchGetBars` + `grpcMarketDataAdapter.BatchGetBars` (3-method pattern from GetLatestQuotes)
- Deviation: spec referenced `source/alpaca/client.go` but actual path is `internal/alpaca/client.go` — no impact on implementation
- Verification: `GOWORK=off go build ./...` — pass
- TDD: red-green deferred to Step 4 (paired test step)

### Step 4 — test: BatchGetBars
- Added 5 tests: `TestBatchGetBars_MultipleSymbols` (AC-2), `TestBatchGetBars_OmitMissingSymbols` (AC-3), `TestBatchGetBars_RejectsNonDailyTimeframe`, `TestBatchGetBars_ClampsMaxBarsPerSymbol`, `TestBatchGetBars_DefaultMaxBars`
- Added `fakeBatchBarsSource` mock implementing `DataSourceClient` + `MultiSymbolSource` for cold-path testing (nil repo forces cold)
- TDD: red implicit (Step 3 had no tests) → green: all 5 pass, coverage 45.8% ≥ 40%
- Lint: `golangci-lint` skipped (built with Go 1.25 < target 1.27); `go vet` passes

### Step 5 — service: Marketdata Go — BatchGetLatestPrice handler/service/repo
- Source: added `GetLatestTradesMulti(ctx, symbols) (map[string]*Trade, error)` to `MultiSymbolSource` interface; added `Trade` struct to `source` package
- Alpaca: added `GetLatestTradesMulti` using `GET /v2/stocks/trades/latest?symbols=…` (follows `GetLatestQuotesMulti` pattern)
- Repo: added `GetPreviousDailyCloseBatch` with ROW_NUMBER (`rn=2` = second-newest 1d bar per symbol); follows `GetLatestQuotesBatch` pattern
- Service: added `BatchGetLatestPrice` with `priceSingleflight` keyed `batch-price:{sorted_symbols}`; type-asserts `MultiSymbolSource` for batch trades, falls back to per-symbol `LatestTradeSource.GetLatestTrade`; omit-not-fabricate (AC-11)
- Handler: added Connect handler `BatchGetLatestPrice` + `grpcMarketDataAdapter.BatchGetLatestPrice` (3-method pattern)
- Verification: `GOWORK=off go build ./...` — pass
- TDD: red-green deferred to Step 6 (paired test step)

### Step 6 — test: BatchGetLatestPrice
- Added `GetLatestTradesMulti` stub to `fakeBatchBarsSource` (compile fix for updated `MultiSymbolSource` interface)
- Added `fakeBatchPriceSource` mock (implements `DataSourceClient` + `MultiSymbolSource`) for multi-symbol trade tests
- Added `fakeLatestTradeOnlySource` mock (implements `DataSourceClient` + `LatestTradeSource` only) for fallback path test
- Added 3 tests: `TestBatchGetLatestPrice_MultipleSymbols` (AC-4), `TestBatchGetLatestPrice_OmitMissingSymbols` (AC-5), `TestBatchGetLatestPrice_FallbackWhenNotMultiSymbolSource`
- TDD: red implicit (Step 5 had no tests) → green: all 3 pass, coverage 45.4% ≥ 40%
- Lint: `golangci-lint` skipped (Go 1.25 < target 1.27); `go vet` passes

### Step 7 — service: Phase 0 drain parallelization
- Replaced 4 sequential drain calls (`_drain_active_signals`, `_drain_held_symbols`, `_drain_watchlist_bindings`, `_drain_source_weights`) with `asyncio.gather` at `servicer.py:3854`.
- Moved `now_utc = datetime.now(UTC)` to AFTER `asyncio.gather` (design decision: prevents timestamp staleness equal to the duration of the slowest drain).
- Deviation: spec referenced lines 3557-3569, actual code at lines 3854-3866 (file grew since spec generation). Same symbols, same logic — no semantic deviation.
- Verification: `ruff check .` ✓, `ruff format --check .` ✓, `ast.parse` syntax ✓.
- TDD: N/A — structural refactor (sequential→concurrent), no paired test step; tests at Step 11.

### Step 8 — Analysis Python — Phase 1 batch bars
- Replaced per-symbol `_fetch_into` + `asyncio.gather` with a single `BatchGetBars` RPC call.
- `max_bars_per_symbol` set to `_READINESS_LOOKBACK_DAYS` (400) — derived from the date range, NOT from `_BAR_PAGE_SIZE`/`_MAX_BAR_PAGES`.
- Added 8MB gRPC receive limit to the marketdata channel in `app/main.py` — worst case ~100 symbols × 400 bars × ~80 bytes ≈ 3.2 MB, 8 MB provides 2.5× headroom.
- `propagation_meta` forwarded via `metadata=` kwarg — identical to existing `_fetch_bars_paged` pattern.
- `_bars_fetch_sem` semaphore no longer acquired per-symbol (batch RPC eliminates per-symbol serialization); but `fetch_failed` tracking preserved — a batch transport failure marks ALL symbols failed.
- Symbols omitted from BatchGetBars response get empty `[]` (no crash).
- Benchmark bars fetch section (lines 4160+) unchanged — still uses per-symbol `_fetch_bars_paged` via `_fetch_benchmark_into`.
- TDD: N/A (paired test step is Step 11).
- Verification: ruff check + ruff format + ast.parse — all pass.

## Session 2026-09-09 — sdd-execute Steps 11–13 (sequential mode, continued)

### Step 11 — Analysis Python tests (AC-6, AC-7, AC-8, AC-9)
- Created `tests/test_opportunities_latency.py` with 4 AC tests: concurrent Phase 0 drains (AC-6), BatchGetBars for Phase 1 (AC-7), batch enrichment RPCs (AC-8), TTL ≥15s (AC-9).
- Fixed 10 pre-existing test failures in `test_analysis_servicer.py` caused by Steps 8–10's batch RPC changes:
  - `test_intra_compute_bars_fetch_bounded` → asserts BatchGetBars used instead of per-symbol peak-concurrency.
  - `test_cross_user_concurrency_bounded_by_semaphore` → renamed to `test_cross_user_concurrency_uses_batch_per_user`; asserts 6 users × BatchGetBars; drains background recomputes.
  - `test_bars_fetch_deduped_at_documented_worst_case_scale` → M00 (muted symbol) now included in batch request (mute resolved post-evaluation); changed from exact-set to superset assertion.
  - 7 additional tests updated in prior session segment (batch mock wiring, enrichment mock updates).
- Ruff lint clean (9 violations fixed: unused imports, long lines, unused variables). Format clean.
- All 744 tests pass. TDD: red-green verified.

### Step 12 — UI BFF deadline plumbing
- Widened `forward()` in `bffShared.ts` to accept `options.timeoutMs` (optional), threaded into the Connect-es `CallOptions` passed to the backend client method.
- `insightsBff.ts` `listOpportunities` now passes `{ timeoutMs: 30_000 }` — 30s BFF-side deadline.
- All other `forward()` callers unaffected (timeoutMs defaults undefined).
- Build and lint pass. TDD: paired with Step 13.

### Step 13 — BFF deadline tests (AC-1)
- Created `src/lib/__tests__/insightsBff.test.ts` with 3 tests: timeoutMs threading, no-timeout non-breaking, identity headers alongside timeout.
- Mocks `verifyAccessToken` to avoid real JWT verification.
- Uses canonical `HEADER_*` imports (DRY guard rail compliance).
- All 3 tests pass, lint clean. TDD: red-green verified.

### Status
- All 13 steps complete. Status: `in-progress` → `code-completed`.
- Ready for acceptance-scenario promotion (C-16) and integration PR.
