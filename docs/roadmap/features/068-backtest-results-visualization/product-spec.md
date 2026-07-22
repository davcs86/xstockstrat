# Product Spec: backtest-results-visualization

**Created**: 2026-07-21

---

## Problem Statement

A strategy developer can run a backtest and see rich results (metrics, equity curve, per-bar
diagnostics) for the run they just executed, but past runs survive only as one summary row each
(`ListBacktests` → `BacktestRunSummary`). The full trades/diagnostics exist only on the latest
in-memory result, so a historical run cannot be re-opened, visualized, or compared — after a
service restart or a newer run, its detail is gone.

## User Story

As a strategy developer, I want to visualize any historical backtest run through the UI
(equity curve, summary metrics, trade markers, per-bar diagnostics), so that I can evaluate and
compare strategy performance over time without re-running backtests or reading raw RPC output.

## Functional Requirements

FR-1. **Persist full backtest results per run.** When `RunBacktest` completes with
      `BACKTEST_STATUS_OK`, the analysis service durably stores the run's detail — at minimum
      the `TradeRecord` list and the data needed to rebuild the equity curve — keyed by
      `backtest_id`, surviving service restarts. Per-bar `SymbolDiagnostics` persistence is
      included unless the design phase documents a size-based cutoff (bounded by
      `analysis.backtest.max_range_days` ≈ 504 rows/symbol).

FR-2. **Fetch a historical run's detail.** A new read RPC (e.g. `GetBacktest(backtest_id)`)
      returns the persisted `BacktestResult` for any run listed by `ListBacktests`. Runs
      predating this feature (no persisted detail) return a distinguishable not-found/empty
      state, not an error page.

FR-3. **Open a past run from the UI.** In the strategy detail page's Past Runs table, each row
      is openable; opening it renders the same results surface used for a fresh run (metrics
      grid, equity curve, diagnostics) populated from the persisted detail of that run.

FR-4. **Time-based equity curve with trade markers.** The equity curve is plotted against time
      (bar/trade timestamps), not trade ordinal, and marks trade entry/exit points; hovering a
      marker shows the trade's symbol, side, qty, entry/exit price, and P&L. Applies to both the
      fresh-run view and the historical-run view (same component — no divergent render paths).

FR-5. **Summary metrics parity.** The historical view shows the identical metric set the fresh
      run shows today (total return, annualized return, Sharpe, max drawdown, win rate, total
      trades, profit factor) sourced from the persisted run — values must match what
      `ListBacktests` reports for that row.

FR-6. **Legacy rows degrade gracefully.** Past Runs rows without persisted detail (pre-feature
      runs) remain visible in the table and clearly indicate that detailed visualization is
      unavailable for them.

FR-7. **Retention bound.** Persisted detail is bounded (e.g. most recent N runs per strategy,
      configurable) so the detail table cannot grow without limit; evicted runs fall back to
      FR-6 behavior. Policy: count-based, most recent 20 per strategy (see Open Questions
      resolution); design decides only eviction mechanics and storage encoding.

## Out of Scope

- Comparing two runs side-by-side in one chart (future feature).
- Re-running/cloning a historical run from its row.
- Visualizing live-loop (feature 048) evaluations — backtests only.
- Exporting results (CSV/PNG).
- Any change to the backtest engine's simulation logic or scoring.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — persist run detail, new read RPC, retention/eviction
- `xstockstrat-ui` — insights segment: openable Past Runs rows, historical results view, time-based equity curve with trade markers, BFF route registration
- `packages/proto` — new RPC + request/response messages in `analysis/v1`

## Proto Contract Changes

- [ ] ~~No proto changes required~~
- New RPC on `AnalysisService`: `GetBacktest(GetBacktestRequest) returns (BacktestResult)`
  (non-breaking, additive). `GetBacktestRequest { string backtest_id }`.
- No changes to existing messages expected; if the equity curve needs persisted per-bar equity
  points, an additive repeated field on `BacktestResult` may be proposed at design time.

## Config Key Changes

- [ ] ~~No new config keys~~
- `analysis.backtest.detail_retention_per_strategy` (int, default **20**) — max persisted
  detailed runs per strategy (matches the `ListBacktests` server default of the most recent
  20 rows); owner: `xstockstrat-analysis`. Default to be declared in
  `services/xstockstrat-analysis/CLAUDE.md` at implementation (C-05).

## Database Changes

- [ ] ~~No schema changes~~
- New migration `008_*` in `services/xstockstrat-analysis/migrations/` (next after
  `007_backtest_run_symbols`, applied via `scripts/db-migrate.sh` in the standard run order):
  table(s) for per-run detail (trades + equity/diagnostics payload) keyed by `backtest_id`,
  with an index on `(strategy_id, completed_at)` for retention eviction. Exact shape
  (normalized rows vs JSONB payload) decided at design time; DBA review required.

## Feature Workflow Notes

Branch to create: `feature/backtest-results-visualization` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change) — not required (additive only)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. Running a backtest, restarting `xstockstrat-analysis`, then opening that run from Past Runs
   shows its metrics, equity curve, and trades identical to the values shown at run time.
2. The equity curve x-axis is time; each closed trade renders a marker whose tooltip shows
   symbol, side, qty, entry/exit price, and P&L.
3. A pre-feature run (summary row without persisted detail) still renders in Past Runs and
   shows an explicit "no detailed data for this run" state when opened.
4. `ListBacktests` metric values and the opened run's metric values agree for the same
   `backtest_id` (parity per Ledger C-10(b)).
5. The fresh-run result view and the historical-run view render through the same components —
   no duplicated chart/metrics implementations (DRY guard rail).
6. `buf lint` and `buf breaking` pass; migration has up+down pair; e2e test covers opening a
   past run against the mock backend.

## Open Questions

- [x] **Resolved 2026-07-21**: persist the full run detail — trades, per-bar equity points,
      *and* per-bar `SymbolDiagnostics` — in one payload per run. Size is bounded twice over:
      ≤ ~504 bars/symbol (`analysis.backtest.max_range_days`, feature 064) and ≤ 20 detailed
      runs/strategy (retention key below). The storage encoding (JSONB payload vs normalized
      rows) is a design-phase implementation choice, not a product question.
- [x] **Resolved 2026-07-21**: retention default is the most recent **20** detailed runs per
      strategy (count-based, matching the `ListBacktests` server default), configurable via
      `analysis.backtest.detail_retention_per_strategy`. Eviction removes detail payloads
      **only** — `backtest_runs` summary rows are never trimmed; evicted runs degrade to FR-6.

## Known Traps (from Ledger — carried into design/spec phases)

- Ledger 2026-07-01, C-10(a): if the historical view becomes a new route rather than in-page
  state, it must be nav-reachable and covered by a reachability e2e. (Current intent: in-page
  state on the existing strategy detail page.)
- Ledger 2026-07-01, C-10(b): metrics surface via two read paths (`ListBacktests` and the new
  `GetBacktest`) — AC-4 mandates a parity test across both.
- Ledger 2026-07-21 fails.md entry (cited there as "C-10(a/d)" shorthand; not a Constitution
  ID): any new/extended proto enum must update every exhaustive TS `Record<Enum,…>` map in the
  same PR, verified by a frontend build in the proto step's paired check.
