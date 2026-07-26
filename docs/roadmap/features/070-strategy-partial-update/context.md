# Context: strategy-partial-update

**Feature**: `docs/roadmap/features/070-strategy-partial-update/feature.md`
**Product Spec**: `docs/roadmap/features/070-strategy-partial-update/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/070-strategy-partial-update/implementation-spec.md`

---

## Session 2026-07-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin:** discovered during offline cooldown-analysis + strategy-restore work on
  `range_mean_reversion_v3` (staging). Passing only `cooldown_days` to `manage_strategy update`
  wiped the strategy's `z`/`er` components and rules; every subsequent backtest returned 0 trades
  with `NO_TRADE_REASON_ENTRY_NEVER_TRUE`. Reproduced twice. Recovery required re-registering the
  formulas and re-sending the full definition, because no strategy read op is exposed.
- **Known trap noted:** proto changes here hard-couple the `manage_strategy` MCP tool,
  `docs/runbooks/mcp-tools.md`, and the StrategyWizard (ledger fails 056/060/067, rule C-10) — must
  be updated in the same feature with a test.
