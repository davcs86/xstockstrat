# Feature: fix-ui-trader-feedback

**Type**: bug
**Development Branch**: `feature/fix-ui-trader-feedback`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-ui-trader-feedback-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-ui-trader-feedback-defect.md` (debt-radar D-11, D-17, D-45, D-64) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment (`production`/`staging`) scope correctness | TBD (/sdd-spec) |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism | D-45 evidence/history semantics and open question NC-D; change only if design finds a phantom-row write |
| `xstockstrat-trading` owner | Order execution correctness, paper-only dev invariant | Read-only: D-17 relies on the server deriving mode from `TRADING_MODE_UNSPECIFIED`; confirm that contract |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ui-trader-feedback`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Trader/insights UI feedback defects: a silently dropped order stream masks fresher polled statuses (D-11);
orders are tagged PAPER while the environment is unknown (D-17); symbol-page backtests omit `strategyId`
and earn no evidence (D-45); and three user actions fail with no visible error (D-64).

## Next Action

`/sdd-design fix-ui-trader-feedback` — recommended design depth: full (2 affected services — ui + analysis for D-45/NC-D; fix site likely UI-only, operator may downgrade to quick); see context.md
