# Design: analysis-concurrency-offload

**Created**: 2026-09-05
**Rounds**: 3 (quick → extended by user; termination: approved after round-3 adversary returned SOUND)
**Approved by**: user @ 2026-09-05
**Grounded in**: recon.md

---

## Chosen Approach

Parallelize the analysis serial fan-out and move CPU-bound / blocking work off the event loop, with
**byte-for-byte output equivalence** to the serial baseline. Consumer surface (C-14): internal
performance change behind the existing UI `/insights` Opportunities + Watchlist panes — no new
surface; the acceptance criteria assert output equivalence + absence of head-of-line blocking.

**Opportunities `_compute_opportunities` (`servicer.py:3385`) — three phases:**
- *Phase 0* — dedup-load the unique strategy definitions (owner-scoped; `user_id` resolved once via
  `_caller_user_id` `servicer.py:446` and closed over by every task; `list_live_enabled(user_id)`
  `strategies.py:214` stays owner-scoped — IDOR guard, fails.md:1153).
- *Phase 1 (single-flight by construction)* — derive the **exact serial-eligible symbol set**
  `{ sym : ∃ candidate c with c.strategy_id truthy AND not (c.muted and not c.is_held) (`:3393`) AND
  _load_strategy_definition(user_id,…) is not None (`:3395`) }`, and fetch each unique symbol's bars
  + each unique benchmark **exactly once** via `asyncio.gather`. Within a task the bars acquire
  `_bars_fetch_sem` (`:3399`) and the benchmark acquires it inside `_load_benchmark_bars_windowed`
  (`:3419`) **sequentially, never nested** → no re-entrant deadlock. Each task replicates the exact
  serial catch (`bars=[]` on error, `:3404`). The eligibility predicate is lifted **verbatim** so
  `session_end_seconds` (an order-free `max()`, `:3412`) is identical to serial — an over-fetched
  symbol would raise it and break `@AC-14` ranking, so this is the load-bearing invariant.
- *Phase 2* — per-candidate `evaluate_conditions_traced` (`:3423`) reads only the now-complete bars
  caches (no bars leaf fetch) but **still fans out indicator RPCs** per component, gathered under a
  **new dedicated** limiter `analysis.opportunity.max_concurrent_candidates` (default 4), **not**
  `_bars_fetch_sem`. No `return_exceptions`; per-task serial catch. Rows reassemble via
  `gather`-ordered results in `selected` order → byte-identical to the serial append.

**Readiness `EvaluateReadiness` (`servicer.py:2702`):** parallelize the per-symbol loop with
`asyncio.gather`, each task **body-gated by the existing `_bars_fetch_sem`** (readiness loads the
benchmark once *before* the loop `:2698`, so a whole-body gate hits **no** nested re-acquire — unlike
opportunities). This literally satisfies FR-2's "same bounded limit that guards the opportunity
bars-fetch path" (product-spec) **and** bounds pending-coroutine memory for a large `request.symbols`.
Readiness does **not** touch `max_concurrent_candidates` → no interactive-vs-batch priority inversion.
Each task always appends a per-symbol entry even on fetch failure (`:2703-2721`); ordered gather
preserves `request.symbols` order.

**Evaluator per-component `evaluate_conditions_traced` (`evaluator.py:234`):** parallelize the
component loop under the existing `_component_series_sem` (`servicer.py:386`). Wire it via a **new
optional** `component_sem=None` param on `StrategyEvaluator.__init__` (`evaluator.py:107`); the
gather/serial choice **branches on `self._component_sem is not None`** — `None ⇒ serial, unchanged`.
Threaded at the readiness (`:2695`) and opportunities (`:3372`) construction sites; passed `None` at
the backtest (`:1463`) and score (`:2892`) sites (score already acquires the sem at its caller
`:2904`, no double-acquire). `StrategyEvaluator` is stateless (only read-only `_indicators`/`_meta`
+ the new read-only singleton sem ref; per-call locals `component_series`/`eval_dates`).

**FR-4 CPU offload:** split each simulator into an async I/O prologue (bars/indicator/evaluator
gRPC) + a **pure-CPU sync core** (the per-bar loop + `_apply_fill` `:134`), offloading only the core
via `loop.run_in_executor` on a **dedicated bounded `ThreadPoolExecutor`** sized by new
`analysis.compute.max_worker_threads` (default 4). Split boundaries: `_backtest_symbol` core from
`:1222`; `_backtest_symbol_evaluated` core after `:1498`; `_simulate_portfolio` whole body (`:1651+`);
`ScreenerEngine.screen` (`screener.py:110`) fan-out → bounded gather under the existing `_sem` +
pure-sync tail offloaded. FR-1/FR-2/FR-3 are pure asyncio and never submit to the executor, so a
backtest burst cannot stall the fan-out.

**FR-5 indicators sandbox:** wrap the blocking `subprocess.run` (`sandbox.py:188`) in
`asyncio.to_thread` **and** gate it with a new `asyncio.Semaphore(sandbox_max_concurrent())` (a new
present-aware accessor in indicators `watcher.py`, coordinated with feature 173's edits) — `to_thread`
frees the loop but each call spawns a real subprocess, so the semaphore is required to cap spawns.
Timeout semantics unchanged.

**Config keys (all no-seed, read once at `__init__` via WatchConfig, `get_int` + `max(1,…)` clamp):**
new `analysis.opportunity.max_concurrent_candidates` (4) and `analysis.compute.max_worker_threads`
(4); enforce existing `indicators.sandbox.max_concurrent`; reuse `analysis.opportunity.max_concurrent_bars_fetches`
(readiness leaf) and `analysis.series.max_concurrent_components` (evaluator — its documented scope
widens to cover readiness + opportunities Phase-2; default 4 kept). Each gets a CLAUDE.md § Config
Keys row + a Per-Feature Registered Keys log entry. **No config-seed migration** (follow the
`analysis.opportunity.*` no-seed pattern) so "no migration" holds.

## Rejected Alternatives

- **`ProcessPoolExecutor` for FR-4** — real multicore, but pickling `bars`/`SimState`/proto + complicated
  asyncpg-pool lifecycle; wins only if concurrent-backtest *throughput* were a requirement. It is not —
  FR-4 is head-of-line isolation (product-spec:37), which `ThreadPoolExecutor` satisfies. GIL keeps
  concurrent backtests serialized (throughput unchanged) — stated honestly.
- **`asyncio.to_thread` on the whole simulator coroutine** — rejected: they're `async def` coroutines
  that `await` gRPC; a thread would get an unawaited coroutine object (silent no-op).
- **Wrapping the opportunities candidate body in `_bars_fetch_sem`** — rejected: deadlocks against the
  non-reentrant nested re-acquire in `_load_benchmark_bars_windowed` (`:3419`).
- **A single fan-out limiter shared across opportunities + readiness** — rejected: a 100-candidate
  opportunity compute would hold all permits and starve interactive readiness (priority inversion).
- **Option B for readiness (leaf-`_bars_fetch_sem` only, no body gate)** — considered; equivalent
  marketdata bound (`_bars_fetch_sem`=2 caps concurrent GetBars regardless), but leaves
  pending-coroutine memory uncapped for a large watchlist. Chose the body-gate (bounded memory,
  FR-2-literal-compliant) instead.
- **`return_exceptions=True` on the gathers** — rejected: changes error granularity vs the serial
  per-symbol/per-candidate catch scope.

## Open Risks

- [ ] **Pure-CPU core evidence (F-06)** — each offloaded sync core must contain no `await`/asyncpg/gRPC
  (executor threads hold no DB connection, so the pool stays 2). Evidence per simulator at `/sdd-spec`.
- [ ] **Readiness large-`request.symbols` memory** — the body-gate bounds concurrent GetBars to 2 but
  N tasks are still created; add a peak/memory test for a large watchlist at `/sdd-spec`/QA.
- [ ] **176→177 same-function overlap** — `_compute_opportunities`/`EvaluateReadiness`/`evaluator.py`
  are also edited by feature 177; a WARN (manual-merge) row goes into `merge-order.md` when 177 is
  specced; 177's spec writes against 176's post-restructure signatures.
- [ ] **feature-173 `watcher.py` coordination (indicators)** — add `sandbox_max_concurrent` alongside
  173's edits without collision.

## Constitution Rules Touched

- `F-06` — honored: offloaded cores are pure-CPU, open no DB connection; asyncpg pool stays 2 (evidence at spec).
- `F-07` — honored: all bounds read via WatchConfig (`get_int` + `max(1,…)`), never hardcoded.
- `C-05` — honored: new keys follow `<service>.<category>.<key>`, get CLAUDE.md + Per-Feature-log rows; the widened `_component_series_sem` scope is documented; keys are no-seed.
- `C-01` — honored: the component sem is threaded via a real existing symbol (`servicer.py:386`) through a new optional constructor param — no invented symbol.
- `C-08`/`C-15` — honored: per-FR RED tests — output-equivalence (byte-for-byte vs serial) AND peak-concurrency ≤ bound (mirror `test_cross_user_concurrency_bounded_by_semaphore` `test_analysis_servicer.py:4706`); named gather-order + owner-scope assertions.
- `P-03` — honored: the ThreadPool-vs-ProcessPool fork and the readiness memory-bound decision are recorded, not silently guessed.

## Business Rules Touched (C-16)

All PRESERVE (output-equivalence refactor; no CHANGE/EXTEND):
- PRESERVE `@AC-14 @feature-095` (opportunity ranking/membership) — Phase-2 gather-ordered reassembly + order-free `session_end_seconds`.
- PRESERVE `@AC-4/@AC-6/@AC-10 @feature-151`, `@AC-1/@AC-3 @feature-150`, `@AC-1 @feature-149` (backtest byte-for-byte / order-independent) — pure-CPU core offload changes scheduling, not arithmetic.
- PRESERVE `@AC-1/@AC-2/@AC-5/@AC-7 @feature-152` (evaluator determinism, no look-ahead) — components reassemble keyed by `ref_name` (order-independent).
- PRESERVE `@AC-1/@AC-2 @feature-160` (screener) — bounded-gather + pure-sync tail.
- PRESERVE `@AC-9 @feature-158` (per-user error isolation) — per-user isolation lives in the caller loop; per-task serial catch preserves it.
- (Indicators has no acceptance suite; FR-5 timeout preservation covered by this feature's own `@AC-5`.)
