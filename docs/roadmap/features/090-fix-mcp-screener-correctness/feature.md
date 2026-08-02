# Feature: fix-mcp-screener-correctness

**Type**: bug
**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/fix-mcp-screener-correctness`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-4)
**Severity**: SEV-3
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-4) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-screener-correctness`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make screen_symbols honest: map ScreenCriterion.component so technical kinds work, implement (or remove) min_conviction, error on unknown metric names, compute coverage_gaps before rank truncation, and pass gap detail through.

## Next Action

`/sdd-design fix-mcp-screener-correctness` — recommended design depth (full) from triage; see context.md
