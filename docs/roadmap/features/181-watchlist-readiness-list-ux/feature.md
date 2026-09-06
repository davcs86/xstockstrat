# Feature: watchlist-readiness-list-ux

**Development Branch**: `feature/watchlist-readiness-list-ux`
**Created**: 2026-09-06
**Last Updated**: 2026-09-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-06 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-06 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS; 3 advisory warnings fixed: FR-7 C-17 primitives/a11y + @AC-6, @AC-5 firmed, known-traps reclassified); overlap CLEAN |
| 2026-09-06 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds) + approved. Chosen: additive cache-first `AnalysisService.GetWatchlistReadiness(watchlist_id, page)` — keyset-paged (ListPositions precedent), probe-gated freshness (full `is_readiness_row_fresh`), background kick for stale (guard-set per owner+strategy+symbol), client polls the same RPC. IDOR closed structurally; cycle-free (no portfolio→analysis edge). 2 operator forks resolved R2 (probe-gate keep @AC-2, poll-new-RPC kill N+1); Obj 3-7 closed R3 (adversary-verified: dropped redundant `source` field, fixed ListPositions/ListOpportunities keyset citation, bounded PENDING→UNKNOWN R-E, split FR-2/FR-6 R-B). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules, risks
- [Design](design.md) — debated + approved architecture, rejected alternatives, open risks
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

`/sdd-spec watchlist-readiness-list-ux` — turn the approved design into a numbered implementation spec
