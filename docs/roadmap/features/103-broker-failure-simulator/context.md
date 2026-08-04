# Context: broker-failure-simulator

**Feature**: `docs/roadmap/features/103-broker-failure-simulator/feature.md`
**Product Spec**: `docs/roadmap/features/103-broker-failure-simulator/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/103-broker-failure-simulator/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P1 item 6 ("deterministic broker simulator and fault-injection harness").
- No upstream dependency (needed for credible verification of everything else). Feeds 104
  (trading-state-machine-invariants), 105 (trading-crash-consistency), and 109 (live-trading-game-day)
  as their fault-injection source.
