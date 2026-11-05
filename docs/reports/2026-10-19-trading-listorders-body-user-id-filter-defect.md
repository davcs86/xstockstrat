# Defect: Trading ListOrders/StreamOrderUpdates trust a body user_id filter where empty means all users

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: authz-defense-in-depth
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-trading, xstockstrat-ui, xstockstrat-agent
**Config-only fix possible**: no
**Source**: `packages/proto/docs/context-constitution-findings.md` § Asymmetries worth triage row 1; `docs/context-constitution.md` PLAT-11 landmine

## Observed
`ListOrders` and `StreamOrderUpdates` filter on the request-body `user_id` and never consult the
trusted `x-user-id` header; an empty `user_id` returns every user's orders. The proto fields are
neither deprecated nor commented (owner filter vs identity vs admin selector). Today both callers pin
the value — the UI BFF overwrites it with the session's `claims.user_id`, the agent sets it to the
caller — so it is not externally exploitable, but any new internal caller (or a BFF regression) that
omits it leaks all users' orders. This contradicts PLAT-11 (ownership from the header) and PROTO-10
(cross-owner body selectors are admin-only).

## Expected
Non-admin callers are scoped to `x-user-id` server-side (body `user_id` honoured only as an admin
selector), and the proto documents the field's semantics.

## Reproduction
1. Read `packages/proto/trading/v1/trading.proto:166-168` (no comment, not deprecated).
2. Read `services/xstockstrat-trading/internal/service/trading.go:1507,1513`.
3. Over mTLS as any internal caller, send `ListOrders{}` with a non-admin `x-user-id` → all users' orders.

## Evidence
`packages/proto/trading/v1/trading.proto:166-167`
> message ListOrdersRequest {
> string user_id = 1;

`services/xstockstrat-trading/internal/service/trading.go:1507`
> orders, err := s.repo.ListOrders(ctx, req.UserId, req.Status, req.TradingMode, req.StrategyId, req.Symbol, req.Side, req.OrderType, req.AccountId, req.Range)

`services/xstockstrat-trading/internal/service/trading.go:1589`
> if req.UserId != "" && order.UserId != req.UserId {

`services/xstockstrat-ui/src/lib/traderBff.ts:31-32`
> // Ownership comes from the x-user-id header, so these forward unchanged. listOrders keeps an explicit
> // user_id — there it's a cross-user filter (empty = all), which the BFF pins to the session.

## Root cause hypothesis
The read RPCs kept the pre-PLAT-11 body filter when mutation RPCs moved to header identity; the
ownership guard lives only in the callers.

## Confidence
high
