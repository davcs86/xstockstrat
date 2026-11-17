# Feature: fix-portfolio-internal-position

**Type**: bug
**Development Branch**: `feature/fix-portfolio-internal-position`
**GitHub Issue**: none — Issues disabled; defect report `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-17
**Last Updated**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md` |
| 2026-11-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-portfolio-internal-position`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`GetPortfolio`, `GetPnL`, `broadcastSnapshot` and `checkRiskLimits` read one 500-row `ListPositions` page and drop the token; users with more than 500 positions get truncated totals, snapshots and risk checks returned as success.

## Next Action

`/sdd-design fix-portfolio-internal-position quick` — quick design recommended (SEV-2 bug, single service, no proto/DB/config gates; overlap is file-level rebase-only; do not merge before feature 353 is on main-dev)
