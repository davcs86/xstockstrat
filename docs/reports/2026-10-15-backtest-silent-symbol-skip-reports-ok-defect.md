# Defect: A backtest whose symbols all fail with an RPC error or exception reports OK with no diagnostics

**Recorded**: 2026-10-15
**Severity**: SEV-2
**Impact type**: silent-failure / misleading-result
**Environment**: dev (staging app `xstockstrat-staging`, deployment `63d315a4`, image `a8a3cfd`)
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no

## Observed

`run_backtest(squeeze_breakout_trend, ["AAPL"], start="2026-01-01", end="2026-09-30")` on staging returned:
- `backtest_id` `df5d966f-f9cb-4e77-b095-6af56908f36a`
- `status: BACKTEST_STATUS_OK`, `total_trades: 0`
- `diagnostics: []`, `coverage_gaps: []`, `warnings: []`

There is no per-symbol row, so there is no `no_trade_reason` or `bars_total`. AAPL has ≥ 501 stored daily bars:
`fundamentals_macd_blend` on AAPL returns a row with `bars_total` 501.

The same strategy on SCHD gives the same shape (`d7892362-deb7-4c2b-88a9-abf679b7dfb1`, and `3e90baba…` earlier). SCHD has
only 3 stored bars (2026-10-13..15), yet there is no coverage gap.

Both of the strategy's custom formulas (`31bb8ea6…` Bollinger Squeeze Percentile, `7f595658…` Volatility Trailing
Stop) run successfully in the staging sandbox via `test_formula`.

## Expected

A requested symbol is never dropped silently. Every symbol that fails with an RPC error or an unexpected exception
gets a diagnostics row with a typed reason, or at least a warning. A run in which **no** symbol was evaluated is not
`BACKTEST_STATUS_OK`, so it is not scored, not persisted as an OK detail, and does not drive a headline-grade
recompute as a success.

## Reproduction

1. On staging, call `run_backtest(squeeze_breakout_trend, ["AAPL"], start="2026-01-01", end="2026-09-30")`.
2. Observe `OK` with `diagnostics: []` and no warnings.

## Evidence

All references are to `services/xstockstrat-analysis` on `main-dev` `a8a3cfdc`.

- **The silent skip.** `app/handlers/servicer.py:1127-1132`, in the `RunBacktest` symbol loop:
  `except grpc.RpcError` and `except Exception` each `log.warning(...)` and `continue`. They append no
  `SymbolDiagnostics`, no coverage gap and no warning, and touch none of the status-gate counters. Contrast
  `except FormulaExecutionError` (`:1112-1126`), which appends `NO_TRADE_REASON_FORMULA_ERROR` and increments
  `formula_errors`.
- **The status gate.** `servicer.py:1235-1242` returns `INSUFFICIENT_DATA` only when
  `coverage_gaps or formula_errors or fund_refusals or fund_unknown`. A run where every symbol was skipped by
  `:1127`/`:1130` therefore ends up `BACKTEST_STATUS_OK`.
- **Consequences of the false OK.** The run is scored for the run-history row, its zeroed detail is persisted, and
  the headline-grade recompute runs (`servicer.py:~1293-1328`).
- **How a custom formula reaches the skip.** `app/services/evaluator.py:257-261` (`_execute_formula`) maps only
  `NOT_FOUND` to `FormulaExecutionError` and re-raises every other `AioRpcError` code. Sources include:
  - indicators `ExecuteFormula` caller rejection, PERMISSION_DENIED, UNKNOWN or INTERNAL
    (`services/xstockstrat-indicators/app/handlers/servicer.py:228-346`);
  - `ComputeIndicator` INVALID_ARGUMENT;
  - a `GetBars` RpcError.

  None of these backtest-path calls has a client deadline.
- **Not covered by tests.** `TestFormulaErrorSurfacing` (`tests/test_analysis_servicer.py:1614`) covers only
  `success=false`. `tests/test_unreadable_formula.py` covers only `NOT_FOUND`.
## Confirmed trigger (2026-10-16, staging run logs)

- **The analysis log names the error.** It holds a line for every `squeeze_breakout_trend` run, including
  `78a25b00-ed45-4215-9fab-55e3e7793f3e` (AAPL, 01:03:20Z), `df5d966f…` and `d7892362…`:
  `backtest symbol <SYM> failed: <AioRpcError … status = StatusCode.PERMISSION_DENIED details = "admins cannot execute another user's formula"> — skipping`.
- **Where indicators raises it.** `ExecuteFormula` (`services/xstockstrat-indicators/app/handlers/servicer.py:240-246`)
  calls `_can_read_formula` (`:136-143`), which allows only `author == x-user-id` (or `system`). The caller has the
  admin scope bit, so indicators returns PERMISSION_DENIED instead of NOT_FOUND. Analysis then maps it to the silent
  skip rather than to FORMULA_ERROR.
- **Why the owner fails that check.** Six staging formulas carry the legacy **username** `author = "davcs86"` instead
  of the owner's user id `80880990-2b79-4d85-8761-d8d9102c2efb`:
  - `31bb8ea6` Bollinger Squeeze Percentile
  - `7f595658` Volatility Trailing Stop Direction
  - `67139be6` Momentum Quality (Clenow)
  - `60c5b411` Kaufman Efficiency Ratio
  - `127e7b0d` Mean-Reversion Z-Score
  - `4a82bce9` probe

  All six were created 2026-07-20. `list_formulas()` for the owner omits them; `list_formulas(author_filter="davcs86")`
  returns them. No indicators migration rewrote `author` (migration 007 only flips `is_public`), so since owner-only
  execution landed, nobody can execute these formulas.
- **Blast radius on staging.** Strategies that reference them include two that are `live_enabled`:
  - `squeeze_breakout_trend`;
  - `dip_buyer_vol_stop` (its `vts` exit leg is `7f595658`).

  The inactive ones are `squeeze_macd_mq`, `squeeze_mq_confirmed`, `clenow_momentum_regime`, `zscore_trend_filtered`,
  `range_mean_reversion`, `dip_buyer_vol_stop_m25`/`_m35`, `dip_buyer_regime_filtered`, `dip_buyer_market_regime_voo`
  and `dbg_regime_voo_inverted`.

  Live-loop impact is **unverified**: the 100-line log tail shows no live-loop formula error. Production exposure is
  unknown: the formula authors there have not been checked.

## Root cause hypothesis

There are two layers:
- **(a) Contract defect, code-proven.** Catch-all branches drop the symbol without a diagnostics row, and the
  status gate cannot see them.
- **(b) Trigger, confirmed.** Formulas with a legacy username `author` cannot be executed by their owner, and
  indicators returns PERMISSION_DENIED to admin-scoped callers. This is a data defect: the rows were never migrated
  from username to user id. (a) is what hid (b).

## Suggested next steps

1. Read the analysis and indicators run logs for the trigger (b).
2. Map the catch-all branches to a typed per-symbol diagnostics row, plus a warning carrying the error status. Make
   them count toward the INSUFFICIENT_DATA/failed gate, so an all-skipped run is never OK. Possibly add a reason
   enum value; that would be a proto change.
3. Add regression tests for a non-NOT_FOUND `ExecuteFormula`/`GetBars` RpcError and for a generic exception.
4. Consider client deadlines on backtest-path RPCs.
