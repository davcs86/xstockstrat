# Promoted from docs/roadmap/features/251-fix-getpnl-source-service/acceptance.feature on launch (C-16). Scenarios are verbatim; each carries its source @AC-* and a @feature-251 tag. A rule enters only by promotion.
Feature: xstockstrat-portfolio - GetPnL reads trading's fills from the ledger and folds them correctly

  @AC-1 @FR-1 @FR-2 @regression @feature-251
  Scenario: Realized P&L folds a sell that trading wrote with an unsigned qty
    Given a ledger that filters QueryEvents by exact source_service match
    And every event below has source_service "xstockstrat-trading" and user_id "u-1"
    And order "o-buy" has an "order.created" event with stream_key "o-buy" and payload symbol "AAPL", side "ORDER_SIDE_BUY", qty 10
    And order "o-sell" has an "order.created" event with stream_key "o-sell" and payload symbol "AAPL", side "ORDER_SIDE_SELL", qty 10
    And order "o-buy" has an "order.filled" event with payload order_id "o-buy", symbol "AAPL", qty 10, fill_price 100.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    And order "o-sell" has a later "order.filled" event with payload order_id "o-sell", symbol "AAPL", unsigned qty 10, fill_price 150.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00

  @AC-2 @FR-1 @FR-2 @regression @feature-251
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

  @AC-4 @FR-2 @regression @feature-251
  Scenario: A caller's fill whose side cannot be resolved refuses GetPnL instead of fabricating a figure
    Given a ledger that filters QueryEvents by exact source_service and stream_key match
    And user "u-1" has an "order.filled" event with payload order_id "o-orphan", symbol "AAPL", unsigned qty 10, fill_price 100.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    And the ledger holds no "order.created" or "order.submitted" event with stream_key "o-orphan"
    When GetPnL runs for user "u-1"
    Then the RPC returns FAILED_PRECONDITION
    And no P&L figure is returned

  @AC-5 @FR-4 @regression @feature-251
  Scenario: Another user's unresolvable fill does not affect the caller and costs no side lookup
    Given a ledger that filters QueryEvents by exact source_service and stream_key match
    And user "u-1" has an "order.filled" buy 10 AAPL @ 100.00 and a later "order.filled" sell 10 AAPL @ 150.00, each payload carrying side, account_id "acct-1", trading_mode "TRADING_MODE_PAPER"
    And user "u-2" has an "order.filled" event for order "o-u2" with no side key and no "order.created" or "order.submitted" sibling
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00
    And the ledger received no QueryEvents call with stream_key "o-u2"

  @AC-6 @FR-5 @regression @feature-251
  Scenario: A ledger read failure mid-drain returns UNAVAILABLE, never a partial realized figure
    Given the ledger answers the first "order.filled" page with a next page token
    And the ledger fails the QueryEvents call for the next page
    When GetPnL runs for user "u-1"
    Then the RPC returns UNAVAILABLE

  @AC-7 @FR-5 @regression @feature-251
  Scenario Outline: The caller's own deadline or cancellation maps to its own status code
    Given the ledger QueryEvents call <behaviour>
    When GetPnL runs for user "u-1" through the gRPC adapter
    Then the RPC returns <code>
    And the ledger received at least one QueryEvents call

  @AC-8 @FR-5 @regression @feature-251
  Scenario Outline: A replaying ledger fails GetPnL closed
    Given the ledger answers "order.filled" QueryEvents with <replay>
    When GetPnL runs for user "u-1"
    Then the RPC returns UNAVAILABLE

  @AC-9 @FR-5 @regression @feature-251
  Scenario: More than one page of fills folds every fill exactly once
    Given user "u-1" has 501 "order.filled" events whose payloads carry side
    And the ledger serves them in several pages of 200 rows, requested at page size 1000
    When GetPnL runs for user "u-1"
    Then each of the 501 fills is folded exactly once
    And GetPnL follows next_page_token until the ledger returns an empty one

  @AC-11 @FR-2 @regression @feature-251
  Scenario: A fill whose payload carries side folds without a sibling lookup
    Given user "u-1" has an "order.filled" buy 10 AAPL @ 100.00 and a later "order.filled" sell 10 AAPL @ 150.00, each payload carrying side
    And the ledger holds no "order.created" or "order.submitted" event for either order
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00
    And the ledger received no QueryEvents call with a stream_key

  @AC-14 @FR-4 @regression @feature-251
  Scenario: Fills on different accounts do not net against each other
    Given user "u-1" buys 10 AAPL @ 100.00 on account "acct-1"
    And user "u-1" buys 10 AAPL @ 120.00 on account "acct-2"
    And user "u-1" later sells 10 AAPL @ 150.00 on account "acct-1"
    And every fill is an "order.filled" event with trading_mode "TRADING_MODE_PAPER" and a resolvable side
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00

  @AC-15 @FR-4 @regression @feature-251
  Scenario: A symbol group mixing fills with and without account_id is refused
    Given user "u-1" has an AAPL "order.filled" with account_id "acct-1" and an AAPL "order.filled" with an empty account_id, both TRADING_MODE_PAPER
    When GetPnL runs for user "u-1"
    Then the RPC returns FAILED_PRECONDITION

  @AC-16 @FR-2 @regression @feature-251
  Scenario Outline: Fills fold in ledger sequence order whatever order the ledger returns them in
    Given user "u-1" has <fills>
    And the ledger returns the events in the order <slice_order>
    When GetPnL runs for user "u-1" <runs>
    Then realized_pnl is 200.00 on every run

  @AC-17 @FR-2 @regression @feature-251
  Scenario: A partially filled sell that later fills folds once, from its order.filled event
    Given user "u-1" has an "order.filled" buy 10 AAPL @ 100.00 for order "o-buy"
    And order "o-sell" (side "ORDER_SIDE_SELL") has an "order.partially_filled" with cumulative filled_qty 4 @ 150.00
    And order "o-sell" later has an "order.filled" with qty 10 @ 150.00
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00

  @AC-18 @FR-4 @FR-3 @regression @feature-251
  Scenario: A LIVE fill is excluded from paper GetPnL and from the paper fill lineage
    Given user "u-1" has a paper AAPL round trip buy 10 @ 100.00 then sell 10 @ 150.00 on account "acct-1"
    And user "u-1" has a LIVE AAPL "order.filled" sell 10 @ 300.00 on account "acct-1"
    When GetPnL runs for user "u-1" with trading_mode TRADING_MODE_PAPER
    Then realized_pnl is 500.00
    And the paper-mode Fill lineage for the "AAPL" position on account "acct-1" does not list the LIVE fill
