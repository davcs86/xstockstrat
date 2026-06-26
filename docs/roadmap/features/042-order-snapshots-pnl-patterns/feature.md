# Feature: order-snapshots-pnl-patterns

**Lifecycle Status**: `draft`
**Development Branch**: `feature/order-snapshots-pnl-patterns`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec order-snapshots-pnl-patterns`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

At every order event (creation, fill, cancellation), capture a snapshot of the active indicator values, signals, and market conditions for the traded symbol. Once a position closes and realized P&L is known, analyze the accumulated snapshots to surface which factors — specific indicators, signal combinations, or market conditions — correlate with positive or negative outcomes.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture, new inter-service dependency graph (trading → indicators, ingest at order time) |
| DBA | Migration NNN numbering, up+down pair present, hypertable partitioning for snapshot time-series data |
| Proto Reviewer | Field number uniqueness, no breaking changes, buf lint + breaking passes |
| `xstockstrat-trading` owner | Order execution correctness, snapshot capture at fill/create/cancel hooks, paper-only dev invariant |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, realized P&L event trigger for pattern analysis |
| `xstockstrat-analysis` owner | Backtest reproducibility, pattern scoring determinism, no look-ahead bias in factor attribution |
| `xstockstrat-indicators` owner | Formula sandboxing, no side-effects from snapshot-time indicator reads |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent signal reads at snapshot time |

## Next Action

`/sdd-review order-snapshots-pnl-patterns product-spec` — AI review of product spec before running /sdd-spec
