# Feature: fix-backtest-annualized-return

**Type**: bug
**Development Branch**: `claude/xstockstrat-metrics-sweep-m070rf` (harness-assigned; the nominal SDD branch would be `feature/fix-backtest-annualized-return`)
**Defect Report**: `docs/reports/2026-08-23-backtest-annualized-return-underscaled-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-23
**Last Updated**: 2026-08-23
**Committed to main**: 2c8c9d7cb563140384324b5e1f9ff6fdceb1a367
**Launched date**: 2026-08-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-23 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (Issues disabled; --from-report path) |
| 2026-08-23 | `draft` → `code-completed` | claude | Fix implemented + red-before-green unit tests; 544 analysis tests pass (82.5% cov), ruff clean. Rides PR #1004. |

| 2026-08-24 | `code-completed` → `launched` | CI workflow | Promoted via PR #1006; committed 2c8c9d7cb563140384324b5e1f9ff6fdceb1a367 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-backtest-annualized-return`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`RunBacktest`'s aggregate `annualized_return` is ~30× under-scaled because it annualizes over the
length of the concatenated multi-symbol equity curve (≈ N_symbols × window_days) instead of the
run's real window span. Fix scoped to the aggregate metrics call; grade-neutral and forward-only.

## Next Action

`/sdd-design fix-backtest-annualized-return quick` — recommended design depth (quick) from triage; see context.md
