# Feature: fix-mcp-extract-credentials

**Type**: bug
**Lifecycle Status**: `draft`
**Development Branch**: `feature/fix-mcp-extract-credentials`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-1)
**Severity**: SEV-2
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-1) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-extract-credentials`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Give extract-tool credentials one owner: interim env/namespace-scoped, non-swallowing config read; radical — ingest resolves its own credentials_ref via a ResolveSourceCredential RPC (or server-side extraction), deleting the agent's dev-scoped plaintext-key path.

## Next Action

`/sdd-design fix-mcp-extract-credentials` — recommended design depth (full) from triage; see context.md
