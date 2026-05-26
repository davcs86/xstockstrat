# Context: signal-performance-attribution

**Feature**: `docs/roadmap/features/029-signal-performance-attribution/feature.md`
**Product Spec**: `docs/roadmap/features/029-signal-performance-attribution/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/029-signal-performance-attribution/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 029.
- Requires proto addition (GetAttribution RPC) and additive DB migration (signal_id column on orders).
- Key design decision: winner-takes-all attribution by highest-weight signal in V1; fractional multi-signal attribution deferred to V2.
- Practical dependency: needs 20+ closed paper trades before metrics are meaningful.
