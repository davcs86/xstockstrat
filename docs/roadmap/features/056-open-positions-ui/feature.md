# Feature: open-positions-ui

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/open-positions-ui`
**Created**: 2026-06-10
**Last Updated**: 2026-06-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-10 | — → `idea` | backlog capture | Feature captured in backlog |
| 2026-06-10 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved; open questions resolved (FR-4 = read-only ledger join, no slot entity; source = ledger `trade.filled`; server-side filters); proto change reduced to additive `ListPositionsRequest` filters only |
| 2026-06-11 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps. Codebase correction: lineage event type is `order.filled` (not `trade.filled`); BFF lacks a ledger client (must add); service `ListPositions` does not currently enrich price/P&L |
| 2026-06-11 | re-review (status retained at `implementation-ready`) | /sdd-review | Formal product-spec re-run (skill-invoked) confirming the earlier inline review. PASS, no blocking failures. Corrected the product spec's stale `trade.filled` → `order.filled`/`order.partially_filled` to match verified codebase. Overlap WARN: 055 + 057 also touch `xstockstrat-ui` (coordinate merge order; recorded at impl-spec review) |
| 2026-06-11 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode (after 055 merged). merge-order 056→055 flipped to Resolved:Yes. Up-front confirm + Step-3 decision: forward `req.AccountId`. Step 1 (proto `symbol`/`side` + `PositionSide` enum) done |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 9 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Upgrade the trader-segment Positions page to a paginated, filterable open-positions view
backed by `xstockstrat-portfolio.ListPositions`, and explore associating each position with
the orders that built it ("position slots ↔ orders" lineage), which requires a new linkage
RPC since `Position` carries no order reference today.

## Reviewers

_(Snapshot finalized at /sdd-spec time from docs/runbooks/reviewer-registry.md, deduplicated
across all 9 implementation-spec steps. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive-only changes (`ListPositionsRequest` `symbol`/`side` filters + `PositionSide` enum), `buf lint`/`buf breaking` pass |
| `xstockstrat-portfolio` (service owner) | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-ui` (service owner) | Trading UI correctness, Connect-RPC call safety, environment/trading-mode scope correctness |
| `xstockstrat-ledger` (service owner) | `QueryEvents` read correctness for `order.filled` lineage (read-only; no ledger changes) |

## Next Action

`/sdd-review open-positions-ui impl-spec` — validate implementation spec, then `/sdd-execute open-positions-ui`
