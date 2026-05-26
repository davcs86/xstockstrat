# Feature: strategy-performance-dashboard

**Lifecycle Status**: `draft`
**Development Branch**: `feature/strategy-performance-dashboard`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec strategy-performance-dashboard`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds a dedicated performance panel to the insights UI showing the strategy's cumulative equity curve, maximum drawdown, rolling Sharpe ratio, win rate, and average hold time, computed from paper trading fill events in the ledger — providing the quantitative basis for the paper-to-live trading decision.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-insights` owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |

## Next Action

`/sdd-review strategy-performance-dashboard product-spec` — AI review of product spec before running /sdd-spec
