# Product Spec: fix-legacy-formula-authors

**Type**: bug
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-22

---

## Problem Statement

**Observed.** On staging, six custom formulas created on 2026-07-20 store `author = "davcs86"` (a legacy username) instead of the owner's user id `80880990-2b79-4d85-8761-d8d9102c2efb`: `67139be6-27ff-4e03-b57f-a5398e7ea9a6` (Momentum Quality (Clenow)), `31bb8ea6-0f3e-4cf7-8844-ec8294cebf85` (Bollinger Squeeze Percentile), `7f595658-2a7f-4ddb-a83a-5fc3d625472d` (Volatility Trailing Stop Direction), `60c5b411-a7b7-4b5c-beb5-fdcb12ec83d1` (Kaufman Efficiency Ratio), `127e7b0d-ab8e-461a-af7b-da3bb9739204` (Mean-Reversion Z-Score) and `4a82bce9-db58-4efb-b2ae-37a90889e255` (probe_test_formula). `list_formulas` for the owner omits them; they appear only with the admin selector `author_filter="davcs86"`. Indicators' read guard (`_can_read_formula`) answers PERMISSION_DENIED, so strategies that use them (for example `squeeze_breakout_trend`, which uses `31bb8ea6…` and `7f595658…`) fail formula evaluation.

**Expected.** Every formula's `author` is the owning user id. The owner can list, read and execute their formulas, and strategies that reference them evaluate normally.

## Reproduction Steps

1. On staging, as the owner, call `list_formulas()`: the six formulas above are absent.
2. As admin, call `list_formulas(author_filter="davcs86")`: all six are returned with `author: "davcs86"`.
3. `run_backtest` on a strategy referencing `31bb8ea6…` evaluates no symbols (since feature 275 lands, it reports a non-OK status with a warning).

## Root Cause Hypothesis

Rows created before formula ownership moved from username to user id were never backfilled. A data fix (rewrite `author` from the username to the matching user id) plus a check that no other legacy-username authors remain is likely needed. Production must be checked for the same rows before choosing the fix shape.

## Affected Services

xstockstrat-indicators (formula store and read guard).

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated (the fix is a data rewrite; whether it ships as a migration, a one-off script or an admin RPC is a design question)
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- The silent skip and false OK status in backtests (feature 275)
