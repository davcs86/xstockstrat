# Feature: shadcn-sidebar-visual-rewrite

**Lifecycle Status**: `code-completed`
**Development Branch**: `claude/implement-124-e48xkn` (harness-assigned; see note below)
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
| 2026-08-10 | `implementation-ready` (unchanged) | /sdd-execute (sequential) | Corrected **Development Branch** from the nominal `feature/shadcn-sidebar-visual-rewrite` (never created — no code work had happened yet) to the actual harness-assigned session branch `claude/implement-124-e48xkn`, which already carries every SDD artifact this feature has produced so far and is up to date with `origin/main-dev`. Same sanctioned pattern feature 124 used. |
| 2026-08-10 | `implementation-ready` → `in-progress` | /sdd-execute (sequential) | Step 1 (add `sectionStart` field to `NavGroup`) done. |
| 2026-08-10 | `in-progress` → `code-completed` | /sdd-execute (sequential) | All 4 steps landed. Steps 1-2 straightforward. Step 3 (e2e coverage): first Playwright attempt fell back to `tsc`+`lint`+`--list` after `warmup.setup.ts`'s 21-route pre-warm timed out; a scoped retry (`--project=chromium --no-deps` + manually pre-warming just the 2 routes this spec visits) got a genuine RED→GREEN cycle, catching and fixing a real test bug along the way (Tailwind v4 sets the standalone `rotate` CSS property for a bare `rotate-90` utility, not `transform`) — final result 9/9 passed. Step 4 (manual visual check): PASS against all three criteria, screenshot sent to user. Closed the impl-spec review's one unaddressed warning (`pnpm build` now run, succeeds). Two `fails.md` entries added (scoped-e2e-run technique, Tailwind v4 rotate/transform gotcha). No out-of-scope changes; no Floor breach. Ready for the integration PR. |

---

**Note on Development Branch**: this session runs on the harness-assigned branch
`claude/implement-124-e48xkn` rather than a `feature/<slug>` branch created fresh from `main-dev` —
consistent with root `CLAUDE.md`'s sanctioning of harness-assigned branches and feature 124's own
precedent (see its `feature.md`). All of this feature's artifacts (`product-spec.md` through
`implementation-spec.md`) already live only on this branch's remote (`origin/claude/implement-124-
e48xkn`), not on `origin/main-dev` — a fresh `feature/shadcn-sidebar-visual-rewrite` branched from
`main-dev` would have none of them.

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
