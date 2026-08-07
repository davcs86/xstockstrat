# Feature: watchlist-screen-improvements

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/watchlist-screen-improvements`
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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 9 steps, implementation-ready
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

`/sdd-review watchlist-screen-improvements impl-spec` — validate implementation spec, then `/sdd-execute watchlist-screen-improvements`
