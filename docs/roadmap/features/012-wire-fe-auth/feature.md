# Feature: wire-fe-auth

**Lifecycle Status**: `launched`
**Development Branch**: `feature/wire-fe-auth`
**Committed to main**: fb84473
**Launched date**: 2026-05-19
**Created**: 2026-05-18
**Last Updated**: 2026-05-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-18 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-18 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-05-18 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-05-18 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 complete — jose added to all three frontends |
| 2026-05-19 | `in-progress` → `code-completed` | /sdd-execute | Step 16 complete — all 16 steps done, all 10 backend service test suites pass |
| 2026-05-19 | `code-completed` → `launched` | /promote | Promoted to production via PR #250 (commit fb84473) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 16 steps, updated 2026-05-18
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

## Reviewers

_(Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trader` owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| `xstockstrat-insights` owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| `xstockstrat-config-ui` owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |

## Next Action

Feature is live in production.
