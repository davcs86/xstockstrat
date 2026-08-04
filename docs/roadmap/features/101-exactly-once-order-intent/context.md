# Context: exactly-once-order-intent

**Feature**: `docs/roadmap/features/101-exactly-once-order-intent/feature.md`
**Product Spec**: `docs/roadmap/features/101-exactly-once-order-intent/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/101-exactly-once-order-intent/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P0 item 4 ("idempotent order-command model").
- No upstream dependency — per the review's suggested execution order this can start alongside 100.
  It is itself a hard dependency for 102 (broker-state-reconciliation resolves `UNKNOWN` intents),
  105 (trading-crash-consistency tests this model's restart behavior), and 107 (canary promotion
  evidence requires "zero duplicate intents").
