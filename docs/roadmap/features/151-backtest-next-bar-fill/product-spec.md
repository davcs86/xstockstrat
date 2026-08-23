# Product Spec: backtest-next-bar-fill

**Created**: 2026-08-23

---

## Problem Statement

Both backtest simulators fill at the **current bar's close**: the entry/exit decision for bar `i` is
evaluated from bar `i`'s own indicator series (which includes bar `i`'s close), then filled at that
same close ± slippage (`servicer.py:966-967,1005-1020` and `:1174-1175,1190-1208`). A trader cannot
observe a bar's close and simultaneously transact at it, so this is a mild look-ahead / optimistically
biased fill that inflates returns relative to what live trading can achieve. The `vts crosses_below 0`
stop has the same issue. This undermines the predictive value of every backtest.

## User Story

As a strategy analyst, I want backtest fills to occur at the **next bar's open** (the standard
bias-free convention), so that backtested performance realistically reflects what live execution could
have achieved.

## Functional Requirements

FR-1. In next-bar-open mode, a signal evaluated on bar `i` (entry, exit, or the `vts` stop) fills at
bar `i+1`'s **open** (± slippage), not bar `i`'s close.
FR-2. A signal on the **last** bar (no `i+1` exists) is handled deterministically and documented
(e.g. the trade does not open; an open position's forced close remains at the final available price).
No look-ahead is introduced anywhere.
FR-3. The fill model is **opt-in and versioned**: existing runs default to the legacy same-bar-close
model so previously banked backtests stay comparable; the fill model used is recorded on the run and
surfaced in the result. No silent behavior change to existing callers.
FR-4. Per-bar diagnostics stay consistent: the `daily_equity[j]` ↔ `diags[j]` 1:1 alignment invariant
(`servicer.py:3275-3296`, feature 071) is preserved, and each `BarDiagnostic.action` reflects the bar
on which the fill actually occurs.
FR-5. Per-symbol evidence cells and the feature-065 derived grade continue to be computed the same way
(the change is to *fill price/timing*, not to the metric definitions); any grade movement is solely
the consequence of more realistic fills, not of a metric redefinition.

## Out of Scope

- The `annualized_return` period bug (feature 149 — fixed) and the serial-parlay sizing (feature 150 —
  separate; this feature is orthogonal and composes with either sizing mode).
- Intrabar fill modeling (limit/stop touches within a bar), gap handling beyond next-open, partial
  fills, or volume-based slippage — v1 is next-bar-open at the open price only.
- Changing commission/slippage magnitudes.

## Affected Services

- `xstockstrat-analysis` — both simulators and the fill sites in `app/handlers/servicer.py`.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` `run_backtest`: optional `fill_model` arg; result summary reports
  the fill model used. Update the `strat-lab` `backtest` skill in the same PR (root CLAUDE.md).
- [x] **UI** — `xstockstrat-ui` `/insights` backtest views: label the fill model on the result so a
  next-bar-open run isn't silently compared to a legacy same-bar-close run. Scope pinned in design.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- **Likely**: an additive, optional `FillModel` enum on `RunBacktestRequest` (with `..._UNSPECIFIED=0`
  → legacy default) and a marker on `BacktestResult` / `BacktestRunSummary` recording the fill model
  used. Additive only; `buf breaking` stays green. **Cross-feature field-number coordination:** feature
  150 also adds an additive `RunBacktestRequest` field (`sizing_mode = 8`); this feature must take the
  **next** free number (`fill_model = 9`) to avoid a collision if both land — confirm free numbers at
  spec time. **Known trap (ledger 067):** a new proto enum needs its UI exhaustive-`Record` key in the
  same PR.

## Config Key Changes

- [ ] No new config keys (fill model is a per-run request param; a config-backed default is optional —
  decide in design).

## Database Changes

- [ ] No schema changes
- **Possible**: a `fill_model` column on `analysis.backtest_runs` (additive migration; coordinate the
  migration number with feature 150's `017` — whichever lands first takes `017`, the other `018`).

## Feature Workflow Notes

Branch to create: `feature/backtest-next-bar-fill` (from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change)
- [ ] DBA review + service owner (only if a migration is added)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` is covered by ≥1 tagged scenario.

## Open Questions

- [ ] **Last-bar signal handling**: skip the entry entirely (recommended, no look-ahead) vs fill at the
  last close? Confirm the deterministic rule for FR-2.
- [ ] **Mode surface**: request-param only, or also a config default? Recommend request-param with an
  optional config-backed default.
- [ ] **Interaction with feature 150**: fill model and sizing mode are orthogonal; confirm the two
  request fields compose cleanly and the design/spec coordinate proto field + migration numbers.
- [ ] **Slippage sign at the open**: keep `open * (1 ± slippage)` symmetric with today's convention?
- [ ] Known trap (ledger 067): every new proto enum value lands with its UI exhaustive-map key in the
  same PR.
