# Feature: fix-gapsonly-backfill-is

**Type**: bug
**Development Branch**: `feature/fix-gapsonly-backfill-is`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-25
**Last Updated**: 2026-11-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-25 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md` |
| 2026-11-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-26 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-gapsonly-backfill-is`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

GAPS_ONLY backfill derives gaps only from a symbol's earliest/latest bar, so an interior hole (e.g.
2026-04-01..2026-09-25 on homelab SCHW/IDXX) is never fetched and the job still reports COMPLETED.

## Next Action

`/sdd-spec fix-gapsonly-backfill-is` — generate implementation spec from the approved design
