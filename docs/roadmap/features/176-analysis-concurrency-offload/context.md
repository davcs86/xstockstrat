# Context: analysis-concurrency-offload  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: Parallelized serial cross-service RPC fan-out in xstockstrat-analysis (opportunity compute, readiness evaluation, per-component evaluator) under bounded concurrency limits and moved CPU-bound/blocking work off the asyncio event loop via bounded `ThreadPoolExecutor` + `asyncio.to_thread`. Byte-for-byte output-equivalence refactor — no API/proto/schema changes. Landed in 11 steps across analysis + indicators services.

**Why (irrecoverable rationale)**: Dominant cause of slow-list symptoms and multi-user scaling wall was serial candidate loop in `_compute_opportunities` combined with CPU cores running on single event loop. Sequenced first of four audit tracks (176/177/178/179) because highest-leverage. Three-phase single-flight architecture: Phase 0 dedup-loads strategy defs once (preserving IDOR owner-scoping); Phase 1 fetches each unique symbol/benchmark exactly once under `_bars_fetch_sem` (keeping `session_end_seconds` identical to serial — load-bearing invariant for @AC-14 ranking); Phase 2 per-candidate evaluate under NEW `_candidates_sem` distinct from `_bars_fetch_sem` — using `_bars_fetch_sem` for candidate body would deadlock against non-reentrant nested re-acquire in `_load_benchmark_bars_windowed`, and shared limiter across opportunities + readiness would cause priority inversion.

**Rejected alternatives**: `ProcessPoolExecutor` for FR-4 (pickling bars/SimState/proto + asyncpg lifecycle; GIL keeps concurrent backtests serialized anyway); `asyncio.to_thread` on whole simulator coroutine (simulators are `async def` that `await` gRPC — thread would get unawaited coroutine); wrapping candidate body in `_bars_fetch_sem` (deadlocks against non-reentrant nested re-acquire); single fan-out limiter shared across opportunities + readiness (priority inversion); Option B for readiness (no body gate — leaves pending-coroutine memory uncapped); `return_exceptions=True` on any gather (changes error granularity vs serial per-item catch scope).

**Scars & gotchas**: New `IndicatorsServicer.__init__` calling `config_watcher` broke 13 bare-MagicMock config doubles in `test_formulas.py`; parallelized `_compute_opportunities` broke fixed 5-turn background drain in stale-read test (replaced with bounded wait-until-guard-clears loop); owner-scoping test assertion corrected mid-authoring (correct IDOR signal is "0/0 readiness" not "empty strategy_id"); spec sketched module-level sync cores but shipped nested `def _core()` closures (auto-capturing locals); `_FakeEngine.__init__` in `test_analysis_servicer.py` broke on new `compute_executor=` kwarg.

**Permanent deviations**: Design said evaluator components reassemble "keyed by ref_name" → shipped uses gather-order-preserving iteration (byte-identical without explicit keying). Design/spec sketched module-level sync core helpers → shipped nested `def _core()` closures (auto-capture, eliminates error-prone param extraction). Spec left screener executor wiring as pick → shipped `AnalysisServicer._compute_executor` with optional constructor param + `to_thread` fallback.

**Cross-feature signal**: 176/177/178/179 coordinated audit-track quad; 176 restructured signatures that 177 had to write against (merge-order WARN row enforced). Three-round debate caught 6 design-breaking defects before implementation.

**Deferred follow-ons**: Indicators has no promoted C-16 acceptance suite (FR-5's sandbox-timeout guarantee covered only by 176's own @AC-5); resource-pressure/back-pressure mechanism for very large `request.symbols` not yet addressed beyond bound test.

**Ledger entries written**: insights.md (0), fails.md (0) — all candidates were DUP.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
