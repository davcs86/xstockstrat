Feature: offline-account-full-pnl
  As a trader who tracks accounts offline, I want full P&L (day, total, return %, fees, since-snapshot
  and lifetime realized) on those accounts, so that they are as informative as broker accounts.

  @AC-1 @FR-1
  Scenario: Day P&L on shares held overnight uses the previous close
    Given offline account "acc-1" holds AAPL qty 100 @ avg 150.00 with no fills on session 2026-10-19
    And the AAPL previous-session daily close is 160.00
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position day_pnl is 300.00
    And the AAPL position day_pnl_pct is 0.01875
    And the account day_pnl is 300.00

  @AC-2 @FR-1
  Scenario: Day P&L on shares bought during the session uses the fill price
    Given offline account "acc-1" holds AAPL qty 100 from before session 2026-10-19 with previous close 160.00
    And an offline BUY of 50 AAPL at filled_avg_price 162.00 with filled_at "2026-10-19T15:00:00Z" is confirmed
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position day_pnl is 350.00

  @AC-3 @FR-1
  Scenario: Day P&L includes realized P&L from a sell during the session
    Given offline account "acc-1" holds AAPL qty 100 @ avg 150.00 from before session 2026-10-19 with previous close 160.00
    And an offline SELL of 40 AAPL at filled_avg_price 165.00 with filled_at "2026-10-19T15:00:00Z" is confirmed
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the account day_pnl is 380.00

  @AC-4 @FR-2
  Scenario: Total P&L is realized plus unrealized and total % is over open cost basis
    Given offline account "acc-1" has since-snapshot realized P&L 600.00
    And holds AAPL qty 70 @ avg 150.00 marked at 160.00
    When the trader reads the portfolio for "acc-1"
    Then the account total_pnl is 1300.00
    And the account total_pnl_pct is 0.1238

  @AC-5 @FR-2
  Scenario: A short position reports a non-zero, correctly signed unrealized %
    Given offline account "acc-1" holds TSLA qty -10 @ avg 200.00
    And the TSLA live mid-quote is 180.00
    When the trader lists positions for "acc-1"
    Then the TSLA position unrealized_pnl is 200.00
    And the TSLA position unrealized_pnl_pct is 0.10

  @AC-6 @FR-2
  Scenario: A fully flat account reports 0% instead of dividing by zero
    Given offline account "acc-1" holds no open positions and has since-snapshot realized P&L 250.00
    When the trader reads the portfolio for "acc-1"
    Then the account total_pnl is 250.00
    And the account total_pnl_pct is 0

  @AC-7 @FR-3
  Scenario: Fees are a separate line and do not change cost basis
    Given offline account "acc-1" holds no positions
    When an offline BUY of 100 AAPL at filled_avg_price 150.00 is confirmed with fees 1.50
    And an offline SELL of 100 AAPL at filled_avg_price 156.00 is confirmed with fees 1.50
    Then list_positions reported AAPL avg_entry_price 150.00 after the BUY
    And the account realized P&L since snapshot is 600.00 gross and 597.00 net
    And the account fees_since_snapshot is 3.00

  @AC-8 @FR-3
  Scenario: Re-confirming an order replaces its fees
    Given an offline order "ord-1" was confirmed with fees 5.00
    When "ord-1" is re-confirmed with the same fill and fees 2.00
    Then the account fees_since_snapshot is 2.00

  @AC-9 @FR-3
  Scenario: Negative fees are rejected
    Given an offline order "ord-2" with status NEW
    When confirm_order is called for "ord-2" with fees -1.00
    Then the call fails with INVALID_ARGUMENT and message containing "fees must be >= 0"
    And "ord-2" remains status NEW

  @AC-10 @FR-4
  Scenario: A snapshot resets since-snapshot realized but carries lifetime realized forward
    Given offline account "acc-1" has since-snapshot realized 600.00, fees_since_snapshot 3.00, and lifetime realized 600.00
    When snapshot_positions is called with a later as_of "2026-10-31T23:59:59Z" and positions_json [{"symbol":"AAPL","qty":70,"avg_cost_per_share":150.00}]
    Then the account realized P&L since snapshot is 0.00
    And the account lifetime realized P&L is 600.00 gross and 597.00 net
    And the account fees_lifetime is 3.00

  @AC-11 @FR-4
  Scenario: Lifetime realized accumulates across two snapshots
    Given offline account "acc-1" has lifetime realized 600.00 carried from a prior snapshot
    And an offline SELL of 20 AAPL @ avg 150.00 at filled_avg_price 155.00 after the latest snapshot is confirmed
    When a second snapshot_positions is taken with a later as_of
    Then the account lifetime realized P&L is 700.00
    And the account realized P&L since snapshot is 0.00

  @AC-12 @FR-5
  Scenario: A symbol with no live quote is marked at the last daily close and flagged stale
    Given offline account "acc-1" holds XYZ qty 10 @ avg 20.00
    And marketdata returns no quote for XYZ
    And the latest XYZ daily bar closed at 22.00 on "2026-10-16"
    When the trader lists positions for "acc-1"
    Then the XYZ position current_price is 22.00
    And the XYZ position mark_source is LAST_CLOSE with mark_as_of "2026-10-16"
    And the XYZ position unrealized_pnl is 20.00

  @AC-13 @FR-5
  Scenario: A symbol with neither quote nor bars is flagged unpriced and does not fail the read
    Given offline account "acc-1" holds AAPL qty 10 marked at 160.00 and ZZZZ qty 5 with no quote and no bars
    When the trader reads the portfolio for "acc-1"
    Then the read succeeds
    And the ZZZZ position mark_source is NONE
    And the account unrealized P&L excludes ZZZZ

  @AC-14 @FR-6
  Scenario: The trader account card shows full P&L for an offline account
    Given offline account "acc-1" with day_pnl 300.00, total_pnl 1300.00, since-snapshot realized 600.00 gross / 597.00 net, lifetime realized 900.00, and fees_lifetime 4.50
    When the trader opens /trader with "acc-1" selected
    Then the PortfolioPanel shows "Day P&L" 300.00, "Total P&L" 1300.00, "Realized (since snapshot)" 600.00 with net 597.00, "Realized (lifetime)" 900.00, and "Fees" 4.50
    And the panel does not show "Cash" or "Buying Power"

  @AC-15 @FR-6
  Scenario: The Book page offline card shows the P&L summary
    Given offline account "acc-1" with day_pnl 300.00 and total_pnl 1300.00
    When the trader opens /trader/portfolio
    Then the offline card for "acc-1" shows "Day P&L" 300.00 and "Total P&L" 1300.00 alongside Equity and the position count

  @AC-16 @FR-6
  Scenario: Positions pages show day P&L and a stale-mark indicator
    Given offline account "acc-1" holds AAPL with day_pnl 300.00 marked by QUOTE and XYZ marked by LAST_CLOSE on "2026-10-16"
    When the trader opens /trader/positions
    Then the AAPL row shows Today's P/L 300.00
    And the XYZ row shows a stale-price indicator labelled "Last close 2026-10-16"

  @AC-17 @FR-6 @FR-3
  Scenario: The agent can confirm an offline order with fees and read the new fields
    Given an offline order "ord-3" with status NEW in account "acc-1"
    When the agent calls manage_offline_account with operation "confirm_order", order_id "ord-3", filled_qty 10, filled_avg_price 100.00, and fees 1.25
    Then get_order for "ord-3" returns fees 1.25
    And get_positions_by_account_id for "acc-1" returns day_pnl, unrealized_pnl_pct, and mark_source for each position

  @AC-18 @FR-7
  Scenario: Rollout backfills fees to zero and seeds lifetime realized
    Given before migration offline account "acc-1" has since-snapshot realized 450.00 and two confirmed orders
    When the feature's migrations are applied
    Then both confirmed orders have fees 0.00
    And "acc-1" lifetime realized P&L is 450.00 and fees_lifetime is 0.00

  @AC-19 @FR-8
  Scenario: Broker account P&L is unchanged
    Given an Alpaca account "alp-1" whose broker sync reports AAPL current_price 163.00 and unrealized_intraday_pl 120.00
    When the trader reads the portfolio for "alp-1"
    Then the AAPL position current_price is 163.00 with mark_source BROKER
    And the AAPL position day_pnl is 120.00
    And GetPnL for the user returns the same realized and unrealized totals as before this feature
