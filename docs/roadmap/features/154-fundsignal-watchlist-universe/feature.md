# Feature: fundsignal-watchlist-universe

**Development Branch**: `feature/fundsignal-watchlist-universe`
**Created**: 2026-08-24
**Last Updated**: 2026-08-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-24 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 advisory warnings, overlap CLEAN) |
| 2026-08-24 | `spec-ready` → `design-approved` | /sdd-design | Full-mode debate (4 rounds); operator-approved. recon.md + design.md written |
| 2026-08-24 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — 7 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make the fundamentals signal producer's `analysis.fundsignal.universe_source=watchlists` (and `both`)
resolve the real cross-user union of user watchlist symbols via a new admin/internal-scoped portfolio
enumeration RPC, replacing the deferred-at-launch silent fallback to `explicit_symbols` (feature 062 FR-3).

## Reviewers

_(Snapshot finalized at /sdd-spec time from docs/runbooks/reviewer-registry.md — the distinct
`**Reviewers**` values across all 7 steps. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass (Steps 1–2) |
| `xstockstrat-portfolio` owner | Position snapshot consistency, concurrent write safety, correctness of the new cross-user enumeration read + its authz gate (Steps 1, 3, 4) |
| `xstockstrat-analysis` owner | Backtest reproducibility / determinism; producer universe resolution preserves dedup+cap+budget (Steps 1, 5, 6) |
| Security | Cross-user data exposure: the global enumeration RPC must be internal-scoped (`x-internal-caller`), not open like the other reads (Step 3) |

## Next Action

`/sdd-review fundsignal-watchlist-universe impl-spec` — validate implementation spec, then `/sdd-execute fundsignal-watchlist-universe`
