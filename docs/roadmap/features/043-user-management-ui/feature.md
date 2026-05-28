# Feature: user-management-ui

**Lifecycle Status**: `draft`
**Development Branch**: `feature/user-management-ui`
**Created**: 2026-05-28
**Last Updated**: 2026-05-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-28 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec user-management-ui`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a user management section to `xstockstrat-config-ui` backed by new admin RPCs on `xstockstrat-identity`, allowing administrators to create users, update passwords, assign roles, and deactivate accounts.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk |
| xstockstrat-identity owner | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) |
| xstockstrat-config-ui owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-review user-management-ui product-spec` — AI review of product spec before running /sdd-spec
