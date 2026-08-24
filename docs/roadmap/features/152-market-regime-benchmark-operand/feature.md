# Feature: market-regime-benchmark-operand

**Development Branch**: `feature/market-regime-benchmark-operand`
**Created**: 2026-08-24
**Last Updated**: 2026-08-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-24 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A strategy component gains an optional `source_symbol` so an indicator/formula can be computed on a
fixed reference/benchmark symbol (e.g. VOO) instead of the evaluated symbol, its output series
aligned onto the evaluated symbol's bar timeline and referenced in entry/exit rules like any other
component ref — enabling cross-symbol "market regime" gates (e.g. buy dips only when VOO's 200-day is
rising).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive non-breaking string field, `buf lint`/`buf breaking` pass |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** in benchmark alignment |
| `xstockstrat-agent` (service owner) | `manage_strategy`/`run_backtest` tool contract — dict→proto builder must carry `source_symbol`; `strat-lab` skill parity in the same PR |

## Next Action

`/sdd-review market-regime-benchmark-operand product-spec` — AI review of product spec before running /sdd-spec
