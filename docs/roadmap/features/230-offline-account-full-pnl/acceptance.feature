Feature: offline-account-full-pnl
  As a trader who tracks accounts offline, I want full P&L (day, total, return %, fees, since-snapshot
  and lifetime realized) on those accounts, so that they are as informative as broker accounts.

  # Unless a scenario says otherwise: the reference session is 2026-10-19 (a Monday, read during regular
  # hours), the account is offline account "acc-1" with no other positions or confirmed orders in the
  # current snapshot window, and percentages are fractions compared to 4 decimal places.

  @AC-1 @FR-1
  Scenario: Day P&L on shares held overnight uses the previous close
    Given "acc-1" holds AAPL qty 100 @ avg 150.00 with no fills on session 2026-10-19
    And the AAPL previous-session daily close is 160.00
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position day_pnl is 300.00
    And the AAPL position day_pnl_pct is 0.0188
    And the account day_pnl is 300.00 and the account day_pnl_pct is 0.0188

  @AC-2 @FR-1
  Scenario: Day P&L on shares bought during the session uses the fill price
    Given "acc-1" holds AAPL qty 100 from before session 2026-10-19 with previous close 160.00
    And an offline BUY of 50 AAPL at filled_avg_price 162.00 with filled_at "2026-10-19T15:00:00Z" is confirmed
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position day_pnl is 350.00

  @AC-3 @FR-1
  Scenario: Day P&L includes the session change of shares sold during the session
    Given "acc-1" holds AAPL qty 100 @ avg 150.00 from before session 2026-10-19 with previous close 160.00
    And an offline SELL of 40 AAPL at filled_avg_price 165.00 with filled_at "2026-10-19T15:00:00Z" is confirmed
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the account day_pnl is 380.00

  @AC-4 @FR-2
  Scenario: Total P&L is realized plus unrealized and total % is over open cost basis
    Given "acc-1" has since-snapshot realized P&L 600.00
    And holds AAPL qty 70 @ avg 150.00 marked at 160.00
    When the trader reads the portfolio for "acc-1"
    Then the account total_pnl is 1300.00
    And the account total_pnl_pct is 0.1238

  @AC-5 @FR-2
  Scenario: A short position reports a non-zero, correctly signed unrealized %
    Given "acc-1" holds TSLA qty -10 @ avg 200.00
    And the TSLA live mid-quote is 180.00
    When the trader lists positions for "acc-1"
    Then the TSLA position unrealized_pnl is 200.00
    And the TSLA position unrealized_pnl_pct is 0.1000

  @AC-6 @FR-2
  Scenario: A fully flat account reports 0% instead of dividing by zero
    Given "acc-1" holds no open positions and has since-snapshot realized P&L 250.00
    When the trader reads the portfolio for "acc-1"
    Then the account total_pnl is 250.00
    And the account total_pnl_pct is 0.0000

  @AC-7 @FR-3
  Scenario: A buy fee is recorded as a separate line and does not change cost basis
    Given "acc-1" holds no positions
    When an offline BUY of 100 AAPL at filled_avg_price 150.00 is confirmed with fees 1.50
    Then list_positions for "acc-1" returns AAPL avg_entry_price 150.00 and cost_basis 15000.00
    And the account fees_since_snapshot is 1.50

  @AC-8 @FR-3
  Scenario: Re-confirming an order replaces its fees
    Given an offline order "ord-1" in "acc-1" was confirmed with fees 5.00
    When "ord-1" is re-confirmed with the same fill and fees 2.00
    Then the account fees_since_snapshot is 2.00
    And get_order for "ord-1" returns fees 2.00

  @AC-9 @FR-3
  Scenario: Negative fees are rejected
    Given an offline order "ord-2" with status NEW
    When confirm_order is called for "ord-2" with filled_qty 10, filled_avg_price 100.00, and fees -1.00
    Then the call fails with INVALID_ARGUMENT and message containing "fees must be >= 0"
    And "ord-2" remains status NEW

  @AC-10 @FR-4
  Scenario: A snapshot resets since-snapshot realized but carries lifetime realized forward
    Given "acc-1" has since-snapshot realized 600.00, fees_since_snapshot 3.00, lifetime realized 600.00, and fees_lifetime 3.00
    When snapshot_positions is called with as_of "2026-10-31T23:59:59Z" and positions_json [{"symbol":"AAPL","qty":70,"avg_cost_per_share":150.00}]
    Then the account realized P&L since snapshot is 0.00 and fees_since_snapshot is 0.00
    And the account lifetime realized P&L is 600.00 gross and 597.00 net
    And the account fees_lifetime is 3.00

  @AC-11 @FR-4
  Scenario: Lifetime realized accumulates across two snapshots
    Given "acc-1" holds AAPL qty 70 @ avg 150.00 from a snapshot with as_of "2026-10-31T23:59:59Z"
    And "acc-1" has lifetime realized 600.00 carried from that snapshot and since-snapshot realized 0.00
    And an offline SELL of 20 AAPL at filled_avg_price 155.00 with filled_at "2026-11-03T15:00:00Z" is confirmed
    When snapshot_positions is called with as_of "2026-11-30T23:59:59Z" and positions_json [{"symbol":"AAPL","qty":50,"avg_cost_per_share":150.00}]
    Then the account lifetime realized P&L is 700.00
    And the account realized P&L since snapshot is 0.00

  @AC-12 @FR-5
  Scenario: A symbol with no live quote is marked at the last daily close and flagged stale
    Given "acc-1" holds XYZ qty 10 @ avg 20.00
    And the marketdata quote batch succeeds but contains no quote for XYZ
    And the latest XYZ daily bar closed at 22.00 for session "2026-10-16"
    When the trader lists positions for "acc-1"
    Then the XYZ position current_price is 22.00
    And the XYZ position mark_source is MARK_SOURCE_LAST_CLOSE with mark_as_of "2026-10-16"
    And the XYZ position unrealized_pnl is 20.00

  @AC-13 @FR-5
  Scenario: A symbol with neither quote nor bars is flagged unpriced and does not fail the read
    Given "acc-1" holds AAPL qty 10 @ avg 150.00 with live mid-quote 160.00
    And "acc-1" holds ZZZZ qty 5 @ avg 30.00 with no quote and no daily bars
    When the trader reads the portfolio for "acc-1"
    Then the read succeeds
    And the ZZZZ position is listed with qty 5, current_price 0, and mark_source MARK_SOURCE_NONE
    And the account unrealized_pnl is 100.00 and the account equity is 1600.00

  @AC-14 @FR-6
  Scenario: The trader account card shows full P&L for an offline account
    Given "acc-1" has day_pnl 300.00, total_pnl 1300.00, total_pnl_pct 0.1238, since-snapshot realized 600.00 with fees_since_snapshot 3.00, lifetime realized 900.00 with fees_lifetime 4.50
    When the trader opens /trader with "acc-1" selected
    Then the PortfolioPanel shows "Day P&L" 300.00, "Total P&L" 1300.00 (12.38%), "Realized (since snapshot)" 600.00 with net 597.00, "Realized (lifetime)" 900.00 with net 895.50, "Fees (since snapshot)" 3.00, and "Fees (lifetime)" 4.50
    And the panel does not show "Cash" or "Buying Power"

  @AC-15 @FR-6
  Scenario: The Book page offline card shows the P&L summary
    Given "acc-1" has day_pnl 300.00 and total_pnl 1300.00
    When the trader opens /trader/portfolio
    Then the offline card for "acc-1" shows "Day P&L" 300.00 and "Total P&L" 1300.00 alongside Equity and the position count

  @AC-16 @FR-6
  Scenario: The positions list shows day P&L and a stale-mark indicator
    Given "acc-1" holds AAPL with day_pnl 300.00 and mark_source MARK_SOURCE_QUOTE
    And "acc-1" holds XYZ with mark_source MARK_SOURCE_LAST_CLOSE and mark_as_of "2026-10-16"
    When the trader opens /trader/positions
    Then the AAPL row shows Today's P/L 300.00
    And the XYZ row shows a stale-price indicator labelled "Last close 2026-10-16"

  @AC-17 @FR-6 @FR-3
  Scenario: The agent can confirm an offline order with fees and read the new fields
    Given an offline order "ord-3" for 10 MSFT with status NEW in "acc-1"
    When the agent calls manage_offline_account with operation "confirm_order", order_id "ord-3", filled_qty 10, filled_avg_price 100.00, and fees 1.25
    Then manage_offline_account get_order for "ord-3" returns fees 1.25
    And get_positions_by_account_id for "acc-1" returns MSFT with fields day_pnl, day_pnl_pct, unrealized_pnl_pct, mark_source, and mark_as_of

  @AC-18 @FR-7
  Scenario: Rollout backfills fees to zero and seeds lifetime realized
    Given before migration "acc-1" has since-snapshot realized 450.00 and two confirmed offline orders
    And Alpaca account "alp-1" has one filled broker order
    When the feature's migrations are applied
    Then both "acc-1" orders have fees 0.00 and the "alp-1" order has no fees value
    And "acc-1" lifetime realized P&L is 450.00, fees_since_snapshot is 0.00, and fees_lifetime is 0.00

  @AC-19 @FR-8
  Scenario: Broker account marks and day P&L are unchanged
    Given an Alpaca account "alp-1" whose broker sync reports AAPL qty 10 with current_price 163.00 and unrealized_intraday_pl 120.00
    When the trader reads the portfolio for "alp-1"
    Then the AAPL position current_price is 163.00 with mark_source MARK_SOURCE_BROKER
    And the AAPL position day_pnl is 120.00

  @AC-20 @FR-3
  Scenario: A sell fee yields realized P&L gross and net of fees
    Given "acc-1" holds AAPL qty 100 @ avg 150.00 bought with fees 1.50 in the current snapshot window
    When an offline SELL of 100 AAPL at filled_avg_price 156.00 is confirmed with fees 1.50
    Then the account realized P&L since snapshot is 600.00 gross and 597.00 net
    And the account fees_since_snapshot is 3.00

  @AC-21 @FR-3
  Scenario: Fees on a partial confirm are the order's cumulative total
    Given an offline order "ord-4" for 100 AAPL with status NEW in "acc-1"
    When "ord-4" is confirmed with filled_qty 40, filled_avg_price 150.00, and fees 0.40
    And "ord-4" is re-confirmed with filled_qty 100, filled_avg_price 150.00, and fees 1.00
    Then "ord-4" has status FILLED and fees 1.00
    And the account fees_since_snapshot is 1.00

  @AC-22 @FR-1
  Scenario: Covering an overnight short below the previous close is a day gain
    Given "acc-1" holds TSLA qty -10 @ avg 210.00 from before session 2026-10-19 with previous close 200.00
    And an offline BUY of 4 TSLA at filled_avg_price 190.00 with filled_at "2026-10-19T15:00:00Z" is confirmed
    And the TSLA live mid-quote is 185.00
    When the trader reads the portfolio for "acc-1"
    Then the TSLA position day_pnl is 130.00

  @AC-23 @FR-1
  Scenario: Same-session sells consume overnight shares first
    Given "acc-1" holds AAPL qty 100 from before session 2026-10-19 with previous close 160.00
    And an offline BUY of 50 AAPL at filled_avg_price 162.00 with filled_at "2026-10-19T14:00:00Z" is confirmed
    And an offline SELL of 120 AAPL at filled_avg_price 165.00 with filled_at "2026-10-19T16:00:00Z" is confirmed
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position qty is 30
    And the AAPL position day_pnl is 590.00

  @AC-24 @FR-1
  Scenario: A weekend read reports the most recently completed session
    Given the read happens on Saturday "2026-10-17"
    And "acc-1" holds AAPL qty 100 with no fills on sessions 2026-10-16 or 2026-10-17
    And the AAPL daily closes are 158.00 for session "2026-10-15" and 160.00 for session "2026-10-16"
    And there is no live AAPL quote
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position current_price is 160.00 with mark_source MARK_SOURCE_LAST_CLOSE
    And the AAPL position day_pnl is 200.00

  @AC-25 @FR-2
  Scenario: A mixed long/short book uses the sum of absolute cost bases
    Given "acc-1" holds AAPL qty 10 @ avg 100.00 marked at 110.00
    And "acc-1" holds TSLA qty -10 @ avg 100.00 marked at 95.00
    And "acc-1" has since-snapshot realized P&L 0.00
    When the trader reads the portfolio for "acc-1"
    Then the account total_pnl is 150.00
    And the account total_pnl_pct is 0.0750

  @AC-26 @FR-2 @FR-8
  Scenario: The short-% correction also applies to an order-fill-valued broker short
    Given Alpaca account "alp-1" holds a position TSLA qty -10 @ avg 200.00 built from order fills with no broker current_price
    And the TSLA live mid-quote is 180.00
    When the trader lists positions for "alp-1"
    Then the TSLA position unrealized_pnl_pct is 0.1000

  @AC-27 @FR-5
  Scenario Outline: A failed or timed-out quote batch falls back to the last close for offline positions
    Given "acc-1" holds AAPL qty 10 @ avg 150.00 and the latest AAPL daily bar closed at 158.00 for session "2026-10-16"
    And portfolio.marketdata.quote_timeout_ms is 2500
    And <quote_condition>
    When the caller reads <rpc>
    Then the response returns within 2500 ms + 0.5 s
    And AAPL is returned with current_price 158.00 and mark_source MARK_SOURCE_LAST_CLOSE

    Examples:
      | rpc            | quote_condition                              |
      | ListPositions  | marketdata GetLatestQuotes never answers     |
      | ListPortfolios | marketdata GetLatestQuotes returns an error  |

  @AC-28 @FR-8
  Scenario: GetPnL keeps refusing an offline holding without a live quote
    Given "acc-1" holds ZZZZ qty 5 with no live quote and a latest daily close of 30.00
    When the caller requests GetPnL
    Then the call fails with gRPC status UNAVAILABLE
    And no PnLResponse is returned

  @AC-29 @FR-9
  Scenario: Every portfolio read returns the same offline P&L for the same state
    Given "acc-1" holds AAPL qty 100 @ avg 150.00 with previous close 160.00 and live mid-quote 163.00
    And "acc-1" has since-snapshot realized P&L 0.00
    When the caller reads GetPortfolio, GetPosition for AAPL, ListPositions, ListPortfolios for "acc-1", ListPortfolios for all accounts, and the next StreamPortfolioUpdates message
    Then each response reports AAPL current_price 163.00, day_pnl 300.00, and unrealized_pnl 1300.00
    And each account-level response reports day_pnl 300.00 and total_pnl 1300.00

  @AC-30 @FR-6
  Scenario: The combined PortfolioPanel sums each account's own figures
    Given offline "acc-1" has day_pnl 300.00, total_pnl 1300.00, and lifetime realized 900.00
    And Alpaca account "alp-1" has day_pnl 120.00 and total_pnl 500.00
    When the trader opens /trader with the combined view
    Then the PortfolioPanel shows "Day P&L" 420.00 and "Total P&L" 1800.00
    And the realized rows show 900.00 labelled "Offline accounts only"

  @AC-31 @FR-6
  Scenario: The position detail page shows day P&L, signed short %, and mark provenance
    Given "acc-1" holds TSLA qty -10 @ avg 200.00 with mark 180.00 from MARK_SOURCE_LAST_CLOSE dated "2026-10-16" and day_pnl 50.00
    When the trader opens /trader/positions/TSLA
    Then the page shows Today's P/L 50.00 and unrealized 200.00 (+10.00%)
    And the page shows a stale-price indicator labelled "Last close 2026-10-16"
