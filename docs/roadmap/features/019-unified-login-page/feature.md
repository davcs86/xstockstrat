# Feature: unified-login-page

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/unified-login-page`
**Created**: 2026-05-25
**Last Updated**: 2026-06-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-25 | `idea` | manual | Captured as follow-up to 018-agent-mcp-oauth |
| 2026-06-01 | `idea` → `draft` | /sdd-story | Product spec formalized from preliminary idea capture |
| 2026-06-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved. 3 OQs resolved: single platform-wide JWT, separate /auth/oauth-login route for OAuth, identity HTTP server removed (gRPC-only). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec unified-login-page`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replaces the three per-basePath login pages in the consolidated `xstockstrat-ui` (after 045) with a single shared login page at `/auth/login`, redirecting all unauthenticated requests regardless of which basePath they originate from, and adapting identity's OAuth login form (from 018) to use the unified page.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) |
| `xstockstrat-ui` owner (`test`) | Auth middleware correctness, open-redirect protection on `?redirect=`, no direct DB from login routes |
| Security | JWT claims minimal, platform-wide JWT scope, no secrets in config, open-redirect validation |

## Next Action

`/sdd-spec unified-login-page` — generate implementation spec from the approved product spec
