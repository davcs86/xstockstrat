# Feature: fix-analysis-admin-formula-refusal

**Type**: bug
**Development Branch**: `feature/fix-analysis-admin-formula-refusal`
**Defect report**: `docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-2
**Created**: 2026-11-04
**Last Updated**: 2026-11-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-11-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved after revision (pass 1 FAIL: 4 blockers; pass 2 FAIL: 1 blocker; pass 3 PASS WITH WARNINGS, all warnings addressed) |
| 2026-11-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds + 1 targeted delta pass, full) and approved; recon.md + design.md written. Operator C-16 sign-offs: unified NOT_FOUND+PERMISSION_DENIED refusal, narrowing `@AC-1 @feature-185`, referenced-only marking, non-held rank/action (fund_skip treatment) with held rows keeping their signal action, global `_formula_fundamentals` classification (FR-5 gate-ON CHANGE). Product-spec/acceptance amended (FR-1..FR-7; AC-14 retired, AC-15..AC-27) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier + business rules (C-16)
- [Design](design.md) — debated, user-approved architecture
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-analysis-admin-formula-refusal`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Analysis folds indicators' deliberate PERMISSION_DENIED (admin may not execute another user's formula) into a data-unavailable row in `_compute_opportunities` and lets it escape as ERROR in `EvaluateReadiness`; feature 275 fixed only the backtest path.

## Next Action

`/sdd-spec fix-analysis-admin-formula-refusal` — generate the implementation spec from the approved design (7 steps: proto → analysis read side → evaluator sink → servicer wiring → agent → UI → docs)
