# Feature: fix-reconciliation-false-halt

**Type**: bug
**Development Branch**: `claude/flow-investigation-4blorq`
**GitHub Issue**: n/a — Issues disabled on this repo; defect recorded at `docs/reports/2026-09-25-reconciliation-false-halt-defect.md`
**Severity**: SEV-2
**Created**: 2026-09-25
**Last Updated**: 2026-09-25
**Committed to main**: eee580622c92a27a5e6dc22e6919075924b01b84
**Launched date**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `bug-reported` → `draft` | sdd-triage (manual) | Product spec pre-populated from defect report `2026-09-25-reconciliation-false-halt-defect.md` |
| 2026-09-25 | `draft` → `design-approved` | sdd-design quick (manual) | recon.md + design.md; one adversarial round (design-buddy:adversary, NEEDS WORK → resolved, incl. HIGH DISTINCT-ON dedup fix) |
| 2026-09-25 | `design-approved` → `in-progress` → `code-completed` | sdd-spec + execute (manual) | implementation-spec.md; both services build/vet/test green (GOWORK=off); context reconciled (PORTFOLIO-10 + both CLAUDE.md) |

| 2026-09-25 | `code-completed` → `launched` | CI workflow | Promoted via PR #1181; committed eee580622c92a27a5e6dc22e6919075924b01b84 |
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

Design approved. Next: `/sdd-spec fix-reconciliation-false-halt` (implementation-spec.md), then implement on `claude/flow-investigation-4blorq`.
