# Feature: shadcn-table-actions-responsive

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/shadcn-table-actions-responsive`
**Created**: 2026-08-09
**Last Updated**: 2026-08-09

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-09 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-09 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap collisions vs 120/121/123 noted, no blocking FAIL) |
| 2026-08-09 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written. Mid-session: sibling features 121/122/123 landed in main-dev, resolving the deferral/sequencing debate; FR-11 (mobile Sidebar) added by explicit user direction and separately grounded/adversary-reviewed. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (includes two mid-debate UPDATE/ADDENDUM sections)
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec shadcn-table-actions-responsive`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Fifth feature in the shadcn/ui migration lineage (119–123): adopt `DropdownMenu` for table "Actions"
columns, close the remaining `e2e/mobile-overflow.spec.ts` coverage/horizontal-scroll gaps, eliminate
the two raw `<table>`s and other hand-rolled styling (badge/toggle-pill duplication, a 14-site repeated
label className, two small cosmetic fixes) an audit found left over from the prior series, and
reposition the shared shell's generic breadcrumb into each page's own layout so it reflects actual
page position rather than just the active nav group.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-spec shadcn-table-actions-responsive` — generate implementation spec from the approved design.
