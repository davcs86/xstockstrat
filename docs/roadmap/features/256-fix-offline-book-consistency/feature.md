# Feature: fix-offline-book-consistency

**Type**: bug
**Development Branch**: `feature/fix-offline-book-consistency`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-offline-book-consistency-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-offline-book-consistency-defect.md` (debt-radar D-47, D-48, D-49, D-63) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 16 steps |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), collected from every step's `**Reviewers**`.

| Reviewer | Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking change, `buf lint` / `buf breaking` pass | 1, 2 |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 1, 2, 7, 8, 9, 10, 11, 12 |
| `xstockstrat-trading` owner | Order execution correctness, fill detection | 1, 2, 3, 4, 5, 6 |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy | 1, 2, 13, 14 |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) | 15 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The offline-account books from feature 240 drift or misreport P&L in four ways:

- Portfolio acks failed offline sync writes (D-47).
- Valuation swallows a failed `GetOfflineStates` and reports unrealized-only P&L as complete (D-48).
- `ConfirmOrder` accepts NaN/Inf quantity and any price (D-49).
- `ConfirmOrder` reports success when the positions emit fails (D-63).

## Next Action

`/sdd-review fix-offline-book-consistency impl-spec` — validate implementation spec, then `/sdd-execute fix-offline-book-consistency`
