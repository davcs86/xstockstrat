# Feature: align-frontend-e2e-bff-mocks

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/align-frontend-e2e-bff-mocks`
**Created**: 2026-05-31
**Last Updated**: 2026-06-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-31 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 overlap warnings — advisory only). Mock approach resolved: H2C gRPC via *_ENDPOINT, per-frontend, bounded StreamAlerts. |
| 2026-06-01 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps. |
| 2026-06-01 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done — streamAlerts added to trader mock. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Realign the Next.js frontend Playwright e2e backend mocks (trader, insights, config-ui) with the connect-web → BFF → backend gRPC architecture introduced by `044-client-api-pattern`, so CI validates the unified API pattern end-to-end instead of pointing at endpoint env vars that runtime code no longer reads.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-trader` owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| `xstockstrat-insights` owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| `xstockstrat-config-ui` owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-review align-frontend-e2e-bff-mocks impl-spec` — validate implementation spec, then `/sdd-execute align-frontend-e2e-bff-mocks`
