# Feature: fix-mcp-server-input-validation

**Type**: bug
**Lifecycle Status**: `draft`
**Development Branch**: `feature/fix-mcp-server-input-validation`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-9 (code), F-10 (notify field validation))
**Severity**: SEV-3
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-9 (code), F-10 (notify field validation)) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-server-input-validation`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).

## Next Action

`/sdd-design fix-mcp-server-input-validation quick` — recommended design depth (quick) from triage; see context.md
