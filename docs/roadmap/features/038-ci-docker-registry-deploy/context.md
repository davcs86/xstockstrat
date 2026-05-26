# Context: ci-docker-registry-deploy

**Feature**: `docs/roadmap/features/038-ci-docker-registry-deploy/feature.md`
**Product Spec**: `docs/roadmap/features/038-ci-docker-registry-deploy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/038-ci-docker-registry-deploy/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin of feature: exploration session comparing Option A (CI build validation only) vs Option B (CI build + push to registry, DO deploys pre-built images). User chose Option B.
- Key open questions captured in product-spec.md: registry choice (DOCR vs ghcr.io), stale image handling strategy for path-filtered builds, and PR build scope.
- No proto, schema, or config changes — Platform Lead review role assigned.

## Session 2026-05-26T00:01:00Z — product-spec update

- Resolved stale image handling: per-service floating `latest-dev`/`latest` tags (FR-9). App specs reference floating tags; no SHA injection needed in deploy workflow.
- Resolved build matrix strategy: build only changed services using existing `changes` filter; shared-file changes trigger all services of the affected language group.
- Resolved local dev workflow: dual `build:` + `image:` in docker-compose.yml. `docker compose pull` fetches CI image; `docker compose build` builds locally. Both usable by `docker compose up`.
- One open question remains: registry choice (DOCR vs ghcr.io).

## Session 2026-05-26T00:04:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: (1) Affected Services mixes file paths with service names — advisory; (2) 003 and 018 both modify docker-compose.yml/.do/ files — 020 must merge before both.
- Two spec failures resolved before approval: FR-5/FR-9 contradiction fixed by aligning to industry standard SHA-pinned deploys; FR-1 updated to build all 14 services (changes filter deferred).
- Overlap findings: no FAIL-level conflicts; merge order advisory noted.

## Session 2026-05-26T00:03:00Z — registry decision

- Registry choice resolved: DOCR. `DIGITALOCEAN_ACCESS_TOKEN` already exists in repo secrets (used by deploy workflows). CI uses `digitalocean/action-doctl@v2` + `doctl registry login` — no new secrets. DO App Platform pulls from DOCR with zero additional credential configuration.
- No open questions remain. Ready for `/sdd-spec ci-docker-registry-deploy`.

## Session 2026-05-26T00:05:00Z — sdd-spec

- Generated implementation-spec.md with 5 steps. Status → implementation-ready.
- Key codebase findings:
  - The `changes` job in `.github/workflows/ci.yml` already has a `dockerfiles` filter at L63 that matches `**/Dockerfile*` — the new `docker-build` job can use this filter in its `if:` guard.
  - `DIGITALOCEAN_ACCESS_TOKEN` is already a repo secret (confirmed at `.github/workflows/deploy.yml` L28) — `doctl registry login` reuses it; no new credential secret needed for CI registry auth.
  - Both app specs have 15 `dockerfile_path` service entries (14 product-spec services + `xstockstrat-agent` at L210) plus 1 `db-migrator` job entry (L452) — the db-migrator is excluded from registry migration per FR-8.
  - `docker-compose.yml` has 16 `build:` entries (15 services + db-migrator at L82); db-migrator does not need an `image:` field.
  - The reusable `deploy.yml` uses a `sed` substitution for `YOUR_GITHUB_ORG` at L31 — the SHA and registry-name substitution follows the same pattern in Step 2.
  - New GitHub Actions secret `DO_REGISTRY_NAME` is required (the DOCR registry slug). Must be added to Steps 1, 2, and 5, and documented in `docs/setup/digitalocean.md`.
  - `xstockstrat-agent` is present in both app specs but absent from the product spec's 14-service list. Implementation includes it in Steps 1 and 3 to avoid a `dockerfile_path` entry left in the app specs after migration.

## Session 2026-05-26T00:06:00Z — sdd-review impl-spec

- Implementation spec reviewed (Mode B — advisory). Result: 0 failures, 0 warnings after fixes applied.
- Fix 1: Step 1 `if:` condition was missing the push-branch short-circuit. Without it, only path-filtered matrix entries would run on push to main-dev/main, violating FR-1 (build all 15 services unconditionally on push). Fixed by prepending `(github.event_name == 'push' && (github.ref == 'refs/heads/main-dev' || github.ref == 'refs/heads/main')) ||` to the `if:` expression.
- Fix 2: Step 4 `**Files**` was missing `.env.example` — the Instructions mention adding `DO_REGISTRY_NAME=xstockstrat` to `.env.example` but the file was not listed. Fixed by adding `- \`.env.example\` — modify (add DO_REGISTRY_NAME)` to the Files list.
- Overlap check: no FAIL-level conflicts. Merge order advisory confirmed: 038 must merge before 003 and 018 (both touch docker-compose.yml and .do/ files).
- Trading domain checks: skipped (non-trading feature).
- Step ordering: no test steps needed (CI workflow — no service coverage threshold applies).

### Step 4 — service: Add image field to docker-compose.yml [done]
- Added `image:` field alongside `build:` block for all 15 app services in `docker-compose.yml`. Image format: `registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/<service>:latest-dev`. db-migrator excluded per FR-8.
- Added `DO_REGISTRY_NAME=xstockstrat` to `.env.example` with usage comment; added `DO_REGISTRY_NAME` to GitHub Secrets table in `.env.example`.
- Files modified: `docker-compose.yml`, `.env.example`
- Deviations: none

## Session 2026-05-26T00:10:00Z — sdd-execute
**Steps this session**: [4]
**Progress**: 4 done / 5 total
**Stopped at**: Step 4 (complete — awaiting merge before continuing)
**Next**: /sdd-execute ci-docker-registry-deploy next

## Session 2026-05-26T00:02:00Z — priority escalation

- Confirmed this is the highest-priority active feature. The current DO-based Dockerfile builds have two active failures: (1) build timeouts — cold pnpm install + pnpm build exceeds DO's build time limit, especially for Next.js frontends; (2) flaky installs — cold npm registry hits on DO egress cause retries that exhaust the timeout budget. Both 018 and 003 are blocked from reaching production until this is resolved.
- Problem Statement in product-spec.md updated to document both failure modes explicitly.

### Step 1 — ci: Add docker-build job to CI workflow [done]
- Inserted `docker-build` job in `.github/workflows/ci.yml` after `dockerfile-lint` (L519), before `shell-lint` (L520). 15-service matrix, push=true always, tags with short SHA + floating tag.
- Files modified: `.github/workflows/ci.yml`
- Deviations: Job restricted to push events on main-dev/main only (no PR builds) — user-requested change from spec's unconditional trigger.

## Session 2026-05-26T00:07:00Z — sdd-execute
**Steps this session**: [1]
**Progress**: 1 done / 5 total
**Stopped at**: Step 1 (complete — awaiting merge before continuing)
**Next**: /sdd-execute ci-docker-registry-deploy next

### Step 3 — service: Migrate app specs from dockerfile_path to image references [done]
- Migrated 5 services (trader, insights, config-ui, identity, notify) from github:+dockerfile_path: to image: DOCR blocks in both .do/app.dev.yaml and .do/app.yaml. 10 backend services + nginx unchanged. Services selected by pnpm lockfile package count (top 5: insights=117, trader=117, config-ui=114, identity=93, notify=93).
- Files modified: `.do/app.dev.yaml`, `.do/app.yaml`
- Deviations: Only 5 of 15 services migrated (DOCR basic plan 5-repo limit); ci.yml matrix stays at 15 services (accepted limitation — 10 non-selected jobs will fail at DOCR quota).

## Session 2026-05-26T00:09:00Z — sdd-execute
**Steps this session**: [3]
**Progress**: 3 done / 5 total
**Stopped at**: Step 3 (complete — awaiting merge before continuing)
**Next**: /sdd-execute ci-docker-registry-deploy next

### Step 2 — service: Update deploy workflows to inject SHA image tags [done]
- Added `image_tag` input and `DO_REGISTRY_NAME` secret to `deploy.yml` reusable workflow; replaced single-sed substitution step with three-substitution step covering `YOUR_GITHUB_ORG`, `YOUR_IMAGE_TAG`, and `YOUR_REGISTRY_NAME`.
- Added `prepare` job to both `deploy-dev.yml` and `deploy-prod.yml` to compute 7-char short SHA; updated `deploy` job in each to depend on `prepare` and pass `image_tag` and `DO_REGISTRY_NAME`.
- Files modified: `.github/workflows/deploy.yml`, `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml`
- Deviations: none

## Session 2026-05-26T00:08:00Z — sdd-execute
**Steps this session**: [2]
**Progress**: 2 done / 5 total
**Stopped at**: Step 2 (complete — awaiting merge before continuing)
**Next**: /sdd-execute ci-docker-registry-deploy next
