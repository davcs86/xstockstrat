# Feature: fix-offline-book-consistency

**Type**: bug
**Development Branch**: `feature/fix-offline-book-consistency`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-offline-book-consistency-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-offline-book-consistency-defect.md` (debt-radar D-47, D-48, D-49, D-63) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety (D-47, D-48) | TBD (/sdd-spec) |
| `xstockstrat-trading` owner | Order execution correctness, offline fill validation and emit (D-49, D-63) | TBD (/sdd-spec) |
| `xstockstrat-ui` owner | Book page error/degraded state for offline cards if D-48 surfaces `UNAVAILABLE` or a degraded marker | Only if design changes the read contract the UI renders |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-offline-book-consistency`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The offline-account books from feature 240 drift or misreport P&L in four ways:

- Portfolio acks failed offline sync writes (D-47).
- Valuation swallows a failed `GetOfflineStates` and reports unrealized-only P&L as complete (D-48).
- `ConfirmOrder` accepts NaN/Inf quantity and any price (D-49).
- `ConfirmOrder` reports success when the positions emit fails (D-63).

## Next Action

`/sdd-design fix-offline-book-consistency` — recommended design depth: full (2 affected services; reverses a recorded feature-240 decision); see context.md
