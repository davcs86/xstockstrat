# Feature: watchlist-screen-improvements

**Lifecycle Status**: `launched`
**Committed to main**: e9d8d9144fb228568b3d71d088ad0d4e26bd0c24
**Launched date**: 2026-08-07
**Development Branch**: `claude/watchlist-screen-improvements-9qf5vq` (harness-assigned session
branch — overrides the `feature/<slug>` convention per root `CLAUDE.md` § Harness Default Branch;
this branch bases on and integrates directly into `main-dev`, same as `sdd-execute` sequential
mode's own integration-PR target)
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-08-07 | `spec-ready` → `design-approved` | /sdd-design | Design debated (6 rounds, quick mode cap explicitly extended to 7 by user) and approved; recon.md + design.md written |
| 2026-08-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-08-07 | `implementation-ready` (unchanged) | /sdd-execute (re-spec gate) | Renumbered `110-watchlist-screen-improvements` → `112-watchlist-screen-improvements`: merging `origin/main-dev` surfaced `110-wire-signal-confidence-to-position-sizing`, already landed on `main-dev` under the same NNN. Per `docs/runbooks/feature-workflow.md` § Feature Numbering collision resolution, the feature never yet integrated into `main-dev` (this one) renumbers to the next free NNN (112 — 111 was also already double-booked on `main-dev` by two other features, unrelated to this one). Slug unchanged, so no branch rename needed. |
| 2026-08-07 | `implementation-ready` (unchanged) | /sdd-execute (re-spec gate §5.3) | Re-spec'd Steps 1, 2, 3, 5, 7, 8 against `origin/main-dev`'s post-branch-cut state: an unrelated same-day defect fix ("disabled strategies usable") split `WatchlistDetail.tsx`'s flat `strategies` list into `allStrategies`/`liveStrategies`/`strategyOptions()`, shifting every downstream line citation and requiring `BindingRowControls` (Step 1) and the add-time picker (Step 3) to adopt the live-strategy filter instead of the flat list. Also found and repointed a 6th e2e test ("excludes non-live strategies") that targets the doomed chip-row testid. See `context.md` for the full re-spec session log. |
| 2026-08-07 | `implementation-ready` → `in-progress` | /sdd-execute (Step 1) | Step 1 done: `BindingRowControls` relocated into `WatchlistReadiness.tsx`, chip row deleted from `WatchlistDetail.tsx`. Red (3 e2e tests) → green (7/7 `watchlists.spec.ts` pass) confirmed. |
| 2026-08-07 | `in-progress` → `code-completed` | /sdd-execute (Steps 2-9) | All 9 steps done: relocated controls (1/2), add-time picker (3/4), key-remount + inline rename (5/6), two-layer concurrency guard (7/8/9). Final e2e run: 10/10 `watchlists.spec.ts` tests pass (57.0s). `pnpm run lint` + `pnpm exec tsc --noEmit` clean throughout. No `merge-order.md` entry for this feature — proceeding to the integration PR. |

| 2026-08-07 | `code-completed` → `launched` | CI workflow | Promoted via PR #896; committed e9d8d9144fb228568b3d71d088ad0d4e26bd0c24 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 9 steps, complete
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Rework the `/insights/watchlists` detail pane: move per-symbol edit/delete actions into the
readiness table (removing the separate chip-row list above it), let a strategy be chosen inline
while adding a symbol instead of via a second binding step, and add an editable watchlist name.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

Integration PR open: https://github.com/davcs86/xstockstrat/pull/893 (`claude/watchlist-screen-improvements-9qf5vq` → `main-dev`). Merge when CI passes and reviewers approve.
