# Feature: market-data-freshness-and-quality-gate

**Lifecycle Status**: `draft`
**Development Branch**: `feature/market-data-freshness-and-quality-gate`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec market-data-freshness-and-quality-gate`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds a pre-trade market-data quality gate consumed by `xstockstrat-trading` that rejects exposure-increasing orders on stale quotes, missing bid/ask, excessive spread, implausible price divergence, uncertain session status, or suspected corporate-action invalidation — while still allowing risk-reducing emergency closes — and persists the exact market-data snapshot used for each risk decision.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, Alpaca feed idempotency |
| `xstockstrat-trading` owner | Order execution correctness, position limit enforcement |

## Next Action

`/sdd-review market-data-freshness-and-quality-gate product-spec` — AI review of product spec before running /sdd-spec
