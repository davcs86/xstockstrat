# Feature: shadcn-migration-medium-confidence

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/shadcn-migration-medium-confidence`
**Created**: 2026-08-08
**Last Updated**: 2026-08-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings after fixes — FR-14 primitive-shape claim corrected, both Open Questions resolved with grepped evidence) |
| 2026-08-08 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. **Caveat**: no `Task`/`AskUserQuestion` tools were available this session — the debate and the FR-13 keep-vs-replace call were self-run by one agent and not gated through an interactive user prompt. Needs explicit human/orchestrator re-affirmation (see design.md § Process Note and Open Risks). |
| 2026-08-08 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps, covering only tranche 1 (FR-1/FR-2/FR-3/FR-10/FR-11/FR-12/FR-13 — no cross-feature dependency). FR-4–FR-9 deliberately left unspecced (F-04 — their target primitives don't exist on `main-dev` yet); re-run `/sdd-spec` once `120-shadcn-migration-high-confidence` merges. |
| 2026-08-09 | `implementation-ready` (unchanged) | /sdd-execute sequential | Tranche 2 (FR-4–FR-9, Steps 22-37) spec'd against the stacked `120` branch per explicit user direction, ahead of `120`'s actual merge to `main-dev` — see implementation-spec.md's Tranche 2 section |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — codebase dossier (Phase 0)
- [Design](design.md) — approved architecture (Phase 1). FR-13's original self-run "keep as-is"
  recommendation (see § Process Note) was superseded 2026-08-08 by a live user decision to
  **replace** — see § Round 3, resolved and no longer outstanding.
- [Implementation Spec](implementation-spec.md) — 21 steps, tranche 1 only (FR-1/FR-2/FR-3/FR-10/FR-11/FR-12/FR-13); FR-13 (Steps 17-20) migrates `PlatformHeader.tsx`/`BottomTabBar.tsx` onto `NavigationMenu`, per `design.md`'s Round 3 user-directed override; FR-4–FR-9 deferred to a re-spec after `120` merges
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

`/sdd-review shadcn-migration-medium-confidence impl-spec` — validate implementation spec, then
`/sdd-execute shadcn-migration-medium-confidence`. FR-13's keep-vs-replace call was re-affirmed by
the user 2026-08-08 (chose **replace** — see design.md § Round 3); no longer outstanding. Note: this
spec covers tranche 1 only (7 of 13 FRs) — FR-4 through FR-9 require a follow-up `/sdd-spec` run
after `120-shadcn-migration-high-confidence` merges to `main-dev`.
