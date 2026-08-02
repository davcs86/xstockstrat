# Feature: fix-mcp-additive-tools

**Type**: bug
**Lifecycle Status**: `launched`
**Committed to main**: a76237080a282abac145b7f88a6044869132ba5f
**Launched date**: 2026-08-02
**Development Branch**: `feature/fix-mcp-additive-tools`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-10 (test_formula, cancel_backfill, list_strategies, source-health passthrough, emit_alert context/tags/correlation_id))
**Severity**: SEV-2
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-10 (test_formula, cancel_backfill, list_strategies, source-health passthrough, emit_alert context/tags/correlation_id)) |
| 2026-08-02 | `draft` → `code-completed` | /sdd-design+/sdd-execute | Quick design (adversary fixes folded) + all 5 steps implemented; agent-only additive tools |

| 2026-08-02 | `code-completed` → `launched` | CI workflow | Promoted via PR #844; committed a76237080a282abac145b7f88a6044869132ba5f |
---

## Artifacts

- [Product Spec](product-spec.md)
- [Recon](recon.md)
- [Design](design.md)
- [Implementation Spec](implementation-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-additive-tools`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Expose already-built backend capabilities that have no MCP surface — all additive, zero backend change.

## Next Action

`/sdd-design fix-mcp-additive-tools quick` — recommended design depth (quick) from triage; see context.md
