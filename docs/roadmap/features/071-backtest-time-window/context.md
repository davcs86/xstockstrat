# Context: backtest-time-window

**Feature**: `docs/roadmap/features/071-backtest-time-window/feature.md`
**Product Spec**: `docs/roadmap/features/071-backtest-time-window/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/071-backtest-time-window/implementation-spec.md`

---

## Session 2026-07-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin:** surfaced during in-engine validation of the `range_mean_reversion_v3` re-entry
  cooldown (feature 069). Re-running the same backtest two days apart (window start moved
  2024-07-25 → 2024-07-29) shifted a symbol's first trade because the shortened indicator warm-up
  pushed its boundary entry later — everything else matched to the digit. Also blocked a proper
  out-of-sample test: only cross-sectional OOS (new symbols) was possible, never a held-out period.
- **Known trap noted:** additive proto request fields still hard-couple the `run_backtest` MCP tool
  and any UI backtest trigger (ledger fails 056/060/067, rule C-10) — update consumers in the same
  feature with a test.
