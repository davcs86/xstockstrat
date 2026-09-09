# Context: opportunities-latency-fix

**Feature**: `docs/roadmap/features/183-opportunities-latency-fix/feature.md`
**Product Spec**: `docs/roadmap/features/183-opportunities-latency-fix/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/183-opportunities-latency-fix/implementation-spec.md`

---

## Session 2026-09-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Root cause analysis performed via DigitalOcean runtime logs: identified 6 bottlenecks (P0–P5) in the ListOpportunities call chain.
- Ledger scan: feature 141 (semaphore sizing to downstream capacity) directly relevant — batch RPCs eliminate the per-symbol fan-out entirely, and the Go batch handler must use `WHERE symbol = ANY($1)` single-query pattern (not per-symbol goroutine fan-out) to respect the pool budget.
