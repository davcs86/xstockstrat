# Feature: screener-data-readiness-polling

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/screener-data-readiness-polling`
**Created**: 2026-08-08
**Last Updated**: 2026-08-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-08 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Skipped `/sdd-review product-spec` per explicit user direction to proceed (recorded in context.md) — `draft` is the actual prior status, not `spec-ready`. |
| 2026-08-08 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps (all `xstockstrat-ui`, no other service touched). |
| 2026-08-08 | `implementation-ready` (unchanged) | /sdd-review impl-spec | PASS WITH WARNINGS (0 blockers, 2 warnings, 1 note, no Floor breach; overlap scan clean). All findings fixed directly in implementation-spec.md — see context.md. |
| 2026-08-08 | `implementation-ready` (unchanged) | /sdd-execute boot | **Renumbered `117` → `118`**: a feature-number collision with `117-screener-fundamental-metric-selector` (independently `code-completed` on `main-dev`) was discovered when `main-dev` was merged into the feature branch. Per the Feature Numbering collision rule, this not-yet-executed feature renumbers. Directory `git mv`'d, self-references updated, `merge-order.md` entry added. Also branched `feature/screener-data-readiness-polling` off `claude/screener-criteria-filtering-7ydsuz` (PR #902) instead of `main-dev` — see context.md for both deviations. |
| 2026-08-08 | `implementation-ready` (unchanged) | /sdd-execute re-spec (§5.3) | Conditional re-spec: every `page.tsx` `path:line` citation in Steps 1-3 re-verified and corrected against the post-merge file (lines shifted by `117-screener-fundamental-metric-selector`'s unrelated, disjoint-region edit). No step instructions/logic changed — evidence only. |
| 2026-08-08 | `implementation-ready` → `in-progress` | /sdd-execute Step 1 | `useScreenSymbolsPoll` added to `useScreenSymbols.ts`. `tsc --noEmit`/lint clean. TDD: red observed across the Step-3 suite before this step (6/7 new tests failed on missing testids); green pending Step 2. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 3 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

When a Screener criterion (fundamental or technical) can't be evaluated because its underlying
data isn't available yet, automatically re-check in the background and update the existing
pending badges live, so a user watching the page sees results resolve without manually re-running
the scan.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

`xstockstrat-analysis`'s conditional row (see design.md § Chosen Approach) resolved to **not
needed** — the approved design makes no proto/servicer/engine change; it resends the existing
`ScreenSymbolsRequest` unchanged.

## Next Action

`/sdd-execute screener-data-readiness-polling sequential` (in progress — Step 1)
