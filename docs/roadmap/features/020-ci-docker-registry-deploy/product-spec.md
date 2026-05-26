# Product Spec: ci-docker-registry-deploy

**Created**: 2026-05-26

---

## Problem Statement

`pnpm build` (and all Docker image builds) currently run inside DigitalOcean's infrastructure when App Platform reads `dockerfile_path` and builds each service's Dockerfile on deploy. This means build failures are discovered during deployment (~10-15 min after merge), every deploy incurs a full cold `pnpm install + pnpm build` with no layer caching, and build logs are split across GitHub Actions (lint/test) and the DO dashboard (actual build).

## User Story

As a platform engineer, I want Docker images to be built in GitHub Actions CI with layer caching and pushed to a container registry, so that build failures surface at PR time, deployments become fast image pulls, and all build artefacts are traceable to a specific commit SHA.

## Functional Requirements

FR-1. CI builds a Docker image for each of the 14 platform services on every push to `main-dev` and `main`.
FR-2. Images are tagged with the commit SHA (e.g. `ghcr.io/org/repo/xstockstrat-ledger:abc1234`) and a `latest-dev` / `latest` floating tag per branch.
FR-3. GitHub Actions layer cache (`cache-from: type=gha, cache-to: type=gha,mode=max`) is applied to all Docker builds to avoid redundant `pnpm install` / `go mod download` / `pip install` layers.
FR-4. On PRs, CI builds all changed-service images (using the existing `changes` filter job) but does **not** push — build failure blocks the PR merge.
FR-5. The deploy workflows (`deploy-dev.yml`, `deploy-prod.yml`) inject the commit SHA as the image tag into the app spec before calling `doctl apps update`.
FR-6. `.do/app.yaml` and `.do/app.dev.yaml` are migrated from `dockerfile_path` to `image:` references for all 14 services.
FR-7. Each service entry in `docker-compose.yml` gets both `build:` (existing Dockerfile path) and `image:` (registry `latest-dev`/`latest` tag). This means `docker compose build` builds locally and tags the result with the registry image name, while `docker compose pull` fetches the CI-built image — both commands produce an image usable by `docker compose up` without rebuilding.
FR-8. The `db-migrator` PRE_DEPLOY job in both app specs is unaffected (it is a `job` kind, not a `service`, and does not use a custom image; it may continue using `dockerfile_path` or a script runner image).
FR-9. CI uses **per-service floating tags** (`latest-dev` on `main-dev` push, `latest` on `main` push) in addition to the immutable `<sha>` tag. The app specs reference the floating tags — no SHA injection required in the deploy workflow. The SHA tag is retained for audit and rollback.

## Out of Scope

- Changing any service's application logic, API contracts, or runtime behaviour.
- Moving proto stub generation into CI (already handled by the `proto-freshness` job).
- Modifying local development workflows beyond adding `image:` to `docker-compose.yml` entries (enabling `docker compose pull` as an alternative to building locally).
- Automated image vulnerability scanning (can be added as a follow-up CI step).
- Multi-architecture builds (`linux/arm64`) — `linux/amd64` only.

## Affected Services

Exact service names from CLAUDE.md Service Registry (all services affected at the CI/deploy layer):
- `xstockstrat-trading` — image build moved to CI
- `xstockstrat-portfolio` — image build moved to CI
- `xstockstrat-marketdata` — image build moved to CI
- `xstockstrat-indicators` — image build moved to CI
- `xstockstrat-ingest` — image build moved to CI
- `xstockstrat-analysis` — image build moved to CI
- `xstockstrat-ledger` — image build moved to CI
- `xstockstrat-identity` — image build moved to CI
- `xstockstrat-notify` — image build moved to CI
- `xstockstrat-config` — image build moved to CI
- `xstockstrat-trader` — image build moved to CI
- `xstockstrat-insights` — image build moved to CI
- `xstockstrat-config-ui` — image build moved to CI
- `xstockstrat-nginx` — image build moved to CI
- `.github/workflows/ci.yml` — new docker-build job matrix
- `.github/workflows/deploy-dev.yml` — image tag injection
- `.github/workflows/deploy-prod.yml` — image tag injection
- `.do/app.dev.yaml` — migrate dockerfile_path → image references
- `.do/app.yaml` — migrate dockerfile_path → image references

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/ci-docker-registry-deploy` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking — CI/deploy infrastructure only, no proto or schema changes)

## Acceptance Criteria

1. All 14 service Docker images build successfully in the CI `docker-build` job on a push to `main-dev`.
2. Images are tagged `<sha>` and `latest-dev` in the registry after a successful `main-dev` push.
3. A PR that introduces a Dockerfile syntax error causes the `docker-build` CI job to fail and blocks merge.
4. Pushing to `main-dev` triggers a DO dev deployment that pulls from the registry (not a Dockerfile build) and reaches `ACTIVE` status within 5 minutes.
5. Pushing to `main` triggers a DO prod deployment from the registry within 5 minutes.
6. Running `docker compose build` locally still works without any registry credentials — it builds from Dockerfiles and tags the result with the registry image name.
7. Running `docker compose pull` fetches all 14 CI-built images from the registry, allowing `docker compose up -d` with no local build required.
8. The deploy workflow substitutes `YOUR_GITHUB_ORG` in the app spec and calls `doctl apps update` — no SHA injection needed because app specs reference floating `latest-dev`/`latest` tags.
9. The `db-migrator` PRE_DEPLOY job continues to run and apply migrations successfully after the migration.

## Open Questions

- [ ] **Registry choice**: DOCR (DigitalOcean Container Registry, native DO auth, ~$5-20/month) vs GitHub Container Registry (ghcr.io, free for the repo's package quota, requires credential wiring in DO). DOCR is strongly preferred for zero-config DO integration.

## Resolved Decisions

- **Stale image handling** → per-service floating `latest-dev`/`latest` tags (FR-9). CI only rebuilds changed services; unchanged services retain their previous floating tag. App specs reference floating tags so no stale SHA problem arises.
- **Build matrix strategy** → build only changed services using the existing `changes` filter job, both on PRs and on push. Shared-file changes (`pnpm-lock.yaml`, `go.work`, `pnpm-workspace.yaml`, `packages/proto/**`) must trigger all services of the affected language group.
- **Local dev with registry** → dual `build:` + `image:` in `docker-compose.yml` (FR-7). `docker compose build` builds locally; `docker compose pull` fetches CI image. Both produce an image usable by `docker compose up` (AC-7).
