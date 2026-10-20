Feature: fix-getpnl-source-service (bug fix)
  Regression guard for docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md:
  GetPnL queries ledger fills with source_service "trading", but trading writes "xstockstrat-trading";
  and trading's fill payloads carry unsigned qty/filled_qty with no side key, so a sell folds as a buy.
  The /trader/positions fill lineage (services/xstockstrat-ui/src/hooks/usePositionLineage.ts:16-20) has the same filter bug.
  Every Given pins the producer's real payload: order.filled per services/xstockstrat-trading/internal/service/trading.go:1805-1812,
  order.partially_filled per :1822-1829, order.created per :649-652 (stream_key = order id, side on this event only).

  @AC-1 @FR-1 @FR-2 @regression
  Scenario: Realized P&L folds a sell that trading wrote with an unsigned qty
    Given a ledger that filters QueryEvents by exact source_service match
    And every event below has source_service "xstockstrat-trading" and user_id "u-1"
    And order "o-buy" has an "order.created" event with stream_key "o-buy" and payload symbol "AAPL", side "ORDER_SIDE_BUY", qty 10
    And order "o-sell" has an "order.created" event with stream_key "o-sell" and payload symbol "AAPL", side "ORDER_SIDE_SELL", qty 10
    And order "o-buy" has an "order.filled" event with payload order_id "o-buy", symbol "AAPL", qty 10, fill_price 100.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    And order "o-sell" has a later "order.filled" event with payload order_id "o-sell", symbol "AAPL", unsigned qty 10, fill_price 150.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00

  @AC-2 @FR-1 @FR-2 @regression
  Scenario: A partially filled sell that trading wrote with an unsigned filled_qty is included in realized P&L
    Given a ledger that filters QueryEvents by exact source_service match
    And every event below has source_service "xstockstrat-trading" and user_id "u-1"
    And order "o-buy" has an "order.created" event with stream_key "o-buy" and payload symbol "AAPL", side "ORDER_SIDE_BUY", qty 10
    And order "o-sell" has an "order.created" event with stream_key "o-sell" and payload symbol "AAPL", side "ORDER_SIDE_SELL", qty 10
    And order "o-buy" has an "order.filled" event with payload order_id "o-buy", symbol "AAPL", qty 10, fill_price 100.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    And order "o-sell" has a later "order.partially_filled" event with payload order_id "o-sell", symbol "AAPL", unsigned cumulative filled_qty 4, fill_price 150.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    And order "o-sell" has no "order.filled" event
    When GetPnL runs for user "u-1"
    Then realized_pnl is 200.00

  @AC-3 @FR-3 @regression
  Scenario: The position fill lineage lists the trader's own fills that trading wrote to the ledger
    Given a ledger that filters QueryEvents by exact source_service match
    And the ledger holds an "order.filled" event with source_service "xstockstrat-trading" and payload order_id "o-buy", symbol "AAPL", qty 10, fill_price 100.00, account_id "acct-1", user_id "u-1", trading_mode "TRADING_MODE_PAPER"
    And the ledger holds an "order.filled" event with source_service "xstockstrat-trading" and payload order_id "o-other", symbol "AAPL", qty 5, fill_price 120.00, account_id "acct-2", user_id "u-2", trading_mode "TRADING_MODE_PAPER"
    When user "u-1" opens the "AAPL" position on account "acct-1" in /trader/positions in paper mode
    Then the Fill lineage table lists order "o-buy" with qty 10 and fill price 100.00
    And the ledger events returned to u-1's browser include none with user_id "u-2"
