# Defect: Portfolio fill DB errors swallowed while ledger events still emitted

**Recorded**: 2026-10-02
**Severity**: SEV-1
**Impact type**: wrong-positions-pnl
**Environment**: production (main)
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no

## Observed

`processOrderFill` discards the errors of its position read and of both writes:
- a failed `GetPosition` is indistinguishable from "no position" — a buy then overwrites qty with
  `fill.Qty` (`UpsertPosition` sets absolute values), and a partial sell computes `newQty < 0` and
  routes to `ClosePosition`, deleting the whole position;
- a failed `ClosePosition`/`UpsertPosition` is ignored and the `portfolio.position.closed` /
  `opened|updated` ledger event is still emitted; the handler returns no error, so the stream
  consumer advances `lastSeq` past the fill and it is never reprocessed.

## Expected

A DB error on the fill path is surfaced: no ledger event is emitted for a write that did not
happen, and the fill is not acknowledged (the consumer does not advance past it), so it is retried
on redelivery. The realized-delta path already tolerates redelivery.

## Reproduction

1. Hold position AAPL qty 10 for an account.
2. Make `GetPosition` return a transient error (DB blip) while a `SELL 4` fill is processed.
3. Observe: `newQty = -4 → ClosePosition` deletes the 10-share row; ledger records a close.
4. Alternatively, fail `UpsertPosition`: ledger records `position.updated`, the row is unchanged,
   and the fill is never retried.

## Evidence

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:258`
> existing, _ := s.repo.GetPosition(ctx, fill.UserID, fill.Symbol, mode, fill.AccountId)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:303`
> _ = s.repo.ClosePosition(ctx, fill.UserID, fill.Symbol, mode, acctID)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:307`
> _ = s.repo.UpsertPosition(ctx, fill.UserID, fill.Symbol, newQty, newAvgEntry, newCost, mode, acctID, delta, fill.Fees)

Also discarded on the same path: `GetRealizedAccum` / `GetFeesAccum` (`:298`, `:300`).

## Root cause hypothesis

Best-effort `_ =` error handling on a financial-integrity write path, and the handler signature
returns nothing, so the consumer cannot withhold the cursor. Related (separate, not in this fix):
fill vs position-sync lost update on the same row (no transaction/row lock).

## Confidence

high
