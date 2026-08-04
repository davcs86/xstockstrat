# Context: trading-state-machine-invariants

**Feature**: `docs/roadmap/features/104-trading-state-machine-invariants/feature.md`
**Product Spec**: `docs/roadmap/features/104-trading-state-machine-invariants/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/104-trading-state-machine-invariants/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P1 item 7 ("trading state-machine property tests").
- Depends on 103 (broker-failure-simulator) for its generated event streams, and on a stable order
  lifecycle model (benefits from 100/101 landing first, though not a hard blocker for writing the
  invariant assertions themselves).
