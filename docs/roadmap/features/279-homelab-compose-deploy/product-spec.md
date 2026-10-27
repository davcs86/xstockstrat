# Product Spec: homelab-compose-deploy

**Created**: 2026-10-24

---

## Problem Statement

xstockstrat deploys only to DigitalOcean App Platform. The operator now runs a homelab (homelab-edge: headscale
tailnet, Caddy edge, shared Postgres on `tag:db`, a forced-command `app-deploy` gate per app VM) and needs the
platform deployed there too, without disturbing the DO deploys, and with an automatic rollback that actually
covers every service.

## User Story

As the platform operator, I want every push to `main-dev` deployed to the homelab staging VM and every push to
`main` deployed to the homelab production VM (after reviewer approval), alongside the DigitalOcean deploys, so that
the platform runs on infrastructure I own and an unhealthy release rolls itself back.

## Functional Requirements

FR-1. A Compose file at `deploy/homelab/compose.yml` runs the 12 services plus a one-shot `db-migrator`, takes every
image as a `@sha256:` digest from `.env`, and takes every environment-specific or secret value from `.env`
(fail-closed `${VAR:?}` for required ones). It has no `build:`, no bind mounts, and no root-level name that would
shadow the local `docker-compose.yml`.
FR-2. Only `xstockstrat-ui` (3000) and `xstockstrat-agent` (9000) publish ports; every long-running service has a
`healthcheck`. `xstockstrat-ui` binds `0.0.0.0` (`HOSTNAME`), so its in-container healthcheck reaches it.
FR-3. Database: the shared Postgres at `db.ts.natanddavehouse.com` provisioned by homelab-edge `db_host`
(`db_workloads`): production database `xstockstrat-production` with role `xstockstrat_production`, staging database
`xstockstrat-staging` with role `xstockstrat_staging` (supersedes the 2026-10-24 names, recon Addendum E1). trading,
portfolio, marketdata, indicators, ingest and analysis connect through PgBouncer `:6432` with `DB_PGBOUNCER=true`;
config, ledger, identity, notify, ui and db-migrator connect directly on `:5432`. Every URL uses `sslmode=require`.
The direct pools total at most 8 connections per environment (homelab-edge sizes each role at 25).
FR-4. `db-migrator` (image built from `scripts/Dockerfile.migrate`, published by `docker-build.yml`) runs on every
deploy before any service starts; services depend on it with `service_completed_successfully`.
`scripts/db-migrate.sh`, which DigitalOcean's PRE_DEPLOY migrator also runs, checks each service before its dirty
handling: a clean database version newer than the image's highest migration is skipped (`[ahead]`); a dirty one is
refused (non-zero) before any `force 0`; an unparsable dirty version, an unparsable migration filename, or a numeric
version with no up-files also refuses. A rollback that reruns an older migrator therefore proceeds in the clean case
and fails closed in the dirty case.
FR-5. trading, portfolio and marketdata register `grpc.health.v1.Health` and accept a `healthcheck` argument that
calls `Check` on `127.0.0.1:$GRPC_PORT` over the service's own mTLS identity, exiting 0 only on `SERVING`. The
health service is registered only once init (config snapshot, DB, broker pool) has completed.
FR-6. A reusable workflow `.github/workflows/deploy-homelab.yml` resolves each image's `:<short sha>` tag to a digest,
mints the 12 mTLS leaves from the environment's own `MTLS_CA` (after checking its key matches its certificate), and
builds the release `.env` with `scripts/homelab-release-env.sh`. The pipeline owns `DB_HOST/DB_NAME/DB_USER`,
`APPLICATION_ENV` and `TRADING_MODE` (production → `production`/`live`, staging → `development`/`paper`), the image
digests and the mTLS values: any `KEY=`/`KEY:` copy of these in `APP_ENV` is dropped and the pipeline's values are
written after it; the CA key is deleted whatever the outcome. `scripts/homelab-render-check.sh` verifies the file
renders and that `deploy/homelab/render-assert.jq` passes, printing check labels and variable names, never a value.
The job then joins the tailnet as an ephemeral `tag:ci` node and ships `compose.yml` + `.env` through the gate.
FR-7. `deploy-dev.yml` calls it for `staging` and `deploy-prod.yml` for `production`, as jobs independent of the DO
deploy and fed by the same `build-images` job; both run only while the repository variable `HOMELAB_DEPLOY_ENABLED`
is `true`. `production` is a GitHub environment with required reviewers and deployment branches `main` only. A manual run takes an environment and an
already-built short SHA.
FR-8. Secrets come from 1Password when the environment has `OP_SERVICE_ACCOUNT_TOKEN`, else from the same-named
GitHub secrets (homelab-edge template behaviour), and the run summary lists each secret's source.
FR-9. OTel is off on the homelab (`OTEL_ENABLED=false`, no collector).
FR-10. homelab-edge (same branch name, separate PR): `tag:ci` may SSH to `tag:xstockstrat-staging`; the gate takes an
optional third forced-command argument for the `up --wait` timeout (30–900 s, default 120) and shows only
missing-variable names when a release does not render (exit 2); Gatus probes `xstockstrat-ui` at `/trader/api/health`
(feature 271 `@AC-3`; no redirect followed; requires `status: ok`) and `xstockstrat-agent` at
`/.well-known/oauth-protected-resource`, requiring `resource` to equal that environment's `$APP_URL/agent`; the deploy
runbook documents the xstockstrat specifics. xstockstrat adds no health route; the agent's compose healthcheck stays a
TCP connect.

## Out of Scope

- Retiring the DigitalOcean deploys. DO files (`deploy.yml`, `.do/app*.yaml`) are unchanged; DO's PRE_DEPLOY migrator
  (`.do/app.yaml:669`, `.do/app.dev.yaml:671`) gains the FR-4 tolerance through the shared `scripts/Dockerfile.migrate`
  (operator, 2026-10-25).
- `sslmode=verify-full` against homelab-edge's `db_tls_ca_crt` (follow-up feature).
- A homelab OTel collector or Grafana Cloud export.
- Adding the Go healthcheck to local `docker-compose.yml`. Local `docker-compose.yml` and `.do/app*.yaml` need no
  change; the homelab target's values live only in `deploy/homelab/compose.yml` and the pipeline.
- Docs that change with it: `docs/patterns/ci-overview.md` (deploy table), `docs/patterns/docker-build.md` and
  `docs/context-constitution.md` PLAT-N2 (Go healthcheck), `docs/patterns/inter-service-mtls.md` (homelab CA path).
- Any trading behaviour: no broker (Alpaca, IBKR), order-type or fill change. Paper vs live is derived from the target
  environment: the pipeline writes `APPLICATION_ENV` and `TRADING_MODE` together (staging `development`/`paper`,
  production `production`/`live`); the `trading.broker.paper` config key still overrides the env default
  (`trading.go:2595-2597`).
- Provisioning the VMs and 1Password vaults (operator). Postgres roles, databases, PgBouncer pools and TLS belong to
  homelab-edge `db_host`.

## Affected Services

Code changes:
- `xstockstrat-trading` — gRPC health service + `healthcheck` mode (FR-5)
- `xstockstrat-portfolio` — same
- `xstockstrat-marketdata` — same

Deployed by the new compose file with no code change (the scope-creep trap from `fails.md` ci-docker-registry-deploy:
every service in the target file is listed): `xstockstrat-config`, `xstockstrat-ledger`, `xstockstrat-identity`,
`xstockstrat-notify`, `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-ui`,
`xstockstrat-agent`, plus the `db-migrator` job image (`scripts/Dockerfile.migrate`, newly pushed to GHCR).

Tooling and CI: `scripts/db-migrate.sh` and `scripts/Dockerfile.migrate` (the DO and homelab migrators),
`scripts/migration-ahead-check.sh` + `.test.sh`, `scripts/migration-rerun.sh`, `scripts/homelab-release-env.sh`,
`scripts/homelab-render-check.sh`, `scripts/homelab-render.test.sh`, `scripts/homelab-mtls-env.py`,
`deploy/homelab/render-assert.jq`, `deploy/homelab/compose.yml`, `.github/workflows/{ci,deploy-homelab,deploy-dev,
deploy-prod,docker-build}.yml`, `docs/patterns/{database,ci-overview,docker-build,inter-service-mtls}.md`,
`docs/context-constitution.md`, `docs/roadmap/features/merge-order.md` (prose note), and a note in
`docs/roadmap/features/271-fix-ui-transport-hardening/context.md` (operator-approved).

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — a deploy target and a readiness probe. Users reach the same UI and agent, unchanged, at the homelab
  URLs (`https://xstockstrat.natanddavehouse.com`, tailnet-only staging at
  `https://xstockstrat-staging-ui.ts.natanddavehouse.com:8443`); the health service is consumed only by the
  container runtime.

## Proto Contract Changes

- [x] No proto changes required (`grpc.health.v1` is the upstream grpc-go package, not a `packages/proto` contract)

## Config Key Changes

- [x] No new config keys (new values are deploy-time env, read before the gRPC server binds)

## Database Changes

- [x] No schema changes (existing migrations run against new databases)

## Feature Workflow Notes

Branch to create: `feature/homelab-compose-deploy` (branch from `main-dev`). This session's harness branch is
`ccr-9bdbcd90-kgj5ev`, which is based on `main-dev` and PR'd into `main-dev`.
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (trading / portfolio / marketdata health service)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)
- [x] Platform lead (new deploy target)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] Run alongside DO or replace it → alongside (operator, 2026-10-24).
- [x] Go readiness → real `grpc.health.v1` service (operator, 2026-10-24).
- [x] A rollback restores images, not schema → **accepted** (operator, 2026-10-24): migrations must work with the
  previous release (expand/contract), under the existing never-edit-an-applied-migration rule. Recorded in
  homelab-edge `docs/decisions.md`.
- [x] Overlap with `084-droplet-compose-deploy` (same dev deploy path) → 084 demoted as superseded by this feature
  (operator, 2026-10-24).
- **Known trap** (`fails.md` remove-x-mcp-secret-header, frontend-reverse-proxy — Docker-unavailable family): the
  authoring sandbox has no Docker daemon. Verification must name non-daemon fallbacks (`docker compose config`,
  the gate's fake-docker test, a headscale binary for policy tests) and label them "not a live-boot proof"; the
  first staging deploy is the live-boot proof.
