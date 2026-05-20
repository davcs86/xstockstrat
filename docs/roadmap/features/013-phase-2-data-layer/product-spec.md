# Product Spec: phase-2-data-layer

**Created**: 2026-05-20

---

## Problem Statement

`xstockstrat-portfolio`'s `GetPnL` RPC always returns `realized_pnl = 0` for every portfolio, regardless of how many positions have been closed. The proto field exists and unrealized P&L is computed correctly, but the service never queries the ledger for closed-position fill events. Traders and platform operators viewing the insights dashboard or trader UI see silently incorrect total P&L figures for any account with closed positions.

The root cause is a compounding bug in `xstockstrat-trading`: the `BrokerOrder` interface carries only `BrokerOrderID` and `Status` — neither Alpaca nor IBKR `GetOrder` implementations populate `FilledAvgPrice`, so `order.filled` ledger events are emitted with `fill_price = 0.0` for every completed order across both brokers. Even after implementing the ledger-query logic in portfolio, `realized_pnl` would remain 0 until this root cause is fixed. Both bugs are fixed together in this feature.

## User Story

As a trader using the xstockstrat platform, I want `GetPnL` to return the correct realized P&L for my closed positions, so that the insights dashboard and trader UI show accurate total portfolio performance.

## Functional Requirements

FR-1. `GetPnL` must query `xstockstrat-ledger` for `order.filled` events associated with the requested portfolio, filtered to the caller's user context (propagated via `x-user-id` header).
FR-2. `GetPnL` must process each `order.filled` event independently in ledger-recorded order. There is exactly one `order.filled` event per completed order (fired when the order transitions to fully-filled status). `order.partially_filled` events (cumulative Alpaca polling updates during order execution) are **not** included in P&L computation — they are observability events only. Each `order.filled` event is fed into a per-symbol signed average-cost-basis accumulator; on a closing fill (opposite direction to current net position), realized gain/loss is computed and accumulated into `realized_pnl`.
FR-3. The computed `realized_pnl` must be returned in the `GetPnLResponse` proto message field `realized_pnl` (defined at `portfolio/v1/portfolio.proto:60`) alongside the existing `unrealized_pnl` without regression.
FR-4. Short positions must be supported read-only (observation of ledger events only — no order creation). A sell fill that opens or increases a net short position is treated as an entry; a subsequent buy fill that reduces or closes the net short computes realized P&L as `(average_entry_price − exit_price) × quantity_closed`. Profit on a short occurs when the exit price is lower than the entry price.
FR-5. The trading service must populate `FilledAvgPrice` in the `BrokerOrder` struct returned by both `AlpacaClient.GetOrder` and `IBKRClient.GetOrder`, and `pollFills` must propagate `brokerOrder.FilledAvgPrice` to `order.FilledAvgPrice` so that `order.filled` ledger events contain a non-zero `fill_price` for completed orders. Alpaca encodes `filled_avg_price` as a decimal string in its API response; IBKR encodes `avgPrice` as a float64.

## Out of Scope

- Short order creation — this feature only reads ledger events; placing short orders is out of scope
- Tax lot accounting (FIFO / LIFO / specific lot matching) — average cost basis is sufficient
- `xstockstrat-marketdata` SourceRegistry gap — already implemented (2026-05-20; see context.md)
- `StreamBars` / `StreamQuotes` WebSocket streaming — no callers; deferred to future chart panel feature
- Any UI changes to the insights dashboard or trader UI — both already consume `realized_pnl` from the proto response; the bug is server-side only

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading` — root-cause fix: `BrokerOrder` struct extension, `GetOrder` fill-price parsing for both Alpaca and IBKR engines, and `pollFills` propagation to ledger event payload
- `xstockstrat-portfolio` — contains the buggy `GetPnL` implementation; receives the ledger-query fix
- `xstockstrat-ledger` — read-only: queried for `order.filled` events to derive realized gains/losses

## Proto Contract Changes

- [x] No proto changes required — `realized_pnl` field already exists at `portfolio/v1/portfolio.proto:60`

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes — ledger is queried read-only; no writes or new tables in portfolio service

## Feature Workflow Notes

Branch to create: `feature/phase-2-data-layer` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking service code change only)
- [ ] 2 service owners + platform lead (breaking proto change) — **not required**
- [ ] DBA review + service owner (schema migration) — **not required**

## Acceptance Criteria

1. Calling `GetPnL` for a portfolio with at least one closed long position (buy then sell fills in the ledger) returns a non-zero `realized_pnl` equal to the sum of `(exit_price - entry_price) × quantity` across all closed long trades.
2. Calling `GetPnL` for a portfolio with at least one closed short position (sell then buy fills) returns a non-zero `realized_pnl` equal to `(entry_price - exit_price) × quantity` for each closed short.
3. Calling `GetPnL` for a portfolio with no closed positions (all positions still open, or no fills at all) returns `realized_pnl = 0`.
4. Multiple completed orders on the same symbol (each producing its own `order.filled` event) are processed independently and their realized P&L accumulates correctly via the average-cost-basis loop. `order.partially_filled` events are excluded from the query.
5. `unrealized_pnl` is unchanged for all portfolios — open-position computation is not regressed.
6. The gRPC call from `xstockstrat-portfolio` to `xstockstrat-ledger` propagates `x-user-id`, `x-access-scope`, and `x-trace-id` headers per the platform header-propagation convention.
7. Unit tests cover: closed long, closed short, no fills, partial fills, mixed open+closed.
8. After the trading service fix, `order.filled` events in the ledger contain a non-zero `fill_price` in their payload when an order is filled at a non-zero price. Both Alpaca and IBKR broker `GetOrder` implementations return `FilledAvgPrice` correctly parsed from their respective API response formats.

## Open Questions

_No unresolved product questions. The following implementation details will be confirmed by `/sdd-spec` codebase audit before writing steps:_

- Ledger event schema for `order.filled`: what fields encode ticker, fill price, quantity, and side? (affects FR-1 query construction)
- Ledger gRPC client wiring in `xstockstrat-portfolio`: existing client or new one required? (affects implementation scope)
- Partial fill modeling: resolved — there is exactly one `order.filled` event per completed order; `order.partially_filled` events are excluded from P&L computation (per FR-2).
