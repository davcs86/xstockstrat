# Feature: shadcn-table-actions-responsive

**Lifecycle Status**: `draft`
**Development Branch**: `feature/shadcn-table-actions-responsive`
**Created**: 2026-08-09
**Last Updated**: 2026-08-09

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-09 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
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

`/sdd-review shadcn-table-actions-responsive product-spec` — AI review of product spec before running `/sdd-spec`.
