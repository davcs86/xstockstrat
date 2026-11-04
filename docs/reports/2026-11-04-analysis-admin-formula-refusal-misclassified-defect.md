# Defect: analysis treats indicators' admin-formula refusal as an outage / unhandled error

**Recorded**: 2026-11-04
**Severity**: SEV-2
**Impact type**: wrong-data-displayed
**Environment**: dev (main-dev) — Grafana `deployment_environment=staging`
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no

## Observed

Indicators deliberately refuses an admin executing another user's formula
(`PERMISSION_DENIED "admins cannot execute another user's formula"`, AC-28). Analysis handles that refusal
wrongly on two read paths that feature 275 did not cover (275 fixed only the backtest path):

- `_compute_opportunities` catches every `grpc.RpcError` as an indicators *transport outage*, logs a WARN
  `_compute_opportunities: indicator RPC failed for <SYM>`, adds the symbol to `fetch_failed` and substitutes an
  empty readiness row — so the symbol is reported as data-unavailable when the real cause is a permission refusal.
- `EvaluateReadiness` lets the same `AioRpcError` escape, logged at ERROR as
  `Unexpected [AioRpcError] raised by servicer method [/xstockstrat.analysis.v1.AnalysisService/EvaluateReadiness]`.

About 4.2k matching lines in 7 days, in two bursts (2026-11-01: 3,298; 2026-11-03: 920).

## Expected

An owner-unreadable / admin-refused formula is surfaced as a distinct per-row reason (as 275 does for backtest),
not folded into "data unavailable", and `EvaluateReadiness` does not abort or log ERROR for an expected refusal.

## Reproduction

1. As an admin caller, request opportunities or `EvaluateReadiness` over symbols whose strategy formulas belong to another user.
2. Observe indicators `ExecuteFormula` return `PERMISSION_DENIED`.
3. Opportunities rows come back data-unavailable; `EvaluateReadiness` aborts with `AioRpcError`.

## Evidence

`services/xstockstrat-analysis/app/handlers/servicer.py:5787`
> "_compute_opportunities: indicator RPC failed for %s: %s"

`services/xstockstrat-indicators/app/handlers/servicer.py:248`
> "admins cannot execute another user's formula"

`services/xstockstrat-analysis/app/services/evaluator.py:226-273` (`raise_unreadable` exists but is opt-in; the backtest path sets it, these paths do not)

Loki `{service_name="analysis", deployment_environment="staging"}`:
> `_compute_opportunities: indicator RPC failed for MYSZ: <AioRpcError … status = StatusCode.PERMISSION_DENIED details = "admins cannot execute another user's formula">`

## Root cause hypothesis

The 275 fix added `raise_unreadable` handling only to the backtest evaluator construction; the opportunities and
readiness paths still use the default evaluator and a broad `except grpc.RpcError`. Not yet confirmed which caller
identity (admin listing across users) triggers it.

## Confidence

high

## Triage (classification only, 2026-11-04)

Track C (SDD path). No feature directory or number reserved yet; status remains `open`.
