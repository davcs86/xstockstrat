# Product Spec: strategy-performance-dashboard

**Created**: 2026-05-26

---

## Problem Statement

The trader UI shows open positions and the insights UI has analytics panels, but neither provides a longitudinal view of whether the strategy is actually working in paper trading. There is no equity curve, no drawdown chart, and no aggregate performance statistics. Without this view, the decision to switch from paper to live trading has no quantitative foundation.

## User Story

As a trader, I want a performance dashboard showing my strategy's equity curve, drawdown, and key statistics so that I can evaluate whether the paper trading results justify moving to live capital.

## Functional Requirements

FR-1. The insights UI must display an equity curve: cumulative P&L over time as a line chart, computed from closed position P&L events in the ledger, starting from a configurable base date.
FR-2. The dashboard must display maximum drawdown: the largest peak-to-trough decline in cumulative P&L, expressed as both a dollar amount and a percentage of peak equity.
FR-3. A rolling 30-day Sharpe ratio must be displayed, computed as: `mean(daily_returns) / std(daily_returns) × sqrt(252)`, using risk-free rate from config.
FR-4. Summary statistics must include: total trades, win count, win rate (%), average return per trade (%), average hold time (hours), total realized P&L.
FR-5. All metrics must refresh automatically on a configurable polling interval (default: 60 seconds) without a page reload.
FR-6. The equity curve chart must support zoom and pan for inspecting specific time windows.
FR-7. A date range picker filters all metrics to the selected window.
FR-8. The dashboard must clearly label all metrics as "Paper Trading" when `TRADING_MODE=paper` to prevent misinterpretation.

## Out of Scope

- Benchmark comparison (vs. S&P 500) — V2
- Per-strategy breakdown (single strategy view in V1)
- Live trade performance (paper only in V1; live mode is the same computation but gated separately)
- Predicted future performance projections

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-insights` — new performance panel, polling queries, chart components
- `xstockstrat-ledger` — queried for fill and P&L events by date range
- `xstockstrat-portfolio` — queried for current equity basis (starting value for equity curve)

## Proto Contract Changes

- [ ] No proto changes required — uses existing ledger read RPCs and portfolio GetPnL

## Config Key Changes

- `insights.performance.risk_free_rate_annual` — float; annualized risk-free rate for Sharpe computation (default: 0.045 = 4.5%)
- `insights.performance.equity_curve_start_date` — ISO date string; starting date for cumulative P&L curve (default: first fill date)

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/strategy-performance-dashboard` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (insights UI + read-only ledger/portfolio queries)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. After 10+ closed paper trades, the equity curve displays a correct cumulative P&L line verified against ledger records.
2. Maximum drawdown is correctly identified as the largest peak-to-trough decline in the equity curve.
3. Sharpe ratio is within 0.01 of a hand-computed reference calculation using the same daily returns series.
4. All statistics update within 65 seconds of a new fill event without a page reload.
5. The "Paper Trading" label is visible in paper mode and absent in live mode.
6. Date range filter correctly scopes all metrics to the selected window.

## Open Questions

- [ ] Should daily returns be computed from ledger events (event-driven, exact) or from daily portfolio snapshots (simpler, requires snapshotting infra)? Event-driven preferred — no new infra needed. Confirm at impl-spec.
- [ ] Which charting library for the equity curve? The trader UI chart panel (feature 014) already chose a library — reuse the same one for consistency. Identify at impl-spec time.
