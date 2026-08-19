# Feature: fix-signal-detail-readiness-rule

**Type**: bug
**Development Branch**: `feature/fix-signal-detail-readiness-rule`
**Defect Report**: `docs/reports/2026-08-15-signal-detail-readiness-traces-entry-rule-on-reduce.md`
**Severity**: SEV-3
**Created**: 2026-08-15
**Last Updated**: 2026-08-19
**Committed to main**: 1d97c6c78caa532a24265dae2fa79c674b3b69dd
**Launched date**: 2026-08-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-15 | `bug-reported` → `draft` | /sdd-triage | Pre-populated from defect report (Issues disabled; report path stands in for the issue URL). SEV-3, Track C (SDD path). |
| 2026-08-15 | `draft` → `code-completed` | direct fix | User chose the full exit-rule-trace approach (AskUserQuestion). Implemented directly as a Track C bug fix (design/impl-spec optional for bugs): additive `ReadinessRule` proto field, analysis handler routing, UI (`useReadiness` + `SignalReadiness`) requests EXIT when the matching opportunity is held (`provenance` includes `position`). Analysis 514 passed; tsc + lint clean; e2e added (CI-gated). |

| 2026-08-19 | `code-completed` → `launched` | status reconciliation | Reconciled to launched: code in production (main==main-dev @ 1d97c6c7); CI status automation (ci-validate-feature-status.yml) missed the slug grep-match. PR #957. |
---

## Artifacts

- [Defect Report](../../../reports/2026-08-15-signal-detail-readiness-traces-entry-rule-on-reduce.md) — observed vs. expected, root cause
- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-signal-detail-readiness-rule`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On the Signal-detail page, a held opportunity tagged `Reduce` shows a header conviction sourced from
the queue's **exit-rule** trace (e.g. 100 / 1&nbsp;of&nbsp;1) while the "Why this fired" panel shows the
**entry-rule** trace from `EvaluateReadiness` (e.g. 0&nbsp;of&nbsp;2, both failing) — two different rule trees
presented as one, producing a self-contradictory display.

## Next Action

Code-complete. Open the integration PR (`feature/fix-signal-detail-readiness-rule` → `main-dev`);
fix rides the next `/promote` cycle to production.
