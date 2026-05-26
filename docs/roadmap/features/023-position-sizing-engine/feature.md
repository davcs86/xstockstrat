# Feature: position-sizing-engine

**Lifecycle Status**: `draft`
**Development Branch**: `feature/position-sizing-engine`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec position-sizing-engine`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds a risk-adjusted position sizing rules engine to the trading service that computes order quantity from account equity, ATR-based stop distance, signal confidence, and portfolio concentration limits — replacing externally-specified quantities and making real-capital trading safe.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| Platform Lead | Cross-service architecture, new service additions, port assignments |

## Next Action

`/sdd-review position-sizing-engine product-spec` — AI review of product spec before running /sdd-spec
