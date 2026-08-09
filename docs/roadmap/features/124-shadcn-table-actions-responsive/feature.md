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

Adopt the shadcn/ui `DropdownMenu` primitive for table row "Actions" columns that currently render
multiple inline buttons side-by-side, and close the remaining horizontal-overflow gaps in
table-bearing pages not yet covered by the existing `e2e/mobile-overflow.spec.ts` phone-viewport sweep.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-review shadcn-table-actions-responsive product-spec` — AI review of product spec before running `/sdd-spec`.
