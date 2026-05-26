# Feature: stop-loss-bracket-orders

**Lifecycle Status**: `draft`
**Development Branch**: `feature/stop-loss-bracket-orders`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec stop-loss-bracket-orders`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Automatically submits stop-loss and optional take-profit bracket orders at the broker (IBKR/Alpaca) when a position is opened, using the stop price computed by the position sizing engine, so that open positions are protected without requiring platform uptime or human intervention.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| Platform Lead | Cross-service architecture, new service additions, port assignments |

## Next Action

`/sdd-review stop-loss-bracket-orders product-spec` — AI review of product spec before running /sdd-spec
