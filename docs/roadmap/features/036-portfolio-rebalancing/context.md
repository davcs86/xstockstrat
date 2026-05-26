# Context: portfolio-rebalancing

**Feature**: `docs/roadmap/features/036-portfolio-rebalancing/feature.md`
**Product Spec**: `docs/roadmap/features/036-portfolio-rebalancing/product-spec.md`

---

## Session 2026-05-26T00:00:00Z — brainstorming

- Idea surfaced during platform brainstorming session.
- Demoted at idea stage without entering draft. Rationale documented in product-spec.md.
- Key decision: rebalancing is for passive allocation; it directly contradicts signal-driven logic by trimming winners and adding to losers. Feature 023 (position-sizing-engine) already solves the concentration control problem that rebalancing is meant to address, in a signal-aware way.
