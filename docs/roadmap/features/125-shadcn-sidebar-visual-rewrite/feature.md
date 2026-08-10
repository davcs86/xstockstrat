# Feature: shadcn-sidebar-visual-rewrite

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/shadcn-sidebar-visual-rewrite`
**Created**: 2026-08-10
**Last Updated**: 2026-08-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-10 | `idea` → `draft` | /sdd-story | Product spec generated from a user story + attached screen-recording comparing our live mobile offcanvas Sidebar against shadcn's own reference Sidebar example. |
| 2026-08-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved: PASS WITH WARNINGS (spec-reviewer — no blockers; qualitative visual ACs and 2 deferred Open Questions flagged, both with stated design-time resolution paths, consistent with feature 124 precedent) + overlap scan CLEAN (feature-overlap — no collisions; 121/122/123/124's shared `PlatformHeader.tsx`/`ui/sidebar.tsx` touches all already merged to `main-dev`). |
| 2026-08-10 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written. No group merge (avoids `SidebarContent` gap-2 spacing loss); `sectionStart` field on `NavGroup` drives purely-visual `SidebarGroupLabel`s ("Navigate"/"Settings" per explicit user steer) — the `aria-labelledby`/`role="group"` ARIA-association route was proposed then dropped (SidebarGroup's implicit `generic` role wouldn't reliably expose it, and each SidebarMenuButton already has a correct accessible name). `SidebarMenuSub*` nests directly under `CollapsibleContent`, no wrapper. Chevron rotation reuses the `navigation-menu.tsx` idiom, verified by the new e2e assertion's red step, not a separate manual check. New requirement: a manual visual-verification checkpoint (screenshot + pass/fail note) before the integration PR, since this codebase has no screenshot-regression tooling. No Floor breach across all 3 rounds. |
| 2026-08-10 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps. Corrected design.md's stated chevron mechanism: verified against the installed `@radix-ui/react-collapsible` source that `CollapsibleTrigger` emits `data-state`, never a literal `data-open` attribute, so `sidebarMenuButtonVariants`'s `data-open:*` classes (`sidebar.tsx:449`) are dead CSS with no producer — the working in-file precedent is `sidebar.tsx:215`'s `group-data-[side=right]:rotate-180` bracket syntax; the spec uses `group-data-[state=open]/menu-button:rotate-90` instead. Also corrected design.md's proposed red-before-green proof: a bare `data-state` transition assertion already passes on `main-dev` (Collapsible/CollapsibleTrigger predate this feature), so the genuine FR-1 red/green proof is a `rotate-90` class assertion on the chevron icon itself, added alongside the `data-state` check. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture (3 rounds)
- [Implementation Spec](implementation-spec.md)
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

`/sdd-review shadcn-sidebar-visual-rewrite impl-spec` — validate implementation spec, then `/sdd-execute shadcn-sidebar-visual-rewrite`
