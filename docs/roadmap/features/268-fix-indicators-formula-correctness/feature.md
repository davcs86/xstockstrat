# Feature: fix-indicators-formula-correctness

**Type**: bug
**Development Branch**: `feature/fix-indicators-formula-correctness`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-indicators-formula-correctness-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-indicators-formula-correctness-defect.md` (debt-radar D-10, D-18, D-54) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. OQ-1 = Option A; @option-B AC-8/AC-9 deleted |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps |
| 2026-10-28 | `implementation-ready` (no change) | /sdd-execute sequential (sdd-batch-execute) | Re-spec: steps 2, 3, 7, 10 aligned with current codebase after merging origin/main-dev (line drift only; no file or symbol missing) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front plan confirmed by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-28 | `in-progress` (Step 1 done) | /sdd-execute sequential (sdd-batch-execute) | D-54 guard: pending-hidden rows → NOT_FOUND on UpdateFormula/DeleteFormula |
| 2026-10-28 | `in-progress` (Step 2 done) | /sdd-execute sequential (sdd-batch-execute) | D-54 guard-branch tests (`TestPendingHiddenMutation`, AC-6/AC-7) |
| 2026-10-28 | `in-progress` (Step 3 done) | /sdd-execute sequential (sdd-batch-execute) | D-10: a sandbox run with no parseable `__OUTPUT__:` line fails (`runtime_error`) |
| 2026-10-29 | `in-progress` (Step 4 done) | /sdd-execute sequential (sdd-batch-execute) | D-10 tests: `TestSandboxNoOutputFails` (AC-1/AC-2/AC-3) + servicer RUNTIME_ERROR mapping |
| 2026-10-29 | `in-progress` (re-spec steps 5, 6) | /sdd-execute sequential (sdd-batch-execute) | Merged `origin/main-dev` (`-X ours`); steps 5, 6 aligned with the current codebase (line drift only) |
| 2026-10-29 | `in-progress` (Step 5 done) | /sdd-execute sequential (sdd-batch-execute) | D-18 Option A: honest ATR/VWAP descriptions in `INDICATOR_REGISTRY` and docstrings; math unchanged |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22). Docs steps 9-10 have no reviewer.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution | 1, 2, 3, 4, 5, 6 |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety | 7, 8 |

`xstockstrat-analysis` and `packages/proto` are consumers whose code does not change under Option A, so no step assigns them a reviewer.

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 grounded codebase dossier
- [Design](design.md) — approved design (D-54 → D-10 → D-18 Option A → docs), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The formula sandbox reports `success=True, output={}` when a formula exits via `SystemExit` or emits an
unparseable output line (D-10); `ATR`/`VWAP` compute close-only approximations under the real indicators'
names (D-18); and `UpdateFormula`/`DeleteFormula` act on pending-hidden saga copies (D-54).

## Next Action

`/sdd-execute fix-indicators-formula-correctness sequential` — continue at Step 6
