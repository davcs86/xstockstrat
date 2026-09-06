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
| 2026-09-06 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds) + approved. Chosen: additive cache-first `AnalysisService.GetWatchlistReadiness(watchlist_id, page)` — keyset-paged (ListPositions precedent), probe-gated freshness (full `is_readiness_row_fresh`), background kick for stale (guard-set per owner+strategy+symbol), client polls the same RPC. IDOR closed structurally; cycle-free (no portfolio→analysis edge). 2 operator forks resolved R2 (probe-gate keep @AC-2, poll-new-RPC kill N+1); Obj 3-7 closed R3 (dropped redundant `source` field, fixed ListPositions/ListOpportunities keyset citation, split FR-2/FR-6 R-B). R4 mechanized the R-E infinite-PENDING trap via a `bar_epoch=-1` failure sentinel in the shared compute path + cooldown-gated UNKNOWN recovery re-kick — an **operator-approved scope deviation** (touches shipped 177/180 compute; re-verify @AC-2 at /sdd-spec). |
| 2026-09-06 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules, risks
- [Design](design.md) — debated + approved architecture, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
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

Canonical snapshot (finalized at /sdd-spec — the distinct `**Reviewers**` across all 12 steps):

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking change, `buf lint`/`buf breaking` (Steps 1–2) |
| `xstockstrat-analysis` (service owner) | Readiness contract shape; backtest reproducibility, strategy scoring determinism, no look-ahead bias (Steps 1, 3–6, 12) |
| `xstockstrat-ui` (service owner) | Analytics display accuracy, Connect-RPC call safety; BFF/e2e mock parity, C-17 UI state primitives + accessibility (Steps 7–11) |

_(Step 12 is `docs` → Reviewers: none. `xstockstrat-portfolio` is NOT a reviewer: this feature adds
no portfolio change — the watchlist read uses the existing analysis→portfolio `GetWatchlist` edge, and
AC-5's no-cycle guard is a structural assertion in the analysis test step.)_

## Next Action

`/sdd-review watchlist-readiness-list-ux impl-spec` — validate the implementation spec, then `/sdd-execute watchlist-readiness-list-ux`
