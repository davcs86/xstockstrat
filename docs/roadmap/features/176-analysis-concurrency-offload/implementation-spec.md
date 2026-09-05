# Implementation Spec: analysis-concurrency-offload

**Status**: `pending`
**Created**: 2026-09-05
**Feature**: `docs/roadmap/features/176-analysis-concurrency-offload/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/analysis-concurrency-offload`

---

## Execution Summary

This is an **output-equivalence refactor**: parallelize the analysis serial cross-service fan-out
and move CPU-bound / blocking work off the single asyncio event loop, with byte-for-byte results
versus the serial baseline (`design.md` § Chosen Approach). Order of work follows recon's Recommended
Scope, sequenced so each service change lands with its paired red-before-green test:

1. **Step 1 (config)** registers the two new no-seed analysis keys and documents enforcement of the
   already-declared `indicators.sandbox.max_concurrent`. No seed migration (follow the existing
   `analysis.opportunity.*` no-seed pattern — `design.md` § Config keys; recon § Risks "config keys
   MUST be no-seed").
2. **Steps 2–3 (FR-5, indicators)** — self-contained sandbox offload; no dependency on the analysis
   work.
3. **Steps 4–5 (FR-3, analysis evaluator)** land the optional `component_sem` param **first**, because
   the readiness (FR-2) and opportunities (FR-1) construction sites thread that sem in.
4. **Steps 6–7 (FR-2, readiness)** then **Steps 8–9 (FR-1/FR-6, opportunities)** restructure the two
   serial loops onto the evaluator built in Step 4.
5. **Steps 10–11 (FR-4)** offload the CPU-bound simulator cores + screener onto a dedicated bounded
   `ThreadPoolExecutor`. FR-1/FR-2/FR-3 are pure-asyncio and never submit to the executor, so a
   backtest burst cannot stall the interactive fan-out (`design.md` § FR-4).

**Consumer surface (C-14):** the product spec marks the surface as the existing UI `/insights`
Opportunities + Watchlist panes — **performance/latency only, no shape or control change** — and the
Agent tools (`list_opportunities`, `run_backtest`, `screen_symbols`, `test_formula`) keep their
response shapes. This is a decision, not an omission: **no dedicated UI/Agent step is required** and
the `strat-lab` plugin needs no update (no `run_backtest`/`manage_strategy` API change). The
`merge-order.md` 176-before-177 WARN row was already added at design-approval (verified present,
`merge-order.md:227-242`) — no step re-adds it.

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1 @FR-1` opportunity fan-out identical set, bound never exceeded | Step 9 |
| `@AC-2 @FR-2` readiness parallel under shared bound, verdicts equal | Step 7 |
| `@AC-3 @FR-3` per-component concurrent, byte-identical series | Step 5 |
| `@AC-4 @FR-4` long backtest does not block another read | Step 11 |
| `@AC-5 @FR-5` concurrent formulas not serialized; timeout preserved | Step 3 |
| `@AC-6 @FR-6` parallel fan-out preserves per-user owner scoping | Step 9 |

## Step Dependencies

- **Step 2 (FR-5 service)** requires **Step 1**: reads `indicators.sandbox.max_concurrent` (default 4)
  registered there. (Independent of all analysis steps — Steps 2–3 can land in parallel with 4–11.)
- **Step 4 (FR-3 evaluator)** must precede **Step 6 (FR-2)** and **Step 8 (FR-1)**: those steps
  construct `StrategyEvaluator` with the new `component_sem=self._component_series_sem` argument that
  Step 4 introduces at `servicer.py:2695` and `:3372`.
- **Step 8 (FR-1)** requires **Step 1**: reads the new `analysis.opportunity.max_concurrent_candidates`
  (default 4).
- **Step 10 (FR-4)** requires **Step 1**: reads the new `analysis.compute.max_worker_threads`
  (default 4). Step 10 is independent of Steps 4/6/8 at the code level (different methods) but is
  sequenced last so the pure-asyncio fan-out work is proven before the executor work.
- Each `service` step's paired `test` step (Constitution C-08) immediately follows it.
- **176→177 overlap (WARN, not hard-order):** `_compute_opportunities` / `EvaluateReadiness` /
  `evaluate_conditions_traced` are also edited by feature 177; 177's `/sdd-spec` writes against 176's
  post-restructure signatures (`merge-order.md:238-242`).

---

### Step 1 — config: Register the two new analysis concurrency keys; document enforcement of `indicators.sandbox.max_concurrent`

**Status**: `done`
**Service**: `xstockstrat-analysis`, `xstockstrat-indicators`, `docs/patterns/`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (add two rows to § Config Keys Consumed)
- `services/xstockstrat-indicators/CLAUDE.md` — modify (update the `indicators.sandbox.max_concurrent` row from "Documented, not yet enforced" to enforced)
- `docs/patterns/config-governance.md` — modify (add two Per-Feature Registered Keys log rows)

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility / determinism; `xstockstrat-indicators` owner — timeout enforcement, no side-effects; `xstockstrat-config` owner — config key naming (`<service>.<category>.<key>`), scoping

**Codebase Evidence**:
- No seed migration exists or is needed: `analysis.opportunity.max_concurrent_bars_fetches` and
  `analysis.series.max_concurrent_components` are already **no-seed** keys read at `__init__` —
  `config-governance.md:295` "mirrors `analysis.series.max_concurrent_components`'s no-seed pattern";
  registered rows at `config-governance.md:299,304,310`.
- Existing analysis § Config Keys Consumed table with the sibling-semaphore rows:
  `services/xstockstrat-analysis/CLAUDE.md:272` (header), `:303` (`analysis.screener.max_concurrent_formula_evals`),
  `:304` (`analysis.series.max_concurrent_components`).
- Indicators key already documented-but-inert: `services/xstockstrat-indicators/CLAUDE.md:72`
  "`indicators.sandbox.max_concurrent` | int | `4` | **Documented, not yet enforced** — … no
  `Semaphore`/limit reads it".

**TDD**: `N/A (config/docs registration — no code in this step; the keys are consumed and asserted in Steps 2, 8, 10)`

**Covers**: —

**Instructions**:
1. In `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed (table starting `:272`), add:
   - `analysis.opportunity.max_concurrent_candidates` | int | `4` | Bounds the per-candidate
     `evaluate_conditions_traced` fan-out in `_compute_opportunities` Phase 2 (feature 176) —
     **separate** from `analysis.opportunity.max_concurrent_bars_fetches` so a large opportunity
     compute cannot starve interactive readiness (priority-inversion guard). Read once in
     `AnalysisServicer.__init__` via `get_int` with a `max(1, …)` clamp. No seed migration.
   - `analysis.compute.max_worker_threads` | int | `4` | Size of the dedicated `ThreadPoolExecutor`
     that runs the pure-CPU simulator cores + screener sync tail off the event loop (feature 176,
     FR-4). Executor threads open **no DB connection** (F-06: asyncpg pool stays 2). Read once in
     `AnalysisServicer.__init__` via `get_int` with a `max(1, …)` clamp. No seed migration.
2. In `services/xstockstrat-indicators/CLAUDE.md:72`, reword the `indicators.sandbox.max_concurrent`
   row: default `4`; description now "Semaphore bound on concurrent off-loop sandbox `subprocess.run`
   spawns in `ExecuteFormula` (feature 176, FR-5). Read once in `IndicatorsServicer.__init__` via a
   new `ConfigWatcher.sandbox_max_concurrent()` accessor with a `max(1, …)` clamp." Remove the
   "not yet enforced" wording.
3. In `docs/patterns/config-governance.md` § Per-Feature Registered Keys (header `:101`), add two
   rows for feature 176 naming both new keys, their defaults (4 / 4), and "no-seed (read at
   `__init__` via WatchConfig)".

**Verification**:
```
grep -n "analysis.opportunity.max_concurrent_candidates\|analysis.compute.max_worker_threads" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
grep -n "max_concurrent" services/xstockstrat-indicators/CLAUDE.md   # row no longer says "not yet enforced"
```
Confirm both new keys appear in the analysis CLAUDE.md and the config-governance log, and the
indicators row is updated. No `migrations/` file is added (no-seed).

---

### Step 2 — service: FR-5 — offload the indicators sandbox `subprocess.run` and enforce `indicators.sandbox.max_concurrent`

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/config/watcher.py` — modify (add `sandbox_max_concurrent()` accessor)
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify (add `import asyncio`; build `self._sandbox_sem` in `__init__`; offload `sandbox.execute_formula` in `ExecuteFormula`)

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- Blocking call on the event loop today: `ExecuteFormula` (`servicer.py:85`) calls the **synchronous**
  `sandbox.execute_formula(...)` at `servicer.py:139`; `execute_formula` is `def` (not `async def`),
  `sandbox.py:159`, and runs `subprocess.run([sys.executable, script_path], … timeout=timeout_ms/1000)`
  at `sandbox.py:188` — a real child process; timeout → `subprocess.TimeoutExpired` → `SandboxResult`
  with `exit_reason="timeout"`.
- `IndicatorsServicer.__init__(self, config_watcher, db_pool=None)` at `servicer.py:28-29`; **`asyncio`
  is NOT imported** (imports listed `servicer.py:5-16`) — must add `import asyncio`.
- Existing sandbox accessors on `ConfigWatcher`: `sandbox_timeout_ms` `watcher.py:129`,
  `sandbox_memory_bytes` `:133`, `sandbox_allowed_imports` `:137`; base `get_int` at `watcher.py:104`.
  **No `sandbox_max_concurrent` accessor exists** (grep confirms). `indicators.sandbox.max_concurrent`
  is read nowhere today (recon § Codebase Map; CLAUDE.md:72).
- `ComputeIndicator` (`servicer.py:56`) uses the numpy `indicators_engine.compute` (GIL-releasing),
  **not** the subprocess sandbox — out of scope for FR-5, unchanged.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `app/config/watcher.py`, after `sandbox_allowed_imports` (`:137`), add:
   `def sandbox_max_concurrent(self) -> int: return self.get_int("indicators.sandbox.max_concurrent", default=4)`
   (mirrors the existing `sandbox_*` accessor idiom; F-07 — read via WatchConfig, never hardcoded).
2. In `app/handlers/servicer.py`, add `import asyncio` to the import block (`:5-16`).
3. In `IndicatorsServicer.__init__` (`:28`), after `self._cfg = config_watcher` (`:29`), construct the
   bound: `self._sandbox_sem = asyncio.Semaphore(max(1, config_watcher.sandbox_max_concurrent()))`
   (the `max(1, …)` clamp guards a negative/zero-trap value, matching the analysis semaphore idiom
   at `analysis servicer.py:391`).
4. In `ExecuteFormula`, replace the synchronous call at `:139-146`
   (`result = sandbox.execute_formula(source=…, …, params=resolved_params)`) with an off-loop,
   bounded call:
   ```
   async with self._sandbox_sem:
       result = await asyncio.to_thread(
           sandbox.execute_formula,
           source=source,
           input_data=input_data,
           allowed_imports=allowed_imports,
           timeout_ms=timeout_ms,
           memory_bytes=memory_bytes,
           params=resolved_params,
       )
   ```
   The `SandboxResult` handling below (`:147+`, `exit_reason_map`, declared-outputs check, response
   assembly) is unchanged — timeout semantics are preserved because `execute_formula` still owns the
   `subprocess.run(timeout=…)` and still returns `exit_reason="timeout"`.

**Verification** (paired with Step 3): lint —
`cd services/xstockstrat-indicators && ruff check . && ruff format --check .`
`grep -n "asyncio.to_thread\|self._sandbox_sem\|sandbox_max_concurrent" services/xstockstrat-indicators/app/handlers/servicer.py services/xstockstrat-indicators/app/config/watcher.py`
— confirm the offload, the semaphore acquire, and the new accessor are present.

---

### Step 3 — test: FR-5 — concurrent formula executions run off-loop under the bound; timeout still enforced

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox.py` — modify (or a new `tests/test_execute_formula_concurrency.py`)

**Reviewers**: `xstockstrat-indicators` owner — sandboxing, timeout enforcement

**Codebase Evidence**:
- Existing sandbox test suite present: `services/xstockstrat-indicators/tests/test_sandbox.py`
  (real file, verified in `tests/` inventory), `tests/conftest.py` present (C-13 canonical Python
  fixture home for this service).
- Coverage threshold for indicators is **50%** (`reference/spec-template.md` table;
  `services/xstockstrat-indicators` row).

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:
1. **Concurrency (AC-5):** construct `IndicatorsServicer` with a `ConfigWatcher` stub whose
   `sandbox_max_concurrent()` returns 4 (and `sandbox_timeout_ms` a large value). Monkeypatch
   `app.services.sandbox.execute_formula` with a synchronous function that increments a shared
   in-flight counter, records the peak, `time.sleep(~0.2s)` (simulating the 2-second formula), then
   decrements — mirroring the analysis concurrency-teeth test
   (`test_analysis_servicer.py:4720 test_cross_user_concurrency_bounded_by_semaphore`, which asserts
   `peak == 2`). Dispatch 4 `ExecuteFormula` calls via `asyncio.gather`. Assert (a) wall-clock is
   ≈ one sleep, not 4× (they ran concurrently off the loop, not serialized), and (b) peak in-flight
   ≤ 4 (the configured bound). Add a second case with `sandbox_max_concurrent()` = 2 asserting
   `peak == 2` to prove the semaphore actually gates.
2. **Timeout preserved (AC-5):** a case that lets the real `sandbox.execute_formula` run a formula
   source guaranteed to exceed a tiny `timeout_ms_override`; assert the response's
   `exit_reason == SANDBOX_EXIT_REASON_TIMEOUT` (unchanged from pre-offload behavior).
3. C-13: any dummy formula source/params literal used by more than one test in this file moves to
   `tests/conftest.py`; a single-consumer literal stays inline (state this verdict in the step).

**Verification**:
`cd services/xstockstrat-indicators && pytest --cov=app --cov-fail-under=50`
`cd services/xstockstrat-indicators && ruff check . && ruff format --check .`
— run against the pre-Step-2 tree the concurrency test must FAIL (serialized wall-clock ≈ 4× sleep,
or no `_sandbox_sem`); after Step 2 it passes and coverage ≥ 50%.

---

### Step 4 — service: FR-3 — optional `component_sem` on `StrategyEvaluator`; concurrent per-component dispatch (None ⇒ serial)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify (add `component_sem=None` param; branch the component loop)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (thread the sem at 2 construction sites; pass `None` explicitly at 2 sites)

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `StrategyEvaluator.__init__(self, indicators_stub, propagation_meta=())` at `evaluator.py:107`;
  fields `self._indicators`, `self._meta` (stateless — only read-only refs + per-call locals).
- The per-component fan-out to parallelize is inside `evaluate_conditions_traced`
  (`def` at `evaluator.py:195`): the loop `for comp in definition.components:` at `evaluator.py:234`
  calling `await self._assemble_component_series(comp, closes, eval_dates, benchmark_bars)`
  (`_assemble_component_series` def at `evaluator.py:341`), assembling `component_series[comp.ref_name]`
  and the `f"{comp.ref_name}.{series_name}"` entries. Reassembly is **keyed by `ref_name`**
  (order-independent — `design.md` § Business Rules Touched).
- The four `StrategyEvaluator(self._indicators, propagation_meta)` construction sites:
  `servicer.py:1463` (`_backtest_symbol_evaluated`), `:2695` (`EvaluateReadiness`),
  `:2892` (`ScoreStrategy`), `:3372` (`_compute_opportunities`).
- Existing process-lifetime component bound to reuse: `self._component_series_sem = asyncio.Semaphore(max(1, get_int("analysis.series.max_concurrent_components", 4)))` at `servicer.py:386-389`.
- `ScoreStrategy` already acquires `self._component_series_sem` at its caller (`servicer.py:2904`,
  `async with self._component_series_sem:`) — so it must be threaded as `None` here to avoid a
  double-acquire (`design.md` § FR-3 encoding 1; recon-round-3 adversary point 1).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `evaluator.py`, extend `__init__` (`:107`) to `def __init__(self, indicators_stub, propagation_meta=(), component_sem=None):`
   and store `self._component_sem = component_sem`.
2. In `evaluate_conditions_traced`, replace the serial loop at `evaluator.py:234-240` with a branch
   on `self._component_sem is not None`:
   - **`None` ⇒ serial, byte-for-byte unchanged** (keep the existing `for comp …: series_map = await
     self._assemble_component_series(...)` body verbatim). This is the load-bearing invariant — the
     backtest (`:1463`) and score (`:2892`) sites rely on serial/existing-acquire behavior
     (`design.md`: "`component_sem=None` MUST mean SERIAL").
   - **not `None` ⇒ concurrent**: build one coroutine per component, each wrapped
     `async with self._component_sem: return comp.ref_name, await self._assemble_component_series(comp, closes, eval_dates, benchmark_bars)`,
     `await asyncio.gather(*tasks)` (no `return_exceptions` — preserve the serial exception scope, a
     `FormulaExecutionError` still propagates), then reassemble `component_series` from the returned
     `(ref_name, series_map)` pairs exactly as the serial loop does (primary → `component_series[ref_name]`,
     plus each `f"{ref_name}.{series_name}"`). Reassembly is keyed by `ref_name`, so gather order does
     not affect output.
3. In `servicer.py`, thread the shared sem at the **interactive** sites:
   `:2695` → `StrategyEvaluator(self._indicators, propagation_meta, component_sem=self._component_series_sem)`;
   `:3372` → same.
4. Pass `None` **explicitly** at the batch sites to make the serial contract legible:
   `:1463` → `StrategyEvaluator(self._indicators, propagation_meta, component_sem=None)`;
   `:2892` → same (score already acquires `_component_series_sem` at `:2904` — no double-acquire).

**Verification** (paired with Step 5): lint —
`cd services/xstockstrat-analysis && GOWORK=off :; ruff check . && ruff format --check .`
`grep -n "component_sem" services/xstockstrat-analysis/app/services/evaluator.py services/xstockstrat-analysis/app/handlers/servicer.py`
— confirm the param exists, the `is not None` branch is present, and all four construction sites pass
`component_sem=` explicitly (2 with the sem, 2 with `None`).

---

### Step 5 — test: FR-3 — components dispatched concurrently under the bound; assembled series byte-identical; None ⇒ serial

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_evaluator.py` — modify (or `test_evaluator_traced.py`)

**Reviewers**: `xstockstrat-analysis` owner — scoring determinism, no look-ahead

**Codebase Evidence**:
- Existing evaluator test suites: `tests/test_strategy_evaluator.py`, `tests/test_evaluator_traced.py`
  (verified in `tests/` inventory). `tests/conftest.py` present (C-13 home).
- Concurrency-teeth precedent to mirror: `test_analysis_servicer.py:4720`
  (`test_cross_user_concurrency_bounded_by_semaphore`, asserts `peak == 2`).
- Analysis coverage threshold **40%** (`reference/spec-template.md` table).

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. **Equivalence (AC-3):** a strategy definition with 4 indicator/formula components. Build one
   `StrategyEvaluator` with `component_sem=None` (serial) and one with
   `component_sem=asyncio.Semaphore(4)` over the **same** `AsyncMock` indicators stub returning fixed
   per-component series. Assert the two `evaluate_conditions_traced(...)` results are equal
   (`component_series` byte-identical and the readiness verdict identical) — proving gather-order
   independence via `ref_name` keying.
2. **Bound (AC-3):** wrap the stub's `ComputeIndicator`/`ExecuteFormula` with the shared in-flight
   counter/peak recorder (mirror `test_cross_user_concurrency_bounded_by_semaphore`); with
   `component_sem=asyncio.Semaphore(2)` assert `peak == 2` (dispatched concurrently but capped).
3. **None ⇒ serial (regression guard):** with `component_sem=None`, assert peak in-flight `== 1`
   (strictly serial) — this is the guard that the backtest/score sites keep their existing behavior.
4. C-13: reuse fixtures from `conftest.py` where a definition/stub literal gains a second consumer;
   state the single-vs-second-consumer verdict.

**Verification**:
`cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40 tests/test_strategy_evaluator.py tests/test_evaluator_traced.py`
(full-suite coverage run in Step 9/11); `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
— pre-Step-4 the concurrency + None⇒serial cases FAIL (no `component_sem` param); post-Step-4 pass.

---

### Step 6 — service: FR-2 — parallelize `EvaluateReadiness` per-symbol fan-out under a `_bars_fetch_sem` body-gate

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`EvaluateReadiness`, `:2660-2723`)

**Reviewers**: `xstockstrat-analysis` owner — no look-ahead bias, determinism

**Codebase Evidence**:
- Serial loop today: `EvaluateReadiness` def `servicer.py:2660`; benchmark loaded **once before the
  loop** at `:2698` (`benchmark_bars = await self._load_benchmark_bars_windowed(definition, range_msg, propagation_meta)`);
  the serial loop `for symbol in request.symbols:` at `:2702` does `await self._fetch_bars_paged(...)`
  (`:2705`, best-effort try/except → `bars=[]`, `fetch_ok=False`), a WARN on empty, then
  `await evaluator.evaluate_conditions_traced(definition, bars, symbol, rule=rule, benchmark_bars=benchmark_bars)`
  (`:2718`), appending `_readiness_to_proto(trace)` per symbol (`:2721`) — **always one entry per
  symbol, even on fetch failure**.
- The bound to use: `self._bars_fetch_sem` (`servicer.py:391`,
  `analysis.opportunity.max_concurrent_bars_fetches`, default 2) — FR-2's product-spec text requires
  "the **same** bounded limit that already guards the opportunity bars-fetch path".
- Because the benchmark is loaded **before** the loop (`:2698`), a whole-body `_bars_fetch_sem` gate
  hits **no** nested re-acquire (unlike `_compute_opportunities`, where
  `_load_benchmark_bars_windowed` re-acquires inside the candidate body) — `design.md` § Readiness;
  recon-round-3 adversary point 2. Chosen over leaf-only Option B to bound pending-coroutine memory.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Keep the pre-loop benchmark load (`:2698`) and the `evaluator` construction (`:2695`, now carrying
   `component_sem=self._component_series_sem` from Step 4) unchanged.
2. Replace the serial `for symbol in request.symbols:` loop (`:2702-2721`) with a per-symbol
   coroutine `_readiness_for(symbol)` whose **entire body is wrapped** `async with self._bars_fetch_sem:`
   — inside it, run the exact existing per-symbol logic verbatim (the `_fetch_bars_paged` try/except
   → `bars=[]`/`fetch_ok=False`, the empty-bars WARN, `evaluate_conditions_traced(...)`), and
   `return _readiness_to_proto(trace)`. The per-symbol catch stays **inside** the task (serial
   granularity preserved — no blanket `return_exceptions`).
3. Dispatch `results = await asyncio.gather(*[_readiness_for(s) for s in request.symbols])` and build
   the response `readiness=list(results)` — **ordered gather preserves `request.symbols` order**, so a
   per-symbol entry is emitted for every symbol in the original order (byte-identical to serial).
4. Do **not** touch `analysis.opportunity.max_concurrent_candidates` here — readiness is interactive
   and must not share the batch limiter (priority-inversion guard, `design.md` § Readiness).

**Verification** (paired with Step 7): lint —
`cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
`grep -n "async with self._bars_fetch_sem\|asyncio.gather" services/xstockstrat-analysis/app/handlers/servicer.py`
— confirm the readiness body-gate + gather are present in `EvaluateReadiness`.

---

### Step 7 — test: FR-2 — readiness verdicts equal serial; per-symbol GetBars bounded; order preserved; large-request memory

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_readiness_opportunities_source_symbol.py` — modify (or `test_analysis_servicer.py`)

**Reviewers**: `xstockstrat-analysis` owner — determinism, no look-ahead

**Codebase Evidence**:
- Existing readiness test surface: `tests/test_readiness_opportunities_source_symbol.py`,
  `tests/test_analysis_servicer.py` (`make_servicer()` at `:34`; concurrency-teeth pattern at `:4720`).
- Open risk to cover: readiness large-`request.symbols` pending-coroutine memory (`design.md` § Open
  Risks; recon-round-3 point 2 — "add a large-request.symbols peak/memory test").

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. **Verdict equivalence (AC-2):** a 20-symbol watchlist bound to one strategy. Compare each symbol's
   readiness verdict from `EvaluateReadiness` against the verdict the serial implementation produced
   (a fixed-response `AsyncMock` marketdata/indicators stub yields deterministic bars) — assert equal
   membership and **preserved order** vs `request.symbols`.
2. **Bound (AC-2):** blocking-`GetBars` mock with the shared in-flight/peak counter (mirror
   `test_cross_user_concurrency_bounded_by_semaphore:4720`); assert peak concurrent `_fetch_bars_paged`
   in-flight `== 2` (the configured `analysis.opportunity.max_concurrent_bars_fetches` default),
   proving the body-gate binds the same bound the opportunity path uses.
3. **Large-request memory (open risk):** a large `request.symbols` (e.g. 200); assert peak in-flight
   stays ≤ 2 (pending-coroutine/in-flight bars bounded, not one-per-symbol simultaneously).
4. C-13: single-vs-second-consumer verdict on any watchlist/strategy literal.

**Verification**:
`cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40`
`cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
— pre-Step-6 the bound/peak test FAILs (serial → peak 1, or the large-request test shows unbounded);
post-Step-6 passes with coverage ≥ 40%.

---

### Step 8 — service: FR-1/FR-6 — three-phase single-flight `_compute_opportunities` fan-out under `analysis.opportunity.max_concurrent_candidates`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`AnalysisServicer.__init__` add the candidates sem; `_compute_opportunities`, `:3109`/`:3372-3475`)

**Reviewers**: `xstockstrat-analysis` owner — determinism, owner-scoping (no look-ahead)

**Codebase Evidence**:
- Serial candidate loop: `_compute_opportunities(self, user_id, propagation_meta)` def `servicer.py:3109`;
  the `evaluator = StrategyEvaluator(...)` at `:3372` (carries `component_sem` from Step 4); the caches
  `strategy_defs` (`:3374`), `bars_by_symbol` (`:3377`), `benchmark_bars_cache` (`:3380`); the loop
  `for c in selected:` at `:3385`.
- Eligibility predicate (must be lifted **verbatim**): `if strat and not (c["muted"] and not c["is_held"]):`
  (`:3393`) → `definition = await self._load_strategy_definition(user_id, strat, strategy_defs)`
  (`:3395`, def at `:3476`, owner-scoped) → bars under `async with self._bars_fetch_sem:` (`:3399`)
  with the `except → bars=[]` catch (`:3404`) → `session_end_seconds = max(session_end_seconds, newest)`
  (`:3412`, order-free max) → `benchmark_bars = await self._load_benchmark_bars_windowed(definition, …, cache=benchmark_bars_cache, sem=self._bars_fetch_sem)` (`:3414-3420`) →
  `readiness = await evaluator.evaluate_conditions_traced(definition, bars, sym, rule=rule, benchmark_bars=benchmark_bars)` (`:3423`) → row assembled and `rows.append({...})` (`:3455-3468`).
- IDOR guard (fails.md:1153, feature 133): `user_id` is resolved once by the caller
  (`_caller_user_id` `servicer.py:446`) and passed into `_compute_opportunities`;
  `_load_strategy_definition(user_id, …)` and `list_live_enabled(user_id)`
  (`app/repositories/strategies.py:214`, `AND user_id=$1`) are owner-scoped. Every concurrent branch
  must close over the **same** `user_id` — no unscoped read.
- TimescaleDB shared-memory bound (feature 141): `self._bars_fetch_sem` (`:391`) must stay the leaf
  bound on `GetBars`; parallelize **under** it, never remove it.
- New bound to add: `self._candidates_sem = asyncio.Semaphore(max(1, self._cfg.get_int("analysis.opportunity.max_concurrent_candidates", 4)))`
  in `__init__` next to the sibling sems (`servicer.py:386-393`) — **distinct** from `_bars_fetch_sem`
  (avoids the non-reentrant nested re-acquire deadlock in `_load_benchmark_bars_windowed`,
  `design.md` § Rejected Alternatives).

**TDD**: `red-green required`

**Covers**: —

**Instructions** (restructure `:3385-3455` into three phases; keep everything after `:3455` — the
`session_end`/`valid_until` tail `:3457-3475` — unchanged):
1. **`__init__`:** add `self._candidates_sem` as above.
2. **Phase 0 — dedup-load strategy defs:** for the unique `c["strategy_id"]` across `selected` that
   pass the eligibility predicate, `await self._load_strategy_definition(user_id, strat, strategy_defs)`
   once each (owner-scoped; `strategy_defs` cache populated). `user_id` is the caller's, closed over by
   every later task (IDOR guard).
3. **Phase 1 — single-flight bars + benchmarks:** derive the exact **serial-eligible** symbol set —
   `{ sym : ∃ c with c["strategy_id"] truthy AND not (c["muted"] and not c["is_held"]) (`:3393`) AND
   strategy_defs[strat] is not None (`:3395`) }` — and, via `asyncio.gather`, fetch each **unique**
   symbol's bars once (each task `async with self._bars_fetch_sem:` + the verbatim `except → bars=[]`
   catch, populating `bars_by_symbol`) and each **unique** benchmark once via
   `_load_benchmark_bars_windowed(..., cache=benchmark_bars_cache, sem=self._bars_fetch_sem)`. Within a
   task the two sem acquisitions are **sequential, never nested**. Fetching exactly the serial-eligible
   set keeps `session_end_seconds` (`max()` over fetched bars, `:3412`) identical to serial — an
   over-fetched symbol would raise it and break `@AC-14` ranking (load-bearing invariant,
   `design.md` § Phase 1).
4. **Phase 2 — per-candidate evaluate under `_candidates_sem`:** one coroutine per `c in selected`,
   each `async with self._candidates_sem:` running the **cache-only** remainder of the serial body —
   read `bars_by_symbol[sym]`/`benchmark_bars_cache` (no bars leaf-fetch), `evaluate_conditions_traced`
   (which still fans out indicator RPCs per component, bounded by `_component_series_sem` from Step 4),
   the `is_held`/exit-fires logic, the signal_params target/stop fold, `_resolve_action_tag`, and the
   row dict. **No `return_exceptions`** — keep the serial per-candidate scope. Reassemble `rows` from
   the **gather-ordered** results in `selected` order (drop `None` for the `action is None`/`continue`
   cases exactly as serial), so the final `rows` is byte-identical to the serial append.
5. Leave the `session_end`/`valid_until` tail (`:3457-3475`) and the `return rows` unchanged.

**Verification** (paired with Step 9): lint —
`cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
`grep -n "_candidates_sem\|analysis.opportunity.max_concurrent_candidates\|asyncio.gather" services/xstockstrat-analysis/app/handlers/servicer.py`
— confirm the new sem in `__init__`, the Phase-2 gather, and single-flight fetch are present.

---

### Step 9 — test: FR-1/FR-6 — opportunity set + rank identical to serial; GetBars ≤ bound; owner-scoping preserved

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (extend the concurrency + opportunity suites)

**Reviewers**: `xstockstrat-analysis` owner — determinism, owner-scoping, no look-ahead

**Codebase Evidence**:
- `make_servicer()` helper `test_analysis_servicer.py:34`; the canonical peak-bound test to mirror,
  `test_cross_user_concurrency_bounded_by_semaphore` `:4720-4759` (6 concurrent flows, blocking-`GetBars`
  mock, `assert peak == 2`).
- Owner-scoping source of truth: `list_live_enabled(user_id)` owner-scoped `strategies.py:214`;
  `_load_strategy_definition(user_id, …)` `servicer.py:3476`; caller resolves `user_id` once at
  `_caller_user_id` `servicer.py:446`. Trap: fails.md:1153 (feature 133 IDOR), recon § Risks.
- Coverage threshold **40%**.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-6`

**Instructions**:
1. **Set + rank equivalence (AC-1):** a user whose universe selects ~100 candidates. Capture the
   serial baseline ordered opportunity list `L` (run against a deterministic fixed-response
   marketdata/indicators stub), then run the concurrent `_compute_opportunities` over the same
   universe; assert the returned opportunities equal `L` in **both membership and rank order** (and
   `valid_until`/`session_end`-derived fields identical — proves the single-flight fetch set matched
   serial). Include a muted-non-held candidate and a held-denied candidate to exercise the verbatim
   eligibility predicate.
2. **Bound never exceeded (AC-1):** blocking-`GetBars` mock with the in-flight/peak counter; assert
   peak concurrent in-flight `GetBars` `== 2` (never exceeds `analysis.opportunity.max_concurrent_bars_fetches`),
   guarding the feature-141 TimescaleDB limit under parallelization.
3. **Owner-scoping (AC-6):** user A has a live strategy, user B does not. Compute user B's opportunity
   queue with the concurrent fan-out; assert **no** opportunity attributed to B references A's live
   strategy, and that every branch's strategy load was called with B's `user_id` (spy on
   `_load_strategy_definition`/`list_live_enabled` arguments — all carry B's id, none global/unscoped).
4. C-13: single-vs-second-consumer verdict on the candidate/strategy literals; reuse existing
   `make_servicer()` stubs.

**Verification**:
`cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40`
`cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
— pre-Step-8 the peak-bound / equivalence tests FAIL (serial peak 1, or set differs under a naive
parallel fetch); post-Step-8 pass with coverage ≥ 40%.

---

### Step 10 — service: FR-4 — offload CPU-bound simulator cores + screener onto a dedicated bounded `ThreadPoolExecutor`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (add executor in `__init__`; split `_backtest_symbol`, `_backtest_symbol_evaluated`, `_simulate_portfolio` prologue/core; offload cores)
- `services/xstockstrat-analysis/app/services/screener.py` — modify (`screen` fan-out gather under `_sem`; offload pure-sync tail)

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, determinism, no look-ahead

**Codebase Evidence** (F-06 pure-CPU-core evidence — verified `await`-free):
- Imports: `import asyncio` present (`servicer.py:13`); **`ThreadPoolExecutor`/`functools` NOT
  imported** — add `from concurrent.futures import ThreadPoolExecutor` and `import functools`.
- `_backtest_symbol` (`servicer.py:1105`): I/O prologue `await`s at `:1132` (`_resolve_prefixed_bars`),
  `:1144`/`:1154` (`ComputeIndicator` fast/slow SMA). The per-bar sim loop `for i in range(max(1, trade_start_idx), n):`
  at `:1222` through `return … , intents` at `:1327` contains **no `await`** (verified by scan) — this
  is the pure-CPU core (uses `_apply_fill` module-level sync fn `:134`, `scoring.*`).
- `_backtest_symbol_evaluated` (`:1429`): prologue `await`s at `:1456` (bars), `:1466`
  (`evaluate_with_series`), `:1471` (`_compute_evaluated_warmup`). The core after `:1498` (per-bar
  state machine → end `~:1610`) has **no `await`** (verified).
- `_simulate_portfolio` (`:1611`, `return equity_curve, capital_skips, trades` at `:1776`): the whole
  body has **no `await`** (verified — the `await`s at `:1800/:1820/:1850` belong to the sibling
  methods `_declared_formula_warmup`/`_prefetch_formula_warmups`, not this one). Offload the whole body.
- Screener: `ScreenerEngine.screen` (`screener.py:88`) serial loop `for symbol in symbols:` at `:110`
  (`await self._eval_symbol(...)`); `_eval_symbol` already acquires `self._sem` at `screener.py:324`
  (`analysis.screener.max_concurrent_formula_evals`, sem built `:84`) but the serial loop leaves it
  ineffective. The pure-sync tail after the loop — `_normalize_universe` (`:143`), the
  `for row in per_symbol: … _build_result` loop (`:145-146`), and `results.sort(...)` — is CPU work.
- Executor sizing key from Step 1: `analysis.compute.max_worker_threads` (default 4). F-06: executor
  threads hold **no** asyncpg connection (cores read only in-memory bars/proto fetched in the
  prologue) → the direct pool stays 2.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`__init__`:** add imports; construct
   `self._compute_executor = ThreadPoolExecutor(max_workers=max(1, self._cfg.get_int("analysis.compute.max_worker_threads", 4)), thread_name_prefix="analysis-compute")`
   next to the sems (`:386-393`).
2. **`_backtest_symbol`:** extract the pure-CPU core (`:1222-1327`) into a **sync** helper
   `_backtest_symbol_core(bars, trade_start_idx, fast_vals, slow_vals, state-init inputs, …) -> (trades, equity, daily_equity, diag, intents)`
   (module-level or a `@staticmethod`, taking only the locals it uses — no `self`-async, no gRPC). In
   the async method, after the prologue builds `bars`/`fast_resp`/`slow_resp`, call
   `loop = asyncio.get_running_loop(); return await loop.run_in_executor(self._compute_executor, functools.partial(_backtest_symbol_core, …))`.
3. **`_backtest_symbol_evaluated`:** same split — core after `:1498` extracted to a sync helper taking
   `bars`, `decisions`, `component_series`, warmup inputs; offload via `run_in_executor`.
4. **`_simulate_portfolio`:** extract the whole body (`:1611-1776`) into a sync helper taking
   `symbol_intents`, `initial_capital`, `position_weight`, `max_concurrent`, `commission`, `slippage`,
   `cooldown_days`, `exit_cooldown_days`; the async method becomes a thin `run_in_executor` wrapper.
5. **Screener `screen`:** replace the serial loop (`screener.py:110`) with
   `per_symbol = await asyncio.gather(*[self._eval_symbol(sym, request, criteria, fundamentals, fundamentals_available, propagation_meta) for sym in symbols])`
   — `_eval_symbol` already acquires `self._sem` (`:324`), so concurrency is bounded by
   `analysis.screener.max_concurrent_formula_evals`. Offload the pure-sync tail
   (`_normalize_universe` + the `_build_result` loop + `results.sort`) via `loop.run_in_executor`
   on a passed-in executor (thread the `AnalysisServicer._compute_executor` into `ScreenerEngine`
   through its constructor, or use `asyncio.to_thread` for the tail if no executor is wired to the
   engine — pick the executor to keep the single bounded pool; state which in the step).
6. **Determinism:** offloading changes only **scheduling**, not arithmetic — the cores compute the
   identical trades/equity/diagnostics. Preserve every existing return tuple shape and the
   `daily_equity[j] ↔ diags[j]` 1:1 invariant (feature 151) and order-independent portfolio
   `total_return` (feature 150).

**Verification** (paired with Step 11): lint —
`cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
`grep -n "ThreadPoolExecutor\|run_in_executor\|_compute_executor" services/xstockstrat-analysis/app/handlers/servicer.py`
`grep -n "asyncio.gather\|run_in_executor\|to_thread" services/xstockstrat-analysis/app/services/screener.py`
— confirm the executor, the offloaded cores, and the screener fan-out are present.

---

### Step 11 — test: FR-4 — a long backtest does not block a concurrent read; backtest/screener output byte-for-byte

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (head-of-line + equivalence)
- `services/xstockstrat-analysis/tests/test_screener.py` — modify (screener equivalence + fan-out bound)

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, determinism

**Codebase Evidence**:
- Existing suites: `tests/test_analysis_servicer.py`, `tests/test_screener.py`,
  `tests/test_portfolio_sizing.py`, `tests/test_fill_model.py` (verified in inventory). These already
  assert backtest byte-for-byte / order-independent totals (recon § Existing Business Rules:
  `@feature-151`, `@feature-150`, `@feature-149`) — extend, do not weaken them.
- Coverage threshold **40%**.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. **Head-of-line isolation (AC-4):** user A starts a `RunBacktest` whose CPU core is instrumented to
   busy-spin ~8 s inside the executor thread (patch a per-bar hook to `time.sleep`/spin); 1 s in, user
   B calls `ListOpportunities` (or a lightweight read). Assert B's call **returns while A's backtest is
   still running** (event loop not blocked) — measure that B's latency is ≈ its normal budget, not
   ≈ 7 s. Pre-Step-10 (core on the loop) this FAILs (B waits for A); post-Step-10 it passes.
2. **Backtest equivalence:** assert the offloaded `_backtest_symbol` / `_backtest_symbol_evaluated` /
   `_simulate_portfolio` produce results byte-identical to the pre-offload run for a fixed input
   (reuse the existing feature-150/151 fixtures) — trades, `daily_equity[j]↔diags[j]`, `total_return`.
3. **Screener (equivalence + bound):** assert `ScreenSymbols` returns the same ranked results as
   serial for a fixed universe, and — with a blocking `_eval_symbol` mock + peak counter — that peak
   concurrent evals `== analysis.screener.max_concurrent_formula_evals` (the `_sem` now actually
   binds the fan-out).
4. C-13: single-vs-second-consumer verdict on any backtest/universe literal reused across cases.

**Verification**:
`cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40`
`cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
— the head-of-line test FAILs pre-Step-10 and passes post-Step-10; equivalence suites stay green;
coverage ≥ 40%.

---

## Deviation Log

### Step 2 — existing indicators test doubles updated for the new `__init__` config contract

**Disposition**: necessary test-double maintenance (not scope creep). `IndicatorsServicer.__init__`
now calls `config_watcher.sandbox_max_concurrent()` to size `self._sandbox_sem`. Every existing
`IndicatorsServicer(...)` construction in `tests/test_formulas.py` passed a bare `MagicMock()` (or a
`_cfg()` MagicMock without that method), which makes `max(1, <MagicMock>)` raise `TypeError`. Fixed
by adding a `_cfg_stub()` factory (answers `sandbox_max_concurrent() → 4`), rewiring the 7 bare
`MagicMock()` config args to it, and adding `cfg.sandbox_max_concurrent.return_value = 4` to the three
sandbox `_cfg()` helpers. `tests/test_formulas.py` is not in Step 2's declared **Files** but the fix
is required for the suite to stay green under Step 2's contract; staged with the Step 2 commit.

### Step 3 — `SandboxResult.error` field in the test double

**Disposition**: spec fidelity. The Step 3 monkeypatch double must return a full `SandboxResult`;
the dataclass has a required `error: str` field (`sandbox.py:94`) the spec sketch omitted — added
`error=""` to the double. No behavior change.
