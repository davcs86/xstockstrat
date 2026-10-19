# Feature: fix-after-hours-positions-priced

**Type**: bug
**Development Branch**: `feature/fix-after-hours-positions-priced` (triage committed on harness branch `ccr-9f55a8ac-dtw4iv`; see context.md)
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-19
**Last Updated**: 2026-10-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-19 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md` |
| 2026-10-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved (8 warnings, carried to design) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated; run `/sdd-spec fix-after-hours-positions-priced`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

After the market close, a one-sided IEX quote (one of ask or bid is 0) is averaged as `(ask + bid) / 2`, so
quote-priced positions, persisted equity snapshots, risk valuation and the fundamentals price overlay
read at about half the real price.

## Next Action

`/sdd-design fix-after-hours-positions-priced` — full design recommended: 2 affected services; see context.md
