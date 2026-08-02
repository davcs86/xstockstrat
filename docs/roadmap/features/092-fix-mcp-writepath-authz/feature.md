# Feature: fix-mcp-writepath-authz

**Type**: bug
**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/fix-mcp-writepath-authz`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-11)
**Severity**: SEV-2
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-11) |
| 2026-08-02 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. ingest gate TriggerBackfill; notify EmitAlert = explicit internal-service-caller contract (no gate, adversary-ruled); agent flips 4 hardcoded-admin tools to caller-derived scope + deletes `_admin_metadata()`. Non-admins lose these tools (intended). |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier (ingest + notify + agent)
- [Design](design.md) — approved 4-step architecture (2-round debate)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-writepath-authz`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Close the authorization gap on write paths: gate TriggerBackfill server-side (it spends provider quota ungated), decide EmitAlert gating, and extend the feature-073 caller-derived-scope pattern to the remaining write tools instead of the unverified hardcoded admin scope.

## Next Action

`/sdd-spec fix-mcp-writepath-authz` — generate the implementation spec from the approved design
