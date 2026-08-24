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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fundsignal-watchlist-universe`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make the fundamentals signal producer's `analysis.fundsignal.universe_source=watchlists` (and `both`)
resolve the real cross-user union of user watchlist symbols via a new admin/internal-scoped portfolio
enumeration RPC, replacing the deferred-at-launch silent fallback to `explicit_symbols` (feature 062 FR-3).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass |
| `xstockstrat-portfolio` owner | Position snapshot consistency, concurrent write safety, correctness of the new cross-user enumeration read |
| `xstockstrat-analysis` owner | Backtest reproducibility / determinism; producer universe resolution preserves dedup+cap+budget |
| Security | Cross-user data exposure: the global enumeration RPC must be admin/internal-scoped, not open like the other reads |

## Next Action

`/sdd-design fundsignal-watchlist-universe` — recon + design debate (full mode) before /sdd-spec
