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
