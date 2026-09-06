# Feature: watchlist-readiness-list-ux

**Development Branch**: `feature/watchlist-readiness-list-ux`
**Created**: 2026-09-06
**Last Updated**: 2026-09-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-06 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

UI follow-up to feature 180: make the `/insights/watchlists` list render immediately with a per-row
readiness **loading state** and **pagination**, instead of the current N+1 fan-out that leaves the
list blank until every per-symbol `EvaluateReadiness` promise resolves. The read path optionally
**decorates readiness** so the list arrives with readiness inline/progressively — with the decoration
placed to avoid an analysis↔portfolio dependency cycle.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Frontend-auth pattern, BFF connect-web call chain + e2e mock parity, UI/UX state primitives (loading/empty/error), accessibility, PLATFORM_SUBNAV reachability |
| `xstockstrat-analysis` (service owner) | Readiness correctness/determinism; batch/paginated readiness RPC if decoration lands here |
| `xstockstrat-portfolio` (service owner) | Watchlist pagination semantics; only if decoration/pagination touches `ListWatchlists` |
| Proto owner(s) | Only if a response gains readiness fields or a new RPC is added (additive, non-breaking) |

## Next Action

`/sdd-review watchlist-readiness-list-ux product-spec` — AI review of product spec before running /sdd-spec
