# Feature: phase-2-data-layer

**Lifecycle Status**: `launched`
**Committed to main**: 1ff20d531e007cc519788dc50af97b4317cfc381
**Launched date**: 2026-05-22
**Development Branch**: `feature/phase-2-data-layer`
**Created**: 2026-05-19
**Last Updated**: 2026-05-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-19 | `idea` | backlog | Surfaced as sleeper risk — Phase 2 skipped while Phases 3–6 completed |
| 2026-05-20 | `idea` → `draft` | /sdd-story | Product spec generated; scope narrowed to realized_pnl fix only |
| 2026-05-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-05-20 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 2 steps |
| 2026-05-21 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 complete — BrokerOrder.FilledAvgPrice added; both GetOrder implementations updated |
| 2026-05-21 | `in-progress` → `code-completed` | /sdd-execute | All 5 steps done — trading fill price root cause fixed; portfolio GetPnL ledger query implemented |

| 2026-05-22 | `code-completed` → `launched` | CI workflow | Promoted via PR #290; committed 1ff20d531e007cc519788dc50af97b4317cfc381 |
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

All 5 steps complete. Run `/sdd-execute phase-2-data-layer` to open the final integration PR into `main-dev`.
