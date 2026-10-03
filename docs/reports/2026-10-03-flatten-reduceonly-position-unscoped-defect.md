# Defect: Bracket flatten and REDUCE_ONLY gate read a position without account scope

**Recorded**: 2026-10-03
**Severity**: SEV-1
**Impact type**: wrong-order-quantity
**Environment**: production (main)
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no

## Observed

Two trading paths call portfolio `GetPosition` with only `Symbol` and `TradingMode`, and never pass
`account_id`, even though the request supports it (`portfolio.proto:169`) and the caller has the
account in hand:

- `flattenAndHalt` has `bracket.AccountID` available and logs it on the next line.
- `checkTradingStateForPlaceOrder` (the `platform.trading_state` REDUCE_ONLY gate) takes no account
  parameter at all.

When `account_id` is empty, the portfolio repo drops the account predicate and picks the row with the
latest `opened_at` across **all** of the user's accounts. For a user holding the same symbol in two
accounts, these paths act on the wrong account's position:

- The protection-window flatten sizes the closing order from the other account's quantity, so it
  either over-sells (opening a short) or under-sells (leaving an unprotected remainder). It then
  submits that order on the bracket's own account.
- REDUCE_ONLY can let an exposure-increasing order through, or block a reducing one.

Production runs with brackets ON. `trading.risk.bracket_orders_enabled` was set to `true` for
production by config migration `029` (feature 189), so the flatten path is live.

## Expected

Both paths scope the position lookup to the account the order or bracket belongs to, via
`GetPositionRequest.account_id`.

## Reproduction

1. One user with two linked broker accounts, A and B, both holding symbol X with different
   quantities. B's row was opened more recently.
2. On account A, place an auto-sized entry for X so that a bracket is created, and let its
   protection window expire without the bracket reaching `ACTIVE`.
3. `flattenAndHalt` reads B's quantity and submits a closing order of that size on account A.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:2684-2686`
> position, err := s.portfolio.GetPosition(posCtx, &portfoliov1.GetPositionRequest{
> 	Symbol: order.Symbol, TradingMode: order.TradingMode,
> })

`services/xstockstrat-trading/internal/service/trading.go:3426-3428`
> pos, err := s.portfolio.GetPosition(posCtx, &portfoliov1.GetPositionRequest{
> 	Symbol: symbol, TradingMode: mode,
> })

`services/xstockstrat-trading/internal/service/trading.go:451`
> if err := s.checkTradingStateForPlaceOrder(ctx, accountEntry.userID, req.Symbol, mode, req.Side); err != nil {

`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:123-128`
> if accountID != "" {
> 	q += ` AND account_id=$4`
> ...
> q += ` ORDER BY opened_at DESC LIMIT 1`

`services/xstockstrat-config/migrations/029_heal_config_keys_full_dotted.up.sql:38-43`
> SET value_data = 'true'
> ...
>   AND key = 'trading.risk.bracket_orders_enabled'
>   AND environment = 'production'

## Root cause hypothesis

`account_id` was added to `GetPositionRequest` for multi-account support, but these two trading call
sites were never migrated. Fix: pass `AccountId: &bracket.AccountID` in the flatten path, and thread
`accountEntry`'s account ID into `checkTradingStateForPlaceOrder`.

## Confidence

high
