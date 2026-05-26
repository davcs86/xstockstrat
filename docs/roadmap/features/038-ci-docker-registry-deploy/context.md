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

## Session 2026-05-26T00:02:00Z — priority escalation

- Confirmed this is the highest-priority active feature. The current DO-based Dockerfile builds have two active failures: (1) build timeouts — cold pnpm install + pnpm build exceeds DO's build time limit, especially for Next.js frontends; (2) flaky installs — cold npm registry hits on DO egress cause retries that exhaust the timeout budget. Both 018 and 003 are blocked from reaching production until this is resolved.
- Problem Statement in product-spec.md updated to document both failure modes explicitly.
