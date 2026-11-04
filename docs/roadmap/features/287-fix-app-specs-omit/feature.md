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
| 2026-11-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps |

---

## Artifacts

- [Product Spec](product-spec.md): bug description and fix scope
- [Acceptance Scenarios](acceptance.feature): regression scenarios (`@AC-*`, C-15)
- [Recon](recon.md): codebase dossier
- [Design](design.md): approved design
- [Implementation Spec](implementation-spec.md): 10 numbered steps with codebase evidence
- [Context Log](context.md): session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` (2026-11-04). The deploy pipeline has no service owner row, so role reviewers apply.

| Reviewer | Focus | Steps |
|---|---|---|
| Platform Lead | Deploy-pipeline correctness: exactly-one resolution, every render site fills `YOUR_VPC_ID`, prod-up/prod-down lifecycle order, full suite green | 1–8, 10 |
| Security | Firewall trusted-source scope (only the app's own rule; never opens or empties the cluster), renderer fail-closed with no value echo | 1–8 |

---

## Summary

A production app created by `prod-up` is not attached to the managed cluster's VPC and is not a cluster
trusted source, so the PRE_DEPLOY `db-migrator` times out. The staging update path can also detach
staging from the VPC.

## Next Action

`/sdd-review fix-app-specs-omit impl-spec` — validate implementation spec, then `/sdd-execute fix-app-specs-omit`
