# Defect: portfolio snapshot equity and risk checks value positions from mid-quotes, not broker marks

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: valuation-parity-break
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no
**Source**: `services/xstockstrat-portfolio/docs/context-constitution-findings.md` § Latent bugs, row 1; constitution PORTFOLIO-1 and Gotchas #1

## Observed
`broadcastSnapshot` and `checkRiskLimits` value every position as `(ask+bid)/2 * qty`. They ignore
the broker's `CurrentPrice` / `MarketValue`, even though PORTFOLIO-1 says broker valuation is
authoritative. As a result:
- Snapshot equity for broker-synced accounts differs from what `ListPositions` / `GetPortfolio` show.
- `broadcastSnapshot` persists when only some positions got quotes. Unquoted positions count as 0,
  so the stored equity is understated.
- `checkRiskLimits` leaves unquoted positions out of `totalValue`. Each remaining position's share is
  inflated, which can fire false concentration-breach alerts.
- Both paths fetch quotes for positions the broker has already valued.

## Expected
Both paths value positions through the shared `unvaluedSymbols` / `applyQuotes` rule, as `GetPnL`
does since feature 229. A partial quote batch must not produce an understated snapshot or a skewed
concentration denominator.

## Reproduction
1. Use a broker-synced account where the broker `current_price` differs from the marketdata mid.
2. Wait for a snapshot tick, then compare `portfolio.snapshots` equity with `GetPortfolio` equity.
3. Make quotes fail for one of two symbols. The snapshot persists with lower equity, and the risk
   check reports the remaining symbol at 100% concentration.

## Evidence
`services/xstockstrat-portfolio/internal/service/portfolio_service.go:841-842`
> price := (quote.AskPrice + quote.BidPrice) / 2
> equity += price * p.Qty

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:847`
> if !ok || (len(positions) > 0 && priced == 0) {

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:904`
> riskQuotes, _ := s.latestQuotesFor(ctx, riskSymbols)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:910`
> totalValue += val

## Root cause hypothesis
Feature 229 moved only `GetPnL` onto the shared `applyQuotes` helpers. The snapshot and risk loops
were never migrated and still compute mid × qty by hand.

## Confidence
high
