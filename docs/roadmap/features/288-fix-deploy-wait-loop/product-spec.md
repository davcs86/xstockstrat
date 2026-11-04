# Product Spec: fix-deploy-wait-loop

**Type**: bug
**GitHub Issue**: none (Issues disabled) — `docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04

---

## Problem Statement

Run #1213 of "Deploy dev" (run id 41780318987) failed in "Wait for deployment" of
`.github/workflows/deploy.yml` after polling 16 minutes: its DO deployment went to phase `SUPERSEDED`
(newer push, run #1214, deployed the same app ~45 s later) and the loop only ends on `ACTIVE`, `ERROR`
or `CANCELED`. The app was healthy; the run was falsely red. Expected: two quick pushes to `main-dev`
produce no red deploy run.

## Reproduction Steps

1. Push to `main-dev`; wait until the first run reaches "Deploy to DigitalOcean App Platform".
2. Push a second commit within about a minute.
3. First run's deployment becomes `SUPERSEDED`; its wait loop times out.

## Root Cause Hypothesis

Confirmed from job 126410876732: the log shows `Phase: SUPERSEDED` for iterations 24–60 (`doctl` reports
the literal phase `SUPERSEDED`). Contributing: no `concurrency` group on any deploy workflow serialises
runs against one DO app (only `deploy-homelab.yml` has one).

## Affected Services

CI/CD workflows only: `.github/workflows/deploy.yml` (reusable), `deploy-dev.yml`, `deploy-prod.yml`. No runtime service.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated
- Do not touch the feature-286 SOPS handling in `deploy.yml` (`resolve-app-id`, `setup-sops`, render steps).

## Acceptance Criteria

See `acceptance.feature`. Plus: `scripts/sops-secrets.test.sh` (deploy group) and `actionlint` pass on
the changed workflows.

## Out of Scope

- Refactoring unrelated to the bug
- Making `DEPLOY_ID` resolution race-free (`list-deployments | head -1` can pick another run's deployment)
- Homelab deploy workflows
