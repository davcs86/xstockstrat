# Feature: cross-stock-score-derivation

**Lifecycle Status**: `implementation-ready`
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
| 2026-07-13 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map (design phase 0)
- [Design](design.md) — debated, approved architecture (design phase 1)
- [Implementation Spec](implementation-spec.md) — 12 numbered steps with codebase evidence
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

_(Snapshot finalized by /sdd-spec from docs/runbooks/reviewer-registry.md — stable unless
/sdd-spec re-runs. Distinct reviewers collected across all 12 steps.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias (steps 1–9; also reviews the agent parity change — agent has no registry row) |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, no direct DB access (steps 1–2, 10–11) |
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass (steps 1–2) |
| DBA | Migration NNN numbering, up+down pair present, index correctness, run-order compliance (step 3) |

## Next Action

`/sdd-review cross-stock-score-derivation impl-spec` — validate implementation spec, then `/sdd-execute cross-stock-score-derivation`
