# Feature: shadcn-sidebar-visual-rewrite

**Lifecycle Status**: `draft`
**Development Branch**: `feature/shadcn-sidebar-visual-rewrite`
**Created**: 2026-08-10
**Last Updated**: 2026-08-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-10 | `idea` → `draft` | /sdd-story | Product spec generated from a user story + attached screen-recording comparing our live mobile offcanvas Sidebar against shadcn's own reference Sidebar example. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec shadcn-sidebar-visual-rewrite`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Follow-up to feature 124: bring the vendored, mobile-only offcanvas `Sidebar` (`PlatformHeader.tsx`)
up to shadcn's own reference visual hierarchy — chevron disclosure indicators on expandable groups
and indented `SidebarMenuSub`-based sub-items — instead of the current flat, undifferentiated pill
list that never used those already-vendored primitives.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-review shadcn-sidebar-visual-rewrite product-spec` — AI review of product spec before running /sdd-spec
