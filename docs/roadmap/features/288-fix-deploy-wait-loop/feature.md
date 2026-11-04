# Feature: fix-deploy-wait-loop

**Type**: bug
**Development Branch**: `feature/fix-deploy-wait-loop`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md)
**Severity**: SEV-3
**Created**: 2026-11-04
**Last Updated**: 2026-11-04
**Committed to main**: 0ef77aa123c69b59d022e2edcac45009599595a7
**Launched date**: 2026-11-04
**Archived**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (`--from-report`) |
| 2026-11-04 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps (design phase skipped per triage `skip`; product-spec not yet AI-reviewed) |
| 2026-11-04 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 (RED harness for AC-1) committed; sequential mode |
| 2026-11-04 | `in-progress` → `code-completed` | /sdd-execute | All 5 steps done (sequential); config-wiring `--final` exit 0 |

| 2026-11-04 | `code-completed` → `launched` | CI workflow | Promoted via PR #1422; committed 0ef77aa123c69b59d022e2edcac45009599595a7 |
| 2026-11-04 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 2 specs |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); scenarios already promoted to platform.feature (@feature-288)
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The "Wait for deployment" step in `deploy.yml` times out (red run) when a newer push supersedes its DO
deployment, because `SUPERSEDED` is not a terminal phase in the loop and no concurrency group serialises
deploys to one app.

## Reviewers

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-workflow deploy topology (DO + homelab): concurrency group collisions, SUPERSEDED-as-success decision (D-1), CI gate completeness (Steps 1-4) |

## Next Action

Integration PR `feature/fix-deploy-wait-loop` → `main-dev`; then post-merge observation of AC-2 (two quick pushes) — see context.md Step 4
