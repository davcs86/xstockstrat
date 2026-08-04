# Feature: broker-state-reconciliation

**Lifecycle Status**: `draft`
**Development Branch**: `feature/broker-state-reconciliation`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec broker-state-reconciliation`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Runs continuous reconciliation between broker truth (open orders, positions, cash, protective orders, fills, account trading status) and `xstockstrat-trading`/`xstockstrat-portfolio` platform state, classifies mismatches by severity, self-heals benign discrepancies, and halts exposure-increasing trading (via feature 100's kill switch) on unsafe ones — never silently overwriting platform state without recording the correction.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, position limit enforcement |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-ui` owner | Trading UI correctness, no direct DB access |
| Platform Lead | Cross-service architecture, inter-service dependency graph correctness |

## Next Action

`/sdd-review broker-state-reconciliation product-spec` — AI review of product spec before running /sdd-spec
