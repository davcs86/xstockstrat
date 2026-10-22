# Product Spec: fix-indicators-formula-correctness

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-indicators-formula-correctness-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **D-10.** The sandbox's restricted builtins keep every `BaseException` subclass
  (`services/xstockstrat-indicators/app/services/sandbox.py:247-254`), so `raise SystemExit(0)` ends the
  child with return code 0 before the `__OUTPUT__:` print (`:310-312`). The parent keeps `output = {}`,
  swallows a malformed output line (`:399` `except json.JSONDecodeError: pass`) and returns
  `success=True, output={}` (`:419-427`). Strategies then score on empty series.
- **D-18.** `_atr` is the rolling mean of `|close diff|` and `_vwap` is the running mean of the inputs
  (`app/services/indicators_engine.py:103-116`), yet the registry (`:141-142`) names them "Average True
  Range" and "Volume Weighted Average Price". `ComputeIndicatorRequest`
  (`packages/proto/indicators/v1/indicators.proto:54-61`) carries only `repeated double values`.
  Analysis consumes both (`evaluator.py:141`, `:196-197`; `screener.py:279-284`; `warmup.py:86`, `:108`;
  `pnl_pattern_consumer.py:50`).
- **D-54.** `UpdateFormula` (`app/handlers/servicer.py:490`) and `DeleteFormula` (`:593`) use raw
  `get_by_id`, while `_load_formula` (`:150-157`) hides `pending_intent_id` rows as not found.

**Expected.** A run that never emits a parseable output line fails (`success=False`, clear error, exit
reason); `ATR`/`VWAP` either compute the true indicators or are renamed/re-described to match what they
compute; `UpdateFormula`/`DeleteFormula` return `NOT_FOUND` for pending-hidden rows.

## Reproduction Steps

1. D-10: `ExecuteFormula` with source `raise SystemExit(0)` → `success=True`, `output={}`.
2. D-18: `ComputeIndicator("ATR", values=[10, 12, 11, 13], period=2)` → `[None, None, 1.5, 1.5]`;
   `ComputeIndicator("VWAP", values=[10, 20, 30])` → `[10, 15, 20]`.
3. D-54: a formula row with `pending_intent_id` set: `GetFormula` → `NOT_FOUND`, but its author's
   `UpdateFormula` succeeds and `DeleteFormula` soft-deletes it.

## Root Cause Hypothesis

D-10: success inferred from return code alone, and interpreter-exiting exceptions are admitted. D-18: the
1-D values contract cannot carry high/low/volume, and the approximations kept the real names. D-54: the
mutating RPCs bypass the pending-hidden read helper.

## Affected Services

- xstockstrat-indicators (fix site for all three)
- xstockstrat-analysis (consumer of `ATR`/`VWAP`; changes if D-18 renames indicators or adds OHLCV input)
- packages/proto (only if design adds OHLCV fields to `ComputeIndicatorRequest`)

## Fix Scope

- [ ] Proto change possible — D-18 true ATR/VWAP needs OHLCV input on `ComputeIndicatorRequest`; a rename avoids it
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

**Behavior-change note (D-18):** either fix path changes the numeric output for every strategy and backtest
that uses `ATR` or `VWAP`. Historical backtest runs and grades computed with the approximations will not
reproduce. Design must state how this is communicated and whether stored grades are recomputed.

**Behavior-change note (D-10):** formulas that relied on implicit empty success will start failing.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Sandbox exit-reason stderr substring classification and `memory_used_bytes` always 0 (separate open reports `2026-10-19-sandbox-exit-reason-stderr-substring-defect.md`, `2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md`)
- `InstantiateTemplate` retry idempotency (debt-radar NC-A, unconfirmed)
