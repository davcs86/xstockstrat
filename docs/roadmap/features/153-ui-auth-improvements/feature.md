# Feature: ui-auth-improvements

**Development Branch**: `feature/ui-auth-improvements`
**Created**: 2026-08-25
**Last Updated**: 2026-08-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-25 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ui-auth-improvements`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Two `xstockstrat-ui` auth UX improvements: (1) a "remember me" control on the login form that
persists the session across browser restarts (extended session), and (2) an automatic redirect to
the login page whenever a browser data call returns Unauthorized (401 / gRPC `Unauthenticated`).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` owner | Connect-RPC call safety, auth cookie handling, no secret values rendered in UI |

## Next Action

`/sdd-review ui-auth-improvements product-spec` — AI review of product spec before running /sdd-spec
