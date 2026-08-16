# Feature: cross-stock-score-derivation

**Committed to main**: 52adaa26702553f9d51f3cf458479a9b7729f930
**Launched date**: 2026-07-21
**Development Branch**: `feature/cross-stock-score-derivation`
**Created**: 2026-07-12
**Last Updated**: 2026-07-13
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-12 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings) |
| 2026-07-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-07-13 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-07-13 | `implementation-ready` (unchanged) | /sdd-spec | Amended to 14 steps — user-directed test-infra scope addition (FR-10: UI vitest seed + agent/UI CI wiring) |
| 2026-07-13 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done (proto additive fields); sequential run, single-PR (user-directed) on branch claude/cross-stock-score-derivation-94k11z |
| 2026-07-13 | `in-progress` → `code-completed` | /sdd-execute | All 14 steps done; verified locally (analysis 220 tests/77%, agent 54/61%, ui vitest 100% + tsc/lint clean, proto buf lint/breaking, migration 007 reversible). Integration PR → main-dev next. |
| 2026-08-06 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(0)/fails(1); pruned 4 specs |

| 2026-07-21 | `code-completed` → `launched` | CI workflow | Promoted via PR #767; committed 52adaa26702553f9d51f3cf458479a9b7729f930 |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
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
