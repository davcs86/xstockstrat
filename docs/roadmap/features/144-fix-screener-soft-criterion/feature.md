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
| 2026-08-17 | `draft` → `code-completed` | implementation session | Fix implemented directly (no interactive `/sdd-design`/`/sdd-spec` run — harness bug-fix session; grounded design reasoning performed and logged inline in `context.md` instead). See `context.md` for the full design decision and verification. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description, fix scope, and resolved acceptance criteria
- [Context Log](context.md) — session history, decisions, deviations (design decision + verification logged here in lieu of a separate `implementation-spec.md`)

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

None — code-completed. Rides the next `/promote` cycle to production; see `context.md` for the
design decision and full verification record.
