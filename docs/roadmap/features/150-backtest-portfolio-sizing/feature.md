# Feature: backtest-portfolio-sizing

**Development Branch**: `feature/backtest-portfolio-sizing` (this session's work rides `claude/xstockstrat-metrics-sweep-m070rf` per the harness branch constraint)
**Created**: 2026-08-23
**Last Updated**: 2026-08-23

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-23 | `idea` → `draft` | /sdd-story | Product spec generated from metrics-sweep audit finding #2 |
| 2026-08-23 | `draft` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + design.md written. merge-order.md 150↔151 row added. |
| 2026-08-23 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps |
| 2026-08-23 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1–2 (proto + codegen) done on claude/xstockstrat-metrics-sweep-m070rf |
| 2026-08-23 | `in-progress` → `code-completed` | /sdd-execute | Steps 3–13 done on claude/xstockstrat-metrics-sweep-m070rf; analysis engine + agent + strat-lab skill + UI all landed, tests green |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the backtest engine's serial per-symbol equity compounding (a Π(1+rᵢ) parlay across symbols)
with an opt-in real portfolio model — one shared capital pool, concurrent positions, a defined
allocation policy, and a single portfolio equity curve — so aggregate `total_return` becomes a
meaningful portfolio return rather than an ordering-dependent artifact.

## Reviewers

_(Snapshot from docs/runbooks/reviewer-registry.md, finalized at /sdd-spec — deduped across all steps.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field-number uniqueness per message, no breaking change (`buf breaking`), enum→TS exhaustive-map coupling (ledger 067) |
| DBA | Migration 017 NNN numbering, up+down pair present, additive-nullable columns |
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias; config key naming + declared defaults |
| xstockstrat-agent owner | MCP tool contract stability (name, parameters, return shape) + `docs/runbooks/mcp-tools.md` / strat-lab skill parity |
| xstockstrat-ui owner | Analytics display accuracy, enum→TS exhaustive-map coupling (ledger 067), test-data inventory (C-12) |

## Next Action

`/sdd-review backtest-portfolio-sizing impl-spec` — validate the implementation spec, then `/sdd-execute backtest-portfolio-sizing`
