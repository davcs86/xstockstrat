# Implementation Spec: backfill-backtest-coverage

**Status**: `in-progress`
**Created**: 2026-06-09
**Feature**: `docs/roadmap/features/053-backfill-backtest-coverage/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/backfill-backtest-coverage`

---

## Execution Summary

This feature closes the backfill↔backtest loop in four threads. First, the proto contracts are
extended additively (Steps 1–2): a `GetDataCoverage` RPC + messages on `marketdata/v1`, a
structured `coverage_gap` + status enum on `analysis/v1`'s `BacktestResult`, and a shared
`Timeframe` enum in `common/v1` plus **deprecated** `timeframe` string fields kept alongside (the
breaking-removal step is deferred to a future release per the deprecation cycle). Then marketdata
gains a normalization + coverage primitive and serves `GetDataCoverage` (Steps 3–6). Analysis
replaces its silent flat-equity no-op with a structured insufficient-data result and fixes the
`"1Day"`/`"1d"` vocabulary mismatch via the normalizer (Steps 7–8). Finally the UI surfaces the
gap message and a "backfill this range" action that calls the existing `TriggerBackfill` RPC
through the BFF chain (Steps 9–11), and a docs step records the timeframe vocabulary + deprecation
(Step 12).

The timeframe normalization is the load-bearing correctness fix: today `services/xstockstrat-analysis/app/handlers/servicer.py:271,292,302,474` query `GetBars` with `timeframe="1Day"`, while the backfill path (`TriggerBackfill`/`BackfillBars`) and `ingest.backfill.default_timeframe` use `"1d"`. The DB stores the literal string in `marketdata.ohlcv.timeframe`, so the two never match — proven by Acceptance Criterion 3.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto` files.
- Step 3 (marketdata normalizer) requires Step 2: needs regenerated `common/v1` Go stubs for the `Timeframe` enum.
- Step 4 (marketdata coverage repo query) requires Step 2.
- Step 5 (marketdata service+handler wiring of `GetDataCoverage`) requires Steps 3 + 4.
- Step 6 [test] covers Steps 3–5 [service] (marketdata).
- Step 7 (analysis structured insufficient-data + timeframe fix) requires Step 2 (regenerated Python `analysis`/`common`/`marketdata` stubs).
- Step 8 [test] covers Step 7 [service] (analysis).
- Step 9 (UI BFF `triggerBackfill` + browser client) requires Step 2 (regenerated TS stubs for the new analysis fields).
- Step 10 (UI backtest view gap message + action) requires Steps 7 + 9.
- Step 11 [test] covers Steps 9–10 [service] (UI, Playwright E2E).
- Step 12 (docs) requires Step 1 (final enum/field names).

---

### Step 1 — proto: Add `GetDataCoverage` RPC, structured insufficient-data fields, and shared `Timeframe` enum

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify (add `Timeframe` enum)
- `packages/proto/marketdata/v1/marketdata.proto` — modify (add `GetDataCoverage` RPC + messages; deprecate string `timeframe` fields, add `Timeframe` enum field)
- `packages/proto/analysis/v1/analysis.proto` — modify (add `BacktestStatus` enum + `CoverageGap` message + fields on `BacktestResult`)
- `packages/proto/ingest/v1/ingest.proto` — modify (deprecate string `timeframe` fields, add `Timeframe` enum field on `TriggerBackfillRequest` and `BackfillJob`)

**Reviewers**: Proto Reviewer — field number uniqueness, breaking-change deprecation path for the `Timeframe` migration, `buf lint`/`buf breaking` pass; Platform Lead — required breaking proto change (cross-service `Timeframe` migration + deprecation cycle, contract consistency across marketdata + analysis); `xstockstrat-marketdata` (service owner) — coverage query contract correctness; `xstockstrat-analysis` (service owner) — insufficient-data surfaced without faking equity

**Codebase Evidence**:
- `common/v1` already follows the enum pattern with a `_UNSPECIFIED = 0` sentinel: `packages/proto/common/v1/common.proto:49-53` (`TradingMode`) and `:57-61` (`Environment`). New `Timeframe` enum mirrors this.
- `marketdata/v1` string timeframe fields confirmed at `packages/proto/marketdata/v1/marketdata.proto:42` (`Bar.timeframe`), `:58` (`StreamBarsRequest.timeframe`), `:69` (`GetBarsRequest.timeframe`), `:85` (`BackfillBarsRequest.timeframe`). Highest field number in `GetBarsRequest` is 4; in `BackfillBarsRequest` is 4; in `Bar` is 11.
- `GetBarsResponse`/`GetBarsRequest` use `xstockstrat.common.v1.TimeRange range` (`:70`, `:86`) and `PageRequest`/`PageResponse` (`:71`, `:76`) — reuse `TimeRange` for the coverage request/gap.
- `analysis/v1` `BacktestResult` highest field number is 11 (`trades`): `packages/proto/analysis/v1/analysis.proto:45`. New fields start at 12. Existing enum precedent with `_UNSPECIFIED = 0` at `:92-96` (`ComponentKind`).
- `ingest/v1` string `timeframe` confirmed at `packages/proto/ingest/v1/ingest.proto:27` (`BackfillJob.timeframe`). **Re-spec (sequential stack on 052):** `BackfillJob`'s highest field is now **11** — feature 052 (`durable-observable-backfills`, this stack's base) added `failed_symbols = 11`. So `timeframe_enum` here must use **12**, not 11 (matches `merge-order.md`). `TriggerBackfillRequest.timeframe` at `:48` (highest field 4) is unaffected by 052.
- `buf-gen.sh` runs `buf lint`, `buf breaking --against "$REPO_ROOT/.git#branch=$AGAINST_BRANCH,subdir=packages/proto"`, then `buf generate`: `scripts/buf-gen.sh:34-48`.

**Instructions**:
1. In `common/v1/common.proto`, add after the `BrokerType` enum (after `:68`):
   ```proto
   // Timeframe is the canonical OHLCV bar interval, shared by marketdata + analysis + ingest.
   // Replaces the free-text "1d"/"1Day"/"1m" strings that previously mismatched across services.
   enum Timeframe {
     TIMEFRAME_UNSPECIFIED = 0;
     TIMEFRAME_1MIN = 1;
     TIMEFRAME_5MIN = 2;
     TIMEFRAME_1HOUR = 3;
     TIMEFRAME_1DAY = 4;
   }
   ```
   (Field/value set is closed and deployment-time-defined → enum per root CLAUDE.md "prefer enums" governance. Mandatory `TIMEFRAME_UNSPECIFIED = 0` sentinel included.)
2. In `marketdata/v1/marketdata.proto`:
   - Add the RPC to `service MarketDataService` (after `BackfillBars` at `:26`):
     `rpc GetDataCoverage(GetDataCoverageRequest) returns (GetDataCoverageResponse);`
   - Add the new messages (additive → non-breaking):
     ```proto
     message GetDataCoverageRequest {
       string symbol = 1;
       xstockstrat.common.v1.Timeframe timeframe = 2;
       // Optional: restrict the coverage scan to this window. Empty = full history.
       xstockstrat.common.v1.TimeRange range = 3;
     }

     message CoverageRange {
       google.protobuf.Timestamp start = 1;
       google.protobuf.Timestamp end = 2;
       int64 bar_count = 3;
     }

     message GetDataCoverageResponse {
       string symbol = 1;
       xstockstrat.common.v1.Timeframe timeframe = 2;
       int64 bars_total = 3;
       // Covered earliest/latest with total bar count; covered_ranges holds contiguous segments,
       // gaps holds the missing segments within the requested range (if range was supplied).
       google.protobuf.Timestamp earliest = 4;
       google.protobuf.Timestamp latest = 5;
       repeated CoverageRange covered_ranges = 6;
       repeated xstockstrat.common.v1.TimeRange gaps = 7;
     }
     ```
   - Add a deprecated-string + new-enum pair (additive, one-release deprecation cycle per `docs/runbooks/proto-versioning.md`). Do **not** remove the string fields in this feature. On `GetBarsRequest` (highest field 4 → use 5), `BackfillBarsRequest` (highest field 4 → use 5), `StreamBarsRequest` (highest field 4 → use 5), and `Bar` (highest field 11 → use 12):
     ```proto
     // DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     string timeframe = 2 [deprecated = true];        // existing field, mark deprecated (keep number)
     xstockstrat.common.v1.Timeframe timeframe_enum = N;  // new field, next free number
     ```
     (Renaming/retyping the existing `timeframe` field would be breaking; adding `timeframe_enum` and only marking the old field `deprecated = true` is non-breaking. `buf breaking` passes this step; the eventual removal is the gated breaking step in a later release.)
3. In `analysis/v1/analysis.proto`, add an enum + message and extend `BacktestResult` (next free field is 12):
   ```proto
   enum BacktestStatus {
     BACKTEST_STATUS_UNSPECIFIED = 0;
     BACKTEST_STATUS_OK = 1;
     BACKTEST_STATUS_INSUFFICIENT_DATA = 2;
   }

   message CoverageGap {
     string symbol = 1;
     xstockstrat.common.v1.Timeframe timeframe = 2;
     xstockstrat.common.v1.TimeRange requested_range = 3;
     int64 bars_have = 4;
     int64 bars_need = 5;
     // The range a caller should backfill to satisfy this backtest.
     xstockstrat.common.v1.TimeRange gap = 6;
   }
   ```
   Add to `BacktestResult` (after `trades = 11` at `:45`):
   ```proto
   BacktestStatus status = 12;
   repeated CoverageGap coverage_gaps = 13;  // populated per-symbol when status == INSUFFICIENT_DATA
   ```
   (Soft structured result per Resolved Decision — status + `coverage_gaps`, not a gRPC error.)
4. In `ingest/v1/ingest.proto`, mirror the deprecation pair on `BackfillJob` (**highest field 11 after 052 → use 12**) and `TriggerBackfillRequest` (highest field 4 → use 5): mark the existing `string timeframe` `[deprecated = true]`, add `xstockstrat.common.v1.Timeframe timeframe_enum = N;`.

**Verification**:
- From `packages/proto/`: `buf lint && buf breaking --against "../../.git#branch=feature/backfill-backtest-coverage,subdir=packages/proto"` — both pass (all changes additive; deprecating a field is not a breaking change). Equivalent to the gate in `scripts/buf-gen.sh:34-41`.

---

### Step 2 — proto-gen: Regenerate Go, Python, and TypeScript stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**` — modify (regenerated)
- `packages/proto/gen/python/**` — modify (regenerated)
- `packages/proto/gen/ts/**` (+ compiled `gen/ts/dist/**`) — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness, breaking-change deprecation path for the `Timeframe` migration, `buf lint`/`buf breaking` pass; Platform Lead — required breaking proto change (cross-service `Timeframe` migration + deprecation cycle); `xstockstrat-marketdata` (service owner); `xstockstrat-analysis` (service owner) (inherited from Step 1)

**Codebase Evidence**:
- `scripts/buf-gen.sh` generates TS + Go via `buf generate` (`:48`) and also regenerates Python + compiles the TS package (per root CLAUDE.md "Generating Proto Stubs"). Generated common stubs live at `packages/proto/gen/go/common/v1/common.pb.go`, `gen/python/common/v1/common_pb2.py`, `gen/ts/common/v1/common_pb.ts` (confirmed via `ls`).

**Instructions**:
1. From the repo root, run `./scripts/buf-gen.sh`.
2. Commit the regenerated stubs **together with** the Step 1 proto source in the same step PR (per `docs/runbooks/proto-versioning.md` PR1 convention: "Commit proto source + generated stubs together").
3. Confirm new symbols exist: `Timeframe` enum in `common`, `GetDataCoverage`/`GetDataCoverageRequest`/`GetDataCoverageResponse`/`CoverageRange` in `marketdata`, `BacktestStatus`/`CoverageGap`/`BacktestResult.status`/`coverage_gaps` in `analysis`, `timeframe_enum` on the `ingest` messages.

**Verification**:
- `./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` — exits clean (stubs match protos; this is the `proto-freshness` CI check per `docs/runbooks/proto-versioning.md:82-88`).

---

### Step 3 — service: Add timeframe normalizer package to marketdata

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/timeframe/timeframe.go` — create

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, coverage-query correctness over the `marketdata.ohlcv` hypertable

**Codebase Evidence**:
- **Not found** — no timeframe-normalization helper exists in marketdata today; `internal/service/marketdata_service.go:93` passes `req.Timeframe` (the raw string) straight to `repo.QueryBars`, and `repository/marketdata_repo.go:84` matches it verbatim in `WHERE ... timeframe=$2`. This package must be created from scratch.
- The DB stores literal strings: `migrations/001_marketdata_hypertables.up.sql:11` comments `timeframe TEXT NOT NULL, -- '1m','5m','1h','1d'`. The canonical stored form is therefore `"1m"`, `"5m"`, `"1h"`, `"1d"`.
- Go module path is `github.com/xstockstrat/marketdata` (`go.mod:1`); generated common stubs import as `commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"` (used at `internal/service/marketdata_service.go:15`).
- This package is **not** in the CI coverage-excluded set (`cmd|handler|repository|telemetry|service`) — it will be measured.

**Instructions**:
1. Create `internal/timeframe/timeframe.go` in package `timeframe`. Implement bidirectional mapping between the canonical DB string and `commonv1.Timeframe`:
   - `func ToCanonical(tf commonv1.Timeframe) (string, bool)` → `TIMEFRAME_1MIN→"1m"`, `_5MIN→"5m"`, `_1HOUR→"1h"`, `_1DAY→"1d"`; returns `("", false)` for `TIMEFRAME_UNSPECIFIED` / unknown.
   - `func FromString(s string) commonv1.Timeframe` → accepts **all known aliases** for backward compatibility during the deprecation cycle: `"1m"/"1Min"→1MIN`, `"5m"/"5Min"→5MIN`, `"1h"/"1Hour"→1HOUR`, `"1d"/"1Day"→1DAY`; returns `TIMEFRAME_UNSPECIFIED` otherwise. This is what reconciles the `"1Day"` (analysis) vs `"1d"` (backfill) mismatch.
   - `func Resolve(enum commonv1.Timeframe, legacyStr string) (string, error)` → prefer the enum when set; else fall back to `FromString(legacyStr)`; return the canonical DB string, or an error if neither resolves.
2. Keep this package pure (no DB/gRPC deps) so it is unit-testable and counts toward coverage.

**Verification**:
- Compiles: `cd services/xstockstrat-marketdata && GOWORK=off go build ./internal/timeframe/`.
- Lint (per §5c): `cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/timeframe/...` (full lint runs in Step 6).

---

### Step 4 — service: Add coverage query to marketdata repository

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, coverage-query correctness over the `marketdata.ohlcv` hypertable

**Codebase Evidence**:
- `MarketDataRepo` wraps a `*pgxpool.Pool` (`internal/repository/marketdata_repo.go:15-17`); existing query pattern `QueryBars` at `:69` shows the `WHERE symbol=$1 AND timeframe=$2 AND time >= $3 AND time <= $4` shape against `marketdata.ohlcv`.
- The `marketdata.ohlcv` PRIMARY KEY is `(symbol, timeframe, time)` (`migrations/001_marketdata_hypertables.up.sql:20`), which already supports an efficient `MIN(time)/MAX(time)/COUNT(*)` scan keyed by `(symbol, timeframe)`. **No new index migration is required** (Database Changes box in product-spec confirms this; verified the PK covers the access path).
- This file is in the CI coverage-**excluded** set (`repository/`) — its logic is exercised via integration, not measured coverage (note carried into Step 6).

**Instructions**:
1. Add `func (r *MarketDataRepo) GetCoverage(ctx context.Context, symbol, timeframe string, start, end time.Time) (earliest, latest time.Time, barCount int64, err error)` that runs:
   `SELECT MIN(time), MAX(time), COUNT(*) FROM marketdata.ohlcv WHERE symbol=$1 AND timeframe=$2 AND time >= $3 AND time <= $4` — `timeframe` here is the **canonical** string from Step 3's `Resolve`. Handle the all-NULL (no rows) case (zero `time.Time`, count 0).
2. (Gap detection) Add a helper that, given the requested `[start,end]` and the covered `[earliest,latest]`, computes the missing leading/trailing ranges. Keep the bar-level gap logic minimal for this feature (leading gap `[start, earliest)` and trailing gap `(latest, end]` when count > 0; whole `[start,end]` when count == 0) — finer interior-hole detection is P2 (`resumable-chunked-backfills`, per Out of Scope). Place the pure range-math helper in `internal/timeframe/` (Step 3 package) so it is unit-tested and counted toward coverage, rather than in the excluded `repository/` package.

**Verification**:
- Compiles: `cd services/xstockstrat-marketdata && GOWORK=off go build ./internal/repository/...` (full lint + coverage in Step 6).

---

### Step 5 — service: Wire `GetDataCoverage` through marketdata service + handler

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (only if a server-registration change is needed; see Instructions)

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, coverage-query correctness over the `marketdata.ohlcv` hypertable

**Codebase Evidence**:
- `MarketDataService` methods (`GetBars` at `internal/service/marketdata_service.go:67`) resolve the `TimeRange` from `req.Range` and call `s.repo` — mirror this for the coverage method.
- The handler implements both Connect + gRPC via `grpcMarketDataAdapter`: existing methods `GetBars` adapter at `internal/handler/marketdata_handler.go:142` and the Connect method at `:86`. The Connect interface assertion `var _ marketdatav1connect.MarketDataServiceHandler = (*MarketDataHandler)(nil)` at `:18` will fail to compile until the new `GetDataCoverage` method is added — surfacing any omission at build time.
- The gRPC server is registered via `marketdatav1.RegisterMarketDataServiceServer(grpcServer, hdl.GRPCHandler())` at `cmd/server/main.go:101`; no per-RPC registration is needed (registration is whole-service), so `main.go` likely needs **no** change.
- `GetDataCoverage` is a read-only DB query — it adds **no new outbound gRPC call** to another backend service, so no header-propagation wiring is required (per §5c trigger). The inbound interceptor `middleware.UnaryServerInterceptor` (`cmd/server/main.go:93`) already covers it.

**Instructions**:
1. In `internal/service/marketdata_service.go`, add `func (s *MarketDataService) GetDataCoverage(ctx context.Context, req *marketdatav1.GetDataCoverageRequest) (*marketdatav1.GetDataCoverageResponse, error)`:
   - Resolve the canonical timeframe via `timeframe.Resolve(req.GetTimeframe(), "")` (the request only carries the enum; the legacy-string fallback is for the `GetBars` path in Step 7). Return `InvalidArgument` if unresolved or `req.Symbol == ""`.
   - Resolve `start/end` from `req.Range` (mirror `GetBars` defaulting at `:77-82`: end→now, start→a wide floor; for coverage prefer a far-past floor when range is empty so "full history" is honored).
   - Call `s.repo.GetCoverage(...)`, then compute `gaps` via the Step 3/4 range-math helper. Build the `GetDataCoverageResponse` (`bars_total`, `earliest`, `latest`, `covered_ranges`, `gaps`).
2. In `internal/handler/marketdata_handler.go`:
   - Add the Connect method `func (h *MarketDataHandler) GetDataCoverage(ctx context.Context, req *connect.Request[marketdatav1.GetDataCoverageRequest]) (*connect.Response[marketdatav1.GetDataCoverageResponse], error)` mirroring `GetBars` at `:86-95` (validate `Symbol`, call `h.svc.GetDataCoverage`, wrap errors with `connect.NewError`).
   - Add the gRPC adapter method on `grpcMarketDataAdapter` mirroring `GetBars` at `:142-148` (call the Connect method, `toGRPCError` on failure).
3. Confirm no `main.go` change is needed (whole-service registration at `:101`).

**Verification**:
- Compiles (proves the `MarketDataServiceHandler` interface assertion at `:18` is satisfied): `cd services/xstockstrat-marketdata && GOWORK=off go build ./...` (full lint + coverage in Step 6).

---

### Step 6 — test: marketdata timeframe normalizer + coverage gap logic

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/timeframe/timeframe_test.go` — create

**Reviewers**: `xstockstrat-marketdata` (service owner) — coverage-query correctness over the `marketdata.ohlcv` hypertable

**Codebase Evidence**:
- Test style precedent: `internal/config/config_test.go` (table-driven `func TestXxx(t *testing.T)`, confirmed via `grep "func Test"`).
- The new coverage logic that is **measurable** lives in `internal/timeframe/` (Steps 3 + 4 placed the pure normalizer + range-math there); the service/handler/repository wiring (Steps 4 DB query, 5) sits in CI-excluded packages (`repository/`, `service/`, `handler/`).

**Instructions**:
1. Add table-driven tests for `FromString` covering the load-bearing aliases — especially that `FromString("1Day")` and `FromString("1d")` both map to `TIMEFRAME_1DAY` (this is the bug from the Problem Statement), plus `ToCanonical` round-trips and `Resolve` enum-preferred / legacy-fallback / error cases.
2. Add tests for the gap range-math helper: count==0 → whole `[start,end]` gap; leading gap; trailing gap; fully covered → no gaps.

**Verification**:
- `cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"` — confirm ≥ 40%.
- Lint (§5c): `cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod`.
- Note: the DB coverage query (Step 4) and service/handler wiring (Step 5) are in CI coverage-excluded packages — their correctness is verified via the integration test (`scripts/integration-test.sh`) and the build-time interface assertion, not the coverage threshold. The threshold is met by the `internal/timeframe/` tests.

---

### Step 7 — service: Structured insufficient-data result + timeframe normalization in `RunBacktest`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, no look-ahead bias, correct surfacing of insufficient-data without silently faking equity

**Codebase Evidence**:
- The silent flat-equity no-op is at `app/handlers/servicer.py:277-281` (`_backtest_symbol`: `if len(bars) < slow_period + 2: ... return [], initial_equity, [initial_equity]`) and `:478-480` (`_backtest_symbol_evaluated`: `if len(bars) < 2: ... return [], initial_equity, [initial_equity]`). These return a fabricated flat series with only a `log.warning`.
- `GetBars` is called with `timeframe="1Day"` at `:271` and `:474`; SMA `ComputeIndicator` calls also pass `timeframe="1Day"` at `:292`, `:302`. This is the string that misses backfilled `"1d"` bars.
- `RunBacktest` builds the `BacktestResult` at `:206-218` and returns it at `:244`; per-symbol results are aggregated in the loop at `:163-198`.
- Header propagation is already correct and reused: `propagation_meta` is built at `:101-105` and passed as `metadata=propagation_meta` on the existing `self._marketdata.GetBars` call (`:274`). This step adds **no new outbound gRPC call** — it reuses the already-propagating `GetBars` invocation, so §5c header-propagation is satisfied by reuse (cited).
- `slow_period` defaults to 50 (`:129`); `bars_need` for the legacy SMA path is `slow_period + 2` (matches `:277`).
- Imports already include `from gen.marketdata.v1 import marketdata_pb2` (`:24`) and `from gen.analysis.v1 import analysis_pb2` (`:20`); `from gen.common.v1 import common_pb2` is used in tests (`tests/test_analysis_servicer.py:14`) — add to servicer imports for `common_pb2.Timeframe`.

**Instructions**:
1. **Timeframe fix**: replace the hardcoded `timeframe="1Day"` strings in the `GetBars` calls (`:271`, `:474`) so the call sends the canonical/enum timeframe the backfill path stores. Concretely: send `timeframe="1d"` (the canonical DB string the backfill writes — confirmed in marketdata migration comment and `ingest.backfill.default_timeframe` default `"1d"`) **and** set the new `timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY` field added in Step 1. This guarantees a backfill (`"1d"`) and this backtest now hit the same stored bars (Acceptance Criterion 3). Leave the `ComputeIndicator` `timeframe` argument as a passthrough label (indicators does not query the OHLCV store — verify it is metadata only; if so, normalize it to `"1d"` for consistency).
2. **Structured insufficient-data**: change `_backtest_symbol` and `_backtest_symbol_evaluated` to, instead of returning a fabricated flat series, signal insufficiency to the caller. Return an extra value (or raise a sentinel) carrying `bars_have=len(bars)`, `bars_need` (`slow_period + 2` for the SMA path, `2` for the evaluated path), and the symbol. In `RunBacktest`'s per-symbol loop (`:163-198`), collect these into a list of `analysis_pb2.CoverageGap` (symbol, `timeframe=TIMEFRAME_1DAY`, `requested_range=request.range`, `bars_have`, `bars_need`, and `gap` = the requested range). Do **not** extend `daily_equity` with the fake flat series for an insufficient symbol.
3. When building the result (`:206-218`): if any symbol produced a `CoverageGap` **and** no symbol produced trades/usable bars, set `result.status = analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA` and `result.coverage_gaps.extend(gaps)`; otherwise set `result.status = analysis_pb2.BACKTEST_STATUS_OK` (partial multi-symbol backtests keep OK + still report per-symbol gaps, per the Resolved Decision favoring partial results). Never fabricate flat equity as a "success".
4. Keep emitting the existing `analysis.backtest.completed` ledger event (`:234-242`) unchanged.

**Verification**:
- `grep -n "1Day" services/xstockstrat-analysis/app/handlers/servicer.py` — the `GetBars` timeframe arguments no longer pass `"1Day"` (now `"1d"` + enum); confirm intentionally.
- `grep -n "BACKTEST_STATUS_INSUFFICIENT_DATA\|coverage_gaps\|propagation_meta" services/xstockstrat-analysis/app/handlers/servicer.py` — structured status/gap is set and the `GetBars` call still carries `metadata=propagation_meta` (header propagation preserved).

---

### Step 8 — test: analysis insufficient-data result + timeframe normalization

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, correct surfacing of insufficient-data without faking equity

**Codebase Evidence**:
- `make_servicer()` builds a servicer with fully mocked channels (`tests/test_analysis_servicer.py:22-34`); `TestRunBacktest` at `:160` and `TestRunBacktestBackwardCompat` at `:479` already exercise `RunBacktest` with a `MagicMock` context.
- `from gen.common.v1 import common_pb2` already imported in the test file (`:14`) — use `common_pb2.Timeframe` for assertions.

**Instructions**:
1. Add a test where `self._marketdata.GetBars` is mocked to return fewer than `slow_period + 2` bars and assert the returned `BacktestResult.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA`, that `coverage_gaps` is non-empty with correct `bars_have`/`bars_need`/`symbol`, and that the result is **not** a fabricated flat-equity success (e.g. `total_trades == 0` and no faked equity assertions). This is Acceptance Criterion 2.
2. Add a test asserting the `GetBars` mock is **called with the normalized timeframe** (the canonical `"1d"` and/or `timeframe_enum=TIMEFRAME_1DAY`), proving the `"1Day"` mismatch is gone (Acceptance Criterion 3, unit-level).

**Verification**:
- `cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40`.
- Lint (§5c): `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`.

---

### Step 9 — service: UI BFF `triggerBackfill` route + browser ingest client

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify
- `services/xstockstrat-ui/src/lib/browserClients/insightsIngestClient.ts` — create

**Reviewers**: `xstockstrat-ui` (service owner) — Connect-RPC call safety, header propagation on the `TriggerBackfill` call, no secret values rendered, BFF route correctness

**Codebase Evidence**:
- `insightsBff.ts` already registers `IngestService` with a `listSignalSources` method (`src/lib/insightsBff.ts:90-95`) using the shared `ingestClient` (`src/lib/connectClients.ts:36`) and `backendHeaders(claims, ctx)` which forwards `x-user-id`/`x-access-scope`/`x-trace-id` (`src/lib/insightsBff.ts:25-31`). Adding `triggerBackfill` reuses this already-propagating client — §5c header propagation satisfied by reuse.
- The server `ingestClient` is wired to `INGEST_ENDPOINT` (default `xstockstrat-ingest:50055`, `src/lib/connectClients.ts:21,36`). The UI `INGEST_ENDPOINT` env var is already present in all three deployment files (confirmed: `docker-compose.yml:452`, and `INGEST_ENDPOINT` keys at `.do/app.dev.yaml:411` / `.do/app.yaml:411` in the `xstockstrat-ui` block) — **no deployment-file change needed**.
- The handler map prefix for insights is `/insights/api` (`src/lib/insightsBff.ts:166-167`), so the browser client must target that base URL.
- Browser-client precedent: `src/lib/browserClients/analysisClient.ts` uses `createConnectTransport({ baseUrl: '/insights/api' })`. The existing `src/lib/browserClients/ingestClient.ts` points at `/config-ui/api` (a different segment), so a **separate** `insightsIngestClient.ts` pointing at `/insights/api` is required — do not repoint the config-ui client.
- `TriggerBackfillRequest` carries `symbols`, `timeframe`(deprecated string) + new `timeframeEnum`, `range`, `overwrite`; response carries `jobId`, `status` (`packages/proto/ingest/v1/ingest.proto:46-56`).

**Instructions**:
1. In `insightsBff.ts`, add a `triggerBackfill` method to the existing `router.service(IngestService, { ... })` block (`:90-95`), mirroring the `listSignalSources` pattern: `await requireSession(ctx)` then `return ingestClient.triggerBackfill(req, { headers: backendHeaders(claims, ctx) })`.
2. Create `src/lib/browserClients/insightsIngestClient.ts` mirroring `analysisClient.ts`: `createConnectTransport({ baseUrl: '/insights/api' })` + `createClient(IngestService, transport)`, exported as `insightsIngestClient`.

**Verification**:
- `grep -n "triggerBackfill\|backendHeaders" services/xstockstrat-ui/src/lib/insightsBff.ts` — the new method forwards `backendHeaders(claims, ctx)` (the three propagation headers).
- Lint/build (§5c, also runs in Step 11): `cd services/xstockstrat-ui && pnpm run lint`.

---

### Step 10 — service: Backtest view renders gap message + "backfill this range" action

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useBacktest.ts` — modify (add a `useTriggerBackfill` mutation hook)

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, BFF Connect-RPC call safety, header propagation on the `TriggerBackfill` call, no secret values rendered

**Codebase Evidence**:
- The backtest result is rendered on the strategy detail page; `result = backtestResult ?? report?.latestBacktest` at `src/app/insights/strategies/[id]/page.tsx:55`, and the results card block is `{result && (...)}` at `:197`. The "Run Backtest" button + form is at `:144-192`; the empty-state message is at `:283-291`.
- The run mutation comes from `useRunBacktest()` (`src/hooks/useBacktest.ts:8-16`) which calls the browser `analysisClient.runBacktest` (`src/lib/browserClients/analysisClient.ts`). The returned `BacktestResult` now carries `status` + `coverageGaps` (camelCase in TS stubs after Step 2).
- The form already holds `symbol`, `start`, `end` (`:31-36`) and converts ISO→timestamp via `isoToTimestamp` (`:43-46`) — reuse this to build the `TriggerBackfill` `range`.

**Instructions**:
1. In `useBacktest.ts`, add `useTriggerBackfill()` — a `useMutation` calling `insightsIngestClient.triggerBackfill(req)` (import from Step 9's `insightsIngestClient.ts`), mirroring `useRunBacktest`'s shape.
2. In `page.tsx`, when `result?.status === BacktestStatus.INSUFFICIENT_DATA` (import `BacktestStatus` from `@xstockstrat/proto/analysis/v1/analysis_pb`), render an insufficient-data panel **instead of** the metrics card: show the missing range and `bars_have`/`bars_need` from `result.coverageGaps[0]`, plus a "Backfill this range" `<Button>`.
3. On click, call the `useTriggerBackfill` mutation with `{ symbols: [gap.symbol], timeframeEnum: gap.timeframe, range: gap.gap, overwrite: false }`. On success, render the returned `jobId` and a confirmation message (FR-6: "give the operator feedback (the returned `job_id` and a confirmation)"). Do **not** add live progress polling (Out of Scope — depends on P0 052).
4. Add a stable test hook (e.g. `data-testid="insufficient-data"` on the panel and `data-testid="backfill-action"` on the button) for the Playwright E2E in Step 11.

**Verification**:
- `grep -n "INSUFFICIENT_DATA\|useTriggerBackfill\|coverageGaps\|jobId" services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — gap message, action wiring, and job-id confirmation present.
- Lint/build (§5c, with Step 11): `cd services/xstockstrat-ui && pnpm run lint`.

---

### Step 11 — test: Playwright E2E for gap message + backfill action

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (mock `RunBacktest` returning `INSUFFICIENT_DATA` + `TriggerBackfill` returning a `jobId`)

**Reviewers**: `xstockstrat-ui` (service owner) — Playwright E2E for the gap message + backfill action (FR-6)

**Codebase Evidence**:
- E2E specs live under `e2e/insights/` (e.g. `e2e/insights/strategy-authoring.spec.ts`, `e2e/insights/dashboard.spec.ts`) and share `e2e/mock-backend.ts` + `e2e/helpers/auth.ts` (confirmed via `find`).
- Mock-backend pattern: `e2e/mock-backend.ts` is the existing fake backend used by insights specs (referenced by `playwright.config.ts` and the other insights specs).
- Phase 5 deviations note the insights backtest flow `POST /api/analysis/backtest → RunBacktest` is already E2E-covered (`docs/roadmap/phase5-deviations.md:101`), so the new spec extends an established pattern.

**Instructions**:
1. Extend `mock-backend.ts` so `RunBacktest` can return a `BacktestResult` with `status = INSUFFICIENT_DATA` and a populated `coverageGaps` entry, and so `TriggerBackfill` returns a deterministic `jobId` (e.g. `"job-e2e-1"`) with `status = BACKFILL_STATUS_QUEUED`.
2. Create `e2e/insights/backtest-coverage.spec.ts`: log in via `e2e/helpers/auth.ts`, open a strategy detail page, run a backtest that returns insufficient data, assert the `insufficient-data` panel shows the missing range + `bars_have`/`bars_need`, click `backfill-action`, and assert the confirmation shows the mocked `job-e2e-1`. This is Acceptance Criterion 4.

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e` (Playwright; no coverage threshold for Next.js per the spec test table — E2E pass is the gate).
- Lint (§5c): `cd services/xstockstrat-ui && pnpm run lint`.

---

### Step 12 — docs: Record canonical timeframe vocabulary + enum deprecation cycle

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/runbooks/historical-backfill.md` — modify (note canonical timeframe + `Timeframe` enum)
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (document `GetDataCoverage` + canonical timeframe form)
- `services/xstockstrat-analysis/CLAUDE.md` — modify (document structured insufficient-data result)

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/historical-backfill.md` documents `TriggerBackfill` usage with the `"1d"` vocabulary (the source of the mismatch, per `context.md` Session 2026-06-08 sdd-story).
- marketdata `CLAUDE.md` lists RPCs/behavior; analysis `CLAUDE.md:9-15` documents the `RunBacktest` flow including the `GetBars` fetch — both need the new behavior recorded.

**Instructions**:
1. In `historical-backfill.md`, document that the canonical stored timeframe is `"1d"`/`"1h"`/`"5m"`/`"1m"`, that the new `common.v1.Timeframe` enum is the preferred field, and that the string `timeframe` fields are deprecated for one release (cite `docs/runbooks/proto-versioning.md` deprecation cycle).
2. In marketdata `CLAUDE.md`, add `GetDataCoverage` to the service's behavior and note the `internal/timeframe/` normalizer reconciles `"1Day"`/`"1d"` aliases.
3. In analysis `CLAUDE.md`, document that `RunBacktest` now returns a structured `BACKTEST_STATUS_INSUFFICIENT_DATA` + `coverage_gaps` instead of a flat-equity no-op, and that it queries marketdata with the canonical `"1d"` timeframe.

**Verification**:
- `grep -rn "Timeframe\|GetDataCoverage\|INSUFFICIENT_DATA\|coverage_gaps" docs/runbooks/historical-backfill.md services/xstockstrat-marketdata/CLAUDE.md services/xstockstrat-analysis/CLAUDE.md` — each new term documented in the intended file.

---

## Deviation Log

### Deviation: Steps 1/3-6 — `//nolint:staticcheck` on existing deprecated-timeframe reads
**Spec said**: Mark the existing `string timeframe` fields `[deprecated = true]` and keep them for a one-release deprecation cycle (do not remove).
**Actual**: Marking the proto fields deprecated made `golangci-lint` (staticcheck SA1019) fail on the marketdata Go code that still legitimately reads the string field during the deprecation window (`internal/repository/marketdata_repo.go`, `internal/handler/marketdata_handler.go`, `internal/service/marketdata_service.go`). Added `//nolint:staticcheck` annotations (with a deprecation-window reason) on those intentional reads so the lint gate passes without prematurely ripping out the still-needed string readers.
**Reason**: One-release deprecation cycle is by design (callers migrate to `timeframe_enum` over the next release); suppressing SA1019 on intentional reads during the window is the idiomatic Go approach. In-scope: the findings were caused by this feature's own deprecation change.
**Disposition**: accepted (deprecation-window lint suppression)
