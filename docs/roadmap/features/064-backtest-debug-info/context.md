# Context: backtest-debug-info

**Feature**: `docs/roadmap/features/064-backtest-debug-info/feature.md`
**Product Spec**: `docs/roadmap/features/064-backtest-debug-info/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/064-backtest-debug-info/implementation-spec.md`

---

## Session 2026-07-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: user posted a screenshot of the strategy backtest run (symbol LLY, 0 trades / 0% return,
  data coverage sufficient) and asked for "more debugging information … a table day by day with
  OHLCV and indicators data."
- User decisions captured up front (AskUserQuestion):
  - **Debug scope**: Full diagnostics (OHLCV + indicators + warm-up markers + per-bar signal scores
    + entry/exit/conviction decision + why-no-trade summary).
  - **Delivery**: Always included in the `RunBacktest` response (no opt-in request flag).
  - **Approach**: Spec-first — write the product spec for review before writing any code.
- Recon notes for the design/spec phase:
  - `RunBacktest` returns `BacktestResult` (`packages/proto/analysis/v1/analysis.proto:54`);
    already carries `trades`, `status`, `coverage_gaps`.
  - Two engine paths in `services/xstockstrat-analysis/app/handlers/servicer.py`:
    `_backtest_symbol` (legacy SMA crossover — computes fast/slow SMA, tech_signal, signal_score,
    combined conviction) and `_backtest_symbol_evaluated` (evaluator path).
  - `app/services/evaluator.py` computes `component_series` (all output series, no look-ahead) but
    `evaluate()` returns only `list[BarDecision]` — component series would need to be exposed for
    diagnostics.
  - Bar fields available: open/high/low/close/volume/vwap/time
    (`packages/proto/marketdata/v1/marketdata.proto:44`).
  - UI target: `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` (metrics grid +
    equity curve + existing `INSUFFICIENT_DATA` coverage-gap/backfill card, feature 053).
- Ledger `fails.md` is empty — no prior trap to design around. Chief self-identified risks recorded as
  OQ-1 (no look-ahead / warm-up definition) and OQ-2 (always-included response size).

Next: `/sdd-review backtest-debug-info product-spec`.
