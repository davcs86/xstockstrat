# Feature: fix-reconciliation-false-halt

**Type**: bug
**Development Branch**: `claude/flow-investigation-4blorq`
**GitHub Issue**: n/a — Issues disabled on this repo; defect recorded at `docs/reports/2026-09-25-reconciliation-false-halt-defect.md`
**Severity**: SEV-2
**Created**: 2026-09-25
**Last Updated**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `bug-reported` → `draft` | sdd-triage (manual) | Product spec pre-populated from defect report `2026-09-25-reconciliation-false-halt-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (`/sdd-design` Phase 0)
- [Design](design.md) — debated architecture (`/sdd-design` Phase 1)
- [Implementation Spec](implementation-spec.md) — numbered fix steps (`/sdd-spec`)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The broker-state reconciliation poller (`xstockstrat-trading` feature 102) auto-halts an account on
a position-side `quantity_discrepancy` when `xstockstrat-portfolio.ListPositions` reads 0 for a
symbol the broker actually holds from the platform's own filled order — a false halt. The position
side has no `trading.orders` DB-grounding (unlike the order side), and `processPositionSync` can
transiently zero the projection on an empty broker snapshot.

## Next Action

`/sdd-design fix-reconciliation-false-halt quick` — recommended design depth (see context.md).
