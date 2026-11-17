# Feature: fix-analysis-held-position-drains

**Type**: bug
**Development Branch**: `feature/fix-analysis-held-position-drains`
**GitHub Issue**: none — Issues disabled; defect report `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-17
**Last Updated**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md` |
| 2026-11-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections, petitions
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-analysis service owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 2, 3, 4, 5, 6, 7 |

Steps 1, 8 and 9 are `docs` steps (no reviewer).

---

## Summary

Harden the two analysis consumers that page portfolio `ListPositions` (`live_loop._drain_held`, `servicer._drain_held_symbols`): reject a repeated token, make a page-cap hit visible, and stop returning a partial or duplicated held set as success.

## Next Action

`/sdd-review fix-analysis-held-position-drains impl-spec` — validate implementation spec, then `/sdd-execute fix-analysis-held-position-drains`
