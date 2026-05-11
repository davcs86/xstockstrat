# Feature: frontend-reverse-proxy

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/frontend-reverse-proxy`
**Created**: 2026-05-11
**Last Updated**: 2026-05-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-11 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |

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

`/sdd-review frontend-reverse-proxy impl-spec` — validate implementation spec, then `/sdd-execute frontend-reverse-proxy` to begin execution
