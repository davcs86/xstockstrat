# Feature: fix-mcp-signal-source-verbs

**Type**: bug
**Lifecycle Status**: `launched`
**Committed to main**: a76237080a282abac145b7f88a6044869132ba5f
**Launched date**: 2026-08-02
**Development Branch**: `feature/fix-mcp-signal-source-verbs`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-6)
**Severity**: SEV-2
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-6) |
| 2026-08-02 | `draft` → `design-approved` | /sdd-design | 2-round debate; scope expanded to include config-ui per 086 precedent (fix every caller); recon.md + design.md written |

| 2026-08-02 | `code-completed` → `launched` | CI workflow | Promoted via PR #844; committed a76237080a282abac145b7f88a6044869132ba5f |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-signal-source-verbs`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Split `manage_signal_source` register/update/deactivate into honest verbs (field-mask merge, no forced reactivation, no silent credentials_ref wipe) and close the mediated_authenticated_website credential gap.

## Next Action

`/sdd-spec fix-mcp-signal-source-verbs` — generate implementation spec from the approved design
