# Feature: auth2-authorized-apps-ui

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/auth2-authorized-apps-ui`
**Created**: 2026-06-07
**Last Updated**: 2026-06-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-07 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings: UI overlap with 049, 050) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec auth2-authorized-apps-ui`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add an "Authorized Apps" UI module to `xstockstrat-ui` that surfaces a one-click button (and copyable URL) for connecting Claude.ai to the xstockstrat MCP agent via the OAuth 2.1 flow delivered by feature `049-unify-admin-auth-gates` (Part B, which supersedes feature `018-agent-mcp-oauth`).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI |
| Security | OAuth scope correctness, no secrets in UI/config, redirect URI / connect-URL construction safety |

## Next Action

`/sdd-spec auth2-authorized-apps-ui` — generate implementation spec from the approved product spec
