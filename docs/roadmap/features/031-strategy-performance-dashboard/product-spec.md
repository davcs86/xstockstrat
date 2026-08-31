# Product Spec: strategy-performance-dashboard

**Created**: 2026-05-26

---

## Problem Statement

The trader UI shows open positions and the insights UI has analytics panels, but neither provides a
longitudinal view of whether the strategy is actually working in paper trading. There is no equity
curve, no drawdown chart, and no aggregate performance statistics. Without this view, the decision to
switch from paper to live trading has no quantitative foundation.

## User Story

As a trader, I want a performance dashboard showing my strategy's equity curve, drawdown, and key
statistics so that I can evaluate whether the paper trading results justify moving to live capital.

## Functional Requirements

FR-1. The insights UI must display an equity curve: cumulative P&L over time as a line chart, computed
from closed position P&L events in the ledger, starting from a configurable base date.
FR-2. The dashboard must display maximum drawdown: the largest peak-to-trough decline in cumulative
P&L, expressed as both a dollar amount and a percentage of peak equity.
FR-3. A rolling 30-day Sharpe ratio must be displayed, computed as:
`mean(daily_returns) / std(daily_returns) × sqrt(252)`, using the risk-free rate from config.
FR-4. Summary statistics must include: total trades, win count, win rate (%), average return per trade
(%), average hold time (hours), total realized P&L.
FR-5. All metrics must refresh automatically on a configurable polling interval (default: 60 seconds)
without a page reload.
FR-6. The equity curve chart must support zoom and pan for inspecting specific time windows.
FR-7. A date range picker filters all metrics to the selected window.
FR-8. The dashboard must clearly label all metrics as "Paper Trading" when `TRADING_MODE=paper` to
prevent misinterpretation.

## Out of Scope

- Benchmark comparison (vs. S&P 500) — V2
- Per-strategy breakdown (single strategy view in V1)
- Live trade performance (paper only in V1; live mode is the same computation but gated separately)
- Predicted future performance projections

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — Next.js `/insights` segment; new performance dashboard page, polling queries, and
  chart components (the standalone `xstockstrat-insights` service was consolidated into `xstockstrat-ui`
  by feature 045).
- `xstockstrat-ledger` — queried for fill and closed-position P&L events by date range (read-only).
- `xstockstrat-portfolio` — queried for current equity basis (the starting value for the equity curve)
  via `GetPnL` (read-only).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights` segment: a new performance dashboard page (equity curve,
  drawdown, rolling Sharpe, summary stats) reachable from the shared `PLATFORM_SUBNAV` insights nav.
- [ ] **Agent** — Not a surface for this feature.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required — reuses the existing ledger read RPCs and portfolio `GetPnL`.

## Config Key Changes

- `insights.performance.risk_free_rate_annual` — float; annualized risk-free rate for the Sharpe
  computation (default: `0.045` = 4.5%).
- `insights.performance.equity_curve_start_date` — ISO date string; starting date for the cumulative
  P&L curve (default: first fill date).

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/strategy-performance-dashboard` (branch from `main-dev`)
This is a **config-only gate** feature (two new config keys, no proto/DB change).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (insights UI + read-only ledger/portfolio queries)
- [x] Config-key owner + config team (two new `insights.performance.*` keys)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Should daily returns be computed from ledger events (event-driven, exact) or from daily portfolio
  snapshots (simpler, requires snapshotting infra)? Event-driven preferred — no new infra needed.
  Confirm at impl-spec.
- [ ] Which charting library for the equity curve? Reuse the existing insights/trader chart engine
  (lightweight-charts, features 014/146) — identify the exact reused component at impl-spec time.
- **Known trap (charting):** do not add a second charting library for this page — reuse the existing
  lightweight-charts engine; cross-engine axis/tick sync is a documented fail (ledger 146).
- **Known trap (config float zero):** an operator-set `risk_free_rate_annual` of `0.0` reads back as
  the default under Python `get_float` (`0.0` is falsy); read with `get_float_present`/`HasField` so a
  legitimate zero is honored (ledger `ANALYSIS-WATCHER-1`).
- **Known trap (Sharpe / P&L math):** a zero-variance (or single-point) return window makes `std = 0`,
  so the Sharpe ratio is `inf`/`NaN`, and `MessageToDict`/JSON reject non-finite values (ledger 072) —
  guard zero-variance windows and render an explicit not-available placeholder rather than serializing
  a non-finite number.
- **Known trap (nav reachability, C-10(a)):** a new insights page must be registered in the shared
  `PLATFORM_SUBNAV` with a nav-reachability test, or it ships unreachable from the sidebar (ledger 060).
