# Feature: do-nginx-integration

**Lifecycle Status**: `draft`
**Development Branch**: `feature/do-nginx-integration`
**Created**: 2026-05-12
**Last Updated**: 2026-05-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-12 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec do-nginx-integration`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Wire the nginx reverse proxy (established locally by feature 005-frontend-reverse-proxy) into the DigitalOcean App Platform deployment by updating `.do/app.yaml` and `.do/app.dev.yaml` so that the unified `/trader`, `/insights`, `/config-ui` routing is live in both dev and production environments.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Port uniqueness, service registry consistency, inter-service dependency graph correctness |
| `xstockstrat-trader` service owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| `xstockstrat-insights` service owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| `xstockstrat-config-ui` service owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-review do-nginx-integration product-spec` — AI review of product spec before running /sdd-spec
