# Feature: watchlist-readiness-precompute

**Development Branch**: `feature/watchlist-readiness-precompute`
**Created**: 2026-09-05
**Last Updated**: 2026-09-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-05 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS with warnings: Open Questions deferred to /sdd-design; evidence-drift nit fixed); overlap CLEAN |
| 2026-09-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 full rounds + operator reframe FR-6/FR-7) and approved; recon.md + design.md written. Chosen: Option B (dedicated materializer loop) + modularized bar_epoch-aware FAST gate |
| 2026-09-05 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules (C-16)
- [Design](design.md) — chosen approach (Option B), rejected alternatives, open risks, rules touched
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Move the per-symbol strategy readiness computation off the synchronous UI render path by
materializing readiness rows into `analysis.readiness_cache` in the background, so the watchlist
readiness overlay reads cache-only and loads fast even for large watchlists. The design phase sizes
two loop-placement options — inside the existing live evaluation loop vs. a new dedicated readiness
materializer loop — with a focus on performance as symbols × strategies grows.

## Reviewers

_Snapshot finalized at /sdd-spec (2026-09-05) from docs/runbooks/reviewer-registry.md, deduplicated
across all 7 implementation-spec steps. Re-run /sdd-spec if the registry changes. No DBA (no schema
migration — reuses `readiness_cache` 022) and no Proto Reviewer (no proto change)._

| Role | Review Focus | Step categories |
|---|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias; readiness byte-identity; owner-scoping/IDOR guard; feature-177 @AC-1/@AC-2 regression guard | `service`, `test`, `config` (Steps 1–7) |
| `xstockstrat-config` (service owner) | Config key naming (`<service>.<category>.<key>`), env × global/per-user scoping, WatchConfig stream stability | `config` (Step 7) |

## Next Action

`/sdd-review watchlist-readiness-precompute impl-spec` — validate the implementation spec, then
`/sdd-execute watchlist-readiness-precompute`
