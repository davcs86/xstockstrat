# Feature: fix-mcp-config-key-registry

**Type**: bug
**Lifecycle Status**: `draft`
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

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-config-key-registry`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Stop set_config from typo-creating orphan keys: cheap agent-side guard using the ListKeys result it already fetches, and a real config key registry so NOT_FOUND is reachable and unset-registered keys are representable.

## Next Action

`/sdd-design fix-mcp-config-key-registry` — recommended design depth (full) from triage; see context.md
