# Feature: watchlist-readiness-precompute

**Development Branch**: `feature/watchlist-readiness-precompute`
**Created**: 2026-09-05
**Last Updated**: 2026-09-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-05 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Move the per-symbol strategy readiness computation off the synchronous UI render path by
materializing readiness rows into `analysis.readiness_cache` in the background, so the watchlist
readiness overlay reads cache-only and loads fast even for large watchlists. The design phase sizes
two loop-placement options — inside the existing live evaluation loop vs. a new dedicated readiness
materializer loop — with a focus on performance as symbols × strategies grows.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias; readiness cache correctness |
| `xstockstrat-config` (service owner) | Config key naming (`<service>.<category>.<key>`), env × global/per-user scoping — for any new cadence/enable keys |
| DBA | Only if the materializer requires a `readiness_cache` schema change (new column/index) |

## Next Action

`/sdd-review watchlist-readiness-precompute product-spec` — AI review of product spec before running /sdd-spec
