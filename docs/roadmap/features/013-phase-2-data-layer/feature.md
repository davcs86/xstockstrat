# Feature: phase-2-data-layer

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/phase-2-data-layer`
**Created**: 2026-05-19
**Last Updated**: 2026-05-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-19 | `idea` | backlog | Surfaced as sleeper risk — Phase 2 skipped while Phases 3–6 completed |
| 2026-05-20 | `idea` → `draft` | /sdd-story | Product spec generated; scope narrowed to realized_pnl fix only |
| 2026-05-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-05-20 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 2 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`GetPnL` in `xstockstrat-portfolio` always returns `realized_pnl = 0` because the service never queries the ledger for closed-position fills. The root cause is in `xstockstrat-trading`: neither broker engine (`AlpacaClient` nor `IBKRClient`) populates `FilledAvgPrice` in `BrokerOrder`, so `order.filled` ledger events are always emitted with `fill_price = 0.0`. This feature fixes both bugs: the trading service broker/pollFills root cause, and the portfolio service GetPnL ledger-query gap.

## Reviewers

_(Snapshot finalized by /sdd-spec 2026-05-20; updated 2026-05-20 for scope expansion to trading service. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner (`xstockstrat-trading`) | Broker interface changes, fill price parsing accuracy, IBKR API field name correctness, pollFills event payload |
| Service owner (`xstockstrat-portfolio`) | P&L calculation accuracy, position snapshot consistency, concurrent write safety |

## Next Action

`/sdd-execute phase-2-data-layer` — implementation spec finalized (5 steps); execute Step 1 first.
