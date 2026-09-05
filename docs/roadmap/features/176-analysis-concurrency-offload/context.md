# Context: analysis-concurrency-offload

**Feature**: `docs/roadmap/features/176-analysis-concurrency-offload/feature.md`
**Product Spec**: `docs/roadmap/features/176-analysis-concurrency-offload/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/176-analysis-concurrency-offload/implementation-spec.md`

---

## Session 2026-09-04 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  performance-audit Track A (`docs/reports/2026-09-04-performance-bottlenecks-audit.md`, findings
  1.1, 1.4, 2.1, 2.2, 3.1, 3.2, 3.3).
- Highest-leverage of four audit tracks: the dominant cause of both slow-list symptoms and the
  multi-user scaling wall. Sequenced first.
- Known traps folded into Open Questions: IDOR owner-scoping of `_compute_opportunities`
  (fails.md:1153, feature 133), and the TimescaleDB shared-memory reason for the `_bars_fetch_sem = 2`
  bound (feature 141) — parallelize under a bound, never by removing it.
- Sibling tracks (deliberately separate features to keep diffs surgical): 177 caching/poll
  discipline, 178 quote-fanout batching, 179 UI resume + halt surfacing.

## Session 2026-09-04 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict PASS WITH WARNINGS (no blockers).
- All code-checkable claims verified against the merged tree (servicer.py:3385/2702, evaluator.py:234, sandbox.py:188; config keys valid).
- Warnings (advisory, to close in /sdd-design): four Open Questions — two guardrails (IDOR owner-scoping fails.md:1153; TimescaleDB shared-mem bound feature 141), two design forks (executor model to_thread vs ProcessPoolExecutor; shared vs independent readiness/opportunity semaphore). New key analysis.compute.max_worker_threads + its DB-pool-budget (F-06) interaction to finalize in design.
- Overlap: CLEAN. Note: 176 and 177 both edit analysis compute paths (servicer.py/evaluator.py) — same-function overlap to coordinate at impl-spec / merge-order time. Config namespaces distinct (analysis.opportunity.* vs analysis.readiness.*).

## Session 2026-09-05 — sdd-design quick, ROUND 1 (PAUSED, not approved)

Status unchanged: **spec-ready** (design NOT approved — user chose "Hold, run another round"). recon.md written + committed. design.md NOT yet written.

- **Proposer (r1):** bounded-gather binding the EXISTING _bars_fetch_sem (opp+readiness) / _component_series_sem (evaluator); two-phase fetch-then-evaluate for determinism; asyncio.to_thread for FR-4 (no new config key); FR-5 = to_thread + new sandbox_max_concurrent semaphore.
- **Adversary (r1): NEEDS WORK, no Floor breach.** Two design-breaking defects + several fixes:
  1. **FR-4 false premise (C-01/P-03):** `_backtest_symbol`/`_backtest_symbol_evaluated`/`ScreenerEngine.screen` are `async def` coroutines that await gRPC (servicer.py:1144/1154/1466/1471; screener.py:100/112) — cannot to_thread a coroutine. FIX: split each simulator into async I/O prologue (fetch bars/indicators) + SYNC CPU core (per-bar loop + _apply_fill:134); offload only the sync core. _simulate_portfolio (:1611) is CPU-pure but declared async — also needs the split.
  2. **Semaphore deadlock:** wrapping the candidate body in _bars_fetch_sem deadlocks vs _load_benchmark_bars_windowed's nested re-acquire (:3414-3420; non-reentrant). FIX: do NOT wrap the body; keep leaf-site acquisition (as serial), bound the FAN-OUT with a SEPARATE task-count limiter → reinstates the `analysis.compute.max_worker_threads` config key the proposer dropped (F-07 risk if hardcoded).
  3. **Dedup race:** check-then-fetch-then-write across await = concurrent tasks all miss+fetch → more concurrent GetBars than dedup assumed (re-risks feature 141 SEV-2) + changes bars seen vs serial (@AC-1/@AC-2). FIX: single-flight each unique symbol/benchmark once in Phase 1.
  4. **Exception semantics:** blanket return_exceptions=True changes error handling vs serial (serial catches only around bars fetch :3404; EvaluateReadiness always appends per-symbol even on failure :2706-2721). @AC-9/158 is PER-USER isolation, different granularity. FIX: replicate exact serial catch scope INSIDE each task.
  5. **FR-4 latency/GIL (@AC-4):** to_thread worker holds GIL; default executor bounded+shared → several 8s sims saturate it → head-of-line blocking returns. FIX: dedicated BOUNDED executor/semaphore + justify GIL vs latency budget, or ProcessPoolExecutor if budget tight.
  6. Assert (re-grep) shared StrategyEvaluator (:3372) statelessness — don't assume (fails.md:1144).
  - Handled well: IDOR owner-scoping (user_id resolved once, closed over — fails.md:1153); FR-5 sandbox to_thread+sem (subprocess.run releases GIL).
- **Synthesis (survives):** core architecture (bounded-gather under existing leaf bounds + prologue/core split + to_thread sandbox) is sound WITH the 6 revisions above. Round 2 must fold them in; the executor config key returns.
- **Ledger:** fails.md:2029 (non-reentrant lock, feature 163) — the deadlock class; fails.md:1153/1144 (IDOR + closure-claims-are-unverified).
- **NEXT (round 2):** re-propose with prologue/core split, separate fan-out limiter (+ analysis.compute.max_worker_threads), Phase-1 single-flight, per-task serial catch, bounded FR-4 executor. Then re-adversary, then user gate.

## Session 2026-09-05 — sdd-design ROUND 2 (proposer done; adversary PENDING)

Status unchanged: **spec-ready**. design.md NOT yet written.

- **Round-2 proposer (done):** three-phase — Phase 0 dedup-load strategy defs; Phase 1 single-flight-by-construction (fetch each unique symbol/benchmark ONCE via gather; sem acquisitions SEQUENTIAL within a task, not nested → no deadlock; per-task serial catch); Phase 2 per-candidate evaluate under a SEPARATE fan-out semaphore (new key `analysis.opportunity.max_concurrent_candidates`, not _bars_fetch_sem), no return_exceptions. FR-4 prologue/sync-core split per simulator, offload only the sync core via loop.run_in_executor on a shared bounded ThreadPoolExecutor (new key `analysis.compute.max_worker_threads`). FR-5 to_thread + sandbox_max_concurrent. Two new config keys; reuse _bars_fetch_sem (leaf) + _component_series_sem. Own flagged risk: Phase-1 eligibility gating must reproduce the serial skip predicates verbatim (muted-non-held :3391, definition-not-None :3395).
- **Round-2 adversary: PENDING** (task launched; notification not yet received when the user requested round 3). Round 3 for 176 is HELD until its round-2 adversary reports, then folds those findings + re-proposes.

## Session 2026-09-05 — sdd-design ROUND 3 (proposer + adversary complete): SOUND; final gate pending

Status unchanged: **spec-ready**. design.md NOT yet written (awaiting consolidated final gate).

- **Round-3 proposer:** readiness = Option B (leaf _bars_fetch_sem + _component_series_sem only, per FR-2's literal wording; no shared whole-evaluation limiter → priority inversion gone); opportunities Phase 2 = own new key analysis.opportunity.max_concurrent_candidates(4); component-sem wired via optional StrategyEvaluator.__init__ param (threaded at readiness :2695 + opportunities :3372; None at backtest :1463/score :2892); FR-4 dedicated bounded ThreadPoolExecutor (analysis.compute.max_worker_threads=4), ThreadPool decision CLOSED (event-loop responsiveness = FR-4 intent, throughput unchanged; ProcessPool rejected); config rows for the 3 keys; closure claims restated (Phase 2 fans out indicator RPCs, not cache-pure; statelessness re-verified); session_end_seconds eligibility predicate lifted verbatim + 3-case equivalence test.
- **Round-3 adversary: SOUND, no Floor breach.** All six round-1 objections confirmed resolved. FOUR doc/test encodings for design.md (no rework):
  1. **`component_sem=None` MUST mean SERIAL** (branch on `self._component_sem is not None`), NOT gather-always-acquire-if-set — else the backtest/score None sites get unbounded per-component fan-out (new indicators/marketdata pressure + @AC-4/6/10/151 determinism risk). Intent is clear ("serial, unchanged"); make `None ⇒ serial` explicit. Verified score already acquires _component_series_sem at the caller (:2904) — no double-acquire; candidates-sem and component-sem are distinct → no reentrancy/deadlock.
  2. **Readiness memory-bound = design decision, NOT a user fork (adversary corrected the proposer):** Option B's only exposure is pending-coroutine/in-flight-bars memory × request.symbols (uncapped in EvaluateReadiness :2702); marketdata/indicators pressure is FULLY bounded (_bars_fetch_sem=2, _component_series_sem=4). A `_bars_fetch_sem` BODY-gate does NOT hit the round-1 nested-reacquire deadlock in readiness (readiness loads the benchmark ONCE before the loop :2698, unlike opportunities' _load_benchmark_bars_windowed re-acquire), so a body-gate is ALSO FR-2-literal-compliant AND bounds memory. DECISION for design.md: use the `_bars_fetch_sem` body-gate for readiness (bounded pending-coroutine memory, 2-wide throughput) — record Option B (max throughput / watchlist-sized peak memory) as the Rejected Alternative; add a large-request.symbols peak/memory test either way.
  3. **176↔177 same-function overlap** → add a WARN row to merge-order.md at /sdd-spec (not hard-order; no shared migration/proto/config). **Config keys MUST be no-seed** (follow the analysis.opportunity.* no-seed-migration pattern) so "no migration" holds — do NOT add a config-seed migration (ledger 081 / 168 renumber trap).
  4. **Determinism RED assertions to name in test steps:** opportunities Phase-2 reassembles via gather-ORDERED results in `selected` order (byte-identical to serial append; session_end_seconds is order-safe max()); evaluator components reassemble keyed by ref_name (order-independent); owner-scope test asserts every concurrent branch stays under the caller (mirror test_cross_user_concurrency_bounded_by_semaphore).
  - F-06 stays clean IFF each offloaded sync core is pure-CPU (no asyncpg/gRPC/await) — evidence per simulator at /sdd-spec.
- **NET:** SOUND. Ready to write design.md (readiness body-gate on _bars_fetch_sem; None⇒serial explicit; no-seed keys; gather-order RED assertions; 176-before-177 WARN). No new user fork.

## Session 2026-09-05 — sdd-design COMPLETE (design-approved)

- Phase 0 Recon: recon.md written (analysis + indicators; key reuse: entry_backfill.py bounded-gather, existing _bars_fetch_sem/_component_series_sem, _definition_fingerprint).
- Phase 1 Grilling: 3 rounds (quick, extended by user). Chosen approach: three-phase single-flight opportunities fan-out under a NEW analysis.opportunity.max_concurrent_candidates; readiness parallelized under a _bars_fetch_sem body-gate; evaluator components under _component_series_sem (wired via optional StrategyEvaluator param, None⇒serial); FR-4 prologue/sync-core split offloaded to a dedicated bounded ThreadPoolExecutor (analysis.compute.max_worker_threads); FR-5 sandbox to_thread + sandbox_max_concurrent. Rejected: ProcessPoolExecutor, shared fan-out sem, Option B readiness, whole-coroutine to_thread.
- Constitution rules touched: F-06, F-07, C-05, C-01, C-08/C-15, P-03. Floor breaches: none.
- Business rules: all PRESERVE (byte-for-byte determinism refactor).
- USER APPROVED design 2026-09-05 (approved 176 & 178; 177 & 179 held). Status: spec-ready → design-approved.
- merge-order.md: 176-before-177 WARN row added (same-function overlap on _compute_opportunities/EvaluateReadiness/evaluator; confirm when 177 is approved).
- Next: /sdd-spec analysis-concurrency-offload. Open risks carried: pure-CPU core evidence (F-06) per simulator, readiness large-symbols memory test, feature-173 watcher.py coordination — all to resolve at /sdd-spec.

## Session 2026-09-05 — sdd-spec

- Generated implementation-spec.md with **11 steps** (5 `service` + 5 paired `test` + 1 `config`).
  Status → implementation-ready. Every step cites verified `path:line` evidence (recon.md Codebase
  Map re-verified against the current tree; no line drift found).
- Step map: 1 config (2 new no-seed analysis keys + enforce indicators.sandbox.max_concurrent);
  2–3 FR-5 sandbox to_thread+sem (indicators); 4–5 FR-3 evaluator optional `component_sem`
  (None⇒serial, 4 construction sites); 6–7 FR-2 readiness `_bars_fetch_sem` body-gate;
  8–9 FR-1/FR-6 three-phase single-flight `_compute_opportunities` under new `_candidates_sem`;
  10–11 FR-4 dedicated bounded ThreadPoolExecutor (simulator prologue/core split + screener).
- Key codebase findings (grep-verified this session):
  - Simulator F-06 evidence CONFIRMED: `_backtest_symbol` core `:1222-1327`, `_backtest_symbol_evaluated`
    core after `:1498`, `_simulate_portfolio` whole body `:1611-1776` are all **`await`-free** (the
    `await`s at `:1800/1820/1850` belong to sibling warmup methods, NOT `_simulate_portfolio`). Cores
    open no DB connection → asyncpg pool stays 2.
  - StrategyEvaluator construction sites: `servicer.py:1463` (backtest), `:2695` (readiness),
    `:2892` (score — already acquires `_component_series_sem` at `:2904`, so pass `None`), `:3372`
    (opportunities). `__init__` at `evaluator.py:107`; per-component loop at `evaluator.py:234` inside
    `evaluate_conditions_traced` (`:195`).
  - Indicators: `ExecuteFormula` `:85` calls sync `sandbox.execute_formula` `:139`; **`asyncio` not
    imported** in that servicer (must add). Analysis servicer **has** `import asyncio` (`:13`) but
    **not** `ThreadPoolExecutor`/`functools` (must add). New indicators accessor
    `sandbox_max_concurrent()` after `watcher.py:137`.
  - Screener: `_sem` built `screener.py:84`, acquired inside `_eval_symbol` `:324`, but the serial
    loop `:110` leaves it ineffective — FR-4 gathers the fan-out so `_sem` actually binds.
  - merge-order.md 176→177 WARN row already present (`:227-242`) — no step re-adds it. strat-lab
    plugin needs no update (no run_backtest API/shape change). No seed migration (no-seed key pattern).
- Reviewers snapshot finalized: analysis owner (1,4–11), indicators owner (1–3), config owner (1).

## Session 2026-09-05 — /sdd-execute sequential (176→177→178→179, one PR per feature)

Sequential-mode run started. Pacing: user-authorized "run all four back-to-back", branch model
`feature/<slug> → main-dev`. Only 176 is implementation-ready; 177/178/179 are design-approved and
will be `/sdd-spec`'d then executed in turn (177 against 176's post-restructure signatures per
merge-order WARN). Tooling: `uv sync --extra dev` for indicators + analysis; baselines green
(indicators 129 passed, analysis 656 passed) before any edit.

### Step 1 — done (config/docs registration, TDD N/A)
- `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed: added
  `analysis.opportunity.max_concurrent_candidates|4` (priority-inversion guard, separate from
  `max_concurrent_bars_fetches`) and `analysis.compute.max_worker_threads|4` (FR-4 executor pool,
  no DB conn). Both no-seed.
- `services/xstockstrat-indicators/CLAUDE.md:72`: reworded `indicators.sandbox.max_concurrent` row —
  removed "not yet enforced"; now enforced via new `ConfigWatcher.sandbox_max_concurrent()` +
  `_sandbox_sem` in `ExecuteFormula` (FR-5).
- `docs/patterns/config-governance.md` § Per-Feature Registered Keys: added feature-176 entry
  (newest-first) with both keys; noted the indicators key is enforced-not-new (no row).
- Verified: both keys present in analysis CLAUDE.md + config-governance log; indicators row updated;
  no `migrations/` file added (no-seed). Committed directly to `feature/analysis-concurrency-offload`.

### Steps 2–3 — done (FR-5 indicators sandbox offload + concurrency/timeout tests, TDD red→green)
- RED captured: new `tests/test_execute_formula_concurrency.py` against the pre-Step-2 tree →
  `peak == 1` (sandbox ran synchronously on the loop; 4 gathered calls serialized) — the two
  concurrency cases FAILED; the timeout guard already passed (it is a regression guard, not a
  discriminator).
- Step 2 (`app/config/watcher.py`, `app/handlers/servicer.py`): added
  `ConfigWatcher.sandbox_max_concurrent()` (method, called with `()` per spec — sits among the
  `@property` sandbox siblings but the call sites use `()`); added `import asyncio`; built
  `self._sandbox_sem = asyncio.Semaphore(max(1, config_watcher.sandbox_max_concurrent()))` in
  `__init__`; wrapped the `sandbox.execute_formula(...)` call in `ExecuteFormula` as
  `async with self._sandbox_sem: result = await asyncio.to_thread(sandbox.execute_formula, ...)`.
  Timeout preserved (execute_formula still owns `subprocess.run(timeout=…)`).
- Deviation (recorded in spec Deviation Log): the new `__init__` contract broke 13 bare-MagicMock
  config doubles in `tests/test_formulas.py` (`max(1, MagicMock())` → TypeError). Fixed with a
  `_cfg_stub()` factory + `sandbox_max_concurrent.return_value = 4` on the 3 sandbox `_cfg()` helpers.
  Staged with the Step 2 commit (required to keep the suite green under Step 2).
- GREEN: full indicators suite `132 passed`, coverage `81%` (≥50 gate); `ruff check` + `format`
  clean. Step 2 grep confirms `_sandbox_sem`/`asyncio.to_thread`/`sandbox_max_concurrent` present.

### Steps 4–5 — done (FR-3 evaluator optional component_sem, TDD red→green)
- Step 4 (`app/services/evaluator.py`, `app/handlers/servicer.py`): added `import asyncio`;
  `StrategyEvaluator.__init__(..., component_sem=None)` storing `self._component_sem`; branched
  `evaluate_conditions_traced`'s per-component loop — `None ⇒` serial (verbatim pre-176) / a
  semaphore ⇒ `asyncio.gather` of `async with self._component_sem: return ref_name, await
  _assemble_component_series(...)`. Refinement over the spec sketch: reassembly iterates the
  **order-preserving** gather result directly (gather keeps input order) rather than a by_ref dict —
  byte-identical to serial even if ref_names ever collided; no return_exceptions (FormulaExecutionError
  still propagates). 4 construction sites threaded explicitly: `:2695` readiness + `:3372`
  opportunities ⇒ `component_sem=self._component_series_sem`; `:1463` backtest + `:2892` score ⇒
  `component_sem=None` (score already holds `_component_series_sem` at `:2904` — avoids double-acquire).
- Step 5 (`tests/test_evaluator_traced.py`): 3 FR-3 tests — concurrent==serial byte-identical
  (period-keyed stub so component output is identity-, not order-, dependent); Semaphore(2) over 4
  components ⇒ `peak == 2` (teeth); `component_sem=None` ⇒ `peak == 1` (serial regression guard).
- RED captured by stashing the Step-4 `evaluator.py` change: all 3 FR-3 tests → TypeError (no
  `component_sem` kwarg). GREEN with Step 4 restored.
- Full analysis suite `659 passed` (656 baseline + 3), coverage `85%` (≥40); `ruff check`/`format`
  clean. Existing 656 unchanged ⇒ serial path proven byte-identical.
