# Product Spec: fix-analysis-admin-formula-refusal

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04

---

## Problem Statement

Indicators refuses an admin executing another user's formula (`PERMISSION_DENIED`, AC-28). `_compute_opportunities` catches every `grpc.RpcError` as an indicators outage, marks the symbol `fetch_failed` and emits an empty readiness row (reported as data-unavailable). `EvaluateReadiness` lets the same `AioRpcError` escape, logged ERROR `Unexpected [AioRpcError] raised by servicer method`. ~4.2k log lines in 7 days (bursts 2026-11-01 and 2026-11-03).

## Reproduction Steps

1. As an admin caller request opportunities or `EvaluateReadiness` over symbols whose strategy formulas belong to another user.
2. Indicators `ExecuteFormula` returns `PERMISSION_DENIED`.
3. Opportunities rows come back data-unavailable; `EvaluateReadiness` aborts.

## Root Cause Hypothesis

Feature 275 added `raise_unreadable` handling only on the backtest evaluator; the opportunities and readiness paths use the default evaluator plus a broad `except grpc.RpcError` (`servicer.py:~5787`, `evaluator.py:226-273`). Lead: staging `fundsignal.scoring_formula_id` (d1ff5e6b-...) is the formula in the `EvaluateReadiness` FormulaExecutionError timeouts; check its owner vs the caller identity.

## Affected Services

xstockstrat-analysis (consumer surfaces: xstockstrat-ui opportunities/readiness pages, xstockstrat-agent list_opportunities)

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
