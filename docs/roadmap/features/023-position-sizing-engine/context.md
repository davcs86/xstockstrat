# Context: position-sizing-engine

**Feature**: `docs/roadmap/features/023-position-sizing-engine/feature.md`
**Product Spec**: `docs/roadmap/features/023-position-sizing-engine/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/023-position-sizing-engine/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 023.
- No proto or schema changes in V1. Internal function in trading service.
- Key design decision: explicit-quantity orders bypass sizing (backward compatibility with agent tool calls).
- Two open questions deferred to /sdd-spec: ATR source (marketdata vs. indicators), and whether to expose ComputePositionSize as a gRPC RPC in V1.
- Platform Lead added as reviewer given cross-service dependency (trading → portfolio → marketdata/indicators).
