# Feature: frontend-reverse-proxy

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/frontend-reverse-proxy`
**Created**: 2026-05-11
**Last Updated**: 2026-05-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-11 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |
| 2026-05-11 | `implementation-ready` (unchanged) | /sdd-review | Impl-spec review PASS — all 6 steps PASS quality checks, valid DAG, 3 WARN overlaps (advisory) |
| 2026-05-11 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 (nginx.conf) complete — verification deferred to Step 6 (env limitation) |
| 2026-05-12 | `implementation-ready` (refreshed) | /sdd-spec | Implementation spec regenerated with refreshed line-number evidence (docker-compose.yml frontend blocks shifted: trader L391, insights L416, config-ui L443); 6 steps unchanged in shape |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 6 steps, all with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Implement a production-ready nginx reverse proxy that routes all frontend requests from a unified public URL (`/trader`, `/insights`, `/config-ui`) and centralizes authentication, CORS, rate limiting, and security middleware across all three Next.js frontends.

## Reviewers

Snapshot from docs/runbooks/reviewer-registry.md, fixed at implementation-ready. See implementation-spec.md for per-step reviewers.

| Role | Review Focus |
|---|---|
| Platform Lead | Port uniqueness, service registry consistency, inter-service dependency graph correctness |
| `xstockstrat-trader` service owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| `xstockstrat-insights` service owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| `xstockstrat-config-ui` service owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-review frontend-reverse-proxy impl-spec` — validate refreshed implementation spec, then `/sdd-execute frontend-reverse-proxy`
