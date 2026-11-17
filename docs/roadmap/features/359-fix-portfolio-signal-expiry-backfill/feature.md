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
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — D-1..D-14, R-1..R-9, O-1..O-11, P-1
- [Design](design.md) — approved design (3 rounds, full)
- [Implementation Spec](implementation-spec.md) — 7 steps (lock fix + forced-interleave tests, FR-3 mark grace unit, docs)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec (2026-11-17).

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-portfolio service owner | Concurrent write safety (P&L calculation accuracy, position snapshot consistency, concurrent write safety) | 1, 2, 3, 4 |

Steps 5–7 are `docs` (no reviewer).

---

## Summary

Portfolio's `backfill-signal-expiry` APPLY can mark a SIGNAL watchlist entry as an untracked, already-due expiry row while a concurrent signal add commits for the same binding. The prune tick then removes a watchlist entry whose signal is still live.

## Next Action

`/sdd-review fix-portfolio-signal-expiry-backfill impl-spec` — validate implementation spec, then `/sdd-execute fix-portfolio-signal-expiry-backfill`
