# Feature: fix-analysis-backtest-bounds

**Type**: bug
**Development Branch**: `feature/fix-analysis-backtest-bounds`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-analysis-backtest-bounds-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-analysis-backtest-bounds-defect.md` (debt-radar D-28, D-29) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN, no FAIL) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Operator gate approval: D-28 option (a) + new AC-7; I-2 owned by 273 (merge 273 before 272) |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps; @AC-5..7 added to acceptance.feature |
| 2026-10-29 | `implementation-ready` (re-spec, no transition) | /sdd-execute sequential (sdd-batch-execute) | Re-spec of steps 1,3,4,5,6,7,8,9 against main-dev @ merge b8b8bac2: line drift; Step 5 post-244 getters; Step 6 reuses `snapshot_watcher`; Step 9 dotted-key premise corrected, operator decision required before G-1 |
| 2026-10-29 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front confirmation by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f, 2026-10-28/29); checkpoints `report`; C-16 promotion auto-confirmed unless it changes an existing @AC rule |
| 2026-10-29 | `in-progress` (no transition) | /sdd-execute sequential (sdd-batch-execute) | Steps 1+2 done in one commit (standing operator rule): D-28 two-token re-serve guard in `_fetch_bars_paged`; pager tests AC-1/2/4/7; full suite 1455 passed |
| 2026-10-29 | `in-progress` (re-spec, no transition) | /sdd-execute sequential (sdd-batch-execute) | Re-spec of steps 3-9 after merging origin/main-dev (e266b4ae): line drift in steps 4/5/6; Step 6 harness audit adds `test_config_zero_clamps.py:161`; steps 3/7/8/9 re-verified unchanged |
| 2026-10-29 | `in-progress` (no transition) | /sdd-execute sequential (sdd-batch-execute) | Steps 3+4 done in one commit (standing operator rule): `RunBacktest` → thin `@owner_scoped` wrapper over `_run_backtest`; `_BarFetchError` → FAILED_PRECONDITION `backtest bar series incomplete: …` (symbol + benchmark); AC-6 tests; full suite 1468 passed |
| 2026-10-29 | `in-progress` (no transition) | /sdd-execute sequential (sdd-batch-execute) | Steps 5+6 done in one commit (standing operator rule, widened): D-29 wall-clock bound — `asyncio.timeout(limit or None)` on `RunBacktest`, `cm.expired()` → DEADLINE_EXCEEDED `backtest exceeded Ns deadline`, `disarm()` before persistence; 0 = no limit, negative = 300 + WARN; AC-3/AC-5/T-inner-timeout/T-commit/T-executor tests; key registered in `HONOUR_KEYS`; full suite 1475 passed |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 1, 2, 3, 4, 5, 6, 9 |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping | 9 (G-1 — any prod-value change goes through `set_config`/config-ui, no migration) |

Docs steps 7–8 carry no reviewer per the governance matrix. No migration (no DBA) and no agent code (the agent
pass-through I-2 is owned by feature 273).

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`_fetch_bars_paged` silently returns only the first page when marketdata re-serves a page, against its own documented
contract, so backtests run on a truncated window. `analysis.backtest.max_duration_seconds` is seeded and documented
but nothing reads it.

## Next Action

`/sdd-review fix-analysis-backtest-bounds impl-spec` — validate implementation spec, then `/sdd-execute fix-analysis-backtest-bounds`. Merge order: 273 (fix-agent-client-deadlines) before 272.
