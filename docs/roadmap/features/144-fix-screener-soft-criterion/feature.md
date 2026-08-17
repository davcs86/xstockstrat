# Feature: fix-screener-soft-criterion

**Type**: bug
**Development Branch**: `feature/fix-screener-soft-criterion`
**Defect Report**: `docs/reports/2026-08-17-screener-missing-data-neutral-score-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-17
**Last Updated**: 2026-08-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-08-17-screener-missing-data-neutral-score-defect.md` (GitHub Issues disabled on this repo) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-screener-soft-criterion`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The screener's soft/weighted-criterion scoring (`ScreenerEngine._build_result`,
`services/xstockstrat-analysis/app/services/screener.py:474`) falls back to a hardcoded neutral
`0.5` `technical_score` whenever a candidate has zero usable data for every configured soft
criterion (e.g. an ETF with no P/E ratio scanned against a `pe_ratio` weighted criterion) —
indistinguishable from a genuinely-computed mid-range score, and able to outrank candidates with
real, worse-looking data. This is the soft-criterion sibling of the hard-filter null-as-zero bug
already fixed in PR #971 (which only covers the `passed` boolean, not the ranking `score`).

## Next Action

`/sdd-design fix-screener-soft-criterion quick` — recommended design depth (skip / quick / full)
from triage; see context.md.
