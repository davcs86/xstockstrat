# Feature: frontend-reverse-proxy

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/frontend-reverse-proxy`
**Created**: 2026-05-11
**Last Updated**: 2026-05-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-11 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |
| 2026-05-11 | `implementation-ready` (unchanged) | /sdd-review | Impl-spec review PASS — all 6 steps PASS quality checks, valid DAG, 3 WARN overlaps (advisory) |
| 2026-05-11 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 (nginx.conf) complete — verification deferred to Step 6 (env limitation) |

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
| Platform Lead | Cross-service routing architecture, port assignments, single-entry-point design |
| `xstockstrat-trader` service owner | Trading UI routing correctness, Connect-RPC call safety after basePath changes |
| `xstockstrat-insights` service owner | Analytics UI routing correctness, SSE polling through reverse proxy |
| `xstockstrat-config-ui` service owner | Config mutation safety through reverse proxy, environment scope correctness |

## Next Action

`/sdd-execute frontend-reverse-proxy` — begin step-by-step execution (impl-spec review passed)
