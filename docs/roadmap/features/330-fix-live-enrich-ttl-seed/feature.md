# Feature: fix-live-enrich-ttl-seed

**Type**: bug
**Development Branch**: `feature/fix-live-enrich-ttl-seed`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage); converted from Track B to Track C by operator decision |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-11-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-13 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-11-13 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); merged origin/main-dev d5de836b and re-specced steps 1-4 (conditional) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections, petitions
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 5 numbered steps (Steps 1+2 land together)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at `/sdd-spec` (2026-11-13); stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` | 2 |
| xstockstrat-config owner | Config key naming, environment (`production`/`staging`) / global-per-user scoping, WatchConfig stream stability | 1, 2, 5 |
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 3 |

---

## Summary

Config migration 028 seeded the live-enrich memo TTL at `10`s, below the UI's 15s `ListOpportunities` poll, so the feature-177 memo never hits; the analysis code default is now `20`. The stored value must be corrected by a new config migration.

## Next Action

`/sdd-execute fix-live-enrich-ttl-seed` — Steps 1-3 done (2026-11-13); next is Step 4 (doc sync)
