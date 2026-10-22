# Feature: fix-etf-flag-fill

**Type**: bug
**Development Branch**: `feature/fix-etf-flag-fill`
**GitHub Issue**: n/a (Issues disabled) — defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-15
**Last Updated**: 2026-10-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-etf-flag-fill`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The background ETF-flag fill in xstockstrat-marketdata never labels SCHD on staging, so feature 215's
`fundamentals_gap` stays `FUNDAMENTALS_GAP_UNSPECIFIED`. Nothing at Info level shows why. The prime
suspect is the FMP budget boot seed, which counts non-FMP fundamentals rows.

## Next Action

`/sdd-design fix-etf-flag-fill quick` — recommended design depth from triage; see context.md
