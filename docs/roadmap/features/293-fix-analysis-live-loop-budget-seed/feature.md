# Feature: fix-analysis-live-loop-budget-seed

**Type**: bug
**Development Branch**: `feature/fix-analysis-live-loop-budget-seed`
**Defect report**: `docs/reports/2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-3
**Created**: 2026-11-04
**Last Updated**: 2026-11-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Durable follow-up to the Track B config write (operator asked for both) |
| 2026-11-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved after revision (first pass FAIL: 5 blockers; second pass PASS WITH WARNINGS, 7 warnings all addressed) |
| 2026-11-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written. Scope additions (operator-approved): second key `eval_interval_seconds`, bounds `[1,1000]` / `[30,600]`, two-PR split, soft renumber-at-merge ordering; product-spec/acceptance amended (AC-10..12) |
| 2026-11-05 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps (PR-1: steps 1-2; PR-2: steps 3-7) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier + business rules (C-16)
- [Design](design.md) — debated, user-approved architecture
- [Implementation Spec](implementation-spec.md) — 7 steps, two PR groups (latch; seed + bounds)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Reviewer | Focus |
|---|---|
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| xstockstrat-config owner | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh` |

---

## Summary

`analysis.engine.max_strategies_per_cycle` is read by the live loop but never registered or seeded, so it only exists where an operator ran `SetConfig create_key=true` (staging, 2026-11-04, value 200); and a fleet permanently above the budget WARNs on every cycle.

## Next Action

`/sdd-review fix-analysis-live-loop-budget-seed impl-spec` — validate implementation spec, then `/sdd-execute fix-analysis-live-loop-budget-seed`
