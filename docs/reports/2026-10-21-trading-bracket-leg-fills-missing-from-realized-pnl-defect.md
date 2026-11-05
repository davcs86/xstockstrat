# Defect: Bracket leg fills never reach the ledger, so realized P&L omits the exit

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: wrong-pnl-reported
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-trading, xstockstrat-portfolio
**Config-only fix possible**: no

## Observed

`order.filled` / `order.partially_filled` are emitted only by `applyBrokerOrderStatus`, reached from
`pollFills`, which polls only orders held in the in-memory `s.orders` map. Bracket leg ids (Alpaca legs
returned on the entry submit; IBKR legs from `SubmitBracketLegs`) are written only to
`trading.order_brackets` and never enter `s.orders`. When a stop-loss or take-profit leg fills at the
broker, no ledger fill event is written. Portfolio `GetPnL` folds realized P&L solely from ledger
`order.filled` / `order.partially_filled`, so the exit of every auto-sized, bracket-protected position is
missing from realized (the round trip shows only the entry), and the live position fold never sees the
exit either. Brackets are on by default (`trading.risk.bracket_orders_enabled`, default `true`, all
environments).

Found during feature 251-fix-getpnl-source-service (design debate): that fix makes `GetPnL` read
trading's fills at all, which exposes this gap. Carried there as Out of Scope.

## Expected

A bracket leg fill produces a ledger fill event (symbol, side, qty, price, account, mode, user), so
`GetPnL` realized and the live position fold include the exit.

## Reproduction

1. With `trading.risk.bracket_orders_enabled=true`, place an auto-sized market buy (stop price set) on an
   Alpaca or IBKR account; the entry fills and `createBracket` records leg ids in `trading.order_brackets`.
2. Let the take-profit (or stop) leg fill at the broker.
3. Query ledger `order.filled` for that user and symbol: only the entry fill exists. `GetPnL` realized
   for the round trip (after feature 251) is 0 instead of the leg's gain or loss.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:1728`
> for _, o := range s.orders {

`services/xstockstrat-trading/internal/service/trading.go:1805`
> go s.emitLedgerEvent(context.Background(), "order.filled", order.OrderId, order.UserId, map[string]interface{}{

`services/xstockstrat-trading/internal/service/trading.go:3403-3405`
> // Bracket already attached atomically at entry SubmitOrder (PlaceOrder's own
> if err := s.bracketRepo.UpdateBracketStatus(ctx, rec.ID, bracketStatusActive, brokerOrder.StopLegOrderID, brokerOrder.TakeProfitLegOrderID, ""); err != nil {

`services/xstockstrat-trading/internal/service/trading.go:3411`
> resp, err := accountEntry.client.SubmitBracketLegs(ctx, order.BrokerOrderId, order.ClientOrderId, broker.BracketLegsRequest{

`services/xstockstrat-trading/internal/service/trading.go:3422`
> if err := s.bracketRepo.UpdateBracketStatus(ctx, rec.ID, bracketStatusActive, resp.StopLegOrderID, resp.TakeProfitLegOrderID, ""); err != nil {

`services/xstockstrat-trading/CLAUDE.md:248-249`
> Alpaca bracket-leg fills, which never
> reach `trading.orders` (leg ids live only in `trading.order_brackets`)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:752`
> EventType:     "order.filled",

## Root cause hypothesis

The bracket state machine (feature 030) tracks legs only for cancel, resize and protection; no poller
observes leg fills, so the fill-emission path never runs for them.

## Confidence

high
