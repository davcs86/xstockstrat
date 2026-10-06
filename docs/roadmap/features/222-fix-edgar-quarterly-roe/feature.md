# Feature: fix-edgar-quarterly-roe

**Type**: bug
**Development Branch**: `feature/fix-edgar-quarterly-roe`
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-10-06-edgar-quarterly-roe-not-annualized-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-06
**Last Updated**: 2026-10-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-06 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-06-edgar-quarterly-roe-not-annualized-defect.md` |
| 2026-10-06 | `draft` → `implementation-ready` → `in-progress` → `code-completed` | /sdd-spec + /sdd-execute sequential | quarterly ROE on a TTM basis (annualize-available fallback) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — steps + deviation log
- [Design](design.md) — operator decisions + approach
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

EDGAR quarterly periods carry a single-quarter ROE (≈¼ of the annual figure) while P/E on the same
row is TTM, depressing every quarterly-derived fundamentals score — live and in point-in-time
backtests — and flipping AXP-class names below the `fundamentals_macd_blend` entry gate.

## Next Action

Merge the integration PR into `main-dev` before 223; then run the single re-backfill described in 223.
