# Feature: fix-analysis-backtest-bounds

**Type**: bug
**Development Branch**: `feature/fix-analysis-backtest-bounds`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-analysis-backtest-bounds-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-analysis-backtest-bounds-defect.md` (debt-radar D-28, D-29) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN, no FAIL) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Operator gate approval: D-28 option (a) + new AC-7; I-2 owned by 273 (merge 273 before 272) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | TBD (/sdd-spec) — `_fetch_bars_paged` (D-28), `RunBacktest` deadline (D-29) |
| `xstockstrat-config` owner | Config key naming, environment scoping | D-29 — wire the seeded key, or retire it via a config migration |
| DBA | Migration numbering, up+down pair, run-order compliance | Only if D-29 retires the key with a new `services/xstockstrat-config/migrations/` file |
| `xstockstrat-agent` owner | MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity | Only if a new `DEADLINE_EXCEEDED` / truncation error changes what `run_backtest` reports (the `strat-lab` `backtest` skill must then be updated in the same PR) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-analysis-backtest-bounds`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`_fetch_bars_paged` silently returns only the first page when marketdata re-serves a page, against its own documented
contract, so backtests run on a truncated window. `analysis.backtest.max_duration_seconds` is seeded and documented
but nothing reads it.

## Next Action

`/sdd-spec fix-analysis-backtest-bounds` — generate implementation spec from the approved design. Add @AC-5..7 to acceptance.feature and pin merge order 273 before 272 first (see design.md § Open Risks).
