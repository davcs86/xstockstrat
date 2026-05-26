# Context: stop-loss-bracket-orders

**Feature**: `docs/roadmap/features/030-stop-loss-bracket-orders/feature.md`
**Product Spec**: `docs/roadmap/features/030-stop-loss-bracket-orders/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/030-stop-loss-bracket-orders/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 030.
- Hard dependency on feature 023 (position-sizing-engine) — must be launched first.
- Proto changes: additive fields only on Position message (stop_order_id, take_profit_order_id). Non-breaking.
- DB migration: two nullable columns on portfolio positions table.
- Key safety requirement: bracket submission failure must emit CRITICAL alert — not silently logged.
- Two open questions for impl-spec: IBKR OCA library support, and blocking vs. best-effort cancellation on signal-driven close.
