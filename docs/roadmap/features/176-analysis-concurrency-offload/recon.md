# Recon: analysis-concurrency-offload

**Created**: 2026-09-04
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-indicators

---

## Objective

Parallelize the serial cross-service RPC fan-out in `xstockstrat-analysis` (opportunity compute,
readiness evaluation, per-component evaluator) under a bounded concurrency limit, and move CPU-bound /
blocking work off the single asyncio event loop (backtest simulators, `ScreenSymbols`, and the
`xstockstrat-indicators` sandbox `subprocess.run`). Goal: flat per-user latency under concurrency,
with **byte-for-byte output equivalence** to the serial baseline and preserved per-user owner-scoping.

## Codebase Map

- **`xstockstrat-analysis`** (Python, asyncio, gRPC-only)
  - Entry point / pool: `app/main.py:53` (`asyncpg.create_pool(min_size=1, max_size=DB_POOL_MAX default 2)`; `statement_cache_size=0` under `DB_PGBOUNCER` `:59`); dual `ConfigWatcher` `main.py:41,47`
  - Serial candidate loop: `_compute_opportunities` def `app/handlers/servicer.py:3109`, loop `:3385` (`for c in selected:` → bars under sem `:3399`, benchmark `:3414`, `evaluate_conditions_traced` `:3423`); caches `bars_by_symbol` `:3377`, `strategy_defs` `:3374`, `benchmark_bars_cache` `:3380`
  - Serial readiness loop: `EvaluateReadiness` def `servicer.py:2660`, loop `:2702` (`_fetch_bars_paged` `:2705`, `evaluate_conditions_traced` `:2718`)
  - Per-component evaluator loop: `app/services/evaluator.py:234` (`for comp in definition.components:` → `_compute_component` `:249` → `ComputeIndicator` `:261` / `ExecuteFormula` `:276`)
  - Process-global bars-fetch semaphore: `servicer.py:391` (`asyncio.Semaphore(analysis.opportunity.max_concurrent_bars_fetches, default 2)`); sibling `_component_series_sem` `:386` (`analysis.series.max_concurrent_components`)
  - CPU-bound on the loop: `RunBacktest` `servicer.py:537` (serial per-symbol `:712`); synchronous per-bar sim loops `_backtest_symbol` `:1105` (`:1191/1222/1280`), `_backtest_symbol_evaluated` `:1429` (`:1481/1523/1539/1553`), `_simulate_portfolio` `:1611` (`:1655`), all via `_apply_fill` `:134`; `ScreenSymbols` `:2582` → `ScreenerEngine.screen` serial loop `app/services/screener.py:110` (bounded by `_sem` `:84`, `analysis.screener.max_concurrent_formula_evals`)
  - Config accessors: `app/config/watcher.py` — `get_int:94`, `get_int_present:102`, `get_float:123`, `get_float_present:131`, `get_bool:115`, `get_str:86`
  - Owner-scoping: `_caller_user_id` `servicer.py:446`; `_compute_opportunities(user_id,…)` → `list_live_enabled(user_id)` `app/repositories/strategies.py:205` (owner-scoped `AND user_id=$1` `:214`)
- **`xstockstrat-indicators`** (Python, asyncio, gRPC-only)
  - Blocking handlers: `ExecuteFormula` `app/handlers/servicer.py:139` (calls `sandbox.execute_formula` synchronously), `ComputeIndicator` `:56-58`
  - Blocking sandbox: `sandbox.execute_formula` sig `app/services/sandbox.py:159`; `subprocess.run([sys.executable, script_path], timeout=timeout_ms/1000)` `:188` (spawns a **separate child process**); timeout → `exit_reason="timeout"` `:240`
  - Config accessors: `app/config/watcher.py` — `sandbox_timeout_ms` `:118`, `sandbox_memory_bytes` `:123`, `sandbox_allowed_imports` `:127`; **`indicators.sandbox.max_concurrent` read NOWHERE** (`CLAUDE.md:72` "documented, not yet enforced")
  - No migration/proto surface in scope for this feature.

## Patterns to REUSE

- **Bounded-gather (the core FR-1/FR-2/FR-3 template)** → `app/engine/entry_backfill.py`: sem `:55`, `async with sem:` per task `:68`, tasks built `:88-99`, `await asyncio.gather(*tasks, return_exceptions=True)` `:100`. Canonical in-service pattern for "parallelize a loop under a semaphore."
- **Already-parallel read-time fan-out** → `_enrich_opportunities_live` `servicer.py:3069` (`asyncio.gather` of per-symbol `_enrich_symbol`, each acquiring `_bars_fetch_sem`). Proof the codebase already does bounded gather on the marketdata edge.
- **Existing component semaphore** → `_component_series_sem` `servicer.py:386` (`analysis.series.max_concurrent_components`) — FR-3 should acquire this rather than invent a new bound.
- **Config accessor for a bound where 0 is meaningful** → `get_int_present` `watcher.py:102` (mirror it for any new key; avoids the zero-trap).
- **Concurrency-teeth test** → `tests/test_analysis_servicer.py:4706` `test_cross_user_concurrency_bounded_by_semaphore` (6 concurrent `ListOpportunities`, blocking-`GetBars` mock, asserts `peak==2`). Every new fan-out test mirrors this: assert output-equivalence AND that in-flight peak ≤ bound.
- **gRPC-stub mocking** → `make_servicer()` `test_analysis_servicer.py:34` (MagicMock channels, cfg `get_*` returns default; stubs swapped to `AsyncMock`).
- **Executor offload (FR-4/FR-5)** → **no in-repo precedent** (greenfield). `asyncio.to_thread` frees the loop; for the indicators sandbox it is necessary but **not sufficient** (each call spawns a real subprocess) — a `max_concurrent` semaphore must cap parallel spawns alongside the offload.

## Existing Business Rules (preserve / extend)

All PRESERVE — this is an explicit output-equivalence refactor (the feature's own `acceptance.feature`
asserts equality vs the serial baseline). No CHANGE/EXTEND; no C-16 sign-off required.
- **PRESERVE** `@AC-14 @feature-095` "live-quote fold does not leak look-ahead into ranking" (`services/xstockstrat-analysis/acceptance/opportunity-live-market-enrichment.feature`) — FR-1 concurrent `_compute_opportunities` must not change queue ranking/membership.
- **PRESERVE** `@AC-4/@AC-6/@AC-10 @feature-151` (`.../backtest-next-bar-fill.feature`) — backtest `total_return`, `daily_equity[j]↔diags[j]` 1:1, and trades/diagnostics byte-for-byte under FR-4 simulator offload.
- **PRESERVE** `@AC-1/@AC-3 @feature-150` (`.../backtest-portfolio-sizing.feature`) — order-independent portfolio `total_return` (≤1e-9) and legacy sizing byte-for-byte; offload must not add scheduling-order dependence.
- **PRESERVE** `@AC-1 @feature-149` (`.../fix-backtest-annualized-return.feature`) — annualized-return scaling correct under offload.
- **PRESERVE** `@AC-1/@AC-2/@AC-5/@AC-7 @feature-152` (`.../market-regime-benchmark-operand.feature`) — evaluator determinism + no-look-ahead alignment under FR-3 concurrent per-component dispatch; live path resolves benchmark component.
- **PRESERVE** `@AC-1/@AC-2 @feature-160` (`.../fix-signal-screen-crash.feature`) — `ScreenSymbols` returns ranked OK per symbol under FR-4 offload.
- **PRESERVE** `@AC-9 @feature-158` (`.../durable-loop-scheduler.feature`) — parallelized per-user opportunity fan-out keeps per-user error isolation (per-user failures = completed pass).
- **No acceptance suite for `xstockstrat-indicators`** — FR-5's sandbox-timeout-still-enforced guarantee is covered only by the feature's own `@AC-5`; a C-16 blind spot on the indicators side.

## Dependencies

- Proto/RPC: none (no new RPC/field; reuses existing marketdata/indicators RPCs).
- Migration: none (compute-only, no schema change).
- Config keys: reuse `analysis.opportunity.max_concurrent_bars_fetches` (extend coverage to `EvaluateReadiness`) and `analysis.series.max_concurrent_components`; enforce `indicators.sandbox.max_concurrent` (new accessor `sandbox_max_concurrent` in indicators `watcher.py`). A new analysis executor-pool key for FR-4 CPU offload (e.g. `analysis.compute.max_worker_threads`) — **design decision** (see Risks).
- Inter-service edges: unchanged (analysis→marketdata `GetBars`/`GetLatestPrice`, analysis→indicators `ComputeIndicator`/`ExecuteFormula`).
- New env vars / ports: none.

## Risks / Not-found

- **Executor model for FR-4 (open design fork)** — no in-repo precedent. `asyncio.to_thread`/`ThreadPoolExecutor` frees the loop but Python GIL limits true parallelism for the pure-Python per-bar sim loops (`_apply_fill`); `ProcessPoolExecutor` gives real parallelism but adds serialization cost + complicates the shared asyncpg pool. Must be settled in the debate.
- **IDOR owner-scoping (fails.md:1153, feature 133)** — parallelizing `_compute_opportunities` must keep every concurrent branch under the caller's `user_id`; no promoted `@AC-*` guards this, only CLAUDE.md § Strategy Ownership + `list_live_enabled(user_id)`. The adversary enforces it from CLAUDE.md.
- **TimescaleDB shared-memory bound (feature 141)** — `_bars_fetch_sem=2` exists because unbounded concurrent `GetBars` caused a SEV-2 "out of shared memory". Parallelize **under** the bound, never remove it. No `@AC-*` guard; enforce from CLAUDE.md.
- **Indicators sandbox: `to_thread` alone insufficient** — each `execute_formula` spawns a real subprocess; concurrency must be capped by enforcing `indicators.sandbox.max_concurrent` (greenfield) alongside the offload, else offload trades event-loop-blocking for unbounded subprocess spawns.
- **176↔177 same-function overlap** — feature 177 (readiness-caching) also edits `_compute_opportunities`/`EvaluateReadiness`/`_enrich_opportunities_live`. Sequence: land 176 (mechanics) before/with 177 (cadence); coordinate at `/sdd-spec` + merge-order.
- **Config-watcher collision (indicators)** — feature 173 edits `app/config/watcher.py`; add `sandbox_max_concurrent` without colliding, mirroring its present-aware accessor idiom.
- Not-found: no proto surface surveyed (none needed); executor precedent absent; exact latest analysis migration NNN not enumerated (feature is schema-free anyway).

## Recommended Scope

Advisory step boundaries for the debate + `/sdd-spec`:
1. Indicators: wrap `sandbox.execute_formula` in `asyncio.to_thread` + a `max_concurrent` semaphore (new `sandbox_max_concurrent` accessor); preserve timeout semantics. (FR-5, self-contained.)
2. Analysis: parallelize `EvaluateReadiness` per-symbol loop with the bounded-gather template under `_bars_fetch_sem`. (FR-2 — smallest, highest-value.)
3. Analysis: parallelize `_compute_opportunities` per-candidate loop under `_bars_fetch_sem`, preserving owner-scoping + caches. (FR-1.)
4. Analysis: parallelize the evaluator per-component fan-out under `_component_series_sem`. (FR-3.)
5. Analysis: offload CPU-bound backtest/screener compute off the loop (executor model per the debate). (FR-4.)
Each step: output-equivalence test + peak-concurrency-≤-bound test (mirror `test_cross_user_concurrency_bounded_by_semaphore`).
