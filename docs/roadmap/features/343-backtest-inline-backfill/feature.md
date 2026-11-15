# Feature: backtest-inline-backfill

**Development Branch**: `feature/backtest-inline-backfill`
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backtest-inline-backfill`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let a user fix an insufficient-data backtest in place: an inline action on the symbol page Backtests card backfills exactly the missing range, shows progress, then offers a re-run.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-ui` | Trading UI correctness, analytics display accuracy, Connect-RPC call safety |
| Service owner — `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion (backfill trigger authorization) |

## Next Action

`/sdd-review backtest-inline-backfill product-spec` — AI review of product spec before running /sdd-spec
