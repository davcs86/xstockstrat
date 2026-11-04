# Promoted from docs/roadmap/features/251-fix-getpnl-source-service/acceptance.feature on launch (C-16). Scenarios are verbatim; each carries its source @AC-* and a @feature-251 tag. A rule enters only by promotion.
Feature: xstockstrat-ui - /trader/positions fill lineage lists the trader's own fills

  @AC-3 @FR-3 @regression @feature-251
  Scenario: The position fill lineage lists the trader's own fills that trading wrote to the ledger
    Given a ledger that filters QueryEvents by exact source_service match
    And the ledger holds an "order.filled" event with source_service "xstockstrat-trading" and payload order_id "o-buy", symbol "AAPL", qty 10, fill_price 100.00, account_id "acct-1", user_id "u-1", trading_mode "TRADING_MODE_PAPER"
    And the ledger holds an "order.filled" event with source_service "xstockstrat-trading" and payload order_id "o-other", symbol "AAPL", qty 5, fill_price 120.00, account_id "acct-2", user_id "u-2", trading_mode "TRADING_MODE_PAPER"
    When user "u-1" opens the "AAPL" position on account "acct-1" in /trader/positions in paper mode
    Then the Fill lineage table lists order "o-buy" with qty 10 and fill price 100.00
    And the ledger events returned to u-1's browser include none with user_id "u-2"

  @AC-19 @FR-3 @regression @feature-251
  Scenario: The fill lineage finds the trader's fill even when it is not in the first platform-wide page
    Given the ledger holds 100 "order.filled" events from other users recorded before u-1's fill for order "o-buy"
    And user "u-1" has order "o-buy" for AAPL on account "acct-1" in paper mode
    When user "u-1" opens the "AAPL" position on account "acct-1" in /trader/positions in paper mode
    Then the Fill lineage table lists order "o-buy"

  @AC-21 @FR-3 @regression @feature-251
  Scenario: The fill lineage caps at 50 orders and says so
    Given user "u-1" has 51 orders for AAPL on account "acct-1" in paper mode
    When user "u-1" opens the "AAPL" position on account "acct-1" in /trader/positions in paper mode
    Then fill events are queried for at most 50 orders
    And the sheet shows a notice that the lineage is truncated

  @AC-22 @FR-3 @regression @feature-251
  Scenario: A fill whose order row still shows a non-filled status is listed
    Given user "u-1" has order "o-stale" for AAPL on account "acct-1" whose ListOrders status is NEW
    And the ledger holds an "order.filled" event for "o-stale" with payload user_id "u-1"
    When user "u-1" opens the "AAPL" position on account "acct-1" in /trader/positions in paper mode
    Then the Fill lineage table lists order "o-stale"
