# Context: live-strategy-alert-engine

**Feature**: `docs/roadmap/features/048-live-strategy-alert-engine/feature.md`
**Product Spec**: `docs/roadmap/features/048-live-strategy-alert-engine/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/048-live-strategy-alert-engine/implementation-spec.md`

---

## Session 2026-06-01 — sdd-story

- Split out of the `047-strategy-engine` revamp. User wanted a live "strategy→alert" engine where
  strategies (composed of multiple indicators/custom formulas) run continuously and in backtests.
  The model/persistence/evaluator/backtest half went to 047; this feature is the **continuous
  live evaluation runtime** that emits alerts on entry/exit triggers.
- **Hard dependency on 047** (StrategyDefinition + shared evaluator). Must merge after 047 — to be
  recorded in `merge-order.md` when 047/048 reach implementation.
- Core principle: **evaluator parity** — live evaluation calls the same 047 evaluator as backtest,
  so live and simulated decisions cannot diverge.
- Safety invariant captured: **alerts only, never orders**, in any trading mode.
- Related existing features noted: `010-agent-scheduler` (continuous signal-extraction loop — same
  runtime concern, reuse pattern), `031-strategy-performance-dashboard`, `032-walk-forward-backtesting`
  (should reuse 047 evaluator), `025-realtime-tick-streaming` (out of scope — this engine uses bars).
- Main Open Question for /sdd-spec: where the runtime lives (analysis loop vs new service vs agent
  scheduler) — Platform Lead decision.
