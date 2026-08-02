# Feature: fix-mcp-config-key-registry

**Type**: bug
**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/fix-mcp-config-key-registry`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-8)
**Severity**: SEV-3
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-8) |
| 2026-08-02 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Single-table (no registry): migration 010 AFTER INSERT audit trigger + mode-exact existence gate + additive `create_key`. AC-3 unset-half reinterpreted (design-gate resolution). |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier (config + agent)
- [Design](design.md) — approved single-table architecture (2-round debate)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-config-key-registry`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Stop set_config from typo-creating orphan keys: cheap agent-side guard using the ListKeys result it already fetches, and a real config key registry so NOT_FOUND is reachable and unset-registered keys are representable.

## Next Action

`/sdd-spec fix-mcp-config-key-registry` — generate the implementation spec from the approved design
