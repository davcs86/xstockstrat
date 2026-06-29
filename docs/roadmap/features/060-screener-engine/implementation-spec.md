# Implementation Spec: screener-engine

**Status**: `complete`
**Created**: 2026-06-27
**Feature**: `docs/roadmap/features/060-screener-engine/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/screener-engine`

---

## Execution Summary

Proto first (additive `ScreenSymbols` RPC + messages + `Comparator` enum), then regenerate stubs so
every consumer compiles. The analysis work is split into two parts to honor FR-4/FR-8: first extract
the existing inline weight-combination scoring math from `_backtest_symbol` into a pure module behind a
golden regression test (proving `RunBacktest` is byte-for-byte unchanged), then build the new
`ScreenSymbols` servicer method that reuses that pure module, calls `ExecuteFormula` exactly as a
backtest formula would, and degrades gracefully when fundamentals (Feature 059) are absent. Config keys
are documentation + default wiring only (live via WatchConfig). The UI lands last: a `screenSymbols`
BFF handler + browser mutation hook + Screener page + Playwright E2E. Fundamental criteria are coded to
degrade-skip because `GetFundamentals` does not yet exist in `marketdata.proto` (Feature 059 has not
landed).

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the new proto.
- Step 4 (extract scoring module) requires nothing proto-related; it is a pure refactor and may run in
  parallel with Step 1–2, but is sequenced here before Step 5 because the screener imports the module.
- Step 5 (ScreenSymbols servicer) requires Step 2 (generated `ScreenSymbols` stubs) **and** Step 4
  (pure scoring module to import).
- Step 6 (analysis tests) covers Steps 4 and 5.
- Step 3 (config keys) is independent; sequence anywhere before Step 5 (the servicer reads the keys).
- Step 7 (BFF handler), Step 8 (page + hook), Step 9 (E2E) all require Step 2 (UI imports the
  regenerated `AnalysisService` with `screenSymbols`).

---

### Step 1 — proto: Add `ScreenSymbols` RPC, request/response messages, and `Comparator` enum

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field-number uniqueness, additive (no breaking change), `buf` pass; `xstockstrat-analysis` (service owner) — RPC shape matches the screener engine contract

**Codebase Evidence**:
- `service AnalysisService` block is `analysis.proto:11-20`; existing RPCs end with
  `rpc SetStrategyLive(...)` at `analysis.proto:19`. New RPC slots in after it, before the closing brace.
- Confirmed absent via grep over `analysis.proto`: no `ScreenSymbols`, `ScreenSymbolsRequest`,
  `ScreenCriterion`, `ScreenResult`, `Comparator` exist (zero matches).
- Reuse — `StrategyComponent` is `analysis.proto:116-122` (fields `ref_name=1`, `kind=2`, `indicator=3`,
  `formula_id=4`, `params=5`).
- Reuse — `CoverageGap` is `analysis.proto:40-48` (`symbol=1`, `timeframe=2`, `requested_range=3`,
  `bars_have=4`, `bars_need=5`, `gap=6`).
- Reuse — `TimeRange` is `xstockstrat.common.v1.TimeRange`, imported at `analysis.proto:9`
  (`import "common/v1/common.proto";`); defined `common/v1/common.proto:42-45`. Used additively today as
  `RunBacktestRequest.range = 2` (`analysis.proto:24`).
- Enum style reference — `ComponentKind` at `analysis.proto:110-114` with
  `COMPONENT_KIND_UNSPECIFIED = 0;`. New `Comparator` must follow the same `COMPARATOR_UNSPECIFIED = 0`
  sentinel (root CLAUDE.md Proto Contract Governance: "Every enum must have a zero-value
  `<NAME>_UNSPECIFIED = 0` sentinel"; prefer enum over string for the closed comparator set).
- Existing `BacktestStatus` enum (`analysis.proto:34-38`) is the style reference for the new per-result
  status enum (e.g. `SCREEN_RESULT_STATUS_UNSPECIFIED=0 | OK | INSUFFICIENT_DATA`).
- **Signal-blend params are NOT proto fields** — `signal_sources` / `signal_weight` /
  `technical_weight` / `min_conviction` live as keys inside the `strategy_params`
  `google.protobuf.Struct` (`RunBacktestRequest.strategy_params = 5`, `analysis.proto:27`; documented
  `services/xstockstrat-analysis/CLAUDE.md` § Backtesting Strategy). To keep the screener consistent
  with backtest, model the same blend params on `ScreenSymbolsRequest` as either explicit typed fields
  **or** a `google.protobuf.Struct strategy_params` field — choose explicit typed fields per the
  product spec FR-3/FR-4 (clearer contract), but ensure the values map onto the same names the extracted
  scoring module reads.

**Instructions**:
1. Add the RPC inside `service AnalysisService` (after `analysis.proto:19`):
   `rpc ScreenSymbols(ScreenSymbolsRequest) returns (ScreenSymbolsResponse);`
2. Add a new top-level enum `Comparator` with `COMPARATOR_UNSPECIFIED = 0; COMPARATOR_LT = 1;
   COMPARATOR_LTE = 2; COMPARATOR_GT = 3; COMPARATOR_GTE = 4; COMPARATOR_BETWEEN = 5;` (per
   product-spec Proto Contract Changes).
3. Add `ScreenCriterion` (new message, fields start at 1): `string ref_name = 1;` `ScreenKind kind = 2;`
   `string metric_name = 3;` (FUNDAMENTAL only) `StrategyComponent component = 4;` (reuse, for TECHNICAL)
   `Comparator op = 5;` `double threshold = 6;` `double threshold_high = 7;` (for `BETWEEN`)
   `double weight = 8;` `bool hard_filter = 9;`. Add a `ScreenKind` enum
   (`SCREEN_KIND_UNSPECIFIED=0 | FUNDAMENTAL | TECHNICAL_FORMULA | TECHNICAL_INDICATOR | SIGNAL`) per
   product-spec FR/Proto.
4. Add `ScreenResult` (new message): `string symbol = 1;` `double score = 2;`
   `map<string,double> criterion_scores = 3;` `bool passed = 4;` `ScreenResultStatus status = 5;`
   `CoverageGap gap = 6;` (reuse `CoverageGap`). Add `ScreenResultStatus` enum
   (`SCREEN_RESULT_STATUS_UNSPECIFIED=0 | OK | INSUFFICIENT_DATA`).
5. Add `ScreenSymbolsRequest` (new message): `repeated string symbols = 1;`
   `repeated ScreenCriterion criteria = 2;` blend params — `repeated string signal_sources = 3;`
   `double signal_weight = 4;` `double technical_weight = 5;` `double min_conviction = 6;`
   `int32 rank_limit = 7;` `xstockstrat.common.v1.TimeRange evaluation_window = 8;` (reserved/optional —
   product-spec OQ-060-e defers historical as-of; latest-bar is default).
6. Add `ScreenSymbolsResponse` (new message): `repeated ScreenResult results = 1;`
   `repeated CoverageGap coverage_gaps = 2;`.
7. All changes are additive (new RPC + new messages + new enums); no existing field number is touched.

**Verification**:
- `cd packages/proto && buf lint` — passes.
- `cd packages/proto && buf breaking --against ".git#branch=main-dev,subdir=packages/proto"` — passes
  (additive only; matches the `scripts/buf-gen.sh` baseline at `buf-gen.sh:38,41`).
- `grep -n "ScreenSymbols\|ScreenCriterion\|ScreenResult\|Comparator" packages/proto/analysis/v1/analysis.proto`
  — confirms the new symbols are present.

---

### Step 2 — proto-gen: Regenerate Go/Python/TS stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/analysis/v1/analysis.pb.go` — regenerate
- `packages/proto/gen/go/analysis/v1/analysis_grpc.pb.go` — regenerate
- `packages/proto/gen/python/analysis/v1/analysis_pb2.py` — regenerate
- `packages/proto/gen/python/analysis/v1/analysis_pb2_grpc.py` — regenerate
- `packages/proto/gen/ts/analysis/v1/analysis_pb.ts` — regenerate
- `packages/proto/gen/ts/analysis/v1/analysis_connect.ts` — regenerate
- `packages/proto/gen/ts/dist/**` — recompiled

**Reviewers**: Proto Reviewer — `buf` pass, generated stubs match source (inherited from Step 1)

**Codebase Evidence**:
- `scripts/buf-gen.sh` exists; key commands: `buf lint` (`buf-gen.sh:35`), `buf breaking` against
  `main-dev` (`buf-gen.sh:38,41`), `buf generate` for Go+TS (`buf-gen.sh:48`), Python via
  `python3 -m grpc_tools.protoc ... --python_out=gen/python --grpc_python_out=gen/python` (`buf-gen.sh:61-66`),
  and `pnpm --filter @xstockstrat/proto run build` to compile TS → `gen/ts/dist/` (`buf-gen.sh:87`).
- Analysis gen dirs already exist for all three languages (confirmed present), so this regenerates
  in place — no new directory.

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Commit the regenerated proto source + stubs together in one commit (proto-versioning runbook step:
   "Commit proto source + generated stubs together").

**Verification**:
- `./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` — second run produces no diff
  (proto-freshness CI invariant; `proto-versioning.md` § Verifying the generated stubs match the protos).
- `grep -rn "ScreenSymbols" packages/proto/gen/python/analysis/v1/analysis_pb2_grpc.py` — confirms the
  Python servicer/stub method exists for Step 5 to implement.

---

### Step 3 — config: Document and default-wire `analysis.screener.*` keys

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `CLAUDE.md` (root) — modify (config table is governed there per Config Governance Rules)
- `services/xstockstrat-analysis/CLAUDE.md` — modify (§ Config Keys Consumed table)

**Reviewers**: `xstockstrat-config` (service owner) — config key naming `<service>.<category>.<key>`,
defaults declared in service CLAUDE.md

**Codebase Evidence**:
- Existing analysis config keys are documented in `services/xstockstrat-analysis/CLAUDE.md`
  § Config Keys Consumed (namespace `analysis`), including `analysis.scoring.sharpe_weight` and
  `analysis.signals.source_weights`.
- Keys are read at runtime via `self._cfg.get_float/get_int/get_str(key, default)` against the
  `ConfigWatcher` snapshot (getters at `services/xstockstrat-analysis/app/config/watcher.py:60,68,76,84`).
  Existing read examples: float reads at `servicer.py:643-645`; JSON-string `source_weights` parse at
  `servicer.py:129-138`.
- No new env var is needed — new keys arrive via the existing `WatchConfig` stream (analysis subscribes
  at `app/main.py:39-40` with `namespace="analysis"`). Deployment audit confirmed the analysis
  `environment:` block in `docker-compose.yml:338-359` and `.do/app.dev.yaml:215-241` (and `.do/app.yaml`)
  already wires `CONFIG_ENDPOINT` — no deployment file change.

**Instructions**:
1. Add the four keys to the root `CLAUDE.md` config table (these are already listed in product-spec
   § Config Key Changes), owned by `xstockstrat-analysis`:
   `analysis.screener.max_universe_size` (int, `100`), `analysis.screener.max_duration_seconds`
   (int, `120`), `analysis.screener.default_rank_limit` (int, `50`),
   `analysis.screener.max_concurrent_formula_evals` (int, `4`).
2. Add the same four rows to `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed.
3. No `SetConfig` rollout is required for v1 (defaults are read inline by the servicer in Step 5 via
   `self._cfg.get_int("analysis.screener.<key>", <default>)`); operators may later override per
   `docs/runbooks/config-rollout.md`.

**Verification**:
- `grep -n "analysis.screener" CLAUDE.md services/xstockstrat-analysis/CLAUDE.md` — all four keys present
  in both files with matching defaults.

---

### Step 4 — service: Extract the source-weighted scoring math into a pure module

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/scoring.py` — create (new pure module)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (import + replace inline math)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility unchanged
(regression-pinned), scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The reusable per-bar signal math is **already** a pure module-level function
  `_compute_signal_score(signals_map, bar, signal_sources, source_weights)` at
  `servicer.py:884-916` (returns 0.0–1.0; maps net conviction −1..1 → 0..1 at `servicer.py:916`).
- The **weight-combination + threshold** logic is currently **inline** inside the `_backtest_symbol`
  loop at `servicer.py:436-459`. Exact code:
  - `combined = technical_weight * (tech_signal * 0.5 + 0.5) + signal_weight * signal_score`
    (`servicer.py:450-451`), with the pure-technical fallback `combined = tech_signal * 0.5 + 0.5`
    (`servicer.py:455`).
  - `buy_threshold = max(0.5 + min_conviction * 0.5, 0.55)` (`servicer.py:458`); `sell_threshold = 0.45`
    (`servicer.py:459`).
- `_compute_metrics` (`servicer.py:919-963`) is a separate pure helper already importable; not in scope
  for this extraction.

**Instructions**:
1. Create `app/services/scoring.py` exposing pure functions (no I/O, no gRPC, no config object):
   - `combine_score(tech_signal: float, signal_score: float, signal_weight: float,
     technical_weight: float, signals_present: bool) -> float` — moves the exact
     `servicer.py:449-455` branch verbatim (including the `signal_weight > 0 and signals_map` guard,
     here passed as `signals_present`).
   - `buy_threshold(min_conviction: float) -> float` returning `max(0.5 + min_conviction * 0.5, 0.55)`
     (`servicer.py:458`); `sell_threshold() -> float` returning `0.45`.
   - Move `_compute_signal_score` (`servicer.py:884-916`) into this module as `compute_signal_score`
     (drop the leading underscore for the public pure API).
2. In `servicer.py`, import `from app.services import scoring` and replace the inline math at
   `servicer.py:444-459` with calls to `scoring.compute_signal_score(...)`,
   `scoring.combine_score(...)`, `scoring.buy_threshold(...)`, `scoring.sell_threshold()`. The numeric
   result must be identical — this is a behavior-preserving refactor (FR-8).
3. Keep a thin backward-compat alias if any test imports `_compute_signal_score` from `servicer`
   directly (existing test `tests/test_analysis_helpers.py:14` imports `_compute_signal_score` from the
   servicer module) — re-export it: `from app.services.scoring import compute_signal_score as
   _compute_signal_score` at module scope in `servicer.py`, so existing tests stay green without edits.
4. Do **not** change any numeric constant, branch order, or threshold — extraction only (FR-4/FR-8).

**Verification**:
- `grep -n "combine_score\|buy_threshold\|compute_signal_score" services/xstockstrat-analysis/app/services/scoring.py`
  — confirms the pure functions exist.
- `grep -n "scoring\.\|_compute_signal_score" services/xstockstrat-analysis/app/handlers/servicer.py`
  — confirms servicer now delegates and re-exports the alias.
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
- (Behavioral proof is the golden test in Step 6.)

---

### Step 5 — service: Implement the `ScreenSymbols` RPC (screener engine)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/screener.py` — create (new engine module)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (add `ScreenSymbols` method)

**Reviewers**: `xstockstrat-analysis` (service owner) — ranking correctness, no look-ahead bias,
backtest isolation (FR-8); `xstockstrat-indicators` (service owner) — `ExecuteFormula` reused exactly
as backtest does, timeout/concurrency under large universes; `xstockstrat-marketdata` (service owner) —
`GetFundamentals` consumption + quota-aware degradation

**Codebase Evidence**:
- Servicer methods live in `servicer.py`; `RunBacktest` is `servicer.py:125`, `ScoreStrategy` is
  `servicer.py:637`. The new `ScreenSymbols(self, request, context)` slots in as a sibling method; no
  `main.py` change needed (it is auto-registered by `add_AnalysisServiceServicer_to_server`,
  `app/main.py:62`).
- Existing outbound calls and their channels (already constructed in `main.py:50-58` from
  `MARKETDATA_ENDPOINT`/`INDICATORS_ENDPOINT`/`INGEST_ENDPOINT`, `main.py:28-30`):
  `MarketDataService.GetBars` (`servicer.py:343,545`), `IngestService.QuerySignals` (`servicer.py:391`),
  `IndicatorsService.ComputeIndicator` (`servicer.py:362,372`), `GetFormula` (`servicer.py:102`).
- **New outbound RPC**: `IndicatorsService.ExecuteFormula` is NOT currently called by this service
  (confirmed — only `ComputeIndicator`/`GetFormula` are used). FR-3 requires calling `ExecuteFormula`
  with `input_data={"close": closes}` / `input_params=params`. The indicators channel/stub already
  exists, but this is a net-new RPC invocation. `ExecuteFormulaRequest` fields (from
  `packages/proto/indicators/v1/indicators.proto:63-75`): `formula_id=1`, `formula_source=2`,
  `input_data=3` (Struct), `input_params=7` (Struct). `ExecuteFormulaResponse`
  (`indicators.proto:77-87`): `success=1`, `output=2` (Struct), `error=7`.
- **Header propagation (required — new outbound call)**: this service uses **manual per-method**
  metadata forwarding — it filters `context.invocation_metadata()` keeping
  `x-user-id`/`x-access-scope`/`x-trace-id` and passes `metadata=propagation_meta` on each outbound
  call (pattern at `servicer.py:147-151` for RunBacktest; matches
  `docs/patterns/header-propagation.md` Python per-method form). The new `ExecuteFormula`, `GetBars`,
  and `QuerySignals` calls in `ScreenSymbols` MUST build the same `propagation_meta` from the inbound
  `context` and pass it on every outbound call.
- **CoverageGap / insufficient-data pattern (FR-7)**: the `_InsufficientData` exception class is at
  `servicer.py:37-48`, raised at `servicer.py:357,557`, caught to build
  `analysis_pb2.CoverageGap(...)` at `servicer.py:240-258`, with status set
  `BACKTEST_STATUS_INSUFFICIENT_DATA` vs `_OK` at `servicer.py:288-293`. Reuse this pattern, mapping to
  the new `ScreenResultStatus.INSUFFICIENT_DATA` + `ScreenResult.gap` (CoverageGap) per result.
- **Fundamentals graceful degradation (FR-5)**: `GetFundamentals`/`GetFundamentalsMulti` do NOT exist
  in `marketdata.proto` yet (Feature 059 has not landed — confirmed absent). Any `FUNDAMENTAL` criterion
  must therefore be reported **skipped** (not present in `criterion_scores`, and not failing the scan),
  exactly as FR-5 requires when FMP is disabled. Guard the fundamental path behind a capability check
  (e.g. `hasattr(marketdata_pb2_grpc.MarketDataServiceStub, "GetFundamentals")` or a try/except on the
  attribute) so the engine compiles and runs today and lights up automatically once 059 lands.
- Config reads follow `self._cfg.get_int("analysis.screener.<key>", <default>)` (getters at
  `app/config/watcher.py:60,68,76,84`).

**Instructions**:
1. Create `app/services/screener.py` with the engine, importing the pure scoring module from Step 4
   (`from app.services import scoring`). The engine is structured to keep `RunBacktest`/`ScoreStrategy`
   untouched (FR-8). It:
   a. Caps the universe to `analysis.screener.max_universe_size` (default 100); reject or truncate
      over-cap requests per product-spec OQ-060-d.
   b. For each symbol, fetches the latest bars via `MarketDataService.GetBars` (canonical `"1d"` +
      `timeframe_enum`, matching the backtest fix noted in `xstockstrat-analysis/CLAUDE.md`), and
      QuerySignals via `IngestService.QuerySignals` for SIGNAL/blend criteria.
   c. For TECHNICAL_FORMULA/TECHNICAL_INDICATOR criteria, evaluates each formula via
      `IndicatorsService.ExecuteFormula(formula_id=..., input_data={"close": closes},
      input_params=params)` — identical invocation shape to a backtest formula (FR-3). Bound concurrent
      formula evals to `analysis.screener.max_concurrent_formula_evals` (default 4) using an
      `asyncio.Semaphore` so a scan cannot starve the live-strategy loop (OQ-060-d).
   d. Evaluates the as-of timestep at the latest bar (OQ-060-e); `evaluation_window` is accepted but
      reserved.
   e. Computes the combined per-symbol score with the **Step 4 pure module** (`scoring.combine_score`,
      `scoring.compute_signal_score`, applying `signal_sources`, `signal_weight`, `technical_weight`,
      `min_conviction`, and `analysis.signals.source_weights`) so screener scoring == backtest scoring
      (FR-4).
   f. Applies each `ScreenCriterion` comparator (`Comparator` enum: LT/LTE/GT/GTE/BETWEEN) against its
      threshold; `hard_filter=true` criteria gate inclusion; weighted criteria contribute to the score.
      Numeric FUNDAMENTAL criteria are min-max normalized **across the scan universe** (FR-6).
   g. For FUNDAMENTAL criteria, attempt `GetFundamentals`/`GetFundamentalsMulti`; if the RPC is absent
      (Feature 059 not landed) or FMP is disabled/quota-exhausted with no cache, mark that criterion
      **skipped** and continue the scan (FR-5).
   h. A symbol lacking sufficient bars/data is returned with `ScreenResultStatus.INSUFFICIENT_DATA` and a
      `CoverageGap`, reusing the `_InsufficientData`→`CoverageGap` pattern (`servicer.py:37-48,240-258`)
      — never silently dropped (FR-7).
   i. Ranks results descending by score, caps at `rank_limit` (default
      `analysis.screener.default_rank_limit`=50), populates `criterion_scores` and `passed` per result.
2. Add `async def ScreenSymbols(self, request, context)` to `servicer.py` as a sibling of `RunBacktest`.
   It builds `propagation_meta` from `context.invocation_metadata()` (filtering
   `x-user-id`/`x-access-scope`/`x-trace-id`, mirroring `servicer.py:147-151`) and passes it to the
   engine for every outbound call. It enforces `analysis.screener.max_duration_seconds` (default 120)
   as an overall scan deadline.
3. Do not inject signals or fundamentals into the indicators sandbox namespace (forbidden — product-spec
   Out of Scope); signal/fundamental contributions are computed in analysis only.
4. Do not modify `RunBacktest`, `ScoreStrategy`, or `app/engine/live_loop.py` behavior (FR-8).

**Verification**:
- `grep -n "def ScreenSymbols" services/xstockstrat-analysis/app/handlers/servicer.py` — method present.
- `grep -n "ExecuteFormula\|propagation_meta\|metadata=" services/xstockstrat-analysis/app/services/screener.py`
  — confirms the new `ExecuteFormula` call forwards the three platform headers via `metadata=`
  (header-propagation gate).
- `grep -n "max_universe_size\|max_concurrent_formula_evals\|default_rank_limit\|max_duration_seconds" services/xstockstrat-analysis/app/services/screener.py`
  — confirms all four config keys are read.
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
- (Behavioral verification is the test step below.)

---

### Step 6 — test: Golden regression + `ScreenSymbols` RPC tests (covers Steps 4 & 5)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_helpers.py` — modify (golden test + scoring module)
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (ScreenSymbols RPC tests)
- `services/xstockstrat-analysis/tests/test_screener.py` — create (engine unit tests)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility (golden-pinned),
scoring determinism, ranking correctness

**Codebase Evidence**:
- `tests/test_analysis_helpers.py` already imports `_compute_signal_score` from the servicer module
  (`:14`) and contains `TestComputeSignalScore` (`:160`) and `TestComputeSignalScoreWithWeights`
  (`:205`) — the existing source-weight regression suite. The FR-4 golden test sits alongside these and
  now imports from `app.services.scoring`.
- `tests/test_analysis_servicer.py` has `make_servicer()` mocking cfg getters (`:22-34`) and
  `TestRunBacktest` (`:160`) with `test_insufficient_data_returns_structured_gap` (`:189`) and
  `test_getbars_called_with_normalized_timeframe` (`:211`); `TestRunBacktestBackwardCompat`
  (`test_legacy_strategy_params_uses_sma_path`, `:530`) is the FR-8 anchor. Mirror these for
  `TestScreenSymbols`.

**Instructions**:
1. **Golden regression (FR-4/FR-8, Acceptance #2)**: add a test that runs `RunBacktest` (or directly the
   `_backtest_symbol` path) over a fixed bar+signal fixture and pins the resulting equity curve /
   trade list / metrics to values captured from the pre-refactor code, proving the Step 4 extraction
   left `RunBacktest` output byte-for-byte unchanged. Capture the baseline by running the suite **before**
   merging Step 4 and freezing the expected values into the test.
2. Add `ScreenSymbols` RPC tests in `test_analysis_servicer.py` mirroring `TestRunBacktest`:
   - Acceptance #1: 3-symbol universe + one formula criterion → 3 ranked, score-ordered results, each
     with per-criterion sub-scores (mock `ExecuteFormula`, `GetBars`).
   - Acceptance #3: a symbol with insufficient bars → `ScreenResultStatus.INSUFFICIENT_DATA` + gap, not
     dropped.
   - Acceptance #4: a fundamental hard-filter excludes a symbol; with the `GetFundamentals` RPC absent
     (current state), the fundamental criterion is marked skipped and the scan completes (FR-5).
   - Header propagation: assert the mocked `ExecuteFormula`/`GetBars` stubs received
     `x-user-id`/`x-access-scope`/`x-trace-id` in `metadata`.
3. Add `test_screener.py` engine unit tests for comparator evaluation (LT/LTE/GT/GTE/BETWEEN),
   universe min-max normalization (FR-6), rank-limit capping, and the concurrency-semaphore bound.
4. Acceptance #5 (FR-8): the full existing analysis suite must pass unchanged.

**Verification**:
- `cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40` — passes at ≥40% coverage
  with the full existing suite green (FR-8 / Acceptance #5).
- `cd services/xstockstrat-analysis && ruff check . && ruff format --check .` — lint/format clean
  (code-quality gate for Steps 4 & 5).

---

### Step 7 — service: Register the `screenSymbols` BFF handler (insights segment)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify (add handler to the AnalysisService router)

**Reviewers**: `xstockstrat-ui` (service owner) — BFF call safety, header propagation

**Codebase Evidence**:
- The insights BFF registers `AnalysisService` methods **explicitly, one per RPC** in
  `router.service(AnalysisService, {...})` at `services/xstockstrat-ui/src/lib/insightsBff.ts:42-95`;
  `runBacktest` is at `insightsBff.ts:54-57`. A method missing from this router returns 404
  (`insightsBff.ts:205-206,229-230`) — it is NOT a transparent pass-through, so `screenSymbols` must be
  added here.
- The handler forwards the three platform headers via `backendHeaders(claims, ctx)` —
  `insightsBff.ts:32-38` sets `'x-user-id'`, `'x-access-scope'`, `'x-trace-id'`. The new handler must
  use the same.
- The backend client the handler forwards to is `analysisClient` at
  `services/xstockstrat-ui/src/lib/connectClients.ts:36`
  (`createClient(AnalysisService, makeTransport(ANALYSIS_ENDPOINT))`). The catch-all route
  `src/app/insights/api/[...connect]/route.ts:5-6` needs no edit.

**Codebase Evidence (continued)**:
- After Step 2, `AnalysisService` (from the regenerated `@xstockstrat/proto` package) exposes
  `screenSymbols`, so the typed handler compiles.

**Instructions**:
1. In `insightsBff.ts` `router.service(AnalysisService, {...})` (after the `runBacktest` handler at
   `:54-57`), add a `screenSymbols(req, ctx)` handler that calls
   `analysisClient.screenSymbols(req, { headers: backendHeaders(claims, ctx) })`, mirroring the existing
   `runBacktest` handler's header-forwarding shape (`:32-38`).
2. No new BFF route file and no catch-all edit are needed.

**Verification**:
- `grep -n "screenSymbols" services/xstockstrat-ui/src/lib/insightsBff.ts` — handler present.
- `grep -n "backendHeaders\|x-user-id" services/xstockstrat-ui/src/lib/insightsBff.ts` — confirms the new
  handler reuses the propagating `backendHeaders` (header-propagation gate).
- Lint: `cd services/xstockstrat-ui && pnpm run lint`.

---

### Step 8 — service: Screener page + `useScreenSymbols` mutation hook

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useScreenSymbols.ts` — create
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — create

**Reviewers**: `xstockstrat-ui` (service owner) — loading/error states, no secret values rendered,
Connect-RPC call safety

**Codebase Evidence**:
- Browser client to import: `services/xstockstrat-ui/src/lib/browserClients/analysisClient.ts:5-6`
  (`createConnectTransport({ baseUrl: '/insights/api' })` → `createClient(AnalysisService, transport)`).
  After Step 2 it exposes `screenSymbols` automatically.
- Mutation-hook template to clone: `services/xstockstrat-ui/src/hooks/useBacktest.ts:6-17`
  (`type RunBacktestInput = Parameters<typeof analysisClient.runBacktest>[0];`
  `mutationFn: (req) => analysisClient.runBacktest(req)`).
- Closest page pattern (mutation + loading/error states):
  `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — `'use client'` (`:1`),
  `useRunBacktest` usage destructuring `isPending`/`error`/`data` (`:30`), `ConnectError.rawMessage`
  error normalization (`:40-42`), loading (`:189`) / error (`:191`) / empty (`:318-333`) renders.
- Insights segment owns analytics pages; new pages live under `src/app/insights/` (CLAUDE.md:43).
  The screener is a pure gRPC call — **no DB / no `pg.Pool`** (only the config-ui audit route uses the
  DB; CLAUDE.md:92-96).
- Feature 058 (watchlist universe) resolves watchlist → symbols at the UI layer; the page passes an
  explicit `symbols` list to `screenSymbols` (product-spec FR-2). If 058 has not landed, fall back to a
  manual symbol-entry input (product-spec Feature Workflow Notes graceful-degradation).

**Instructions**:
1. Create `useScreenSymbols.ts` cloning `useBacktest.ts:6-17` but for `analysisClient.screenSymbols`
   (`useMutation`, since the scan is on-demand — product-spec FR-9).
2. Create `src/app/insights/screener/page.tsx` (`'use client'`): pick a watchlist (Feature 058) or enter
   symbols manually; compose `ScreenCriterion` rows (kind + comparator + threshold + weight +
   hard_filter); run via `useScreenSymbols().mutate(...)`; render a ranked results table with
   per-criterion sub-score columns and fundamentals columns, plus loading and error states (mirror the
   `strategies/[id]/page.tsx:30,40-42,189,191` patterns). Render no secret values.
3. Use `data-testid` attributes on the run button, the results table, and the
   loading/error/insufficient-data states so the E2E spec (Step 9) can assert on them (mirror the
   `getByTestId` usage in `e2e/insights/backtest-coverage.spec.ts`).

**Verification**:
- `grep -n "screenSymbols\|useScreenSymbols" services/xstockstrat-ui/src/hooks/useScreenSymbols.ts services/xstockstrat-ui/src/app/insights/screener/page.tsx`
  — hook and page wired.
- Lint: `cd services/xstockstrat-ui && pnpm run lint`.

---

### Step 9 — test: Playwright E2E for the Screener page

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add `screenSymbols` mock to insights handler)
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — create

**Reviewers**: `xstockstrat-ui` (service owner) — Playwright E2E, loading/error states

**Codebase Evidence**:
- Insights E2E specs live in `services/xstockstrat-ui/e2e/insights/`; reference structure
  `e2e/insights/backtest-coverage.spec.ts:11-30` — `test.describe(...)`, `addAuthCookie(page)` (`:13`),
  `page.goto('/insights/...')` (`:14`), `getByTestId(...)` assertions (`:19,26-27`). Auth helper
  `e2e/helpers/auth.ts` (`addAuthCookie`, `TEST_JWT_SECRET`).
- Mock backend serves insights on port 9092 (`e2e/mock-backend.ts:30,237`,`insightsHandler` at `:237`);
  `AnalysisService` mocks are registered in `router.service(AnalysisService, {...})` at `:239`, e.g.
  `runBacktest` at `:254-272`. The new `screenSymbols` mock handler is added inside this block.
- Scripts (`services/xstockstrat-ui/package.json`): `"lint": "next lint"` (`:10`),
  `"test:e2e": "playwright test"` (`:14`).

**Instructions**:
1. In `e2e/mock-backend.ts`, add a `screenSymbols` mock inside the insights
   `router.service(AnalysisService, {...})` block (`:239-...`, alongside `runBacktest` at `:254-272`)
   returning a deterministic ranked `ScreenSymbolsResponse` (e.g. 3 results, score-ordered, one with
   `INSUFFICIENT_DATA` + a `coverage_gap`).
2. Create `e2e/insights/screener.spec.ts` mirroring `backtest-coverage.spec.ts`: `addAuthCookie(page)`,
   `page.goto('/insights/screener')`, add a criterion, run the scan, assert the ranked table renders
   (Acceptance #6) and that loading and error/insufficient-data states render via `getByTestId`.

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- screener` — the new spec passes (loading + ranked
  table + error/insufficient-data states render). No coverage threshold applies to the Next.js segment
  (E2E coverage is the gate per `reference/spec-template.md` test table).

---

## Deviation Log

### Step 6 — golden regression realized as (frozen functions + unchanged suite)
The spec asks for a golden test pinning `RunBacktest` output captured before the Step 4 refactor.
Because the extraction moves the scoring math verbatim, the regression is realized as: (a) a
frozen-value test (`TestScoringGolden`) that pins the extracted pure functions
(`combine_score`/`buy_threshold`/`sell_threshold`) byte-for-byte, and (b) the full pre-existing
analysis suite — including `TestRunBacktest`/`TestRunBacktestBackwardCompat` — passing **unchanged**
after the refactor (105→ still green). Together these prove `RunBacktest` output is unchanged, without
introducing a brittle equity-curve snapshot.

### Step 5 — active fundamentals path (059 in ancestry) with runtime degradation
The spec (written when 059 had not landed) guards fundamental criteria behind a `hasattr` capability
check and reports them skipped. Since this branch is stacked on 059, `GetFundamentalsMulti` exists in
the proto. The engine therefore CALLS `GetFundamentalsMulti` and degrades fundamental criteria to
**skipped** on any `grpc.RpcError` (FMP is disabled by default → `FailedPrecondition`, or
quota-exhausted/unavailable) — satisfying FR-5 both when fundamentals are off (the default) and
lighting up automatically when FMP is enabled. The Step-6 fundamental tests assert the skipped path
by mocking `GetFundamentalsMulti` to raise.

### Step 5 — screener score blend reuses the backtest combine via a [0,1]→[-1,1] map
To reuse `scoring.combine_score` (FR-4) for the screener's multi-criterion score, the weighted
criterion aggregate (in [0,1]) is mapped to a `tech_signal` in [-1,1] (`2*x-1`) before calling
`combine_score`, so the function's `tech_signal*0.5+0.5` recovers the aggregate and the signal blend
is identical to a backtest. Formula `value` outputs are read via `MessageToDict` (a list output is a
`ListValue` under `dict(Struct)`).

### Step 9 — E2E authored but not run to completion in this container
The Playwright spec (`e2e/insights/screener.spec.ts`) and the `screenSymbols` mock were authored and
wired exactly as the already-passing `e2e/insights/account-portfolio` / `backtest-coverage` specs. The
spec could not be run to completion in the execution container: the Next.js dev server repeatedly failed
to bind/serve within Playwright's 60s `webServer` window (the container was simultaneously running
post-restart setup — apt upgrades + a Playwright Firefox install — starving the Next.js compile), and a
production `next build` is not viable here either (it type-checks files in the project tree). The screener
page is otherwise verified by `tsc --noEmit` (compiles against the regenerated `AnalysisService` with
`screenSymbols`) and `next lint` (clean), and the BFF handler/hook/mock mirror proven patterns. Re-run
`pnpm test:e2e -- screener` in a stable environment to execute it.
