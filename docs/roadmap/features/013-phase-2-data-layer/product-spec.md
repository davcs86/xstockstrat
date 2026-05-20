# Product Spec: phase-2-data-layer

**Created**: 2026-05-20

---

## Problem Statement

`xstockstrat-portfolio`'s `GetPnL` RPC always returns `realized_pnl = 0` for every portfolio, regardless of how many positions have been closed. The proto field exists and unrealized P&L is computed correctly, but the service never queries the ledger for closed-position fill events. Traders and platform operators viewing the insights dashboard or trader UI see silently incorrect total P&L figures for any account with closed positions.

## User Story

As a trader using the xstockstrat platform, I want `GetPnL` to return the correct realized P&L for my closed positions, so that the insights dashboard and trader UI show accurate total portfolio performance.

## Functional Requirements

FR-1. `GetPnL` must query `xstockstrat-ledger` for `order.filled` events associated with the requested portfolio, filtered to the caller's user context (propagated via `x-user-id` header).
FR-2. For each matched pair of an entry fill (buy) and an exit fill (sell) on the same ticker, realized gain/loss must be computed as `(exit_price - entry_price) × quantity` and accumulated into `realized_pnl`.
FR-3. The computed `realized_pnl` must be returned in the `GetPnLResponse` proto message field `realized_pnl` (defined at `portfolio/v1/portfolio.proto:60`) alongside the existing `unrealized_pnl` without regression.

## Out of Scope

- Short-selling P&L (reverse entry/exit pairs where sell precedes buy)
- Tax lot accounting (FIFO / LIFO / specific lot matching) — average cost basis is sufficient
- `xstockstrat-marketdata` SourceRegistry gap — already implemented (2026-05-20; see context.md)
- `StreamBars` / `StreamQuotes` WebSocket streaming — no callers; deferred to future chart panel feature
- Any UI changes to the insights dashboard or trader UI — both already consume `realized_pnl` from the proto response; the bug is server-side only

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-portfolio` — contains the buggy `GetPnL` implementation; receives the fix
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

1. Calling `GetPnL` for a portfolio with at least one closed position (matched buy + sell fills in the ledger) returns a non-zero `realized_pnl` equal to the sum of `(exit_price - entry_price) × quantity` across all closed trades.
2. Calling `GetPnL` for a portfolio with no closed positions (all positions still open, or no fills at all) returns `realized_pnl = 0`.
3. `unrealized_pnl` is unchanged for all portfolios — open-position computation is not regressed.
4. The gRPC call from `xstockstrat-portfolio` to `xstockstrat-ledger` propagates `x-user-id`, `x-access-scope`, and `x-trace-id` headers per the platform header-propagation convention.
5. Unit tests cover the three cases above: closed positions, no closed positions, mixed open+closed.

## Open Questions

- [ ] What event type key and payload schema does `xstockstrat-ledger` use for `order.filled` events — specifically what fields encode ticker, fill price, quantity, and side (buy/sell)? Needs code audit of ledger event schema at `/sdd-spec` time.
- [ ] Does `xstockstrat-portfolio` already have a ledger gRPC client wired in its service layer, or does one need to be added? Needs code audit of `portfolio_service.go` imports and constructor.
- [ ] How are partial fills modeled? If an order is filled in multiple partial tranches, does each tranche produce a separate ledger event, or is there a single aggregated event? Answer affects how fill pairs are matched in FR-2.
