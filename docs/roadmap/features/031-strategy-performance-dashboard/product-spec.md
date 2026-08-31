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
FR-8. The dashboard must clearly label all metrics as "Paper Trading" when the deployment's
environment-derived trading mode is paper, determined via the existing **`GetTradingEnvironment`** RPC
(already consumed by `traderBff.ts` and surfaced by `AccountContext.tsx` as `environmentMode`), NOT a
`TRADING_MODE` axis. The `TRADING_MODE` config/env dimension was removed by feature 147 — paper/live is
now derived from environment (`staging` → paper, `production` → live). Concretely: in **staging** the
"Paper Trading" label is shown; in **production** it is not.

> **Realized-only (C-5):** only fully-closed (realized) positions feed the equity curve and every metric
> derived from it (drawdown, rolling Sharpe, summary stats); open or partially-filled positions are
> excluded. Fill-lifecycle handling is unaffected — partial fills still accumulate toward a close as
> today; a position simply contributes to these metrics only once it is fully closed.

## Out of Scope

- Benchmark comparison (vs. S&P 500) — V2
- Per-strategy breakdown (single strategy view in V1)
- Live trade performance (paper only in V1; live mode is the same computation but gated separately)
- Predicted future performance projections

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — Next.js `/insights` segment; new performance dashboard page, polling queries, and
  chart components (the standalone `xstockstrat-insights` service was consolidated into `xstockstrat-ui`
  by feature 045). **All equity-curve / drawdown / rolling-Sharpe / summary-stat math runs here, in the
  xstockstrat-ui BFF/lib** — reading ledger events + portfolio `GetPnL` over existing RPCs. There is no
  backend analytics service in this feature and no proto change.
- `xstockstrat-ledger` — queried for fill and closed-position P&L events by date range (read-only).
- `xstockstrat-portfolio` — queried for current equity basis (the starting value for the equity curve)
  via `GetPnL` (read-only).
- `xstockstrat-trading` — read-only reuse of the existing `GetTradingEnvironment` RPC (via the current
  `traderBff.ts` registration / `AccountContext.tsx`) for the FR-8 environment-derived paper/live label.
  No new endpoint or behavior.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights` segment: a new performance dashboard page (equity curve,
  drawdown, rolling Sharpe, summary stats) reachable from the shared `PLATFORM_SUBNAV` insights nav.
- [ ] **Agent** — Not a surface for this feature.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required — reuses the existing ledger read RPCs and portfolio `GetPnL`.

## Config Key Changes

Both keys live in the **`ui.performance.*`** namespace. The `insights.*` prefix was retired when the
standalone insights service was consolidated into `xstockstrat-ui` (feature 045) — it names a service
that no longer exists. `ui` is the config short-name for `xstockstrat-ui`, which both computes these
metrics (in its BFF/lib, from ledger events + portfolio `GetPnL` over existing RPCs — no proto change)
and consumes the keys.

- `ui.performance.risk_free_rate_annual` — float; annualized risk-free rate for the Sharpe
  computation (default: `0.045` = 4.5%).
- `ui.performance.equity_curve_start_date` — ISO date string; starting date for the cumulative
  P&L curve (default: first fill date).

The exact xstockstrat-ui config-consumption path for these two keys (a `WatchConfig` subscription vs a
one-shot `GetConfig` read via the existing `ConfigService` BFF registration in `traderBff.ts`) is a
Design-Phase Decision — see below.

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/strategy-performance-dashboard` (branch from `main-dev`)
This is a **config-only gate** feature (two new config keys, no proto/DB change).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (insights UI + read-only ledger/portfolio queries)
- [x] Config-key owner + config team (two new `ui.performance.*` keys)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

None — moved to Design-Phase Decisions below.

## Design-Phase Decisions (owned by /sdd-design)

Architecture forks to resolve during `/sdd-design`, not acceptance unknowns:

- **Daily-returns source.** Compute daily returns from ledger fill events (event-driven, exact) or from
  daily portfolio snapshots (simpler, requires snapshotting infra)? Event-driven is preferred — no new
  infra needed. Confirm at /sdd-design.
- **Charting library.** Reuse the existing insights/trader chart engine for the equity curve
  (`lightweight-charts` v5, features 014/146) and identify the exact reused component. Do **not** add a
  second charting library for this page — cross-engine axis/tick sync is a documented fail (ledger 146).
- **Config-consumption path.** Confirm how `xstockstrat-ui` reads the two `ui.performance.*` keys — a
  `WatchConfig` subscription vs a one-shot `GetConfig` read via the existing `ConfigService` BFF
  registration in `traderBff.ts` — at /sdd-design.

## Design Guardrails

Constraints to honor in the design/implementation (not open forks):

- **Config zero vs absent (Node/JSON number handling).** The consumer is the Node/Next.js UI, not a
  Python service. A configured `ui.performance.risk_free_rate_annual` of `0` is legitimate (a zero
  risk-free rate) and must not be collapsed to the `0.045` default. Read it with an explicit
  presence/`undefined` check, never a falsy `value || default` guard (which treats `0` as absent).
- **Non-finite Sharpe guard.** A zero-variance (or single-point) return window makes `std = 0`, so the
  Sharpe ratio is `Infinity`/`NaN`. `JSON.stringify` serializes both to `null` and `Number.isFinite`
  is false, so guard zero-variance windows explicitly and render a not-available placeholder rather
  than emitting a non-finite number (ledger 072).
- **Nav reachability (C-10(a)).** A new insights page must be registered in the shared
  `PLATFORM_SUBNAV` with a nav-reachability test, or it ships unreachable from the sidebar (ledger 060).
