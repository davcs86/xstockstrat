# Feature: fix-opportunity-composite-score

**Type**: bug
**Development Branch**: `feature/fix-opportunity-composite-score`
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-10-06-ui-composite-score-grade-colour-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-06
**Last Updated**: 2026-10-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-06 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-06-ui-composite-score-grade-colour-defect.md` |
| 2026-10-06 | `draft` → `implementation-ready` → `in-progress` → `code-completed` | /sdd-spec + /sdd-execute sequential | centred diverging composite bands (±0.08 muted); design decided by operator |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — steps + deviation log
- [Design](design.md) — band decision
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The opportunity composite score is coloured with the strategy-grade `scoreColor` thresholds, so its
neutral point (0.500) renders red and its reachable range almost never renders green; replace it
with centred diverging bands calibrated to the composite's own scale.

## Next Action

Merge the integration PR into `main-dev`; promote @AC-1..3 into a `services/xstockstrat-ui/acceptance/` suite at launch (C-16).
