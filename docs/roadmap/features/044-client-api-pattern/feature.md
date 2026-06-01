# Feature: client-api-pattern

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/client-api-pattern`
**Created**: 2026-05-28
**Last Updated**: 2026-06-01
---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-28 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-28 | `draft` → `spec-ready` | /sdd-review | Product spec approved (11 overlap warnings — advisory only) |
| 2026-05-30 | `spec-ready` → `draft` | /sdd-story | Product spec regenerated fresh; server-side typing now done, scope narrowed to client layer; library question re-opened for review |
| 2026-06-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 overlap warnings — advisory only). Library stack resolved: connect-query-es + TanStack Query v5 + normy. |
| 2026-06-01 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps. |
| 2026-06-01 | `implementation-ready` → `code-completed` | /sdd-execute | All 11 steps done — SWR replaced, hooks created, any eliminated, CLAUDE.md and pattern doc updated. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Standardise the **client-side** API layer across all three Next.js frontends (xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui): replace SWR with a single typed data-fetching + cache-normalization stack (library choice deferred to review), wrap every read and write in named typed hooks backed by generated `@xstockstrat/proto` types, and eliminate `any` from request/response boundaries. The server-side Connect-RPC clients are already typed with `@xstockstrat/proto`, so this feature is scoped to the client→route-handler boundary only.

## Reviewers

_(Snapshot from docs/runbooks/reviewer-registry.md — re-run /sdd-spec if registry changes.)_

| Role | Review Focus |
|---|---|
| xstockstrat-trader service owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| xstockstrat-insights service owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| xstockstrat-config-ui service owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

_(Finalized by /sdd-spec 2026-06-01. Covers all distinct reviewers across 11 steps.)_

## Next Action

Open integration PR: `feature/client-api-pattern` → `main-dev`
