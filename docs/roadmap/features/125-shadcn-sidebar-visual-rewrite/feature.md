# Feature: shadcn-sidebar-visual-rewrite

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/shadcn-sidebar-visual-rewrite`
**Created**: 2026-08-10
**Last Updated**: 2026-08-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-10 | `idea` → `draft` | /sdd-story | Product spec generated from a user story + attached screen-recording comparing our live mobile offcanvas Sidebar against shadcn's own reference Sidebar example. |
| 2026-08-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved: PASS WITH WARNINGS (spec-reviewer — no blockers; qualitative visual ACs and 2 deferred Open Questions flagged, both with stated design-time resolution paths, consistent with feature 124 precedent) + overlap scan CLEAN (feature-overlap — no collisions; 121/122/123/124's shared `PlatformHeader.tsx`/`ui/sidebar.tsx` touches all already merged to `main-dev`). |

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

`/sdd-design shadcn-sidebar-visual-rewrite` — recon + adversarial design debate
