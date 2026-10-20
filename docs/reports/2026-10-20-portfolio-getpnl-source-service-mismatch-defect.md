# Defect: GetPnL queries ledger fills with source_service "trading", but trading writes "xstockstrat-trading", so realized P&L is always zero

**Recorded**: 2026-10-20
**Severity**: SEV-2
**Impact type**: wrong-pnl-reported
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-portfolio, xstockstrat-trading, xstockstrat-ledger
**Config-only fix possible**: no
**Source**: found while confirming `2026-10-19-portfolio-default-identity-fallback-defect` (low-confidence verification pass, PR #1257)

## Observed

`PortfolioService.GetPnL` builds realized P&L by folding `order.filled` and `order.partially_filled`
ledger events. It fetches them with `QueryEvents{EventType: …, SourceService: "trading"}`. Every trading
emit goes through `emitLedgerEvent`, which stamps `SourceService: "xstockstrat-trading"`. The ledger applies
`source_service` as an exact-match SQL predicate. Both passes therefore return no events, the fill
fold runs over an empty set, and `PnLResponse.realized_pnl` is 0 for every user and mode. Unrealized
P&L is computed from positions and is unaffected.

No in-repo caller (UI, agent, analysis) invokes `GetPnL` today. Any gRPC consumer of the RPC gets a
silently wrong realized figure, and the wrong value carries no error or warning.

## Expected

`GetPnL` matches the source service trading actually writes. The fix is the shared constant or literal
`"xstockstrat-trading"`, or dropping the `SourceService` filter since `event_type` is already
trading-owned. Realized P&L then equals the fold of the user's fills.

## Reproduction

1. In `services/xstockstrat-portfolio`, run the scratch test
   `/tmp/claude-0/-home-user-xstockstrat/0e33c54d-7bf5-528d-8d50-aaa4bc92a407/scratchpad/confirm/portfolio-getpnl-source-service-mismatch/zz_getpnl_source_test.go`.
   Copy it into `internal/service/`, then run `GOWORK=off go test ./internal/service/ -run TestZZ_ -v`.
   Its fake ledger mirrors the real exact-match filter, and it stores two fills: buy 10 @ 100, then sell 10 @ 150.
2. Output:
   - events stored as `"xstockstrat-trading"` (what trading writes) give `GetPnL queried [trading trading] -> realized=0`
   - events stored as `"trading"` (control) give `realized=500`

## Evidence

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:670-672` (pass 1; pass 2 at `:715-717`)
> resp, err := s.ledger.QueryEvents(ctx, &ledgerv1.QueryEventsRequest{
> 	EventType:     "order.filled",
> 	SourceService: "trading",

`services/xstockstrat-trading/internal/service/trading.go:1722` → `:3577` (`emitLedgerEvent`)
> go s.emitLedgerEvent(context.Background(), "order.filled", order.OrderId, order.UserId, map[string]interface{}{
> SourceService: "xstockstrat-trading",

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:138-140`
> if (req.sourceService) {
>   conditions.push(`source_service = $${p++}`);

The existing `GetPnL` tests use a fake ledger that ignores the request (`watchlist_service_test.go:268`,
"QueryEvents returns an empty page"), so no test exercises the filter.

## Root cause hypothesis

The service name is a bare string literal on both sides, with no shared constant: trading uses the full
`xstockstrat-trading`, while portfolio assumed the short name. The test double ignores `SourceService`,
so the mismatch was never observable in CI.

## Confidence

high
