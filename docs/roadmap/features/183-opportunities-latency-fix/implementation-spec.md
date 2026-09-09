# Implementation Spec: opportunities-latency-fix

**Status**: `pending`
**Created**: 2026-09-09
**Feature**: `docs/roadmap/features/183-opportunities-latency-fix/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/opportunities-latency-fix`

---

## Execution Summary

The 13 steps follow the design.md's 8-step additive approach, expanded with paired test steps
(C-08) and separated proto-gen. Steps 1–2 add proto messages and RPCs (additive, non-breaking)
and run codegen. Steps 3–6 implement and test the two new batch RPC handlers in
`xstockstrat-marketdata` (Go). Steps 7–11 modify `xstockstrat-analysis` (Python): parallelize
Phase 0 drains, replace per-symbol RPC fan-out with batch calls in Phase 1 and enrichment,
raise the TTL default, and test all four changes together. Steps 12–13 add the BFF-side gRPC
deadline in `xstockstrat-ui` (Next.js) and test it. The consumer surface (`/insights` segment)
is reached by Step 12 (C-14). Every `@AC-*` scenario is covered by at least one test step (C-15).

## Scenario Coverage

- `@AC-1` → Step 13
- `@AC-2` → Step 4
- `@AC-3` → Step 4
- `@AC-4` → Step 6
- `@AC-5` → Step 6
- `@AC-6` → Step 11
- `@AC-7` → Step 11
- `@AC-8` → Step 11
- `@AC-9` → Step 11

## Step Dependencies

- Step 2 requires Step 1: codegen consumes the new `.proto` definitions
- Step 3 requires Step 2: Go handler imports generated `pb` types
- Step 4 requires Step 3: tests exercise the new BatchGetBars handler
- Step 5 requires Step 2: Go handler imports generated `pb` types
- Step 6 requires Step 5: tests exercise the new BatchGetLatestPrice handler
- Step 7 requires Step 2: Python stubs for batch RPCs imported (though Step 7 itself uses only existing RPCs — `asyncio.gather` parallelization is independent, but co-deploying requires the generated stubs to exist)
- Step 8 requires Steps 3, 7: Phase 1 calls `BatchGetBars`, which must exist, and Phase 0 is refactored first
- Step 9 requires Steps 3, 5, 7: enrichment calls both `BatchGetBars` and `BatchGetLatestPrice`
- Step 10 requires Step 9: TTL raise is meaningful only after batch enrichment reduces response time
- Step 11 requires Steps 7–10: tests cover all four analysis changes
- Step 12 requires Step 2: BFF imports generated analysis client (no new imports, but proto must be up to date)
- Step 13 requires Step 12: tests exercise the BFF deadline plumbing

---

### Step 1 — proto: BatchGetBars and BatchGetLatestPrice definitions

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, buf lint/buf breaking; xstockstrat-marketdata owner — OHLCV ingestion integrity; xstockstrat-analysis owner — backtest reproducibility

**Codebase Evidence**:
- Confirmed via recon: `marketdata.proto` service block ends at line 49; last message ends at line 239
- Existing batch RPC template: `GetLatestQuotes` at line 48, `GetLatestQuotesRequest` at line 233
- Existing `LatestPrice` message at lines 82–88 (reused by `BatchGetLatestPriceResponse`)
- Existing `Bar` message and `GetBarsRequest` fields (symbol, timeframe, start, end) at lines 103–110

**TDD**: `N/A (proto — non-code-bearing)`

**Covers**: —

**Instructions**:

1. In `packages/proto/marketdata/v1/marketdata.proto`, add two new RPCs inside the `MarketDataService` block (before the closing brace at line 49):
   ```
   rpc BatchGetBars(BatchGetBarsRequest) returns (BatchGetBarsResponse) {}
   rpc BatchGetLatestPrice(BatchGetLatestPriceRequest) returns (BatchGetLatestPriceResponse) {}
   ```

2. After the last message (line 239), add five new messages:
   ```protobuf
   message BatchGetBarsRequest {
     repeated string symbols = 1;
     string timeframe = 2;
     google.protobuf.Timestamp start = 3;
     google.protobuf.Timestamp end = 4;
     int32 max_bars_per_symbol = 5;
   }

   message SymbolBars {
     string symbol = 1;
     repeated Bar bars = 2;
   }

   message BatchGetBarsResponse {
     repeated SymbolBars results = 1;
   }

   message BatchGetLatestPriceRequest {
     repeated string symbols = 1;
   }

   message BatchGetLatestPriceResponse {
     repeated LatestPrice results = 1;
   }
   ```

3. All changes are additive — no field removal, no type change, no renumbering. The existing `LatestPrice` message (lines 82–88) is reused directly in `BatchGetLatestPriceResponse`.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against '.git#branch=main-dev'
```
Confirm both pass with exit code 0.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/marketdata/v1/*.go` — modify (generated)
- `packages/proto/gen/python/marketdata/v1/*_pb2*.py` — modify (generated)
- `packages/proto/gen/ts/src/marketdata/v1/*` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, buf lint/buf breaking; xstockstrat-marketdata owner — OHLCV ingestion integrity; xstockstrat-analysis owner — backtest reproducibility

**Codebase Evidence**:
- Confirmed via recon: codegen script at `./scripts/buf-gen.sh`
- Generated output directories: `packages/proto/gen/{go,python,ts}/`

**TDD**: `N/A (proto-gen — non-code-bearing)`

**Covers**: —

**Instructions**:

1. Run `./scripts/buf-gen.sh` from the repo root.
2. Verify the generated stubs compile: `cd packages/proto/gen/ts && pnpm run build`.

**Verification**:
```bash
./scripts/buf-gen.sh
cd packages/proto/gen/ts && pnpm run build
```
Confirm both succeed with exit code 0. Confirm `git diff --stat packages/proto/gen/` shows changes to Go, Python, and TS stubs for the marketdata/v1 package (new `BatchGetBars*`, `BatchGetLatestPrice*`, `SymbolBars` types).

---

### Step 3 — service: Marketdata Go — BatchGetBars handler/service/repo

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Batch SQL template: `GetLatestQuotesBatch` at `marketdata_repo.go:311` uses `WHERE symbol = ANY($1)`
- Single-symbol `QueryBars` at `marketdata_repo.go:85`: `WHERE symbol=$1 AND timeframe=$2`
- Existing index: `(symbol, time DESC)` at migration `001:31-32`
- Service warm/cold pattern: `GetLatestQuotes` at `marketdata_service.go:442` (warm DB → cold singleflight → `MultiSymbolSource.GetBarsMulti`)
- `GetBarsMulti` already implemented in Alpaca at `alpaca/client.go:300`, interface at `source.go:24`
- Handler 3-method pattern: Connect handler at `marketdata_handler.go:194`, `GRPCHandler()` at `:214`, adapter method at `:337`
- Repo cap at `marketdata_repo.go:86` (LIMIT used by single-symbol `QueryBars`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. **Repo** — Add `QueryBarsBatch` method to the repo (file: `marketdata_repo.go`). Use a LATERAL JOIN query:
   ```sql
   SELECT b.* FROM unnest($1::text[]) AS s(sym)
   CROSS JOIN LATERAL (
     SELECT * FROM bars
     WHERE symbol = s.sym AND timeframe = $2 AND time >= $3 AND time < $4
     ORDER BY time ASC LIMIT $5
   ) b
   ```
   Accept parameters: `symbols []string`, `timeframe string`, `start time.Time`, `end time.Time`, `maxBarsPerSymbol int32`. Clamp `maxBarsPerSymbol` to `[1, 5000]` server-side (consistent with the existing cap pattern at `marketdata_repo.go:86`). Return results grouped by symbol into a `map[string][]Bar` (or equivalent struct). Enforce `timeframe = "1d"` (or `"1Day"`) only — return `InvalidArgument` for other timeframes (design decision: avoids combinatorial lock-budget risk; only consumer is analysis Phase 1 using daily bars).

2. **Service** — Add `BatchGetBars` method to the service (file: `marketdata_service.go`). Follow the warm-DB → cold-singleflight → `MultiSymbolSource.GetBarsMulti` pattern from `GetLatestQuotes` at `:442`:
   - Warm path: call `QueryBarsBatch` on the repo.
   - Cold path (symbols with no DB bars): group into a singleflight call keyed by `batch:{sorted_symbols}:{timeframe}:{start}:{end}`, calling `MultiSymbolSource.GetBarsMulti` (already wired at `source.go:24`, Alpaca impl at `alpaca/client.go:300`).
   - Merge warm + cold results into the response.

3. **Handler + gRPC adapter** — Replicate the 3-method pattern from `GetLatestQuotes` (Connect handler at `marketdata_handler.go:194`, adapter at `:337`):
   - Add `BatchGetBars` Connect handler method on `MarketDataHandler`.
   - Add `BatchGetBars` method on `grpcMarketDataAdapter` (wraps Connect handler, converts errors via `toGRPCError` at `:353`).
   - The `GRPCHandler()` at `:214` already returns the adapter (which embeds `UnimplementedMarketDataServiceServer` at `:220`), so the new method is automatically available.

4. **Lock budget note** (design § Step 2): TimescaleDB partitions by time (30-day chunks), not by symbol. The LATERAL JOIN over N symbols touching the same time range locks ~14 chunks for a 400-day range, regardless of N. This stays within `max_locks_per_transaction = 1024`. Preserves `@AC-1 @regression @feature-153`.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
```
Confirm the service compiles without errors.

---

### Step 4 — test: BatchGetBars

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning

**Codebase Evidence**:
- Existing test file: `internal/service/marketdata_service_test.go` (service-level unit tests with mocked repo/source)
- Test pattern: mock `Repository` and `MultiSymbolSource` interfaces, call service methods directly

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3`

**Instructions**:

1. Add `TestBatchGetBars_MultipleSymbols` — mock repo `QueryBarsBatch` to return bars for "AAPL", "MSFT", "GOOG". Call `BatchGetBars` with all three symbols. Assert response contains a `SymbolBars` entry for each symbol with the correct bars. Covers `@AC-2`.

2. Add `TestBatchGetBars_OmitMissingSymbols` — mock repo `QueryBarsBatch` to return bars for "AAPL" only (none for "ZZZZ"). Call `BatchGetBars` with ["AAPL", "ZZZZ"]. Assert response contains only "AAPL" entry, no "ZZZZ" entry. Covers `@AC-3` (omit-not-fabricate).

3. Add `TestBatchGetBars_RejectsNonDailyTimeframe` — call `BatchGetBars` with `timeframe = "1h"`. Assert `InvalidArgument` error is returned.

4. Add `TestBatchGetBars_ClampsMaxBarsPerSymbol` — call with `maxBarsPerSymbol = 10000`. Assert the repo receives a clamped value of `5000`.

5. Test data is single-consumer (only these tests use it) — inline literals are compliant per C-13.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... -run "TestBatchGetBars" -race -count=1 -v -coverprofile=cover.out && go tool cover -func=cover.out | grep total | awk '{print $3}' | sed 's/%//' | xargs -I{} sh -c '[ $(echo "{} >= 40" | bc) -eq 1 ] && echo "Coverage OK: {}%" || (echo "Coverage FAIL: {}% < 40%" && exit 1)'
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm all `TestBatchGetBars*` tests pass, coverage ≥40% (C-08), and lint passes.

---

### Step 5 — service: Marketdata Go — BatchGetLatestPrice handler/service/repo

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/source/source.go` — modify
- `services/xstockstrat-marketdata/internal/alpaca/client.go` — modify
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Single-symbol `GetPreviousDailyClose` at `marketdata_repo.go:192`
- Batch template: `GetLatestQuotesBatch` at `marketdata_repo.go:311` (`WHERE symbol = ANY($1)`)
- `MultiSymbolSource` interface at `source.go:22-27`: defines `GetBarsMulti` + `GetLatestQuotesMulti` but NOT `GetLatestTradesMulti`
- `LatestTradeSource` interface at `source.go:29-32`: single-symbol `GetLatestTrade` only
- `GetLatestPrice` service method at `marketdata_service.go:520`: calls Alpaca `GetLatestTrade` + repo `GetPreviousDailyClose`
- Alpaca `GetLatestQuotesMulti` at `alpaca/client.go:362` (multi-symbol template to follow)
- Handler 3-method pattern same as Step 3

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. **Source interface** — Add `GetLatestTradesMulti(ctx, symbols []string) (map[string]*Trade, error)` method to the `MultiSymbolSource` interface at `source.go:24-27`. This extends the existing interface that already has `GetBarsMulti` and `GetLatestQuotesMulti`.

2. **Alpaca implementation** — Add `GetLatestTradesMulti` to the Alpaca client (file: `alpaca/client.go`), following the pattern of `GetLatestQuotesMulti` at `:362`. Use the Alpaca multi-symbol latest-trades endpoint. If the endpoint does not exist or the Alpaca SDK does not support it, implement a batched concurrent approach using `GetLatestTrade` per symbol with bounded concurrency (consistent with the design's type-assert fallback decision).

3. **Repo** — Add `GetPreviousDailyCloseBatch` method to the repo (file: `marketdata_repo.go`). Use ROW_NUMBER for the batch query:
   ```sql
   WITH ranked AS (
     SELECT symbol, time, close,
       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY time DESC) AS rn
     FROM bars
     WHERE symbol = ANY($1) AND timeframe = '1d' AND time < $2
   )
   SELECT symbol, time, close FROM ranked WHERE rn = 1
   ```
   Follow the `GetLatestQuotesBatch` at `:311` pattern.

4. **Service** — Add `BatchGetLatestPrice` method to the service (file: `marketdata_service.go`). For each symbol in the request:
   - Live price: type-assert the source as `MultiSymbolSource` at runtime. If it implements `GetLatestTradesMulti`, use the batch call. If not, fall back to per-symbol `GetLatestTrade` (from `LatestTradeSource` at `source.go:29-32`). This preserves non-Alpaca source compatibility (design decision).
   - Prev close: call `GetPreviousDailyCloseBatch` on the repo.
   - Singleflight keyed by `batch-price:{sorted_symbols}`.
   - **Omit-not-fabricate** (AC-11, feature 095): symbols missing from Alpaca or DB are omitted from the response — never zero-filled.

5. **Handler + gRPC adapter** — Same 3-method pattern as Step 3: add `BatchGetLatestPrice` Connect handler + adapter method.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
```
Confirm the service compiles without errors.

---

### Step 6 — test: BatchGetLatestPrice

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- Same test file and patterns as Step 4
- Existing tests for `GetLatestPrice` can serve as template

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5`

**Instructions**:

1. Add `TestBatchGetLatestPrice_MultipleSymbols` — mock Alpaca source (implementing `MultiSymbolSource`) to return trades for "AAPL" at $185.50 and "MSFT" at $420.10. Mock repo `GetPreviousDailyCloseBatch` to return prev close values. Call `BatchGetLatestPrice` with ["AAPL", "MSFT"]. Assert response contains `LatestPrice` entries for both with correct `last_price` values. Covers `@AC-4`.

2. Add `TestBatchGetLatestPrice_OmitMissingSymbols` — mock Alpaca source to return a trade for "AAPL" only (not "ZZZZ"). Call `BatchGetLatestPrice` with ["AAPL", "ZZZZ"]. Assert response contains only "AAPL" entry. Covers `@AC-5` (omit-not-fabricate).

3. Add `TestBatchGetLatestPrice_FallbackWhenNotMultiSymbolSource` — use a mock source that implements only `LatestTradeSource` (not `MultiSymbolSource`). Call `BatchGetLatestPrice` with ["AAPL"]. Assert it falls back to per-symbol `GetLatestTrade` and succeeds.

4. Test data is single-consumer — inline literals are compliant per C-13.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... -run "TestBatchGetLatestPrice" -race -count=1 -v -coverprofile=cover.out && go tool cover -func=cover.out | grep total | awk '{print $3}' | sed 's/%//' | xargs -I{} sh -c '[ $(echo "{} >= 40" | bc) -eq 1 ] && echo "Coverage OK: {}%" || (echo "Coverage FAIL: {}% < 40%" && exit 1)'
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm all `TestBatchGetLatestPrice*` tests pass, coverage ≥40% (C-08), and lint passes.

---

### Step 7 — service: Analysis Python — Phase 0 drain parallelization

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Phase 0 sequential drains at `servicer.py:3557` (`_drain_active_signals`), `:3566` (`_drain_held_symbols`), `:3567` (`_drain_watchlist_bindings`), `:3569` (`_drain_source_weights`)
- `now_utc` captured at `servicer.py:3560` — currently between the first and second drain
- `asyncio.gather` already used elsewhere: Phase 1 at `:3846`, enrichment at `:3480`
- No header-propagation concern: this step modifies internal drain calls within the same service, not outbound gRPC calls to other services

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Replace the four sequential drain calls (at `servicer.py:3557-3569`) with `asyncio.gather`:
   ```python
   signals, held, bindings, weights = await asyncio.gather(
       self._drain_active_signals(...),
       self._drain_held_symbols(...),
       self._drain_watchlist_bindings(...),
       self._drain_source_weights(...),
   )
   ```
   Pass the same arguments each drain currently receives.

2. Move `now_utc = datetime.now(tz=timezone.utc)` to **after** the `asyncio.gather` call (design decision: prevents timestamp staleness equal to the duration of the slowest drain). Currently at `:3560`, it must come after the gather returns.

3. Preserve all variable names and downstream usage — only the execution model (sequential → concurrent) and the `now_utc` capture point change.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && python -c "import ast; ast.parse(open('app/handlers/servicer.py').read()); print('syntax ok')"
```
Confirm lint passes and the file is syntactically valid.

---

### Step 8 — service: Analysis Python — Phase 1 batch bars

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Phase 1 `_fetch_into` at `servicer.py:3837-3843`: acquires `_bars_fetch_sem` per symbol, calls single-symbol `GetBars`
- `unique_symbols` dedup via `dict.fromkeys` at `servicer.py:3845`
- `asyncio.gather` over `_fetch_into` at `servicer.py:3846`
- `_BAR_PAGE_SIZE=1000` / `_MAX_BAR_PAGES=32` at `servicer.py:247,251` — NOT used for `max_bars_per_symbol` (design decision: derive from actual date range instead)
- Marketdata channel at `app/main.py:65`: `grpc.aio.insecure_channel(MARKETDATA_ENDPOINT)` — no options, needs 8 MB receive limit
- Header propagation: analysis already has per-method metadata forwarding for its outbound marketdata calls (existing pattern); the new batch RPC call reuses the same channel/stub — no new propagation wiring needed

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. **gRPC receive limit** — In `app/main.py:65`, add channel options to the marketdata channel:
   ```python
   grpc.aio.insecure_channel(
       MARKETDATA_ENDPOINT,
       options=[("grpc.max_receive_message_length", 8 * 1024 * 1024)],
   )
   ```
   This raises the receive limit from the default 4 MB to 8 MB. Worst case: 100 symbols × 400 bars × ~80 bytes ≈ 3.2 MB, well within 8 MB.

2. **Phase 1 replacement** — Replace the per-symbol `_fetch_into` + semaphore loop (at `servicer.py:3837-3846`) with a single `BatchGetBars` call:
   - Collect `unique_symbols` via `dict.fromkeys` (reuse existing dedup at `:3845`).
   - Compute `max_bars_per_symbol` from the actual date range: `(end - start).days` (roughly 252 trading days for a 400-calendar-day lookback). Do NOT use `_BAR_PAGE_SIZE` or `_MAX_BAR_PAGES` (design decision).
   - Call `stub.BatchGetBars(BatchGetBarsRequest(symbols=list(unique_symbols), timeframe="1d", start=start_ts, end=end_ts, max_bars_per_symbol=max_bars))`.
   - Unpack `BatchGetBarsResponse.results` (list of `SymbolBars`) into the same per-symbol data structure the existing code populates.
   - The `_bars_fetch_sem` is no longer acquired in this path — the batch RPC eliminates the per-symbol serialization.

3. Forward `x-user-id`, `x-access-scope`, `x-trace-id` metadata on the new `BatchGetBars` call using the same per-method metadata pattern the existing `GetBars` calls use in this file.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && python -c "import ast; ast.parse(open('app/handlers/servicer.py').read()); print('syntax ok')"
```
Confirm lint passes and the file is syntactically valid.

---

### Step 9 — service: Analysis Python — enrichment batch

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Enrichment sem for `GetLatestPrice` at `servicer.py:3444`
- Enrichment sem for `GetBars` sparkline at `servicer.py:3458`
- `asyncio.gather` over `by_symbol.items()` at `servicer.py:3480`
- AC-11 omit-not-fabricate: existing pattern at enrichment — symbols missing from response are omitted, never zero-filled
- Header propagation: same channel/stub reuse as Step 8 — no new wiring needed

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Replace the per-symbol `GetLatestPrice` + `GetBars` sparkline enrichment loop (at `servicer.py:3444-3480`) with two batch calls:
   - Collect all symbols needing enrichment.
   - Call `stub.BatchGetLatestPrice(BatchGetLatestPriceRequest(symbols=symbol_list))` — one call for all symbols.
   - Call `stub.BatchGetBars(BatchGetBarsRequest(symbols=symbol_list, timeframe="1d", ...))` — one call for sparkline bars.
   - Unpack results into the existing per-symbol enrichment data structure.

2. Wrap both batch calls in `try/except`: on transport error (e.g. `grpc.RpcError`), fall back to the existing per-symbol enrichment loop. This preserves `@AC-11` (omit-not-fabricate) partial-availability guarantee (design § Step 6).

3. The `_bars_fetch_sem` is no longer acquired per-symbol in the enrichment path — the batch RPCs eliminate the 2× semaphore acquisitions per symbol.

4. Forward metadata (`x-user-id`, `x-access-scope`, `x-trace-id`) on both new batch calls using the existing per-method metadata pattern.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && python -c "import ast; ast.parse(open('app/handlers/servicer.py').read()); print('syntax ok')"
```
Confirm lint passes and the file is syntactically valid.

---

### Step 10 — config: Analysis Python — TTL raise

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- `live_enrich_ttl_seconds` default at `servicer.py:3411`: `get_int_present("analysis.opportunity.live_enrich_ttl_seconds", 10)`
- Browser polls every 15s: `refetchInterval: 15_000` at `useOpportunities.ts:16-21`
- React Query v5 counts `refetchInterval` from query completion, not start
- C-16 CHANGE sign-off for `@AC-5 @FR-4 @feature-177` recorded in context.md

**TDD**: `N/A (config — non-code-bearing default change)`

**Covers**: —

**Instructions**:

1. Change the default value in the `get_int_present` call at `servicer.py:3411` from `10` to `20`:
   ```python
   get_int_present("analysis.opportunity.live_enrich_ttl_seconds", 20)
   ```
   This is a code-default change only — no migration needed. Operators can still override via `SetConfig`. The value 20s (not 15s) provides margin: React Query v5 counts `refetchInterval` from completion, so effective poll interval is `15s + response_time (~2-5s)` ≈ 17-20s. TTL of 20s ensures a warm re-read within one poll interval does not re-fetch.

2. This is a **CHANGE** to `@AC-5 @FR-4 @feature-177` (design § Step 7, C-16 sign-off in context.md): guarantee shape preserved, only threshold changes.

**Verification**:
```bash
grep -n "live_enrich_ttl_seconds" services/xstockstrat-analysis/app/handlers/servicer.py
```
Confirm the default is `20`.

---

### Step 11 — test: Analysis changes (Phase 0, Phase 1, enrichment, TTL)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_servicer.py` — modify (or create test file if not existing)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Existing test infrastructure in `services/xstockstrat-analysis/tests/`
- `asyncio.gather` call structure testable by mocking drain functions and asserting concurrent execution
- Batch RPC calls testable by mocking the marketdata stub
- TTL default testable by checking `get_int_present` default or memo expiry behavior

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7, AC-8, AC-9`

**Instructions**:

1. **`test_phase0_drains_concurrent`** — Mock the four drain methods to record call timestamps (or use `asyncio.gather` detection). Invoke `_compute_opportunities`. Assert all four drains were dispatched concurrently (not sequentially). Assert `now_utc` is captured after all drains complete. Covers `@AC-6`.

2. **`test_phase1_uses_batch_get_bars`** — Mock the marketdata stub. Invoke the Phase 1 bars fetch path with 50 symbols. Assert `BatchGetBars` was called (not per-symbol `GetBars`). Assert all 50 symbols were included in the batch request. Covers `@AC-7`.

3. **`test_enrichment_uses_batch_rpcs`** — Mock the marketdata stub. Invoke `_enrich_opportunities_live` with 30 symbols. Assert `BatchGetLatestPrice` was called once with all 30 symbols. Assert `BatchGetBars` was called once for sparkline bars. Assert `_bars_fetch_sem` was not acquired per-symbol. Covers `@AC-8`.

4. **`test_memo_ttl_default_exceeds_poll_interval`** — Assert the default value of `live_enrich_ttl_seconds` is >= 15 (the browser poll interval). Optionally: mock time, invoke enrichment twice 15s apart, assert the second call does not re-fetch from marketdata. Covers `@AC-9`.

5. Test data is single-consumer — inline literals are compliant per C-13.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest tests/ -k "test_phase0_drains_concurrent or test_phase1_uses_batch_get_bars or test_enrichment_uses_batch_rpcs or test_memo_ttl_default_exceeds_poll_interval" -v --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Confirm all four tests pass, coverage ≥40% (C-08), and lint passes.

---

### Step 12 — service: UI BFF — deadline plumbing

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/bffShared.ts` — modify
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify

**Reviewers**: xstockstrat-ui owner — Connect-RPC call safety, analytics display accuracy

**Codebase Evidence**:
- `forward()` at `bffShared.ts:60-68`: type is `(req: Req, opts: { headers: Headers }) => Promise<Res>` — needs widening to accept `timeoutMs`
- Currently passes only `{ headers: backendHeaders(claims, ctx) }` at `:67`
- `listOpportunities` at `insightsBff.ts:54`: `forward((req, opts) => analysisClient.listOpportunities(req, opts))`
- No existing per-call timeout pattern: zero matches for `timeoutMs`, `deadline`, `AbortSignal`, `CallOptions` across UI codebase
- `connectClients.ts:64` already handles `DeadlineExceeded` status code
- Consumer surface: `/insights` segment (C-14) — this step delivers the deadline to the end-user-reachable surface

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. **Add `forwardOpts` parameter to `forward()`** — In `bffShared.ts`, add an optional second parameter to `forward()` for caller-specified call options:
   ```typescript
   // forward() currently: (fn: (req, opts: { headers: Headers }) => Promise<Res>) => ...
   // Add second param:    forwardOpts?: { timeoutMs?: number }
   ```
   Inside `forward()`, merge `forwardOpts` into the opts object passed to `fn`. The current call at `:67` passes `{ headers: backendHeaders(claims, ctx) }` — extend it to:
   ```typescript
   const callOpts = { headers: backendHeaders(claims, ctx), ...forwardOpts };
   const result = await fn(req, callOpts);
   ```
   This threads `timeoutMs` from `forward()`'s call site into the Connect-es `CallOptions` that the callback's `opts` parameter carries to the client method. Connect-es per-call `CallOptions.timeoutMs` emits `DeadlineExceeded` status code (NOT a transport-level `defaultTimeoutMs`, which does not exist).

2. **Add deadline to `listOpportunities`** — In `insightsBff.ts:54`, pass `{ timeoutMs: 30_000 }` as `forward()`'s second argument:
   ```typescript
   forward((req, opts) => analysisClient.listOpportunities(req, opts), { timeoutMs: 30_000 })
   ```
   The `timeoutMs` flows: call site → `forwardOpts` → merged into `callOpts` → passed as `opts` to the callback → Connect-es client receives `timeoutMs` in its `CallOptions`.

3. No other `forward()` callers are affected — `timeoutMs` is optional and defaults to undefined (no timeout), preserving existing behavior for all other BFF handlers.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run build
cd services/xstockstrat-ui && pnpm run lint
```
Confirm build and lint pass.

---

### Step 13 — test: BFF deadline

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/__tests__/insightsBff.test.ts` — create

**Reviewers**: xstockstrat-ui owner — Connect-RPC call safety

**Codebase Evidence**:
- Vitest unit tests live in `src/**/*.test.ts` (node environment), coverage scoped to `src/lib/**`
- `connectClients.ts:64` already handles `DeadlineExceeded` — confirm the timeout emits this status
- No existing test file for `insightsBff.ts`; the test creates a new file per the Vitest convention

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:

1. Add `test_bff_listOpportunities_timeout` — Mock the analysis client's `listOpportunities` to delay longer than 30s (or assert the call options include `timeoutMs: 30000`). Assert the forward call passes `timeoutMs: 30000` to the Connect-es client. Covers `@AC-1`.

2. Add `test_bff_forward_without_timeout` — Call a different BFF handler (not `listOpportunities`) that does not set `timeoutMs`. Assert no `timeoutMs` is passed (undefined/absent). Confirms the change is non-breaking for other handlers.

3. Test-data inventory (C-12): these tests mock the Connect-es client transport, not domain data. No fixture inventory update needed — mock setup is a scenario one-off (exempt per step-constraints.md).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm vitest run src/lib/__tests__/insightsBff.test.ts
cd services/xstockstrat-ui && pnpm run lint
```
Confirm tests pass and lint passes.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
