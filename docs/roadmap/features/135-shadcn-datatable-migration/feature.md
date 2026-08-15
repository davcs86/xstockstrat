# Feature: shadcn-datatable-migration

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/shadcn-datatable-migration`
**Created**: 2026-08-15
**Last Updated**: 2026-08-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-15 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings; soft file-overlap with 124/125 noted, no blocking collision) |
| 2026-08-15 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + design.md written. Zero Floor breaches. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (15-table inventory, all 4 UI segments)
- [Design](design.md) — debated, approved architecture (shared DataTable composite, onRowClick safety mechanism, row 2/3 exceptions)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec shadcn-datatable-migration`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Migrate every table in `xstockstrat-ui` — native HTML markup, the shadcn `Table` primitive, or any
other table implementation in use — to the shadcn `DataTable` pattern (`@tanstack/react-table` +
`Table` primitive + column defs), and ensure every migrated table is horizontally responsive on
narrow viewports (scrollable container, column priority, or stacked layout, as fits each table).

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-spec shadcn-datatable-migration` — generate implementation spec from the approved design
