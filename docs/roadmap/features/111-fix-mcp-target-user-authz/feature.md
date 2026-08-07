# Feature: fix-mcp-target-user-authz

**Type**: bug
**Lifecycle Status**: `draft`
**Development Branch**: `feature/fix-mcp-target-user-authz`
**Source Report**: docs/reports/2026-08-07-mcp-target-user-authz.md
**Severity**: SEV-2
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from docs/reports/2026-08-07-mcp-target-user-authz.md |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-target-user-authz`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`emit_alert` and `manage_formula` accept a caller-supplied user-identity parameter
(`target_user_id`, `formula_author_user_id`) instead of deriving the caller's identity from the
verified OAuth claims. Remove both parameters and tie the affected calls/permission checks to the
OAuth-authenticated caller.

## Next Action

`/sdd-design fix-mcp-target-user-authz quick` — recommended design depth from triage; see context.md
