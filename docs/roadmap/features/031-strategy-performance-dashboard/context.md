# Context: strategy-performance-dashboard

**Feature**: `docs/roadmap/features/031-strategy-performance-dashboard/feature.md`
**Product Spec**: `docs/roadmap/features/031-strategy-performance-dashboard/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/031-strategy-performance-dashboard/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 031.
- No proto or schema changes — read-only queries against existing ledger and portfolio RPCs.
- Key design decision: daily returns computed from ledger fill events (event-driven), not from daily snapshot infra.
- Two open questions deferred to impl-spec: return computation method confirmation, charting library selection (reuse feature 014's choice).
- Practical dependency: needs 10+ closed paper trades for meaningful statistics.
