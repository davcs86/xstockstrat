# Feature: fix-historical-fundamentals-price-join

**Type**: bug
**Development Branch**: `feature/fix-historical-fundamentals-price-join`
**Defect Report**: `docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md` (GitHub Issues disabled on this repo — recorded as a report by `/sdd-qa defect`)
**Severity**: SEV-3
**Created**: 2026-09-27
**Last Updated**: 2026-09-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-27 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md` |
| 2026-09-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory warning; criterion-9 blocker fixed, C-16 + two-lane warnings folded into Design constraints) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-historical-fundamentals-price-join`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Backfilling a symbol's point-in-time fundamentals before its daily OHLCV bars exist leaves every
price-derived metric (`price`, `market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`) permanently
`missing`, because the historical-fundamentals write is insert-only (`ON CONFLICT DO NOTHING`) and the
price-join is a one-shot at insert time — so a re-backfill (even `overwrite=true`) never re-derives it.

## Next Action

`/sdd-design fix-historical-fundamentals-price-join` (full) — recommended design depth from triage
(affected services ≥ 2: cross-service upsert-vs-orchestration-ordering design fork); see context.md
