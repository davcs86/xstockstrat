# Feature: fix-mcp-formula-lifecycle

**Type**: bug
**Lifecycle Status**: `draft`
**Development Branch**: `feature/fix-mcp-formula-lifecycle`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-2, F-3, F-10 (get_formula/list_formulas))
**Severity**: SEV-2
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-2, F-3, F-10 (get_formula/list_formulas)) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-formula-lifecycle`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make `manage_formula` safe: partial-merge update (update_mask), declarable `outputs`/`warmup_period`, `get_formula`/`list_formulas` read tools, and reference-checked delete.

## Next Action

`/sdd-design fix-mcp-formula-lifecycle` — recommended design depth (full) from triage; see context.md
