# Feature: open-positions-ui

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/open-positions-ui`
**Created**: 2026-06-10
**Last Updated**: 2026-06-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-10 | — → `idea` | backlog capture | Feature captured in backlog |
| 2026-06-10 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved; open questions resolved (FR-4 = read-only ledger join, no slot entity; source = ledger `trade.filled`; server-side filters); proto change reduced to additive `ListPositionsRequest` filters only |

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
| `xstockstrat-ledger` (service owner) | Append-only invariant, event ordering, `QueryEvents` read correctness for `trade.filled` lineage (read-only; no ledger changes) |

## Next Action

`/sdd-spec open-positions-ui` — generate implementation spec from the approved product spec
