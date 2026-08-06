# Feature: fix-mcp-screener-correctness

**Type**: bug
**Lifecycle Status**: `launched`
**Committed to main**: a76237080a282abac145b7f88a6044869132ba5f
**Launched date**: 2026-08-02
**Development Branch**: `feature/fix-mcp-screener-correctness`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-4)
**Severity**: SEV-3
**Created**: 2026-08-02
**Last Updated**: 2026-08-02
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-4) |
| 2026-08-06 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 3 specs |

| 2026-08-02 | `code-completed` → `launched` | CI workflow | Promoted via PR #844; committed a76237080a282abac145b7f88a6044869132ba5f |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make screen_symbols honest: map ScreenCriterion.component so technical kinds work, implement (or remove) min_conviction, error on unknown metric names, compute coverage_gaps before rank truncation, and pass gap detail through.

## Next Action

`/sdd-design fix-mcp-screener-correctness` — recommended design depth (full) from triage; see context.md
