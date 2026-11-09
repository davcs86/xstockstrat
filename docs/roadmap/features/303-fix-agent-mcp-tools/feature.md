# Feature: fix-agent-mcp-tools

**Type**: bug
**Development Branch**: `feature/fix-agent-mcp-tools`
**Defect Report**: `docs/reports/2026-11-07-agent-mcp-tool-error-details-masked-defect.md` (GitHub Issues disabled; PR #1470)
**Severity**: SEV-3
**Created**: 2026-11-07
**Last Updated**: 2026-11-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-07 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-11-07-agent-mcp-tool-error-details-masked-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-agent-mcp-tools`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Every xstockstrat-agent MCP tool raises `RuntimeError`/`ValueError`/`PermissionError` for anticipated backend refusals; the `mcp` SDK treats those as crashes and returns only `Error executing tool <name>`, so callers never see the gRPC code or message (first seen on `set_config` `FAILED_PRECONDITION`).

## Next Action

`/sdd-spec fix-agent-mcp-tools` — design depth recommended: skip (SEV-3, single service, no proto/migration/config, clear root cause)
