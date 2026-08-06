# Feature: fix-mcp-strategy-lifecycle

**Type**: bug
**Lifecycle Status**: `launched`
**Committed to main**: a76237080a282abac145b7f88a6044869132ba5f
**Launched date**: 2026-08-02
**Development Branch**: `feature/fix-mcp-strategy-lifecycle`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-5, F-7)
**Severity**: SEV-2
**Created**: 2026-08-02
**Last Updated**: 2026-08-02
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-5, F-7) |
| 2026-08-06 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(1); pruned 4 specs |

| 2026-08-02 | `code-completed` → `launched` | CI workflow | Promoted via PR #844; committed a76237080a282abac145b7f88a6044869132ba5f |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make strategy lifecycle honest: ALREADY_EXISTS on duplicate register, a reactivate path, and a FAILED_PRECONDITION guard on set_strategy_live for inert (inactive / no-symbols) configs.

## Next Action

`/sdd-design fix-mcp-strategy-lifecycle` — recommended design depth (full) from triage; see context.md
