# Implementation Spec: market-regime-benchmark-operand

**Status**: `complete` (all 9 steps landed 2026-08-24; analysis suite 591 green, agent suite 286 green, buf lint+breaking clean)
**Created**: 2026-08-24
**Feature**: `docs/roadmap/features/152-market-regime-benchmark-operand/feature.md`
**Total Steps**: 9
**Feature Branch**: `claude/market-regime-benchmark-operand-sruo7n` (harness-assigned; PRs target `main-dev`)

---

## Execution Summary

Proto field first (Step 1), then the shared evaluator computation unit (Step 2) that every consumer
routes through, then the four site-specific benchmark preloads (Steps 3–6: backtest, live,
readiness/opportunities, GetIndicatorSeries), then server-side write-path normalization (Step 7), then
the agent surface + strat-lab skill (Step 8), then docs/teardown (Step 9). Steps 3–6 each depend on the
Step-2 helper. Consumer surface (C-14) is the Agent — landed in Step 8; UI editor deferred to the named
follow-up `strategy-builder-source-symbol`.

### Scenario Coverage
- @AC-1 (byte-identity) → Step 2 (+ Step 3 regression)
- @AC-2 (benchmark computed on its own bars, no lookahead) → Step 2, Step 3
- @AC-3 (missing benchmark bar → hold, no forward-fill, no reindex) → Step 2, Step 3
- @AC-4 (insufficient benchmark history → INSUFFICIENT_DATA names benchmark) → Step 3
- @AC-5 (warmed-from-before-start, deterministic) → Step 3
- @AC-6 (normalize + fingerprint) → Step 7
- @AC-7 (live resolves benchmark, safe degrade) → Step 4
- @AC-8 (VOO-200d dip-buy registers + backtests) → Step 3, Step 8

## Step Dependencies

- Steps 3,4,5,6 require Step 2 (the shared helper + `benchmark_bars` kwargs).
- Step 2 requires Step 1 (the proto field).
- Step 8 requires Step 1 (builder carries the field) and is the C-14 consumer surface.
- UI strategy-builder surface deferred → named follow-up `strategy-builder-source-symbol`.

---

### Step 1 — proto: add `source_symbol` to StrategyComponent

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/gen/**` — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness, additive non-breaking; `xstockstrat-analysis` owner.
**Codebase Evidence**:
- `message StrategyComponent` at `analysis.proto:300`; fields `ref_name=1..params=5`; next free tag 6.
**TDD**: N/A (proto).
**Covers**: —
**Instructions**: Add `string source_symbol = 6;` (plain, NOT `optional`) after `map<string,double> params = 5;`, with a comment: `// optional; empty = evaluated symbol (feature 152)`. Run `./scripts/buf-gen.sh`.
**Verification**: `cd packages/proto && buf lint && buf breaking --against '.git#branch=main-dev'`; `git diff --stat packages/proto/gen` shows regenerated go/python/ts stubs; `grep -rn source_symbol packages/proto/gen/python` non-empty.

---

### Step 2 — service: shared `_assemble_component_series` helper + date-join

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify
**Reviewers**: `xstockstrat-analysis` — backtest reproducibility, no look-ahead.
**Codebase Evidence**:
- `_compute_component(comp, closes)` `evaluator.py:220`; `align_indicator_points` `:300`.
- Series assembly `evaluate_with_series:148-154`, `evaluate_conditions_traced:206-212`; `evaluate` wrapper `:102-116`.
- Date transform precedent `live_loop.py:475` `bar.time.ToDatetime(tzinfo=UTC).date()`.
**TDD**: red-green required.
**Covers**: —
**Instructions**:
- Add module helper `_bar_date(bar) -> datetime.date` = `bar.time.ToDatetime(tzinfo=UTC).date()`.
- Add `async _assemble_component_series(self, comp, closes, eval_dates, benchmark_bars=None)`:
  - empty `comp.source_symbol` → `return await self._compute_component(comp, closes)` (untouched path).
  - truthy: `bb = (benchmark_bars or {}).get(comp.source_symbol)`; falsy → `{"value":[None]*len(closes)}`;
    else `series_map = await self._compute_component(comp, [b.close for b in bb])`, build
    `{_bar_date(b): idx}` for the benchmark bars, and left-join EACH series onto `eval_dates`
    (missing date → `None`), returning aligned lists `len == len(closes)`. Log a WARN when in-window
    matched-ratio < `_SOURCE_JOIN_SPARSITY_WARN` (module constant, e.g. 0.5).
- Refactor `evaluate_with_series` and `evaluate_conditions_traced` to compute `eval_dates = [_bar_date(b) for b in bars]` once and call `_assemble_component_series(comp, closes, eval_dates, benchmark_bars)` in place of the inline `_compute_component` loop; add `benchmark_bars: dict|None=None` kwarg to `evaluate`, `evaluate_with_series`, `evaluate_conditions_traced`, forwarding through the `evaluate`→`evaluate_with_series` wrapper.
**Verification**: `cd services/xstockstrat-analysis && uv run ruff check app && uv run pytest tests/test_source_symbol_parity.py -q` (Step 2b).

### Step 2b — test: helper + parity + byte-identity
**Status**: `pending` · **Service**: `xstockstrat-analysis` · **Files**: `services/xstockstrat-analysis/tests/test_source_symbol_parity.py` — create
**Reviewers**: `xstockstrat-analysis`. **TDD**: red-green required.
**Covers**: AC-1, AC-2, AC-3
**Instructions**: Fake `IndicatorsServiceStub` returns a deterministic series for given closes. Assert: (a) a `source_symbol="VOO"` component yields the benchmark-computed series date-joined onto the eval timeline, identical across `evaluate_with_series` and `evaluate_conditions_traced` (last-bar leaf); (b) a missing benchmark date → `None` at that index → leaf false; the eval symbol's own bars are all present (len unchanged); (c) `benchmark_bars={}` → all-None; (d) byte-identity: a no-`source_symbol` definition yields identical `component_series` as the pre-change path. Use real `marketdata_pb2.Bar` instances (`bar.time`), not MagicMock.
**Verification**: `cd services/xstockstrat-analysis && uv run pytest tests/test_source_symbol_parity.py -q` green; full `uv run pytest --cov=app --cov-fail-under=40`.

---

### Step 3 — service: backtest benchmark preload + CoverageGap(benchmark)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**: `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
**Reviewers**: `xstockstrat-analysis` — reproducibility, no look-ahead, coverage-gap correctness.
**Codebase Evidence**:
- `_resolve_prefixed_bars` `servicer.py:1059-1097` (raises `_InsufficientData` `:1090`); CoverageGap emit `:747-766`; per-symbol engine `_backtest_symbol_evaluated` `:1336`; `evaluate_with_series` call within backtest `~:1371`.
**TDD**: red-green required.
**Covers**: —
**Instructions**: In the evaluated-backtest path, collect distinct truthy `source_symbol`s from `definition.components`; for each, size warmup via `required_prefix_bars` over a definition slice of that symbol's components and load via `_resolve_prefixed_bars(source_symbol, range, prefix, meta)` (dedup). Catch its `_InsufficientData` and append a `CoverageGap(symbol=source_symbol, …)` via the existing path so the benchmark is named and the status gate can flip INSUFFICIENT_DATA. Pass `benchmark_bars={sym: bars}` into `evaluate_with_series`. The benchmark bars are trimmed to the window like the evaluated symbol (determinism).
**Verification**: Step 3b.

### Step 3b — test: backtest benchmark alignment + coverage + determinism + AC-8
**Status**: `pending` · **Files**: `services/xstockstrat-analysis/tests/test_backtest_source_symbol.py` — create
**Covers**: AC-2, AC-3, AC-4, AC-5, AC-8 · **TDD**: red-green required.
**Instructions**: With fake marketdata returning eval + VOO bars: (AC-2/AC-3) a benchmark gate resolves on VOO's series, a missing VOO date → hold on that bar; (AC-4) VOO with < warmup history → response status `BACKTEST_STATUS_INSUFFICIENT_DATA` and `coverage_gaps` contains `symbol=="VOO"`; (AC-5) two runs over the same explicit start+end → identical metrics; (AC-8) the VOO-200d-rising dip-buy definition registers + backtests to a valid status. Real `Bar` protos.
**Verification**: `cd services/xstockstrat-analysis && uv run pytest tests/test_backtest_source_symbol.py -q` + full coverage ≥40%.

---

### Step 4 — service: live benchmark preload + formula-warmup plumbed into live

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**: `services/xstockstrat-analysis/app/engine/live_loop.py` — modify; `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (extract formula-warmup helper); possibly `services/xstockstrat-analysis/app/services/warmup.py` — modify (no behavior change)
**Reviewers**: `xstockstrat-analysis` — live/backtest parity, no silent always-hold.
**Codebase Evidence**:
- `_eval_pair` `live_loop.py:450-466`; `_recent_range` `:443`; `_declared_formula_warmup` `servicer.py:1721`; `_prefetch_formula_warmups` `:1744`; `required_prefix_bars` `warmup.py:118`.
**TDD**: red-green required.
**Covers**: —
**Instructions**: Extract the declared-formula-warmup logic (`_declared_formula_warmup`/`_prefetch_formula_warmups`) to a location callable by both the servicer and the live loop (e.g. a small module or a shared method with a `GetFormula`-capable stub). In `_eval_pair`, for each distinct truthy `source_symbol`, size warmup via `required_prefix_bars(benchmark_slice, formula_warmup_cache)` (builtins via `builtin_lookback_bars`, formulas via the extracted cache), widen the benchmark fetch range accordingly (not the bare `_recent_range()`), fetch benchmark bars, and pass `benchmark_bars` into `evaluate`. A benchmark lacking history → all-None → hold (never crash).
**Verification**: Step 4b.

### Step 4b — test: live benchmark resolution + safe degrade + formula warmup
**Status**: `pending` · **Files**: `services/xstockstrat-analysis/tests/test_live_source_symbol.py` — create
**Covers**: AC-7 · **TDD**: red-green required.
**Instructions**: Fake marketdata/indicators: (AC-7) `_eval_pair` on a benchmark-referencing strategy resolves `mkt` from VOO's live-window bars aligned onto the eval timeline; a VOO missing the current date → benchmark leaf false (hold), no exception; a custom-formula benchmark gets a warmup-widened fetch (assert the requested range spans ≥ the formula's declared warmup).
**Verification**: `cd services/xstockstrat-analysis && uv run pytest tests/test_live_source_symbol.py -q` + coverage.

---

### Step 5 — service: readiness + opportunities benchmark preload (dedup once/pass)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**: `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
**Reviewers**: `xstockstrat-analysis` — decide-surface parity, per-pass fetch bound.
**Codebase Evidence**: `EvaluateReadiness` `servicer.py:2651`; `ListOpportunities` compute `:3143-3184`; `_bars_fetch_sem` + `bars_by_symbol` dedup `:3143-3178`; `_READINESS_LOOKBACK_DAYS` `:2632`.
**TDD**: red-green required.
**Covers**: —
**Instructions**: Readiness: preload benchmark bars for the strategy's distinct source_symbols (same lookback fetch) and pass `benchmark_bars` to `evaluate_conditions_traced`. Opportunities: load each distinct benchmark **once per compute pass** under `_bars_fetch_sem` (add to/parallel with `bars_by_symbol`), reused across all evaluated symbols; thread into each `evaluate_conditions_traced` call.
**Verification**: Step 5b.

### Step 5b — test: readiness/opportunities benchmark + single-fetch dedup
**Status**: `pending` · **Files**: `services/xstockstrat-analysis/tests/test_readiness_opportunities_source_symbol.py` — create
**Covers**: AC-2 · **TDD**: red-green required.
**Instructions**: Readiness on a benchmark strategy resolves the benchmark leaf; Opportunities over N eval symbols sharing one VOO benchmark issues exactly ONE VOO GetBars (assert call count).
**Verification**: `cd services/xstockstrat-analysis && uv run pytest tests/test_readiness_opportunities_source_symbol.py -q` + coverage.

---

### Step 6 — service: GetIndicatorSeries benchmark preload (align onto request.times)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**: `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
**Reviewers**: `xstockstrat-analysis`. **TDD**: red-green required.
**Codebase Evidence**: GetIndicatorSeries loop `servicer.py:2729-2732`; request carries `symbol`+`times` `analysis.proto:638`.
**Covers**: —
**Instructions**: For a component with truthy `source_symbol`, fetch that symbol's bars server-side (warmup-sized) and call `_assemble_component_series(comp, closes, eval_dates=[t.ToDatetime(UTC).date() for t in request.times], benchmark_bars={sym:bars})` instead of `_compute_component`; keep the existing `NamedSeries` build + `_component_series_sem`.
**Verification**: Step 6b.

### Step 6b — test: GetIndicatorSeries benchmark series aligned onto request.times
**Status**: `pending` · **Files**: `services/xstockstrat-analysis/tests/test_indicator_series_source_symbol.py` — create
**Covers**: AC-2 · **TDD**: red-green required.
**Instructions**: A `source_symbol="VOO"` component returns `NamedSeries` aligned onto `request.times` (unset `IndicatorValue.value` → None at gap dates), computed on VOO closes.
**Verification**: `cd services/xstockstrat-analysis && uv run pytest tests/test_indicator_series_source_symbol.py -q` + coverage.

---

### Step 7 — service: server-authoritative normalization (both write paths)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**: `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
**Reviewers**: `xstockstrat-analysis` — fingerprint stability, write-path guard.
**Codebase Evidence**: REGISTER `MessageToDict` `servicer.py:2232`; UPDATE merge `_merge_definition_json` `:2300-2315,:3935-3949`; fingerprint `:3994`.
**TDD**: red-green required.
**Covers**: —
**Instructions**: Add `_normalize_source_symbol(s) -> str` (`s.strip().upper()`, `""` when empty). Apply it to every component's `source_symbol` on the REGISTER path (before `MessageToDict`/persist) and inside the UPDATE merge path, so `"voo "` persists as `"VOO"` and `"  "` persists as unset. No client-side reliance.
**Verification**: Step 7b.

### Step 7b — test: normalization + fingerprint
**Status**: `pending` · **Files**: `services/xstockstrat-analysis/tests/test_manage_strategy_source_symbol.py` — create
**Covers**: AC-6 · **TDD**: red-green required.
**Instructions**: Register with `source_symbol="voo "` → stored `"VOO"`; `"  "` → unset; changing VOO→SPY changes `_definition_fingerprint`; empty-`source_symbol` definition fingerprint == pre-change value (byte-identity).
**Verification**: `cd services/xstockstrat-analysis && uv run pytest tests/test_manage_strategy_source_symbol.py -q` + coverage.

---

### Step 8 — service: agent manage_strategy builder + parity test + strat-lab skill

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` and/or `services/xstockstrat-agent/app/client.py` — modify (dict→proto builder carries `source_symbol`)
- `services/xstockstrat-agent/tests/…` — create/modify (descriptor-parity test)
- `plugins/strat-lab/…` (backtest skill) — modify (same PR, root CLAUDE.md rule)
**Reviewers**: `xstockstrat-agent` — MCP tool contract stability, builder parity, strat-lab parity.
**Codebase Evidence**: pinned at execution via `grep -n "source_symbol\|StrategyComponent\|ref_name" services/xstockstrat-agent/app/*.py` and the `test_backtest_view.py::test_summary_key_set_covers_every_proto_field` parity pattern (Ledger RC-1/F-12).
**TDD**: red-green required.
**Covers**: AC-8
**Instructions**: Add `source_symbol` to the `manage_strategy` component dict→proto request builder; add a descriptor-parity test asserting every `StrategyComponent` proto field is covered by the builder (mirror `test_backtest_view.py`). Update the `strat-lab` `backtest` skill to document `source_symbol` on components.
**Verification**: `cd services/xstockstrat-agent && uv run pytest -q` (+ coverage per CI); parity test green.

---

### Step 9 — docs: service CLAUDE.md + teardown scrubber

**Status**: `pending`
**Service**: `docs`
**Files**: `services/xstockstrat-analysis/CLAUDE.md` — modify (document `source_symbol` under Composable Strategy Rules); feature `context.md` — modify
**Reviewers**: none.
**TDD**: N/A (docs).
**Covers**: —
**Instructions**: Document `source_symbol` (benchmark operand) in the analysis service CLAUDE.md § Composable Strategy Rules. Run `/context-scrubber scan` scoped to touched context files if the plugin is available; else note in PR body.
**Verification**: `grep -n source_symbol services/xstockstrat-analysis/CLAUDE.md` non-empty.

---

## Deviation Log

- **D-1 (Step 3):** benchmark bars are preloaded **once per RunBacktest run** (before the
  per-symbol loop) rather than inside `_backtest_symbol_evaluated` per symbol — a benchmark (VOO)
  is shared by every evaluated symbol, so a per-symbol fetch would re-fetch VOO N times and emit N
  duplicate coverage gaps. `_backtest_symbol_evaluated` gained a `benchmark_bars` param; the run
  loads them once and passes them in. Insufficient benchmark → one coverage gap, `symbols_to_run`
  emptied → INSUFFICIENT_DATA.
- **D-2 (Step 4):** rather than extract the servicer's `_declared_formula_warmup` (which also
  records feature-086 soft-delete warnings and would risk backtest behavior), a self-contained
  `StrategyEvaluator.declared_formula_warmups` was added for the live path to size a
  custom-formula benchmark's warmup. Backtest servicer untouched (zero regression risk).
- **D-3 (Step 4):** the pre-existing guard test `test_the_live_loop_still_uses_its_own_fixed_lookback`
  (which asserted `"warmup" not in live_loop source`) was **intentionally** made obsolete by the
  operator decision to wire warmup into live for benchmark components — its own docstring authorized
  this. Repurposed to assert the **evaluated** symbol still uses the fixed 365-day lookback; the FR-7
  divergence note in `docs/warmup.md` was updated.
- **D-4 (Step 8):** the descriptor-parity test `test_build_component_covers_every_proto_field` caught
  the new `source_symbol` field RED before the builder update (the RC-1/F-12 guard working as
  designed); the test input was extended to cover it + a value round-trip.

_All steps complete. Teardown: the context-forge/context-scrubber plugin was not available in this
session, so a manual scoped audit of the touched context files (analysis CLAUDE.md, docs/warmup.md,
strat-lab SKILL.md, mcp-tools.md) was done instead — noted in the PR body._
