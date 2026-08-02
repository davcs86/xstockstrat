# Context: screener-watchlist-fidelity

**Feature**: `docs/roadmap/features/097-screener-watchlist-fidelity/feature.md`
**Product Spec**: `docs/roadmap/features/097-screener-watchlist-fidelity/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/097-screener-watchlist-fidelity/implementation-spec.md`

---

## Session 2026-08-02 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from the user request to fix
  low-fidelity gaps in the Screener and Watchlists pages left by feature 083.
- **Scope decision (derivable-only):** verified against `packages/proto/analysis/v1/analysis.proto`
  and `packages/proto/portfolio/v1/portfolio.proto` that every proposed surface reads an
  already-existing field/RPC — `ScreenCriterion.weight`/`hard_filter`, `ScreenResult.score`,
  `EvaluateReadiness`/`SymbolReadiness`/`ConditionEval`, `ListOpportunities`, and the portfolio
  `Watchlist` CRUD RPCs. No proto/config/DB change is required.
- **C-14 override (livestream deferral) — recorded:** the design handoff's LAST price column, intraday
  CHG % column, and Quotes tab require a streaming/realtime quote feed the platform does not expose.
  These are split to a **named backlog follow-up feature, `098-watchlist-live-quotes`** (created in the
  same session at `idea` status), satisfying the C-14 "named follow-up" requirement rather than a vague
  "later". The predefined screener universe picker is likewise out of scope (no constituent table).
- **Open design fork logged** (product-spec Open Questions): readiness roll-ups are strategy-scoped to
  honor feature 083's "never a fabricated signal→strategy binding" rule; the sidebar per-list count and
  STRATEGY column reflect the explicitly chosen strategy. To be confirmed in /sdd-design.
- Reviewer: `xstockstrat-ui` (service owner) only — UI-only change deriving from existing RPCs.
