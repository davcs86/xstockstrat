# Context: strategy-reentry-cooldown

**Feature**: `docs/roadmap/features/068-strategy-reentry-cooldown/feature.md`
**Product Spec**: `docs/roadmap/features/068-strategy-reentry-cooldown/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/068-strategy-reentry-cooldown/implementation-spec.md`

---

## Session 2026-07-24T07:05:26Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Motivating evidence: MCP-tool-driven shadow-strategy validation session (no production strategy
  touched) that fixed a sandbox bug in two custom formulas (`rolling_zscore_v2`,
  `kaufman_efficiency_ratio_v2`) for a `range_mean_reversion_v2` shadow strategy, then tested a
  bounded-exit variant `range_mean_reversion_v3` (adds `er>0.5 OR z<=-3.0` bail-out conditions to
  the `z>=0` exit). v3 improved the 10-symbol basket aggregate materially (total_return -8.42%→
  +1.23%, max_drawdown 53.1%→36.3%) but degraded WSM specifically (win rate 66.7%→46.7%, Sharpe
  -0.55→-1.07) because the tightened exit stopped it out and the entry condition immediately
  refired on the same still-declining symbol, four times within about a month — confirmed in code
  at `services/xstockstrat-analysis/app/handlers/servicer.py:849`
  (`if position == 0.0 and decision.entry:`, no recency check). This feature is the fix for that
  specific whipsaw mechanism.
- User directed the default cooldown to be wash-sale-safe: 31 calendar days (outside the IRS
  30-day-each-side wash-sale window), configurable per strategy via a new
  `analysis.strategy.default_cooldown_days` config key and `StrategyDefinition.cooldown_days` field.
- No production strategy or shadow strategy has been modified as part of this `/sdd-story` step —
  this is spec-only.
