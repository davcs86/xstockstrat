# Context: backtest-next-bar-fill

**Feature**: `docs/roadmap/features/151-backtest-next-bar-fill/feature.md`
**Product Spec**: `docs/roadmap/features/151-backtest-next-bar-fill/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/151-backtest-next-bar-fill/implementation-spec.md`

---

## Session 2026-08-23 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  metrics-sweep audit finding #3 (`_tasks/x-backtest-metrics-audit.md` Q1).
- Root evidence: both simulators fill at the current bar's close ± slippage —
  `services/xstockstrat-analysis/app/handlers/servicer.py:966-967,1005-1020` (`_backtest_symbol`) and
  `:1174-1175,1190-1208` (`_backtest_symbol_evaluated`); the decision for bar i is evaluated from bar
  i's own series, so filling at bar i's close is a mild look-ahead.
- Operator decision this session: **story + design only** — stop before /sdd-spec and /sdd-execute.
- Orthogonal to feature 150 (sizing): fill model and sizing mode are independent request params;
  cross-feature coordination noted for proto field numbers (150 `sizing_mode=8`, this `fill_model=9`)
  and migration numbers (whichever lands first takes 017).
- Known traps: ledger 067 (proto enum ↔ UI exhaustive `Record` map coupling); alignment invariant
  `daily_equity[j]↔diags[j]` (`servicer.py:3275-3296`, feature 071) must be preserved; analysis review
  focus = no look-ahead bias.
- Development branch note: rides `claude/xstockstrat-metrics-sweep-m070rf` this session per the binding
  branch constraint.
