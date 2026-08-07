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
| 2026-08-07 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick) and approved; recon.md + design.md written. emit_alert's target_user_id becomes a required broadcast: bool (no default); manage_formula's author + formula_author_user_id both derived from OAuth claims via new shared _require_claims/_caller_user_id helpers. No client.py/proto changes. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description, fix scope, and Consumer Surface(s)
- [Recon](recon.md) — codebase map and target-parameter inventory
- [Design](design.md) — chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-target-user-authz`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`emit_alert` and `manage_formula` accept a caller-supplied user-identity parameter
(`target_user_id`, `formula_author_user_id`, and `author`) instead of deriving the caller's
identity from the verified OAuth claims. Remove all three parameters and tie the affected
calls/permission checks to the OAuth-authenticated caller.

## Next Action

`/sdd-spec fix-mcp-target-user-authz` — generate implementation spec from the approved design
