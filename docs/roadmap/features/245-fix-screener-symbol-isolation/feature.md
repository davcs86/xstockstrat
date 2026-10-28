# Feature: fix-screener-symbol-isolation

**Type**: bug
**Development Branch**: `feature/fix-screener-symbol-isolation`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings, 4 notes; overlap PASS) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps; product-spec/acceptance amended per design (AC-1 reworded, FR-4, AC-4, AC-5) |
| 2026-10-28 | `implementation-ready` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Re-spec: Step 5 Codebase Evidence re-anchored agent CI threshold `ci.yml:358-359` → `:368-369` (value still 40); main-dev merged into branch |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Sequential execution started; up-front plan confirmed by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Step 1 done — AC-2 deadline + AC-3 two-symbol validation preservation guards added to `TestScreenSymbols`; green on the unfixed tree |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Step 2 done — `ScreenerEngine` per-symbol isolation (`_eval_symbol_isolated`, `except Exception`), fail-closed `eval_failed` degraded row, `(score_unavailable, eval_failed, -score)` sort, summary WARN/ERROR + `screener.degraded_count` span attribute |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Step 3 done — engine tests: AC-1 outline (3 Examples, 49-run oracle), FR-2 cancel passthrough, soft-only fail-closed, all-failed ERROR, feature-144 sort tie, duplicate symbol, span attribute; RED 8 failed / 1 passed on pre-Step-2 engine → GREEN 29 passed; mutations (a)/(b) recorded |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Step 4 done — agent `screen_symbols` forwards `score_unavailable` (`app/client.py`); docstring lists the key, the three `score_unavailable=true` row kinds and the `min_conviction`/`rank_limit` caveat, false "never reported OK/passed" clause removed (`app/tools.py`) |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Step 5 done — `test_screen_symbols_sends_grpc_call` asserts the `score_unavailable` key on an OK row (`False`) and an un-evaluated BAD row (`True`, `passed=False`) (AC-5) |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Step 6 done — `docs/runbooks/mcp-tools.md` `screen_symbols` parity (C-10): Return JSON gains `"score_unavailable": false`, aside lists the three `score_unavailable=true` row kinds + `min_conviction`/`rank_limit` caveat, Errors table gains the per-symbol evaluation-fault row |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-21). Stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 1, 2, 3 |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity | 4, 5 |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety | 7, 8 |
| none (docs) | — | 6, 9 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 grounded codebase dossier
- [Design](design.md) — approved design (4 rounds, full): chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 9 steps (analysis 1-3, agent 4-6, UI 7-8, docs 9)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ScreenerEngine.screen()` fans out `_eval_symbol` via `asyncio.gather` with no per-symbol isolation, so one
symbol raising a non-`grpc.RpcError` exception fails the whole `ScreenSymbols` RPC as gRPC UNKNOWN.

## Next Action

`/sdd-review fix-screener-symbol-isolation impl-spec` — validate implementation spec, then `/sdd-execute fix-screener-symbol-isolation`
