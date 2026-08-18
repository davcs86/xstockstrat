# Feature: ui-middleware-nodejs-runtime

**Development Branch**: `feature/ui-middleware-nodejs-runtime`
**Created**: 2026-08-11
**Last Updated**: 2026-08-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-11 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ui-middleware-nodejs-runtime`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Move `xstockstrat-ui`'s `src/middleware.ts` from the Edge runtime to the Node.js runtime (stable
since Next.js 15.5) and have it call `xstockstrat-identity`'s `refreshSession()` directly, removing
the self-referential HTTP loopback to `/api/auth/refresh` landed as a hotfix in PR #925.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |

## Next Action

`/sdd-review ui-middleware-nodejs-runtime product-spec` — AI review of product spec before running /sdd-spec
