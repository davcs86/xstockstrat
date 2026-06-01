# Product Spec: client-api-pattern

**Created**: 2026-05-28
**Last Updated**: 2026-05-30

---

## Problem Statement

The three Next.js frontends have already had their **server-side** Connect-RPC clients
(`lib/connectClients.ts`, `configClient.ts`) migrated to fully typed `@xstockstrat/proto`
service descriptors over a gRPC transport — the old `{} as any` placeholders are gone and
`@xstockstrat/proto` is a workspace dependency in all three. What remains untyped and
unmaintainable is the **client-side** data layer: all three frontends still use SWR `^2.2.5` for
browser-side fetching, mutations are plain `fetch()` calls with no loading/error state, and
response shapes leak `any` into component props (18 / 21 / 5 `any` occurrences in trader /
insights / config-ui respectively, plus `catch (err: any)` clauses).

SWR also lacks automatic cache propagation: when a mutation updates an entity, every query that
displays it must be manually invalidated at the call site, creating a dependency graph that grows
as dashboard panels multiply.

## User Story

As a frontend developer, I want every client-side API call expressed as a typed hook so that
(1) incorrect request/response shapes are caught at compile time, and (2) mutations
automatically propagate entity updates to all co-mounted queries without manual invalidation
bookkeeping.

## Functional Requirements

FR-1. Adopt a single client-side data-fetching + cache-normalization stack across all three
frontends (the specific libraries are an Open Question — see below), replacing SWR. SWR is fully
removed from all three `package.json` files and all call sites.

FR-2. The chosen stack is provisioned once per service via shared provider wiring in each
service's root `layout.tsx`, with any normalization/cache configuration centralized in a single
shared module (e.g. `lib/queryClient.ts`) rather than duplicated across layout files.

FR-3. Every **read** operation (data rendered in a component) is wrapped in a named, typed query
hook (e.g. `useOrders`, `usePortfolio`, `useStrategies`) with explicit data and error type
parameters. Components must not call the underlying query primitive directly with an untyped
fetcher.

FR-4. Every **write/mutation** operation (POST, PATCH, DELETE) is wrapped in a named, typed
mutation hook with explicit data, error, and variables type parameters. Components must not call
`fetch` directly for mutations. Mutation functions return the full updated entity (not
`{ success: true }`) so the cache-normalization layer can propagate the update to co-mounted
queries.

FR-5. Request/response types in route handlers and hook files are imported from the generated
`@xstockstrat/proto` message types (`*_pb`) rather than declared as `any[]` or inline literals,
keeping the client layer in sync with proto on every `buf-gen.sh` run.

FR-6. `any` is eliminated from the public surface of all hook return types and request/response
shapes. `unknown` + type guards are permitted internally where a runtime shape cannot be
statically guaranteed (e.g. caught errors).

FR-7. Error handling in client-facing route handlers uses `unknown` instead of `any` in catch
clauses, with a narrow type guard (`instanceof Error`) before accessing `.message`.

FR-8. config-ui's `useEffect` + `fetch` data-loading pattern is migrated to the same typed query
hook pattern as the other two services.

FR-9. All three services follow an identical directory layout and naming convention for the hook
layer, documented in a new `docs/patterns/client-api-pattern.md` pattern file. The pattern file
includes: directory structure, the shared provider/config template, a query-hook example, a
mutation-hook example, and the cache-normalization extension guide.

FR-10. After this feature lands, no component file calls the data-fetching/mutation primitives
directly — all data access goes through the named typed hooks.

## Out of Scope

- **Server-side** Connect-RPC client construction in route handlers — already typed with
  `@xstockstrat/proto`; not revisited here. Only the client→route-handler boundary is in scope.
- SSE/streaming endpoints (`/api/alerts/stream`) — streaming follows a separate pattern.
- Adding new API endpoints or changing backend proto contracts.
- End-to-end (Playwright) tests — unit/type-level coverage is sufficient.
- The `ts-proto` generated stubs (grpc-js client classes) — not used by the frontends.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trader` — remove SWR; add typed query/mutation hooks; eliminate client-side `any`
- `xstockstrat-insights` — same
- `xstockstrat-config-ui` — same; also migrate `useEffect`+`fetch` to the query-hook pattern;
  flat directory structure (no `src/`)

**Build artifact (not a registered service):** `packages/proto/gen/ts` — verify the generated
message types consumed by the hooks are present in the compiled `dist/` output.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/client-api-pattern` (branch from `main-dev`).
Approval gates required (per `docs/runbooks/feature-workflow.md`):
- [x] 1 service owner approval (non-breaking change to three frontend services, no
  proto/migration)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. `tsc --noEmit` passes with zero errors in all three services after the changes.
2. `grep -rn 'swr' src/` (or `./` for config-ui) returns zero hits — SWR fully removed from
   dependencies and call sites.
3. `grep -rn ': any' ` inside hook files returns zero hits; `any` only appears inside internal
   type-guard bodies.
4. No component file calls the data-fetching/mutation primitives directly — all data access goes
   through named hook wrappers.
5. `grep -rn 'catch (err: any)' ` returns zero hits across all three services.
6. Request/response types in hooks and route handlers are imported from `@xstockstrat/proto`
   (`*_pb`) rather than declared inline as `any`.
7. The new `docs/patterns/client-api-pattern.md` documents the directory layout, shared
   provider/config template, hook naming conventions, and a minimal example for each operation
   type (query, mutation, normalization-config extension).
8. All existing UI features (order placement, portfolio view, strategy scoring, config mutation)
   continue to function correctly — no regressions in the Connect-RPC proxying behind the route
   handlers.

## Open Questions

_Left open for the `/sdd-review product-spec` gate — do not resolve inline._

- [ ] **Data-fetching + normalization library choice.** TanStack Query v5 + `@normy/react-query`
  (automatic entity propagation across co-mounted queries) vs. staying on/standardizing SWR with
  manual invalidation, vs. another option? react-query + normy is the suggested default because
  automatic propagation eliminates the manual-invalidation dependency graph as panels multiply,
  but it carries a one-time migration cost. Decide before impl-spec.
- [ ] **Normalization key scope.** Which entities are safe to normalize by a stable domain ID?
  `orderId` and `strategyId` are obvious candidates; `symbol` (positions), `key` (config), and
  `portfolioId` use field names that may be too generic to normalize without cross-entity
  collisions. Confirm the initial whitelist and the extension policy.
- [ ] **Sole mutation pattern.** Is a single mutation-hook primitive used everywhere, or is more
  than one mutation pattern permitted? (Tied to the library choice above.)
- [ ] **Sequencing vs features 045 / 041.** 045 consolidates these three services into one and
  041 upgrades two of them to Next.js 15. Should 044 land before 045 so the consolidated app
  absorbs the finished hook layer (045's own overlap analysis recommends this), and does the
  Next.js 15 upgrade affect the chosen library's provider wiring?
