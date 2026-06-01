# Feature: align-frontend-e2e-bff-mocks

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/align-frontend-e2e-bff-mocks`
**Created**: 2026-05-31
**Last Updated**: 2026-06-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-31 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 overlap warnings — advisory only). Mock approach resolved: H2C gRPC via *_ENDPOINT, per-frontend, bounded StreamAlerts. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec align-frontend-e2e-bff-mocks`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Realign the Next.js frontend Playwright e2e backend mocks (trader, insights, config-ui) with the connect-web → BFF → backend gRPC architecture introduced by `044-client-api-pattern`, so CI validates the unified API pattern end-to-end instead of pointing at endpoint env vars that runtime code no longer reads.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trader` owner (`test`) | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| `xstockstrat-insights` owner (`test`) | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| `xstockstrat-config-ui` owner (`test`) | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-spec align-frontend-e2e-bff-mocks` — generate implementation spec from the approved product spec
