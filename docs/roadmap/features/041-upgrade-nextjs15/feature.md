# Feature: upgrade-nextjs15

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/upgrade-nextjs15`
**Created**: 2026-05-27
**Last Updated**: 2026-05-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-27 | `idea` | manual | Backlog entry created after DO deploy failures investigation |
| 2026-05-30 | `idea` → `draft` | /sdd-story | Product spec generated; open questions left for review |
| 2026-05-31 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 7 steps, generated 2026-05-31
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

## Background / Motivation

During DO deploy failure investigation (2026-05-27), the root cause of `Cannot find module '/app/server.js'` on insights and config-ui was identified: pnpm workspace causes Next.js to mirror the full repo path inside `.next/standalone/`, so `server.js` lands at `standalone/services/<service>/server.js` rather than at the standalone root.

The immediate fix applied was to update the Dockerfile CMD and static COPY to use the actual subdirectory path. This fix is correct and complete for the current version. The gotcha is documented in `docs/patterns/docker-build.md`.

**Deferred work**: The proper long-term fix is upgrading to Next.js 15, which aligns with trader and avoids accumulating a two-major-version split between frontends.

## Upgrade Scope

| Service | Current | Target | Breaking changes |
|---|---|---|---|
| `xstockstrat-insights` | Next.js 14.2.x | 15.x | See below |
| `xstockstrat-config-ui` | Next.js 14.2.x | 15.x | See below |
| `xstockstrat-trader` | Next.js 15.x | — | Already on target |

### Known Breaking Changes (Next.js 14 → 15)

1. **`experimental.serverComponentsExternalPackages` → `serverExternalPackages`**: Move the config key out of `experimental` in both `next.config.js` files (same change already applied to trader)
2. **Async request APIs**: `cookies()`, `headers()`, `params`, `searchParams` are now async in Next.js 15 — all route handlers and server components that call these must be updated to `await` them
3. **Default fetch caching**: `fetch()` is now `no-store` by default (was `force-cache`); any route handlers that rely on implicit caching need explicit `{ cache: 'force-cache' }` or `unstable_cache`
4. **React 19**: Next.js 15 ships with React 19 — `package.json` peer deps for `react` and `react-dom` must be updated; verify no React 18-only APIs are used

### Suggested Approach

1. Upgrade `package.json` in each service: `next`, `react`, `react-dom`, `eslint-config-next`, relevant `@opentelemetry/*` packages to versions compatible with Next.js 15
2. Update `next.config.js`: move `serverComponentsExternalPackages` out of `experimental`
3. Run `pnpm install` and fix any peer dependency conflicts
4. Audit and update async request API call sites (`cookies()`, `headers()`)
5. Verify all pages and API routes in dev, then run `pnpm run build` to confirm clean standalone output
6. Update `pnpm-lock.yaml` and commit

## Reviewers

_(Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| xstockstrat-insights owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| xstockstrat-config-ui owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-review upgrade-nextjs15 impl-spec` — validate implementation spec, then `/sdd-execute upgrade-nextjs15`
