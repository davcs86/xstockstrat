# Defect: Deploy wait loop times out on a superseded DigitalOcean deployment

**Recorded**: 2026-11-04
**Severity**: SEV-3
**Impact type**: ci-false-failure
**Environment**: dev (main-dev)
**Affected service(s)**: CI/CD workflows (.github/workflows/deploy.yml, deploy-dev.yml, deploy-prod.yml); no runtime service
**Config-only fix possible**: no

## Observed

Run #1213 of "Deploy dev" (run id 41780318987, head `86132e77`, the promotion merge) failed in the
"Wait for deployment" step of the reusable `deploy.yml`. It polled for 16 minutes (05:39:31 to
05:55:30 UTC) and exited through the "Timeout: deployment did not complete within 15 minutes" branch.
Run #1214 (id 41780394949, head `d758013d`) started about 45 seconds later against the same DO app
(`xstockstrat-staging`) and succeeded, as did #1215 (id 41781362789). The app is healthy; only the
run is red.

## Expected

Two pushes to `main-dev` in quick succession produce no red deploy run. The wait loop ends on every
terminal deployment phase DigitalOcean reports, not only on ACTIVE, ERROR and CANCELED.

## Reproduction

1. Push to `main-dev`; let the "Deploy dev" run reach "Deploy to DigitalOcean App Platform".
2. Push a second commit to `main-dev` within about a minute, before the first deployment is ACTIVE.
3. The second run's `doctl apps update` creates a newer deployment; the first deployment goes to
   phase `SUPERSEDED` and stays there. The first run's wait loop never matches it and times out.

## Evidence

Job 126410876732 (run #1213), "Wait for deployment" log, iterations 24 through 60:
> `[60/60] Phase: SUPERSEDED`
> `Timeout: deployment did not complete within 15 minutes.`

`.github/workflows/deploy.yml:107-123` (Wait for deployment)
> `DEPLOY_ID=$(doctl apps list-deployments "$APP_ID" --format ID --no-header | head -1)`
> `if [ "$PHASE" = "ACTIVE" ]` ... `elif [ "$PHASE" = "ERROR" ] || [ "$PHASE" = "CANCELED" ]`

`.github/workflows/deploy-dev.yml` and `deploy-prod.yml` declare no `concurrency` group, and the
reusable `deploy.yml` declares none either (only `deploy-homelab.yml:54` does, per job).

## Root cause hypothesis

Two defects compound. Nothing serialises deploys to one DO app, so a second push creates a deployment
while the first is still building. The wait loop then has no branch for `SUPERSEDED`, a terminal phase
that is neither a success nor an error, so it spins until the iteration cap.

## Confidence

high
