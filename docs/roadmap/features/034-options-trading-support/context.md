# Context: options-trading-support

**Feature**: `docs/roadmap/features/034-options-trading-support/feature.md`
**Product Spec**: `docs/roadmap/features/034-options-trading-support/product-spec.md`

---

## Session 2026-05-26T00:00:00Z — brainstorming

- Idea surfaced during platform brainstorming session.
- Demoted at idea stage without entering draft. Rationale documented in product-spec.md.
- Key decisions: options require chain data, IV surface, and a pricing model that don't exist on the platform; directional equity signals lack strike/expiry/strategy parameters; IBKR options API is a parallel implementation effort. Revisit only after equity strategy is validated and signal sources are extended to produce options-specific parameters.
