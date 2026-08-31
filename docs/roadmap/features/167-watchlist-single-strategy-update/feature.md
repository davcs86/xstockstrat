# Feature: watchlist-single-strategy-update

**Development Branch**: `feature/watchlist-single-strategy-update`
**Created**: 2026-08-31
**Last Updated**: 2026-08-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-31 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings after fixes); overlap CLEAN |
| 2026-08-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (full) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec watchlist-single-strategy-update`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Change the strategy bound to a single symbol in a watchlist through a targeted
`UpdateWatchlistBinding(watchlist_id, symbol, strategy_id)` RPC (a single-row `UPDATE`), and have the
UI patch just that entry in its query cache — instead of re-sending the entire binding array through
the replace-all `UpdateWatchlist` and refetching the whole list.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-portfolio` owner | Watchlist write correctness; single-row rebind must not reset `strategy_id`/`source` (fails-080 trap) |
| `xstockstrat-ui` owner | Targeted cache patch vs full invalidation; concurrency guards; Connect-RPC call safety |
| Proto Reviewer | Additive RPC, field-number uniqueness, no breaking change, `buf breaking` passes |

## Next Action

`/sdd-design watchlist-single-strategy-update quick` — recon + design debate before /sdd-spec
