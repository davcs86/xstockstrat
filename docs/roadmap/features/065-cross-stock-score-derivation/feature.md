# Feature: cross-stock-score-derivation

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/cross-stock-score-derivation`
**Created**: 2026-07-12
**Last Updated**: 2026-07-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-12 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings) |
| 2026-07-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map (design phase 0)
- [Design](design.md) — debated, approved architecture (design phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec cross-stock-score-derivation`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the last-run-wins strategy headline score with a statistically robust derivation over
per-symbol backtest evidence: persist (symbol × window) result cells from every `RunBacktest`,
dedupe one cell per symbol (most evidence wins), and aggregate with trading-day evidence
weighting plus empirical-Bayes shrinkage toward a neutral prior — so high grades are earnable
only through breadth and duration across stocks, and a throwaway single-symbol run can never
overwrite a well-evidenced grade.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, no direct DB access |
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass |
| DBA | Migration NNN numbering, up+down pair present, index correctness, run-order compliance |

## Next Action

`/sdd-spec cross-stock-score-derivation` — generate implementation spec from the approved design
