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
