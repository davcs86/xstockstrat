# Defect: Live position fold treats every trading sell fill as a buy

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: wrong-positions-displayed
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no

## Observed

Trading emits `order.filled` with an unsigned `qty` (`order.Qty`) and no `side` key. The live fold
`processOrderFill` adds `fill.Qty` to the existing qty and takes the "buying more" branch whenever
`fill.Qty > 0`. A sell therefore folds as a buy: the position grows instead of shrinking, cost basis and
average entry are recomputed as an add, `pnl.RealizedDelta` sees a same-direction fill (no realized), and
`portfolio.position.closed` never fires for a full exit. The row stays wrong until the next
`account.positions.synced` broker reconciliation overwrites it. `realized_accum` and the
`portfolio.position.closed` `realized_pnl` contract (feature 042) are understated for every
order-fill-closed position.

Found during feature 251-fix-getpnl-source-service: same unsigned-qty root cause as its FR-2, which
covers only `GetPnL`. Carried there as Out of Scope.

## Expected

A sell fill reduces (or flips) the position: the fold applies a signed qty (negative for a sell), as
`pnl.Fill.Qty` documents; realized accrues on the reducing leg; a full exit closes the row and emits
`portfolio.position.closed` with the sealed realized.

## Reproduction

1. Place buy 10 @ 100 on a broker account; `pollFills` emits `order.filled` with `qty: 10`.
2. Place sell 10 @ 150; `order.filled` is emitted with `qty: 10` and no `side`.
3. Before the next positions sync, read `portfolio.positions`: qty 20 and the row is not closed.
   Expected: row closed and `portfolio.position.closed` emitted with `realized_pnl` 500.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:1805-1807`
> go s.emitLedgerEvent(context.Background(), "order.filled", order.OrderId, order.UserId, map[string]interface{}{
> "qty": order.Qty, "fill_price": order.FilledAvgPrice,

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:248`
> Qty       float64 `json:"qty"`        // set by order.filled (total); zero for order.partially_filled

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:310-311`
> newQty = existing.Qty + fill.Qty
> if fill.Qty > 0 { // buying more

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:332-335`
> delta = pnl.RealizedDelta(existing.Qty, existing.CostBasis, fill.Qty, fill.FillPrice)
> if newQty <= 0 {

`packages/proto/pnl/pnl.go:26`
> Qty    float64 // signed: positive = buy, negative = sell

## Root cause hypothesis

The `order.filled` producer drops the order side and the consumer assumes a signed qty. The fold needs a
resolved side (a producer `side` key, or the `order.created`/`order.submitted` sibling lookup feature 251
builds for `GetPnL`) before applying the fill.

## Confidence

high
