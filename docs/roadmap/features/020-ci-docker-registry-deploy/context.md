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
