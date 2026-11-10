# Feature: fix-position-fold-correctness

**Type**: bug
**Development Branch**: `feature/fix-position-fold-correctness`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md`, `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md`, `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-position-fold-correctness`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The portfolio live position fold is wrong three ways: it re-applies the whole `order.filled` history on
every restart (and double-applies across overlapping processes), it folds every sell as a buy, and it
never sees bracket-leg exit fills because trading emits no ledger event for them.

## Next Action

`/sdd-design fix-position-fold-correctness` — recommended design depth (full) from triage; see context.md
