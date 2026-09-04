# Context: readiness-caching-poll-discipline

**Feature**: `docs/roadmap/features/177-readiness-caching-poll-discipline/feature.md`
**Product Spec**: `docs/roadmap/features/177-readiness-caching-poll-discipline/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/177-readiness-caching-poll-discipline/implementation-spec.md`

---

## Session 2026-09-04 — sdd-story

- Created from performance-audit Track B (`docs/reports/2026-09-04-performance-bottlenecks-audit.md`,
  findings 2.4, 1.2, 1.3, 1.7).
- Reduces how *often* the analysis fan-out runs; composes with feature 176, which makes each run
  faster. Kept separate to keep diffs surgical (behavior #3) — 176 is service-concurrency mechanics,
  177 is caching/cadence policy.
- Known traps folded into Open Questions: feature 110 (verify remount cost vs. actual `staleTime`
  before per-symptom fixes; the outer cache key is the systemic fix) and feature 118
  (screener-data-readiness-polling — align with the existing readiness-poll pattern).
