# Context: trading-crash-consistency

**Feature**: `docs/roadmap/features/105-trading-crash-consistency/feature.md`
**Product Spec**: `docs/roadmap/features/105-trading-crash-consistency/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/105-trading-crash-consistency/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P1 item 8 ("crash-consistency test suite").
- Hard-depends on 103 (broker-failure-simulator) and 101 (exactly-once-order-intent — the durable
  intent model this suite proves survives a crash).
