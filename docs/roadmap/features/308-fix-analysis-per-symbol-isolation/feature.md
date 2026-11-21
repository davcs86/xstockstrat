# Feature: fix-analysis-per-symbol-isolation

**Type**: bug
**Development Branch**: `feature/fix-analysis-per-symbol-isolation`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md`, `docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md`, `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps |
| 2026-11-21 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); steps 2 and 16 re-specced against `985d694c` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 17 steps (analysis, indicators, UI)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

_Snapshot finalized by /sdd-spec on 2026-11-20 from the per-step **Reviewers**. Re-run /sdd-spec if the registry changes._

| Role | Review Focus |
|---|---|
| Service owner `xstockstrat-analysis` | Backtest reproducibility, strategy scoring determinism, no look-ahead bias (steps 1-2, 5-14) |
| Service owner `xstockstrat-indicators` | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution (steps 3-4) |
| Service owner `xstockstrat-ui` | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access except audit log (steps 15-16) |
| none | Step 17 (docs) |

---

## Summary

One failing symbol or candidate aborts a whole xstockstrat-analysis per-symbol fan-out (opportunities
compute, `EvaluateReadiness`, readiness kick / materializer / opportunity heal), losing every healthy
sibling's rows instead of degrading only the failing one.

## Next Action

`/sdd-review fix-analysis-per-symbol-isolation impl-spec` — validate implementation spec, then `/sdd-execute fix-analysis-per-symbol-isolation`
