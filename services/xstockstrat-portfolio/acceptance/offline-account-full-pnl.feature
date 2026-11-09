# Promoted from docs/roadmap/features/240-offline-account-full-pnl/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-240` tag.
# Durable business rules xstockstrat-portfolio already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Shared givens: unless a scenario says otherwise, the reference session is 2026-10-19 (a Monday, read
# during regular hours), the account is offline account "acc-1" with no other positions or confirmed
# orders in the current snapshot window, and percentages are fractions compared to 4 decimal places.

Feature: xstockstrat-portfolio - offline account full P&L (day, total, return %, marks, read-path parity)
  Offline accounts report broker-style Day P&L, Total P&L, signed return %, and a marked price with
  provenance, identically on every portfolio read path.

  @AC-1 @FR-1 @feature-240
  Scenario: Day P&L on shares held overnight uses the previous close
    Given "acc-1" holds AAPL qty 100 @ avg 150.00 with no fills on session 2026-10-19
    And the AAPL previous-session daily close is 160.00
    And the AAPL live mid-quote is 164.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position day_pnl is 400.00
    And the AAPL position day_pnl_pct is 0.0250
    And the account day_pnl is 400.00 and the account day_pnl_pct is 0.0250

  @AC-2 @FR-1 @feature-240
  Scenario: Day P&L on shares bought during the session uses the fill price
    Given "acc-1" holds AAPL qty 100 from before session 2026-10-19 with previous close 160.00
    And an offline BUY of 50 AAPL at filled_avg_price 162.00 with filled_at "2026-10-19T15:00:00Z" is confirmed
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position day_pnl is 350.00

  @AC-3 @FR-1 @feature-240
  Scenario: Day P&L includes the session change of shares sold during the session
    Given "acc-1" holds AAPL qty 100 @ avg 150.00 from before session 2026-10-19 with previous close 160.00
    And an offline SELL of 40 AAPL at filled_avg_price 165.00 with filled_at "2026-10-19T15:00:00Z" is confirmed
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the account day_pnl is 380.00

  @AC-4 @FR-2 @feature-240
  Scenario: Total P&L is realized plus unrealized and total % is over open cost basis
    Given "acc-1" has lifetime realized P&L 600.00, of which since-snapshot realized is 200.00
    And holds AAPL qty 70 @ avg 150.00 marked at 160.00
    When the trader reads the portfolio for "acc-1"
    Then the account total_pnl is 1300.00
    And the account total_pnl_pct is 0.1238

  @AC-5 @FR-2 @feature-240
  Scenario: A short position reports a non-zero, correctly signed unrealized %
    Given "acc-1" holds TSLA qty -10 @ avg 200.00
    And the TSLA live mid-quote is 180.00
    When the trader lists positions for "acc-1"
    Then the TSLA position unrealized_pnl is 200.00
    And the TSLA position unrealized_pnl_pct is 0.1000

  @AC-6 @FR-2 @feature-240
  Scenario: A fully flat account reports 0% instead of dividing by zero
    Given "acc-1" holds no open positions and has lifetime realized P&L 250.00
    When the trader reads the portfolio for "acc-1"
    Then the account total_pnl is 250.00
    And the account total_pnl_pct is 0.0000

  @AC-12 @FR-5 @feature-240
  Scenario: A symbol with no live quote is marked at the last daily close and flagged stale
    Given "acc-1" holds XYZ qty 10 @ avg 20.00
    And the marketdata quote batch succeeds but contains no quote for XYZ
    And the latest XYZ daily bar closed at 22.00 for session "2026-10-16"
    When the trader lists positions for "acc-1"
    Then the XYZ position current_price is 22.00
    And the XYZ position mark_source is MARK_SOURCE_LAST_CLOSE with mark_as_of "2026-10-16"
    And the XYZ position unrealized_pnl is 20.00

  @AC-13 @FR-5 @feature-240
  Scenario: A symbol with neither quote nor bars is flagged unpriced and does not fail the read
    Given "acc-1" holds AAPL qty 10 @ avg 150.00 with live mid-quote 160.00
    And "acc-1" holds ZZZZ qty 5 @ avg 30.00 with no quote and no daily bars
    And "acc-1" has lifetime realized P&L 0.00
    When the trader reads the portfolio for "acc-1"
    Then the read succeeds
    And the ZZZZ position is listed with qty 5, current_price 0, and mark_source MARK_SOURCE_NONE
    And the account total_pnl is 100.00 and the account equity is 1600.00

  @AC-19 @FR-8 @feature-240
  Scenario: Broker account marks and day P&L are unchanged
    Given an Alpaca account "alp-1" whose broker sync reports AAPL qty 10 with current_price 163.00 and unrealized_intraday_pl 120.00
    When the trader reads the portfolio for "alp-1"
    Then the AAPL position current_price is 163.00 with mark_source MARK_SOURCE_BROKER
    And the AAPL position day_pnl is 120.00

  @AC-22 @FR-1 @feature-240
  Scenario: Covering an overnight short below the previous close is a day gain
    Given "acc-1" holds TSLA qty -10 @ avg 210.00 from before session 2026-10-19 with previous close 200.00
    And an offline BUY of 4 TSLA at filled_avg_price 190.00 with filled_at "2026-10-19T15:00:00Z" is confirmed
    And the TSLA live mid-quote is 185.00
    When the trader reads the portfolio for "acc-1"
    Then the TSLA position day_pnl is 130.00

  @AC-23 @FR-1 @feature-240
  Scenario: A round trip across overnight and same-session shares in one session
    Given "acc-1" holds AAPL qty 100 from before session 2026-10-19 with previous close 160.00
    And an offline BUY of 50 AAPL at filled_avg_price 162.00 with filled_at "2026-10-19T14:00:00Z" is confirmed
    And an offline SELL of 120 AAPL at filled_avg_price 165.00 with filled_at "2026-10-19T16:00:00Z" is confirmed
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position qty is 30
    And the AAPL position day_pnl is 590.00

  @AC-24 @FR-1 @feature-240
  Scenario: A weekend read reports the most recently completed session
    Given the read happens on Saturday "2026-10-17"
    And "acc-1" holds AAPL qty 100 with no fills on session 2026-10-16 or since
    And the AAPL daily closes are 158.00 for session "2026-10-15" and 160.00 for session "2026-10-16"
    And there is no live AAPL quote
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position current_price is 160.00 with mark_source MARK_SOURCE_LAST_CLOSE
    And the AAPL position day_pnl is 200.00

  @AC-25 @FR-2 @feature-240
  Scenario: A mixed long/short book uses the sum of absolute cost bases
    Given "acc-1" holds AAPL qty 10 @ avg 100.00 marked at 110.00
    And "acc-1" holds TSLA qty -10 @ avg 100.00 marked at 95.00
    And "acc-1" has lifetime realized P&L 0.00
    When the trader reads the portfolio for "acc-1"
    Then the account total_pnl is 150.00
    And the account total_pnl_pct is 0.0750

  @AC-26 @FR-2 @FR-8 @feature-240
  Scenario: The short-% correction also applies to an order-fill-valued broker short
    Given Alpaca account "alp-1" holds a position TSLA qty -10 @ avg 200.00 built from order fills with no broker current_price
    And the TSLA live mid-quote is 180.00
    When the trader lists positions for "alp-1"
    Then the TSLA position unrealized_pnl_pct is 0.1000

  @AC-27 @FR-5 @feature-240
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

  @AC-28 @FR-8 @feature-240
  Scenario: GetPnL keeps refusing an offline holding without a live quote
    Given "acc-1" holds ZZZZ qty 5 with no live quote and a latest daily close of 30.00
    When the caller requests GetPnL
    Then the call fails with gRPC status UNAVAILABLE
    And no PnLResponse is returned

  @AC-29 @FR-9 @feature-240
  Scenario: Every portfolio read returns the same offline P&L for the same state
    Given "acc-1" holds AAPL qty 100 @ avg 150.00 with previous close 160.00 and live mid-quote 163.00
    And "acc-1" has lifetime realized P&L 0.00
    And the caller has no other accounts
    When the caller reads GetPortfolio for "acc-1", GetPortfolio without account_id, GetPosition for AAPL, ListPositions for "acc-1", ListPortfolios for "acc-1", and ListPortfolios for all accounts
    Then each response that contains the AAPL position reports current_price 163.00, day_pnl 300.00, and unrealized_pnl 1300.00
    And each account-level response reports day_pnl 300.00 and total_pnl 1300.00

  @AC-34 @FR-1 @feature-240
  Scenario: A symbol fully closed during the session still counts in account day P&L
    Given "acc-1" holds AAPL qty 100 @ avg 150.00 from before session 2026-10-19 with previous close 160.00 and no other positions
    And an offline SELL of 100 AAPL at filled_avg_price 166.00 with filled_at "2026-10-19T15:00:00Z" is confirmed
    When the trader reads the portfolio for "acc-1"
    Then no AAPL position is listed
    And the account day_pnl is 600.00 and the account day_pnl_pct is 0.0375

  @AC-35 @FR-1 @feature-240
  Scenario Outline: An after-close read on the session day prefers the session's daily close once it exists
    Given the read happens at "2026-10-19T21:00:00Z" after the regular session closed
    And "acc-1" holds AAPL qty 100 with no fills on session 2026-10-19 and previous close 160.00
    And the AAPL live mid-quote is 163.00
    And <bar_condition>
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position current_price is <mark> with mark_source <source>
    And the AAPL position day_pnl is <day_pnl>

    Examples:
      | bar_condition                                               | mark   | source                 | day_pnl |
      | the AAPL daily bar for session 2026-10-19 closed at 162.00   | 162.00 | MARK_SOURCE_LAST_CLOSE | 200.00  |
      | no AAPL daily bar for session 2026-10-19 is available yet    | 163.00 | MARK_SOURCE_QUOTE      | 300.00  |

  @AC-36 @FR-1 @feature-240
  Scenario: Shares seeded by a baseline inside the session count as overnight shares
    Given snapshot_positions for "acc-1" was called with as_of "2026-10-19T14:00:00Z" and positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00}]
    And the AAPL previous-session daily close is 160.00
    And the AAPL live mid-quote is 163.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL position day_pnl is 300.00

  @AC-38 @FR-1 @feature-240
  Scenario: An overnight position with no previous-session bar adds nothing to day P&L or its base
    Given "acc-1" holds AAPL qty 100 from before session 2026-10-19 with previous close 160.00 and live mid-quote 164.00
    And "acc-1" holds NEWCO qty 10 from before session 2026-10-19 with live mid-quote 50.00 and no daily bar for session 2026-10-16
    When the trader reads the portfolio for "acc-1"
    Then the NEWCO position day_pnl is 0.00 and its current_price is 50.00 with mark_source MARK_SOURCE_QUOTE
    And the account day_pnl is 400.00 and the account day_pnl_pct is 0.0250

  @AC-39 @FR-9 @FR-8 @feature-240
  Scenario: GetPortfolio carries broker and offline P&L and aggregates them
    Given Alpaca account "alp-1" has broker equity 10120.00, last_equity 10000.00, and positions with summed unrealized P&L 500.00
    And offline "acc-1" holds AAPL qty 100 @ avg 150.00 from before session 2026-10-19 with previous close 160.00 and live mid-quote 164.00, and lifetime realized P&L 0.00
    And the caller has no other accounts
    When the caller reads GetPortfolio for "alp-1", GetPortfolio for "acc-1", and GetPortfolio without account_id
    Then GetPortfolio for "alp-1" reports day_pnl 120.00, day_pnl_pct 0.0120, total_pnl 500.00, and no total_pnl_pct value
    And GetPortfolio for "acc-1" reports day_pnl 400.00, total_pnl 1400.00, and total_pnl_pct 0.0933
    And GetPortfolio without account_id reports day_pnl 520.00, day_pnl_pct 0.0200, total_pnl 1900.00, and no total_pnl_pct value

  @AC-40 @FR-1 @feature-240
  Scenario: Without a previous close, overnight-first decides the round-trip day P&L
    Given "acc-1" holds NEWCO qty 10 from before session 2026-10-19 with no daily bar for session 2026-10-16
    And an offline BUY of 5 NEWCO at filled_avg_price 48.00 with filled_at "2026-10-19T14:00:00Z" is confirmed
    And an offline SELL of 5 NEWCO at filled_avg_price 51.00 with filled_at "2026-10-19T16:00:00Z" is confirmed
    And the NEWCO live mid-quote is 50.00
    When the trader reads the portfolio for "acc-1"
    Then the NEWCO position qty is 10
    And the NEWCO position day_pnl is 10.00

  @AC-49 @FR-5 @feature-240
  Scenario: During a live session the forming daily bar is not used as the last close
    Given the read time is "2026-10-19T15:00:00Z"
    And "acc-1" holds AAPL qty 100 from before session 2026-10-19
    And the quote batch fails
    And AAPL has a daily bar for session 2026-10-16 with close 158.00 and a forming bar for session 2026-10-19 at 161.00
    When the trader reads the portfolio for "acc-1"
    Then the AAPL current_price is 158.00 with mark_source LAST_CLOSE and mark_as_of 2026-10-16
    And the AAPL day_pnl is 0.00

  @AC-50 @FR-1 @feature-240
  Scenario: A weekend fill after the reference session does not change the reference session's day P&L
    Given the read time is Saturday "2026-10-17T16:00:00Z"
    And "acc-1" holds AAPL qty 100
    And AAPL daily closes are 158.00 for session 2026-10-15 and 160.00 for session 2026-10-16
    And there is no AAPL quote
    When an offline SELL of 50 AAPL at filled_avg_price 161.00 with filled_at "2026-10-17T15:00:00Z" is confirmed
    And the trader reads the portfolio for "acc-1"
    Then the AAPL position qty is 50
    And the AAPL day_pnl is 200.00

  @AC-51 @FR-1 @FR-5 @feature-240
  Scenario: A failed bars batch still serves a quote-marked read
    Given the read time is "2026-10-19T15:00:00Z"
    And "acc-1" holds AAPL qty 100 from before session 2026-10-19
    And the AAPL live mid-quote is 164.00
    And BatchGetBars returns an error
    When the trader reads the portfolio for "acc-1"
    Then the read succeeds
    And the AAPL current_price is 164.00 with mark_source QUOTE
    And the AAPL day_pnl is 0.00
    And the "acc-1" day_pnl_pct is 0.0000

  @AC-52 @FR-9 @feature-240
  Scenario Outline: GetPortfolio reveals nothing for an account the caller has no rows in
    Given <setup>
    When user "u-1" calls GetPortfolio with account_id "<account>"
    Then the call succeeds with no positions
    And realized_pnl, realized_pnl_lifetime, fees_since_snapshot, fees_lifetime and total_pnl_pct have no value
    And equity is 0.00, day_pnl is 0.00 and total_pnl is 0.00

    Examples:
      | setup                                                                                 | account |
      | user "u-2" owns offline "acc-2" with realized_pnl 500.00 and an AAPL position qty 10  | acc-2   |
      | user "u-1" has just registered offline "acc-9" and it has no rows                     | acc-9   |
