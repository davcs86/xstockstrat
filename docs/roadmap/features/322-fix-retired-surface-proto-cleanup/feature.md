# Feature: fix-retired-surface-proto-cleanup

**Type**: bug
**Development Branch**: `feature/fix-retired-surface-proto-cleanup`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-trading-mode-axis-retained-defect.md, docs/reports/2026-10-19-opportunity-sparkline-removal-residue-defect.md, docs/reports/2026-10-19-proto-contract-hygiene-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-13 | `spec-ready` (unchanged) | /sdd-design | Design debated (3 rounds, full) and approved by the operator; recon.md + debate.md + design.md written. The flip to `design-approved` is held under settled D-11 because no O-1 answer ((A) keep ComputeIndicatorRequest field 7 / (B) deprecation-only) was recorded |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — D-1..D-14, R-1..R-9, O-1..O-3 (Phase 1)
- [Design](design.md) — approved design, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-retired-surface-proto-cleanup`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Residue of retired surfaces (the `trading_mode` axis, the server-side opportunity sparkline) and proto
contract hygiene drift (stalled timeframe migration, orphaned common types, closed-set strings, a
mislabelled `user_id`) still mislead agents copying patterns from code, docs and contracts.

## Next Action

Record the operator's O-1 answer in context.md — (A) keep `ComputeIndicatorRequest.timeframe_enum = 7` (recommended) or (B) deprecation-only, which applies the D-12 edit set. Then flip status `spec-ready` → `design-approved` (D-11) and run `/sdd-spec fix-retired-surface-proto-cleanup` to generate the implementation spec from the approved design.
