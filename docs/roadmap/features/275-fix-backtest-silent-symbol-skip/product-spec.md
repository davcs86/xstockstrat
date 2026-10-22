# Product Spec: fix-backtest-silent-symbol-skip

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-15-backtest-silent-symbol-skip-reports-ok-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-22

---

## Problem Statement

**Observed.** On staging (deployment `63d315a4`, image `a8a3cfd`),
`run_backtest(squeeze_breakout_trend, ["AAPL"], start="2026-01-01", end="2026-09-30")` returned backtest
`df5d966f-f9cb-4e77-b095-6af56908f36a` with `status: BACKTEST_STATUS_OK`, `total_trades: 0`, `diagnostics: []`,
`coverage_gaps: []` and `warnings: []`. AAPL has ≥ 501 stored daily bars. The same strategy on SCHD (3 stored bars)
gave the same shape (`d7892362-deb7-4c2b-88a9-abf679b7dfb1`) with no coverage gap. The analysis log shows the real
cause for every run: `backtest symbol <SYM> failed: <AioRpcError … PERMISSION_DENIED "admins cannot execute another
user's formula"> — skipping`.

Code on `main-dev` `6923e95a` (`services/xstockstrat-analysis`), unchanged in substance since the report:

- **The silent skip.** In the `RunBacktest` symbol loop, `except grpc.RpcError` (`app/handlers/servicer.py:1127-1129`)
  and `except Exception` (`:1130-1132`) each `log.warning(...)` and `continue`. They append no `SymbolDiagnostics`,
  no coverage gap and no warning, and touch none of the gate counters. The sibling `except FormulaExecutionError`
  (`:1112-1126`) appends `NO_TRADE_REASON_FORMULA_ERROR` and increments `formula_errors`.
- **The status gate.** `:1236-1241` returns `INSUFFICIENT_DATA` only when there are no trades, no usable curve **and**
  `coverage_gaps or formula_errors or fund_refusals or fund_unknown`. An all-skipped run satisfies none of these and
  is `BACKTEST_STATUS_OK`.
- **Consequences of the false OK.** The run is scored for the run-history row (`_score_from_result`, `:1297`),
  persisted (`_persist_backtest_run`, `:1300`; `_persist_backtest_detail`, `:1314`), and the headline recompute runs
  (`_recompute_headline`, `:1322`).
- **How a custom formula reaches the skip.** `StrategyEvaluator._execute_formula`
  (`app/services/evaluator.py:254-266`) maps only `NOT_FOUND` to `FormulaExecutionError` (`:260-263`) and re-raises
  every other `AioRpcError` code. Indicators `ExecuteFormula` raises PERMISSION_DENIED to an admin-scoped non-author
  (`services/xstockstrat-indicators/app/handlers/servicer.py:243-248`, via `_can_read_formula` `:141-148`). A
  `GetBars` or `ComputeIndicator` RpcError reaches the same branch.

**Expected.** A requested symbol is never dropped silently. Every symbol that fails with an RPC error or an
unexpected exception gets a diagnostics row with a typed reason and a warning naming the symbol and the error status.
These failures count toward the status gate, so a run in which no symbol was evaluated is not `BACKTEST_STATUS_OK`:
it is not scored, not persisted as an OK detail, and does not drive the headline recompute as a success. A partial
run (some symbols evaluated) stays OK, with the failed symbols reported.

**Who is affected.** Anyone running a backtest (agent `run_backtest`, the strat-lab `backtest` skill, the UI backtest
view): a broken strategy reads as "no signal". Two `live_enabled` staging strategies (`squeeze_breakout_trend`,
`dip_buyer_vol_stop`) reference the unexecutable formulas.

## Reproduction Steps

1. On staging, call `run_backtest(squeeze_breakout_trend, ["AAPL"], start="2026-01-01", end="2026-09-30")`.
2. Observe `BACKTEST_STATUS_OK` with `diagnostics: []` and no warnings.
3. Unit level: stub indicators `ExecuteFormula` to raise `AioRpcError(PERMISSION_DENIED)` for the strategy's custom
   formula component; `RunBacktest` returns OK with no diagnostics row.

## Root Cause Hypothesis

Two layers (report § Root cause hypothesis):

- **(a) Contract defect, code-proven — this feature.** The catch-all branches drop the symbol without a diagnostics
  row, and the status gate cannot see them.
- **(b) Trigger, confirmed — not this feature.** Six staging formulas carry the legacy username `author = "davcs86"`
  instead of the owner's user id, so their owner cannot execute them and indicators returns PERMISSION_DENIED to the
  admin-scoped caller. That is a data defect (no indicators migration rewrote `author`). (a) is what hid (b).

## Affected Services

- xstockstrat-analysis (fix site)
- xstockstrat-indicators (read-only: the PERMISSION_DENIED / NOT_FOUND contract the mapping relies on)
- xstockstrat-agent / strat-lab plugin (docs only, if the surfaced reason or warnings change — `docs/patterns/strat-lab-plugin.md`)

## Fix Scope

- [ ] No proto changes anticipated — open: the design may add a `NoTradeReason` value for an RPC/unexpected failure
      instead of reusing `NO_TRADE_REASON_FORMULA_ERROR` plus a warning
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Fixing the trigger (b): rewriting legacy username `author` values in `indicators.formulas` (a separate data-defect
  report is needed; production exposure is unchecked)
- Client deadlines on backtest-path RPCs (feature 272 bounds the run wall-clock; feature 273 bounds agent calls)
- The truncated-bar-series failure surface (`_BarFetchError` → `FAILED_PRECONDITION`), owned by feature 272
