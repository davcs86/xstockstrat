# Feature: client-api-pattern

**Lifecycle Status**: `draft`
**Development Branch**: `feature/client-api-pattern`
**Created**: 2026-05-28
**Last Updated**: 2026-05-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-28 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec client-api-pattern`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Standardise client-side API calls across all three Next.js frontends (xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui) by replacing manual `{} as any` service-descriptor placeholders and untyped SWR fetchers with a shared, heavily-typed SWR-based hook layer that eliminates `any` from request/response boundaries.

## Reviewers

_(Snapshot from docs/runbooks/reviewer-registry.md — re-run /sdd-spec if registry changes.)_

| Role | Review Focus |
|---|---|
| xstockstrat-trader service owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| xstockstrat-insights service owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| xstockstrat-config-ui service owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-review client-api-pattern product-spec` — AI review of product spec before running /sdd-spec
