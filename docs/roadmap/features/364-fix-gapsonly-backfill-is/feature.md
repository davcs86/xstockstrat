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

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-gapsonly-backfill-is`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

GAPS_ONLY backfill derives gaps only from a symbol's earliest/latest bar, so an interior hole (e.g.
2026-04-01..2026-09-25 on homelab SCHW/IDXX) is never fetched and the job still reports COMPLETED.

## Next Action

`/sdd-design fix-gapsonly-backfill-is` — full design recommended (2 code-changing services, marketdata + ingest, plus GAPS_ONLY consumer surfaces in ui/agent; possible additive proto change to `GetDataCoverage`)
