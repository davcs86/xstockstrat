# Feature: wire-fe-auth

**Lifecycle Status**: `draft`
**Development Branch**: `feature/wire-fe-auth`
**Created**: 2026-05-18
**Last Updated**: 2026-05-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-18 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec wire-fe-auth`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) |
| `xstockstrat-trader` owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| `xstockstrat-insights` owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| `xstockstrat-config-ui` owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |

## Next Action

`/sdd-review wire-fe-auth product-spec` — AI review of product spec before running /sdd-spec
