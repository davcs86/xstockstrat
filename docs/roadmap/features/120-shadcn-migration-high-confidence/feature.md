# Feature: shadcn-migration-high-confidence

**Lifecycle Status**: `draft`
**Development Branch**: `feature/shadcn-migration-high-confidence`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec shadcn-migration-high-confidence`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add ten missing shadcn-style primitives to `xstockstrat-ui`'s `src/components/ui/` (Tabs, Toggle
Group, Alert Dialog, Alert, Checkbox, Textarea, Breadcrumb, Accordion, Progress) and consolidate two
existing-but-bypassed primitives (Badge, Skeleton), replacing the 27 high-confidence hand-rolled
reimplementations a full-codebase audit found across the trader/insights/config-ui/mobile surfaces.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-review shadcn-migration-high-confidence product-spec` — AI review of product spec before running /sdd-spec
