# Product Spec: client-api-pattern

**Created**: 2026-05-28

---

## Problem Statement

All three Next.js frontends already use SWR for client-side data fetching, but each service defines its Connect-RPC service descriptors with `I: {} as any, O: {} as any` placeholders and parses API responses into untyped variables (`any[]`, `order: any`, etc.). This makes API calls invisible to the TypeScript compiler — type errors at the boundary are only caught at runtime, and refactoring proto shapes propagates silently.

## User Story

As a frontend developer, I want every client-side API call to be expressed as a typed SWR hook so that incorrect request shapes and unhandled response fields are caught at compile time, not in production.

## Functional Requirements

FR-1. A shared typed-fetcher module must exist in each frontend service under `src/lib/api/` (or `lib/api/` for config-ui) that defines request and response TypeScript interfaces for every `/api/*` route the service exposes.

FR-2. Every read operation (data displayed in a component) must be wrapped in a named, typed `useSWR` hook (e.g. `useOrders`, `usePortfolio`, `useStrategies`) — components must not call `useSWR` directly with an untyped fetcher.

FR-3. Every write/mutation operation (POST, PATCH, DELETE) must be wrapped using `useSWRMutation` (from `swr/mutation`) with typed `arg` and return generics — components must not call `fetch` directly for mutations.

FR-4. `any` must be eliminated from the public surface of all hook return types and all request/response interfaces. `unknown` + type guards are permitted internally where a runtime shape cannot be statically guaranteed (e.g., caught errors).

FR-5. The `{} as any` placeholders in `connectClients.ts` / `configClient.ts` service descriptors must be replaced with explicit TypeScript interfaces that match the JSON-over-HTTP shapes sent by Connect-RPC route handlers. These interfaces become the canonical source of truth for the client-side type layer (not the generated proto stubs, to keep bundle size unchanged).

FR-6. All three services must follow an identical directory layout and naming convention for the hook layer, documented in a new `docs/patterns/client-api-pattern.md` pattern file.

FR-7. Existing SWR usage (`useSWR` calls directly in component files) must be migrated to the new typed hooks — no new direct `useSWR` calls in component files after this feature lands.

FR-8. Error handling in all route handlers must use `unknown` instead of `any` in catch clauses, with a narrow type guard (`instanceof Error`) before accessing `.message`.

## Out of Scope

- Replacing SWR with react-query or any other library — all three frontends already have SWR; the library choice is locked.
- Importing generated TypeScript proto stubs (`packages/proto/gen/ts/`) into the frontends — generated stubs are intentionally excluded to keep bundle size down and avoid proto-loader coupling.
- SSE/streaming endpoints (`/api/alerts/stream`) — streaming routes follow a separate pattern and are excluded from this feature.
- Server-side route handler logic (Connect-RPC call construction) — only the client→route-handler layer is in scope.
- Adding new API endpoints or changing backend proto contracts.
- End-to-end (Playwright) tests — unit/type-level coverage is sufficient.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trader` — replace untyped SWR fetchers and connect descriptors; add typed hooks
- `xstockstrat-insights` — same
- `xstockstrat-config-ui` — same; also note its flatter directory structure (no `src/`; paths use `./`)

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/client-api-pattern` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking change to three frontend services, no proto/migration)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. `tsc --noEmit` passes with zero errors in all three services after the changes.
2. `grep -rn ': any' src/` (or `./` for config-ui) returns zero hits inside hook files and interface files; only permitted inside internal type-guard bodies.
3. `grep -rn 'useSWR(' src/` in component files (`app/`, `components/`) returns zero hits — all calls go through named hooks.
4. `grep -rn 'catch (err: any)' src/` returns zero hits across all three services.
5. The new `docs/patterns/client-api-pattern.md` pattern file documents the directory layout, naming conventions, and a minimal hook example for each operation type (query, mutation).
6. All existing UI features (order placement, portfolio view, strategy scoring, config mutation) continue to function correctly — no regressions in Connect-RPC proxying.

## Open Questions

- [ ] Should `useSWRMutation` be the sole mutation pattern, or is a lightweight typed `useFetch` wrapper acceptable for one-shot fire-and-forget calls (e.g., cancel order)? (Recommendation: use `useSWRMutation` everywhere for consistency — it provides loading/error state for free.)
- [ ] Should the typed interfaces live in a shared package (`packages/api-types/`) or remain local to each service? (Recommendation: keep them local for now — the three services call different backends with different shapes; sharing would only add coupling without reducing duplication meaningfully.)
