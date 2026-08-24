# Product Spec: backtest-portfolio-sizing

**Created**: 2026-08-23

---

## Problem Statement

The backtest engine loops symbols serially, threading one running equity scalar from each symbol into
the next (`servicer.py:522,525-529`) and concatenating their per-symbol curves (`servicer.py:571`), so
aggregate `total_return` = Π(1+rᵢ)−1 across all symbols — a compounding "parlay," not a portfolio
return. Over 33 symbols this produced the implausible +193%/+207% aggregates seen in the metrics
sweep, and the result depends on symbol order. Analysts cannot read aggregate return as a portfolio's
performance, which undermines strategy comparison and any capital-planning use of a backtest.

## User Story

As a strategy analyst, I want a backtest's aggregate return to reflect a real shared-capital portfolio
(concurrent positions, one equity curve, a defined allocation policy), so that `total_return` and
`max_drawdown` mean what a portfolio manager expects and are comparable across strategies.

## Functional Requirements

FR-1. A backtest run can execute in a **portfolio mode**: a single shared cash pool is allocated
across symbols under a defined policy (equal-weight fraction per concurrent position, with a cash
buffer), positions in different symbols may be **held concurrently**, and one **portfolio-level daily
equity curve** (summing cash + all open positions, marked-to-market per bar on a shared calendar) is
produced.
FR-2. Aggregate `total_return`, `max_drawdown`, and `sharpe_ratio` are computed from the
portfolio-level curve and are **independent of symbol ordering**.
FR-3. Portfolio mode is **opt-in and versioned**: existing runs default to the legacy serial model so
previously banked backtests stay comparable; the mode used is recorded on the run
(`backtest_runs`) and surfaced in the result. No silent behavior change to existing callers.
FR-4. Per-symbol evidence cells (`servicer.py:558`) and the **feature-065 derived grade** are
**unchanged** — the grade continues to derive from per-symbol cells, not the aggregate curve.
FR-5. When capital is insufficient to open a new position at the policy weight (all cash committed to
concurrent holdings), the entry is skipped with a diagnostic reason rather than silently sized to
zero; behavior is deterministic and documented.
FR-6. Backtest/live parity is preserved or the divergence is explicitly documented (the live loop
places no orders, so this is a backtest-only accounting change — confirm during design).

## Out of Scope

- The `annualized_return` period bug (feature 149 — already fixed).
- The same-bar-close vs next-bar-open fill model (feature 151 — separate).
- Changing per-symbol sizing *within* a single-symbol run's own cell.
- Sophisticated allocation (risk-parity, vol-targeting, correlation-aware weighting) — v1 is
  equal-weight / fixed-fraction only; advanced schemes are a named follow-up if wanted.
- Retroactively recomputing historically banked runs.

## Affected Services

- `xstockstrat-analysis` — the backtest engine (`app/handlers/servicer.py` `RunBacktest`,
  `_backtest_symbol_evaluated` / `_backtest_symbol`, `_compute_metrics`).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tool `run_backtest` — likely gains an optional
  sizing/portfolio-mode argument and the result summary reports which mode ran. The `strat-lab`
  plugin's `backtest` skill documents `run_backtest` quirks and must be updated in the same PR that
  changes the tool (root CLAUDE.md § strat-lab plugin).
- [x] **UI** — `xstockstrat-ui` `/insights` backtest surface — if the run result exposes a
  portfolio-vs-legacy mode and a portfolio equity curve, the backtest/Past-Runs views should label the
  mode so a portfolio-mode return isn't compared against a legacy-mode one. Exact scope to be pinned in
  design.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- **Likely**: an additive, optional sizing-mode selector on `RunBacktestRequest` (prefer an enum with
  `..._UNSPECIFIED = 0` → legacy default, per proto governance) and a field on `BacktestResult` /
  `BacktestRunSummary` recording the mode actually used. Additive only; `buf breaking` must stay green.
  **Known trap (ledger 067):** a new proto enum couples to the UI's exhaustive `Record<…>` maps —
  any enum addition needs the matching TS map update in the *same* PR or `pnpm build` fails.

## Config Key Changes

- [ ] No new config keys
- **Possible**: a default allocation fraction / max-concurrent-positions default under `analysis.backtest.*`
  (e.g. `analysis.backtest.portfolio_max_weight`). Decide in design vs. request-level params.

## Database Changes

- [ ] No schema changes
- **Possible**: a `sizing_mode` column on `analysis.backtest_runs` (additive migration) so Past-Runs
  can distinguish portfolio vs legacy rows. Decide in design (could ride existing JSONB if present).

## Feature Workflow Notes

Branch to create: `feature/backtest-portfolio-sizing` (from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (only if a breaking proto change — should be avoidable)
- [ ] DBA review + service owner (only if a migration is added)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` is covered by ≥1 tagged scenario.

## Open Questions

- [ ] **Allocation policy for v1**: equal-weight fixed fraction per concurrent position with a global
  cash buffer, or a fixed per-position fraction of *initial* capital? What is `max_concurrent_positions`
  and the default weight?
- [ ] **Mode surface**: request-level param (per run) vs config default vs both? Recommend
  request-level enum with a config-backed default.
- [ ] **Comparability policy**: should the derived grade ever consider portfolio-mode aggregates, or
  stay strictly per-symbol-cell (recommended: stay per-cell, FR-4)?
- [ ] **UI comparability guard**: is labeling the mode enough, or should Past-Runs prevent
  cross-mode ranking? (design to decide the minimum viable guard.)
- [ ] Known trap (ledger 067): confirm every new proto enum value lands with its UI exhaustive-map key
  in the same PR.
