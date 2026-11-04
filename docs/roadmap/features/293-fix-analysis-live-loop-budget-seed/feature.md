# Feature: fix-analysis-live-loop-budget-seed

**Type**: bug
**Development Branch**: `feature/fix-analysis-live-loop-budget-seed`
**Defect report**: `docs/reports/2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-3
**Created**: 2026-11-04
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Durable follow-up to the Track B config write (operator asked for both) |
| 2026-11-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved after revision (first pass FAIL: 5 blockers; second pass PASS WITH WARNINGS, 7 warnings all addressed) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-analysis-live-loop-budget-seed`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`analysis.engine.max_strategies_per_cycle` is read by the live loop but never registered or seeded, so it only exists where an operator ran `SetConfig create_key=true` (staging, 2026-11-04, value 200); and a fleet permanently above the budget WARNs on every cycle.

## Next Action

`/sdd-design fix-analysis-live-loop-budget-seed` — full design recommended (a config-service DB migration is an escalate signal; analysis + config = 2 services)
