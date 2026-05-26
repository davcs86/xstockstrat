# Context: multi-broker-smart-routing

**Feature**: `docs/roadmap/features/037-multi-broker-smart-routing/feature.md`
**Product Spec**: `docs/roadmap/features/037-multi-broker-smart-routing/product-spec.md`

---

## Session 2026-05-26T00:00:00Z — brainstorming

- Idea surfaced during platform brainstorming session.
- Demoted at idea stage without entering draft. Rationale documented in product-spec.md.
- Key decisions: execution benefit is cents per trade at retail position sizes — not worth dual-broker operational complexity; position aggregation across two accounts creates ledger consistency problems; IBKR SmartRouting already provides internal best-execution. Revisit only if position sizes grow to institutional scale or a specific documented slippage problem is identified.
