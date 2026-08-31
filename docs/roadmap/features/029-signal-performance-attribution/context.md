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

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current template (section order, C-14 Consumer Surface checkboxes, split Acceptance Criteria) **in place** — kept feature number **029** and directory `029-signal-performance-attribution`; no new numbered dir created.
- Preserved all existing scope: 7 FRs unchanged, all affected services, the non-breaking proto change (`GetAttribution` RPC + additive `signal_id` field on order submission) and the additive DB migration (nullable `orders.signal_id` + composite index `orders(signal_id, status, closed_at)`) intact; both open questions carried forward.
- Moved the previously inlined `## Acceptance Criteria` numbered list out into new `acceptance.feature` (9 `@AC-*` scenarios, every FR-N covered); the spec section is now a C-15 pointer only.
- Added a "Known traps" block to Open Questions from the Ledger: attribution lives on the order not the position (exit-cooldown insight), owner-scope every attribution query (131 IDOR fail), ordinal conviction ≠ cardinal weight (mpt/023), source-enum-subset propagation (signal-source-registry), P&L parity across read paths (056/C-10(b)). Status left at `draft`.
