# Feature: backtest-portfolio-sizing

**Development Branch**: `feature/backtest-portfolio-sizing` (this session's work rides `claude/xstockstrat-metrics-sweep-m070rf` per the harness branch constraint)
**Created**: 2026-08-23
**Last Updated**: 2026-08-23

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-23 | `idea` → `draft` | /sdd-story | Product spec generated from metrics-sweep audit finding #2 |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backtest-portfolio-sizing`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the backtest engine's serial per-symbol equity compounding (a Π(1+rᵢ) parlay across symbols)
with an opt-in real portfolio model — one shared capital pool, concurrent positions, a defined
allocation policy, and a single portfolio equity curve — so aggregate `total_return` becomes a
meaningful portfolio return rather than an ordering-dependent artifact.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md; finalized at /sdd-spec.)_

| Role | Review Focus |
|---|---|
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Proto owner (if a sizing-mode field is added) | Non-breaking additive field; enum→TS exhaustive-map coupling (ledger 067) |

## Next Action

`/sdd-design backtest-portfolio-sizing quick` — ground and debate the design (operator chose story+design only; stop before /sdd-spec)
