# Feature: fix-migration-tooling-safety

**Type**: bug
**Development Branch**: `feature/fix-migration-tooling-safety`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md, docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Migration tooling has two unguarded hazards: `db-migrate.sh` dirty-state recovery (`force 0` + `up`) replays
non-idempotent up-files below the feature-225 contract floor, and a late-merging lower-numbered migration is
silently skipped by golang-migrate on persistent databases with no CI ordering gate.

## Reviewers

_(Snapshot from docs/runbooks/reviewer-registry.md, finalized at /sdd-spec time — re-run /sdd-spec if the
registry changes. The change is platform tooling under `scripts/` and `.github/workflows/`, which has no
service-owner row, so the role reviewers apply. `docs` steps have none.)_

| Role | Review Focus |
|---|---|
| DBA | Migration NNN numbering (no conflicts), run-order compliance with `scripts/db-migrate.sh` |
| Platform Lead | Cross-service architecture |

## Next Action

`/sdd-review fix-migration-tooling-safety impl-spec` — validate implementation spec, then `/sdd-execute fix-migration-tooling-safety`
