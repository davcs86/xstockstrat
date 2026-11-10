# Feature: fix-agent-mcp-transport-fallthrough

**Type**: bug
**Development Branch**: `feature/fix-agent-mcp-transport-fallthrough`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage); converted from Track B to Track C by operator decision |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-agent-mcp-transport-fallthrough`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

With `MCP_TRANSPORT` unset or mistyped (e.g. `htp`), the agent silently starts the stdio transport — nothing listens on :9000 and no DO health check notices. The agent must fail closed in code instead of falling through to stdio.

## Next Action

`/sdd-design fix-agent-mcp-transport-fallthrough quick` — quick design recommended (single service, no proto/migration; operator decisions recorded)
