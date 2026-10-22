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

## Functional Requirements

- **FR-1 (D-10).** An `ExecuteFormula` run whose child never emits a parseable `__OUTPUT__:` line
  (it exits early, including via `SystemExit`, or the line is malformed) returns `success=false`, a
  non-empty `error` naming the cause, an empty `output`, and an `exit_reason` other than
  `SANDBOX_EXIT_REASON_SUCCESS`.
- **FR-2 (D-10 guard).** A formula that assigns `result` and exits normally still returns
  `success=true` with that `result` as `output`.
- **FR-3 (D-18).** The `ATR` built-in's advertised name/description (`ListIndicators`) matches what
  `ComputeIndicator("ATR")` computes. The registry key `ATR` stays, so analysis consumers and stored
  strategies that reference it by name keep resolving.
- **FR-4 (D-18).** The `VWAP` built-in's advertised name/description matches what
  `ComputeIndicator("VWAP")` computes, under the same key-stability rule as FR-3.
- **FR-5 (D-54).** `UpdateFormula` and `DeleteFormula` on a row with `pending_intent_id` set return
  `NOT_FOUND` (as `_load_formula`/`GetFormula` do) and leave the row unchanged.

FR-3/FR-4 have two allowed fix paths (Option A: re-describe; Option B: true OHLCV indicators). Design
picks one (OQ-1). `acceptance.feature` carries one deterministic scenario per option. Design deletes
the scenarios for the losing option and records the choice in `context.md`.

## Consumer Surface(s)

- [x] Agent MCP tools (`xstockstrat-agent`): `test_formula` (FR-1/FR-2: `ExecuteFormula` now reports
  failure), `manage_formula` update/delete (FR-5: `NOT_FOUND`), `run_backtest` and `screen_symbols`
  (FR-3/FR-4: ATR/VWAP-based scores change under Option B; descriptions only under Option A).
- [x] UI `/insights`: the formula workspace run result (`FormulaRunResult` Passed/Failed badge, FR-1)
  and backtest/strategy results that use ATR/VWAP (FR-3/FR-4).
- [ ] `/trader`, `/config-ui`: not affected.

## Open Questions

- **OQ-1 (design decision, C-11).** Should D-18 use Option A (keep the close-only math and re-describe
  `ATR`/`VWAP` honestly; no proto change; numeric output unchanged) or Option B (add OHLCV input to
  `ComputeIndicatorRequest` and compute the true indicators; this changes numeric output for every
  ATR/VWAP strategy and backtest)?
- **OQ-2 (Option B only).** How is the change in historical backtest numbers communicated, and are
  stored grades recomputed?

## Reproduction Steps

1. D-10: `ExecuteFormula` with source `raise SystemExit(0)` → `success=True`, `output={}`.
2. D-18: `ComputeIndicator("ATR", values=[10, 12, 11, 13], period=2)` → engine series `[None, None, 1.5, 1.5]`,
   so `ComputeIndicatorResponse.result` holds 2 `IndicatorPoint`s with `value` 1.5 and 1.5 (the servicer drops
   `None` warm-up positions, `servicer.py:215-218`); `ComputeIndicator("VWAP", values=[10, 20, 30])` → `result`
   values `[10, 15, 20]`.
3. D-54: a formula row with `pending_intent_id` set: `GetFormula` → `NOT_FOUND`, but its author's
   `UpdateFormula` succeeds and `DeleteFormula` soft-deletes it.

## Root Cause Hypothesis

D-10: success inferred from return code alone, and interpreter-exiting exceptions are admitted. D-18: the
1-D values contract cannot carry high/low/volume, and the approximations kept the real names. D-54: the
mutating RPCs bypass the pending-hidden read helper.

## Affected Services

- xstockstrat-indicators (fix site for all three)
- xstockstrat-ui (`src/lib/strategyCatalog.ts` repeats the ATR/VWAP descriptions; added at /sdd-design, C-10)
- xstockstrat-analysis (consumer, unchanged: Option A keeps the `ATR`/`VWAP` keys and math)
- packages/proto (consumer, unchanged: Option A needs no proto change)

## Fix Scope

- [x] No proto change (OQ-1 = Option A, /sdd-design 2026-10-22). The Option B additive-field plan is rejected.
- [x] No database migrations anticipated
- [x] No config key changes anticipated


**Behavior-change note (D-18):** Option B changes the numeric output for every strategy and backtest that
uses `ATR` or `VWAP`. Historical backtest runs and grades computed with the approximations will not
reproduce (OQ-2). Option A changes only the advertised descriptions.

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
