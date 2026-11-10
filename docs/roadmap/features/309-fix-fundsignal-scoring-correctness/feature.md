# Feature: fix-fundsignal-scoring-correctness

**Type**: bug
**Development Branch**: `feature/fix-fundsignal-scoring-correctness`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md`, `docs/reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md`, `docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md`, `docs/reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 4 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-fundsignal-scoring-correctness`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The fundamentals signal producer and its consumers mis-score signals: absent metrics score as wire zeros
on the formula path, a lone scored symbol is always `buy`, an explicit conviction 0.0 is read back as 0.5,
and fabricated 0.5 signals stored before feature 246 stay active.

## Next Action

`/sdd-design fix-fundsignal-scoring-correctness` — full design recommended (proto/migration possible; 3 services; C-16 sign-off for durable @AC-8 @feature-201)
