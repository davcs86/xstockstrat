# Feature: fix-analysis-per-symbol-isolation

**Type**: bug
**Development Branch**: `feature/fix-analysis-per-symbol-isolation`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md`, `docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md`, `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-analysis-per-symbol-isolation`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

One failing symbol or candidate aborts a whole xstockstrat-analysis per-symbol fan-out (opportunities
compute, `EvaluateReadiness`, readiness kick / materializer / opportunity heal), losing every healthy
sibling's rows instead of degrading only the failing one.

## Next Action

`/sdd-design fix-analysis-per-symbol-isolation quick` — recommended design depth (quick) from triage; see context.md
