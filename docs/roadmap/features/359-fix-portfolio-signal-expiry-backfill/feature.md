# Feature: fix-portfolio-signal-expiry-backfill

**Type**: bug
**Development Branch**: `feature/fix-portfolio-signal-expiry-backfill`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-17
**Last Updated**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |
| 2026-11-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — D-1..D-14, R-1..R-9, O-1..O-11, P-1
- [Design](design.md) — approved design (3 rounds, full)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-portfolio-signal-expiry-backfill`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Portfolio's `backfill-signal-expiry` APPLY can mark a SIGNAL watchlist entry as an untracked, already-due expiry row while a concurrent signal add commits for the same binding. The prune tick then removes a watchlist entry whose signal is still live.

## Next Action

`/sdd-spec fix-portfolio-signal-expiry-backfill` — generate implementation spec from the approved design
