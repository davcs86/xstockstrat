# Product Spec: upgrade-nextjs15

**Created**: 2026-05-30
**Last Updated**: 2026-05-30

---

## Problem Statement

The three Next.js frontends are split across two major versions: `xstockstrat-trader` runs
Next.js 15.5.x while `xstockstrat-insights` and `xstockstrat-config-ui` remain on Next.js
14.2.3 (both on React 18.3, `eslint-config-next` 14.2.x). The split dates back to the DO deploy
failure investigation (2026-05-27), where the `Cannot find module '/app/server.js'` error on
insights and config-ui was traced to pnpm-workspace standalone path mirroring. The immediate
workaround (subdirectory `CMD` and static `COPY` paths, documented in
`docs/patterns/docker-build.md`) is correct and complete for v14, but it leaves two services a
full major version behind and accumulates drift: every shared frontend pattern (auth middleware,
OTel init, Docker build) now has to account for two Next.js majors.

Upgrading insights and config-ui to Next.js 15 realigns all three frontends on one major
version, eliminates the version-skew tax, and lets the standalone-output workaround be applied
or removed consistently across all three.

## User Story

As a frontend maintainer, I want `xstockstrat-insights` and `xstockstrat-config-ui` on the same
Next.js 15 major as `xstockstrat-trader`, so that all three frontends share one set of patterns,
dependencies, and build behaviors with no two-major-version drift.

## Functional Requirements

FR-1. `xstockstrat-insights` and `xstockstrat-config-ui` are upgraded from Next.js 14.2.x to the
same Next.js 15.x line already used by `xstockstrat-trader`, including aligned `react`,
`react-dom`, and `eslint-config-next` versions.

FR-2. The `next.config.js` in both services moves `serverComponentsExternalPackages` out of
`experimental` to the top-level `serverExternalPackages` key (the same change already applied to
trader).

FR-3. All call sites of the now-async request APIs (`cookies()`, `headers()`, `params`,
`searchParams`) in route handlers and server components of both services are updated to `await`
them.

FR-4. Any route handler that relied on the Next.js 14 implicit `fetch()` caching default
(`force-cache`) is made explicit, since Next.js 15 defaults `fetch()` to `no-store`. Caching
behavior must be unchanged from the user's perspective.

FR-5. `package.json` peer dependencies are reconciled for the React major shipped with Next.js
15; `pnpm install` resolves with no unmet peer-dependency errors, and `pnpm-lock.yaml` is updated
and committed.

FR-6. Both services build cleanly with `pnpm run build`, producing correct standalone output, and
their existing Docker builds succeed unchanged (or with the standalone-path workaround applied
consistently with trader).

FR-7. All existing functionality of both UIs is preserved — no user-visible behavior change,
no broken pages, no broken API routes, auth and OTel init still work.

FR-8. `docs/patterns/docker-build.md` and `docs/patterns/nextjs-frontends.md` are updated if the
upgrade changes any documented frontend gotcha (e.g., if the standalone-path workaround can be
removed on v15).

## Out of Scope

- `xstockstrat-trader` — already on Next.js 15; only realigned if a shared dependency needs a
  coordinated bump.
- The UI consolidation effort (feature 045) — this feature keeps the three services separate and
  only upgrades two of them. (See Open Questions for sequencing.)
- Any new UI features, redesigns, or route changes.
- Migrating SWR / data-fetching patterns (feature 044) — orthogonal.
- Backend, proto, or database changes.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-insights` — Next.js 14.2.x → 15.x; `next.config.js`, async request API call
  sites, `package.json`, `pnpm-lock.yaml`, Dockerfile if needed
- `xstockstrat-config-ui` — same set of changes (flat directory structure, no `src/`)
- `xstockstrat-trader` — reference target (already on 15); touched only if a shared dependency
  bump is required

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/upgrade-nextjs15` (branch from `main-dev`).
Approval gates required (per `docs/runbooks/feature-workflow.md`):
- [x] 1 service owner approval (non-breaking dependency upgrade to two frontend services)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

Per the root CLAUDE.md Version Bump Workflow, this is a per-service framework upgrade (not a
platform-wide Node version bump), so the language-version table is unaffected; only the two
service `package.json` / `Dockerfile` pairs and the lockfile change.

## Acceptance Criteria

1. `services/xstockstrat-insights/package.json` and
   `services/xstockstrat-config-ui/package.json` declare a Next.js 15.x version matching
   trader's major.
2. `pnpm install` completes with no unmet peer-dependency errors; `pnpm-lock.yaml` is updated and
   committed in the same PR.
3. `pnpm run build` succeeds for both services and emits valid standalone output.
4. Neither `next.config.js` still nests `serverComponentsExternalPackages` under `experimental`.
5. No remaining un-awaited `cookies()` / `headers()` / `params` / `searchParams` usage in either
   service.
6. Both services start and serve all existing pages and API routes in dev with no runtime errors;
   auth (login/refresh/logout) and OTel init continue to work.
7. The Docker images for both services build and run, serving their basePaths (`/insights`,
   `/config-ui`) correctly.
8. CI (lint, build, Playwright e2e for both UIs) passes.

## Open Questions

_Resolved at `/sdd-review product-spec` gate (2026-05-31)._

- [x] **Exact Next.js 15 target version.** **Pin to `^15.5.15`** — match trader's current exact
  pin. Minimizes skew; trader already validated this version in production. Do not chase latest
  15.x; update only when trader bumps.
- [x] **React 18 vs React 19.** **Stay on React 18.3.1** — trader pairs Next.js 15.5.15 with
  React 18.3.1 (confirmed in `pnpm-lock.yaml` L3767). No Radix/charting gate needed. No React
  19 bump for this feature.
- [x] **Standalone-path workaround disposition.** **Stays.** Next.js 15 does not change
  pnpm-workspace standalone path mirroring. Both Dockerfiles already use
  `CMD ["node", "services/<service>/server.js"]` and this remains correct on v15. Step 7 will
  add "(confirmed on Next.js 15.5.15)" to the `docs/patterns/docker-build.md` gotcha note.
- [x] **OpenTelemetry package compatibility.** **No bump needed.** `@opentelemetry/sdk-node
  ^0.218.0` and `exporter-trace-otlp-http ^0.218.0` are confirmed compatible with Next.js 15 —
  trader uses identical pins with Next.js 15.5.15 in production.
- [x] **Sequencing vs feature 045 (UI consolidation).** **041 proceeds independently.** Feature
  045 is still `draft`. Upgrading insights and config-ui to Next.js 15 first de-risks the
  eventual consolidation by ensuring all three services share one major before the merge. No
  blocking dependency on 044 either — orthogonal changes.
