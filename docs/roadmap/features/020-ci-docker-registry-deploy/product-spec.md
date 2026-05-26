# Product Spec: ci-docker-registry-deploy

**Created**: 2026-05-26

---

## Problem Statement

`pnpm build` (and all Docker image builds) currently run inside DigitalOcean's infrastructure when App Platform reads `dockerfile_path` and builds each service's Dockerfile on deploy. This is causing two active deployment failures:

1. **Build timeouts**: DO App Platform enforces a hard build time limit. A cold workspace `pnpm install` + proto compile + `pnpm build` across multi-stage Dockerfiles (especially Next.js frontends) regularly exceeds it, causing the deploy to fail with no code change.
2. **Flaky installs**: Every DO deploy runs `pnpm install` cold against the npm registry. When DO's egress is congested or registry requests are slow, installs hit retry limits and exhaust the remaining timeout budget. The `npm config set fetch-retries 5` in all Node Dockerfiles is a band-aid that does not fully mitigate this.

The result is that production and dev deployments are unreliable independent of whether the application code is correct. Moving builds to GitHub Actions CI eliminates both root causes: the GHA layer cache (`type=gha`) means `pnpm install` is skipped on repeat builds (no cold npm installs on DO), and GitHub Actions has no meaningful build time ceiling.

## User Story

As a platform engineer, I want Docker images to be built in GitHub Actions CI with layer caching and pushed to a container registry, so that build failures surface at PR time, deployments become fast image pulls, and all build artefacts are traceable to a specific commit SHA.

## Functional Requirements

FR-1. CI builds a Docker image for all 14 platform services on every push to `main-dev` and `main`. Path-filtered builds (changed services only) are deferred until the `changes` filter job is working correctly; full matrix builds are used in the interim.
FR-2. Images are pushed to DOCR and tagged with the commit SHA (e.g. `registry.digitalocean.com/<registry>/xstockstrat-ledger:abc1234`) and a `latest-dev` / `latest` floating tag per branch.
FR-3. GitHub Actions layer cache (`cache-from: type=gha, cache-to: type=gha,mode=max`) is applied to all Docker builds to avoid redundant `pnpm install` / `go mod download` / `pip install` layers.
FR-4. On PRs, CI builds all changed-service images (using the existing `changes` filter job) but does **not** push — build failure blocks the PR merge.
FR-5. The deploy workflows (`deploy-dev.yml`, `deploy-prod.yml`) inject the commit SHA as the image tag for each service into the app spec before calling `doctl apps update`. This ensures every deployment is pinned to an immutable, auditable image digest.
FR-6. `.do/app.yaml` and `.do/app.dev.yaml` are migrated from `dockerfile_path` to `image:` references for all 14 services.
FR-7. Each service entry in `docker-compose.yml` gets both `build:` (existing Dockerfile path) and `image:` (registry `latest-dev`/`latest` tag). This means `docker compose build` builds locally and tags the result with the registry image name, while `docker compose pull` fetches the CI-built image — both commands produce an image usable by `docker compose up` without rebuilding.
FR-8. The `db-migrator` PRE_DEPLOY job in both app specs is unaffected (it is a `job` kind, not a `service`, and does not use a custom image; it may continue using `dockerfile_path` or a script runner image).
FR-9. CI pushes two tags per image: the immutable commit SHA tag (used by the deploy workflow in app specs) and a floating `latest-dev` / `latest` tag (used by `docker compose pull` for local development). App specs always reference the SHA tag — floating tags are a local dev convenience only.

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
8. The deploy workflow substitutes `YOUR_GITHUB_ORG` and the commit SHA into the app spec and calls `doctl apps update` — each service's `image.tag` in the spec is pinned to the exact SHA of the triggering commit.
9. The `db-migrator` PRE_DEPLOY job continues to run and apply migrations successfully after the migration.

## Resolved Decisions

- **Registry**: DOCR (DigitalOcean Container Registry). Native DO App Platform auth (zero credential wiring on DO side). CI authenticates via `digitalocean/action-doctl@v2` + `doctl registry login` using `DIGITALOCEAN_ACCESS_TOKEN` — the same secret already present in the repo for `doctl apps update` in the deploy workflows. No new secrets required.
- **Deployment tagging** → SHA-pinned (industry standard). App specs always reference the immutable commit SHA tag. Floating `latest-dev`/`latest` tags are also pushed as a local dev convenience for `docker compose pull` but are never used in DO deployments (FR-9).
- **Build matrix strategy** → build all 14 services on every push (interim). Path-filtered builds deferred until the `changes` filter job is fixed (FR-1).
- **Local dev with registry** → dual `build:` + `image:` in `docker-compose.yml` (FR-7). `docker compose build` builds locally; `docker compose pull` fetches CI image. Both produce an image usable by `docker compose up` (AC-7).
