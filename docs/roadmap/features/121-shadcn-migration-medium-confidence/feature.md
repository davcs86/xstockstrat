# Feature: shadcn-migration-medium-confidence

**Lifecycle Status**: `draft`
**Development Branch**: `feature/shadcn-migration-medium-confidence`
**Created**: 2026-08-08
**Last Updated**: 2026-08-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-08 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec shadcn-migration-medium-confidence`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add four more shadcn-style primitives (Switch, Slider, Collapsible, Navigation Menu — the latter
advisory-only) to `xstockstrat-ui`'s `src/components/ui/`, extend `alert-dialog`/`tabs`/`toggle-group`
usage to five `window.confirm()` call sites and two looser segmented-selector/pill occurrences, and
consolidate two independently-duplicated non-primitive recipes (a bordered filter toolbar, two raw
`<table>` grids), covering the 22 medium-confidence occurrences the shadcn/ui gap audit found.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-review shadcn-migration-medium-confidence product-spec` — AI review of product spec before running /sdd-spec
