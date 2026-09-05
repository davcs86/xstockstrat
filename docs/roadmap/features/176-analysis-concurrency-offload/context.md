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
