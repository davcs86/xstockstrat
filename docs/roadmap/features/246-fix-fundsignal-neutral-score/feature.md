# Feature: fix-fundsignal-neutral-score

**Type**: bug
**Development Branch**: `feature/fix-fundsignal-neutral-score`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md` |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it and assigns steps.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | TBD (`/sdd-spec`) |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability (downstream recipient of the emitted signals) | TBD (`/sdd-spec`) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-fundsignal-neutral-score`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The fundamentals signal producer's `_builtin_score` returns a fabricated 0.5 for a symbol with no usable
metric, which then enters the cross-sectional quantile and is emitted to ingest as a real signal. The
truthiness checks also drop metrics whose real value is 0.

## Next Action

`/sdd-design fix-fundsignal-neutral-score quick` — recommended design depth (quick) from triage; see context.md
