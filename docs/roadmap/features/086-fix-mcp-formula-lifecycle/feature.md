# Feature: fix-mcp-formula-lifecycle

**Type**: bug
**Lifecycle Status**: `launched`
**Committed to main**: a76237080a282abac145b7f88a6044869132ba5f
**Launched date**: 2026-08-02
**Development Branch**: `feature/fix-mcp-formula-lifecycle`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-2, F-3, F-10 (get_formula/list_formulas))
**Severity**: SEV-2
**Created**: 2026-08-02
**Last Updated**: 2026-08-02
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-2, F-3, F-10 (get_formula/list_formulas)) |
| 2026-08-02 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved with user steer (analysis binding-refusal + backtest run-flagging + UI deleted-handling added to scope); recon.md + design.md written |
| 2026-08-02 | `implementation-ready` → `code-completed` | /sdd-execute | All 13 steps implemented + verified (proto/migration/indicators/analysis/agent/ui/docs); ready for integration PR |
| 2026-08-06 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 4 specs |

| 2026-08-02 | `code-completed` → `launched` | CI workflow | Promoted via PR #844; committed a76237080a282abac145b7f88a6044869132ba5f |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make `manage_formula` safe: partial-merge update (update_mask), declarable `outputs`/`warmup_period`, `get_formula`/`list_formulas` read tools, and honest run-flagged soft-delete. Per user steer, analysis refuses binding a new strategy to a deleted formula and flags a referenced formula's deletion in backtest results; the UI gates edit on a deleted formula and renders the warning.

## Next Action

`/sdd-spec fix-mcp-formula-lifecycle` — generate implementation spec from the approved design
