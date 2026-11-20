# Feature: fix-analysis-evidence-dry

**Type**: bug
**Development Branch**: `feature/fix-analysis-evidence-dry`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md, docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-analysis service owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 |

Step 15 is a `docs` step (no reviewer).

---

## Summary

Two analysis single-source-of-truth gaps: the evidence-eligibility fingerprint ignores the content of referenced custom formulas (stale evidence keeps feeding the grade), and the boot entry-backfill re-types the live-enabled gate SQL instead of using `LIVE_ENABLED_PREDICATE_SQL`.

## Next Action

`/sdd-review fix-analysis-evidence-dry impl-spec` — validate implementation spec, then `/sdd-execute fix-analysis-evidence-dry`
