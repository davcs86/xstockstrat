# Context: ui-consolidation-nextjs

**Feature**: `docs/roadmap/features/045-ui-consolidation-nextjs/feature.md`
**Product Spec**: `docs/roadmap/features/045-ui-consolidation-nextjs/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/045-ui-consolidation-nextjs/implementation-spec.md`

---

## Session 2026-05-29T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Pre-scan of the three frontends confirmed: all use basePaths (/trader, /insights, /config-ui), identical middleware pattern, shared dependency set, Next.js version skew (trader on v15, insights + config-ui on v14), and config-ui has direct pg access for audit log.
- nginx also proxies /agent/sse and /agent/messages — captured in FR-3 to move those to Next.js rewrites.
- New service name `xstockstrat-ui` proposed (open question in product-spec).

## Session 2026-05-29T00:01:00Z — user decisions

- **Service name**: `xstockstrat-ui` confirmed.
- **DO routing**: single domain; routes configured directly in DO App Platform spec (no per-basePath custom domains). This also eliminates the need for nginx to proxy `/agent/sse` and `/agent/messages` — those routes are configured in the DO spec to hit `xstockstrat-agent` directly. FR-3 updated accordingly; no Next.js rewrites needed for agent routes.
- **pg access**: keep direct `pg` calls in the consolidated app as-is; no server-only module isolation needed.

## Session 2026-05-29T00:02:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - (advisory) xstockstrat-nginx Affected Services description was stale ("Next.js rewrites" vs actual "DO App Platform route rules") — fixed in product-spec.md.
- Overlap findings (all advisory ⚠, no blocking conflicts):
  - `005-frontend-reverse-proxy`, `006-do-nginx-integration` are functionally inverse (set up nginx that 045 removes) — recommend demoting both before executing 045.
  - `012-wire-fe-auth` wires auth into the three source services + nginx; merge before executing 045 so 045 absorbs the finished auth implementation.
  - `044-client-api-pattern` migrates SWR → react-query in all three source services; merge before 045 for the same reason.
  - `014-trader-chart-panel`, `002-broker-accounts-ui`, `003-formula-management-ui` also touch one or more source services — merge before 045 to avoid re-doing work in the consolidated service.
  - `038-ci-docker-registry-deploy` builds images for old services + nginx; must be updated to reference `xstockstrat-ui` after 045 merges (or merge 038 after 045).

## Session 2026-05-29T00:03:00Z — overlap clarification

- User confirmed 002, 005, 006, and 012 are already `launched` (code in main-dev).
- Revised overlap picture: the source services already have basePaths (005), nginx routing (006), auth + header propagation (012), and broker accounts UI (002) in place.
- Remaining active-feature concerns before executing 045:
  - **Merge before 045**: `014-trader-chart-panel` (touches xstockstrat-trader), `044-client-api-pattern` (touches all three source services), `003-formula-management-ui` (touches xstockstrat-insights).
  - **Merge after 045 or update**: `038-ci-docker-registry-deploy` references old service names in CI; update to `xstockstrat-ui` after 045 lands.

## Session 2026-05-30T00:00:00Z — sdd-story (regenerate)

- Product spec regenerated fresh as part of a 4-feature spec batch (033, 041, 045, 044), each
  delivered as an independent PR off `main-dev`. Per the requesting story, previously-resolved
  open questions were deliberately RE-OPENED and left for the `/sdd-review product-spec` gate.
  Status reverted: `spec-ready` → `draft`.
- Re-opened questions: consolidated service name (was resolved to `xstockstrat-ui`), DO routing
  model (was resolved to single-domain), and config-ui `pg` access (was resolved to keep-as-is).
  Added two sequencing questions: vs feature 041 (Next.js 15 upgrade — consolidation needs all
  three UIs on one major) and vs features 044 / 038.
- Corrected stale facts against current `main-dev`: backends are now gRPC-only (the 80xx
  HTTP/Connect-RPC servers were removed), so FR-6 now references gRPC `*_ENDPOINT` vars only —
  the previous `*_HTTP_ENDPOINT` reference was removed. Added an explicit platform-lead approval
  gate (service registry change: four services removed, one added with a new port assignment).
- Next action: `/sdd-review ui-consolidation-nextjs product-spec`.

## Session 2026-06-01T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- All 5 open questions resolved at review gate:
  - Service name: `xstockstrat-ui` — restores the 2026-05-29 decision; service registry, OTel
    `service.name`, image name, and CI references updated in the implementation.
  - DO routing: single domain, path-based App Platform route rules — restores prior decision;
    no per-basePath custom domains; auth cookies scoped within the same origin per basePath.
  - config-ui `pg` access: keep direct `pg` calls as-is — restores prior decision; no
    server-only isolation module needed.
  - Sequencing vs 041: no dependency — feature 041 (Next.js 15 upgrade) is already `launched`;
    all three source UIs are already on Next.js 15.
  - Sequencing vs 044 / 038: 044 must land before 045 so the consolidated app absorbs the
    finished typed hook layer; 038 is already `launched` (CI image references to old service
    names updated as part of 045's removal step, not a separate PR).
- Overlap warnings (advisory, no blocking action required):
  - `044-client-api-pattern` and `046-align-frontend-e2e-bff-mocks` must merge before 045 —
    already captured in merge-order.md from prior session.
  - `003-formula-management-ui` added to Stream 2 workstream — must merge before 045 to avoid
    re-doing xstockstrat-insights work in the consolidated service.

## Session 2026-06-01T00:01:00Z — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Key codebase findings:
  - All three frontends already on Next.js 15.5.15 (package.json confirmed); no version alignment work needed.
  - Config-ui uses `app/` (no `src/`) layout and `@/app/lib/*` import paths — migrated files must remap to `@/lib/*` in the consolidated `src/` tree.
  - All three middleware files are logically identical; the consolidated service uses a single middleware.ts at `src/middleware.ts` — no per-segment middleware files needed.
  - Three separate mock backends (ports 9091/9092/9093) must remain distinct in the consolidated e2e suite — they serve different gRPC service sets and cannot be merged.
  - `next.config.js` carries no top-level `basePath`; each segment is a route group under `src/app/`. The BFF `handlerMap` keyed on `'/api' + h.requestPath` is correct because Next.js strips the segment path prefix before the handler (confirmed in all three connectBff.ts files).
  - Config-ui's `pg` Pool access in `app/api/audit/route.ts:12` carried forward as-is; `DATABASE_URL` added to consolidated service's env var set.
  - DO ingress must add a `/agent` route rule before the root `/` rule to route agent SSE/messages to `xstockstrat-agent` without passing through the UI service.
