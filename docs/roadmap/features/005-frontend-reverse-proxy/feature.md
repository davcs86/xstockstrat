# Feature: frontend-reverse-proxy

**Lifecycle Status**: `draft`
**Development Branch**: `feature/frontend-reverse-proxy`
**Created**: 2026-05-11
**Last Updated**: 2026-05-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-11 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec frontend-reverse-proxy`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Implement a production-ready nginx reverse proxy that routes all frontend requests from a unified public URL (`/trader`, `/insights`, `/config-ui`) and centralizes authentication, CORS, rate limiting, and security middleware across all three Next.js frontends.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and change types.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service routing architecture, port assignments, single-entry-point design |
| `xstockstrat-trader` service owner | Trading UI routing correctness, Connect-RPC call safety after basePath changes |
| `xstockstrat-insights` service owner | Analytics UI routing correctness, SSE polling through reverse proxy |
| `xstockstrat-config-ui` service owner | Config mutation safety through reverse proxy, environment scope correctness |

## Next Action

`/sdd-review frontend-reverse-proxy product-spec` — AI review of product spec before running `/sdd-spec`
