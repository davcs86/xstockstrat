# Context: live-capital-canary-rollout

**Feature**: `docs/roadmap/features/107-live-capital-canary-rollout/feature.md`
**Product Spec**: `docs/roadmap/features/107-live-capital-canary-rollout/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/107-live-capital-canary-rollout/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P1 item 10 ("live-trading canary mode").
- Hard-depends on all other P0 controls (100 kill switch, 101 idempotency, 102 reconciliation, 030
  stop-loss/bracket orders, 023 position sizing) — its promotion criteria (FR-3) are evidence that
  those controls are clean over an observation window. Per the source review this is correctly last
  among the P0 items ("All P0 controls").
