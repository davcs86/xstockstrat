# Context: order-snapshots-pnl-patterns

**Feature**: `docs/roadmap/features/020-order-snapshots-pnl-patterns/feature.md`
**Product Spec**: `docs/roadmap/features/020-order-snapshots-pnl-patterns/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/020-order-snapshots-pnl-patterns/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature assigned directory: `020-order-snapshots-pnl-patterns`
- Affected services identified: trading, portfolio, indicators, ingest, analysis, ledger, insights, proto.
- Key open question flagged: where should `order_snapshots` table live (trading DB vs. analysis DB) — deferred to impl-spec.
- Key open question flagged: async vs. sync pattern analysis on position close — deferred to impl-spec.
