# Feature: open-positions-ui

**Lifecycle Status**: `draft`
**Development Branch**: `feature/open-positions-ui`
**Created**: 2026-06-10
**Last Updated**: 2026-06-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-10 | — → `idea` | backlog capture | Feature captured in backlog |
| 2026-06-10 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec open-positions-ui`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Upgrade the trader-segment Positions page to a paginated, filterable open-positions view
backed by `xstockstrat-portfolio.ListPositions`, and explore associating each position with
the orders that built it ("position slots ↔ orders" lineage), which requires a new linkage
RPC since `Position` carries no order reference today.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed. Snapshot finalized at /sdd-spec time — re-run /sdd-spec if
the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive-only changes (position filters + order-lineage RPC), `buf lint`/`buf breaking` pass |
| `xstockstrat-portfolio` (service owner) | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-ui` (service owner) | Trading UI correctness, Connect-RPC call safety, environment/trading-mode scope correctness |
| `xstockstrat-ledger` (service owner) | Append-only invariant, event ordering — _only if fill-event lineage is read from ledger_ |

## Next Action

`/sdd-review open-positions-ui product-spec` — AI review of product spec before running /sdd-spec
