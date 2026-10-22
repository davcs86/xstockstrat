# Feature: fix-backtest-silent-symbol-skip

**Type**: bug
**Development Branch**: `feature/fix-backtest-silent-symbol-skip`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-15-backtest-silent-symbol-skip-reports-ok-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-22
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-22 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-15-backtest-silent-symbol-skip-reports-ok-defect.md` (recorded during feature 215 staging verification) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-22). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | TBD (/sdd-spec) — `RunBacktest` per-symbol catch-alls + status gate (`app/handlers/servicer.py`), tests |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement | Read-only: `ExecuteFormula` PERMISSION_DENIED vs NOT_FOUND semantics the analysis mapping relies on |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity | `run_backtest` result/docstring parity if the surfaced reason or warnings change; strat-lab `backtest` skill update in the same PR |
| Proto Reviewer | Field number uniqueness, backward compatibility, `buf lint`/`buf breaking` | Conditional — only if design adds a `NoTradeReason` value |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-backtest-silent-symbol-skip`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`RunBacktest` drops a symbol that fails with a `grpc.RpcError` or an unexpected exception without a diagnostics row,
warning or gate counter, so a run in which no symbol was evaluated reports `BACKTEST_STATUS_OK` with empty
diagnostics and is scored and persisted as a success. On staging this hid a PERMISSION_DENIED from indicators
`ExecuteFormula` for formulas whose `author` is a legacy username.

## Next Action

`/sdd-design fix-backtest-silent-symbol-skip` — recommended design depth: full (the report raises a possible
`NoTradeReason` proto addition — the C-0 full trigger; the operator may downgrade to quick if the design reuses an
existing reason plus a warning); see context.md
