# Feature: fix-opportunity-composite-score

**Type**: bug
**Development Branch**: `feature/fix-opportunity-composite-score`
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-10-06-ui-composite-score-grade-colour-defect.md` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-06-ui-composite-score-grade-colour-defect.md)
**Severity**: SEV-3
**Created**: 2026-10-06
**Last Updated**: 2026-10-06
**Committed to main**: 595bd1d4effdc73153752d8dce5cee69d1a6f656
**Launched date**: 2026-10-08
**Archived**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-06 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-06-ui-composite-score-grade-colour-defect.md` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-06-ui-composite-score-grade-colour-defect.md) |
| 2026-10-06 | `draft` → `implementation-ready` → `in-progress` → `code-completed` | /sdd-spec + /sdd-execute sequential | centred diverging composite bands (±0.08 muted); design decided by operator |

| 2026-10-08 | `code-completed` → `launched` | CI workflow | Promoted via PR #1233; committed 595bd1d4effdc73153752d8dce5cee69d1a6f656 |
| 2026-11-04 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 3 specs |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-ui/acceptance/fix-opportunity-composite-score.feature (C-16)
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The opportunity composite score is coloured with the strategy-grade `scoreColor` thresholds, so its
neutral point (0.500) renders red and its reachable range almost never renders green; replace it
with centred diverging bands calibrated to the composite's own scale.

## Next Action

Merge the integration PR into `main-dev`; promote @AC-1..3 into a `services/xstockstrat-ui/acceptance/` suite at launch (C-16).
