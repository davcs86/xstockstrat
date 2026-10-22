# Feature: fix-etf-flag-fill

**Type**: bug
**Development Branch**: `feature/fix-etf-flag-fill`
**GitHub Issue**: n/a (Issues disabled) — defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-15
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md` |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings, overlap WARN); scope narrowed to @AC-2/@AC-3, lands after 255 |

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
suspect, the FMP budget boot seed counting non-FMP fundamentals rows, is fixed by
`255-fix-marketdata-fundamentals-cache`; 230 (narrowed 2026-10-22) lands after 255 and adds the
later-call labelling guard plus rate-limited Info-level fill visibility.

## Next Action

`/sdd-design fix-etf-flag-fill` — first design question: the @AC-3 rate-limit key (see context.md)
