# Context: ci-docker-registry-deploy

**Feature**: `docs/roadmap/features/020-ci-docker-registry-deploy/feature.md`
**Product Spec**: `docs/roadmap/features/020-ci-docker-registry-deploy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/020-ci-docker-registry-deploy/implementation-spec.md`

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

## Session 2026-05-26T00:02:00Z — priority escalation

- Confirmed this is the highest-priority active feature. The current DO-based Dockerfile builds have two active failures: (1) build timeouts — cold pnpm install + pnpm build exceeds DO's build time limit, especially for Next.js frontends; (2) flaky installs — cold npm registry hits on DO egress cause retries that exhaust the timeout budget. Both 018 and 003 are blocked from reaching production until this is resolved.
- Problem Statement in product-spec.md updated to document both failure modes explicitly.
