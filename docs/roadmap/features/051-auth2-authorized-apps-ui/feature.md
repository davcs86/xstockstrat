# Feature: auth2-authorized-apps-ui

**Lifecycle Status**: `draft`
**Development Branch**: `feature/auth2-authorized-apps-ui`
**Created**: 2026-06-07
**Last Updated**: 2026-06-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-07 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings: UI overlap with 049, 050) |
| 2026-06-07 | `spec-ready` → `draft` | user re-scope | Scope expanded: per-user authorized-app list + revoke (not UI-only); now spans ui + identity + proto + migration. Re-review required. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec auth2-authorized-apps-ui`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a per-user **"My Authorized Apps"** management module (new `/accounts` segment in `xstockstrat-ui`) that lets an operator list, audit, and **revoke** the OAuth apps (e.g. Claude.ai) they've authorized against the xstockstrat MCP agent, plus connect a new one. Extends feature `049-unify-admin-auth-gates`'s identity OAuth backend with additive list/revoke RPCs + a per-user linkage migration (049 shipped no list and no revocation).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI |
| `xstockstrat-identity` (service owner) | JWT/refresh-token handling, API key/token scoping, per-user isolation, no plaintext secrets |
| Proto Reviewer | Additive identity RPCs (ListAuthorizedApps/RevokeAuthorizedApp); field-number uniqueness; `buf breaking` passes |
| DBA | identity migration NNN numbering (after 049's 003), up+down pair, run-order vs 049 |
| Security | Revocation correctness, per-user isolation / IDOR, no token/secret exposure in list responses, refresh-token invalidation semantics |

## Next Action

`/sdd-review auth2-authorized-apps-ui product-spec` — re-review the re-scoped product spec (was spec-ready; reverted to draft after scope expansion)
