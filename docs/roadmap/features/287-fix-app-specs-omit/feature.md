# Feature: fix-app-specs-omit

**Type**: bug
**Development Branch**: `feature/fix-app-specs-omit`
**GitHub Issue**: none (Issues disabled), report `docs/reports/2026-11-04-app-specs-omit-db-vpc-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report (Track C by operator override) |
| 2026-11-04 | `draft` → `design-approved` | /sdd-design | Design debated (5 rounds; invoked quick, operator extended it to the cap) and approved. recon.md and design.md written. The operator confirmed proceeding without /sdd-review |

---

## Artifacts

- [Product Spec](product-spec.md): bug description and fix scope
- [Acceptance Scenarios](acceptance.feature): regression scenarios (`@AC-*`, C-15)
- [Recon](recon.md): codebase dossier
- [Design](design.md): approved design
- [Implementation Spec](implementation-spec.md): _not yet generated. Run `/sdd-spec fix-app-specs-omit`_
- [Context Log](context.md): session history, decisions, deviations

---

## Summary

A production app created by `prod-up` is not attached to the managed cluster's VPC and is not a cluster
trusted source, so the PRE_DEPLOY `db-migrator` times out. The staging update path can also detach
staging from the VPC.

## Next Action

`/sdd-spec fix-app-specs-omit`: generate the implementation spec from the approved design.
