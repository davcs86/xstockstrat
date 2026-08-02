# Feature: fix-mcp-formula-lifecycle

**Type**: bug
**Lifecycle Status**: `code-completed`
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
| 2026-08-02 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved with user steer (analysis binding-refusal + backtest run-flagging + UI deleted-handling added to scope); recon.md + design.md written |
| 2026-08-02 | `implementation-ready` → `code-completed` | /sdd-execute | All 13 steps implemented + verified (proto/migration/indicators/analysis/agent/ui/docs); ready for integration PR |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier (indicators, agent, analysis, ui)
- [Design](design.md) — approved architecture (2-round debate + user steer)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-formula-lifecycle`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make `manage_formula` safe: partial-merge update (update_mask), declarable `outputs`/`warmup_period`, `get_formula`/`list_formulas` read tools, and honest run-flagged soft-delete. Per user steer, analysis refuses binding a new strategy to a deleted formula and flags a referenced formula's deletion in backtest results; the UI gates edit on a deleted formula and renders the warning.

## Next Action

`/sdd-spec fix-mcp-formula-lifecycle` — generate implementation spec from the approved design
