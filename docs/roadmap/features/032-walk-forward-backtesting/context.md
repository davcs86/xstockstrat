# Context: walk-forward-backtesting

**Feature**: `docs/roadmap/features/032-walk-forward-backtesting/feature.md`
**Product Spec**: `docs/roadmap/features/032-walk-forward-backtesting/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/032-walk-forward-backtesting/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 032.
- New streaming proto RPC (RunWalkForward) — non-breaking addition to analysis proto.
- No schema changes; reads existing OHLCV and signal tables.
- Key constraint: look-ahead-free guarantee is a correctness requirement, not just best practice. Must be verified in acceptance testing.
- Two open questions deferred to impl-spec: result persistence vs. ephemeral, and SSE/streaming bridge in insights UI.
