Feature: backfilled-data-queryable
  As a trader/analyst, I want to query and view my backfilled OHLCV and fundamentals
  data directly through the UI and MCP agent, so that I can perform independent analysis
  without having to set up strategies or run backtests.

  @AC-1 @FR-1
  Scenario: Query OHLCV bars by symbol, timeframe, and date range in the UI
    Given the user navigates to "/insights/data-explorer"
    And OHLCV bars exist for symbol "AAPL" with timeframe "1Day" from "2025-01-01" to "2025-12-31"
    When the user selects symbol "AAPL", timeframe "1Day", start "2025-01-01", end "2025-06-30"
    Then the page displays a table of OHLCV bars with columns time, open, high, low, close, volume
    And the page displays a price chart rendering the returned bars

  @AC-2 @FR-1
  Scenario: OHLCV query returns empty result for symbol with no data
    Given the user navigates to "/insights/data-explorer"
    And no OHLCV bars exist for symbol "ZZZZ" in any timeframe
    When the user selects symbol "ZZZZ", timeframe "1Day", start "2025-01-01", end "2025-12-31"
    Then the page displays an empty-state message "No OHLCV data found for the selected criteria"

  @AC-3 @FR-2
  Scenario: Query current fundamentals snapshot by symbol in the UI
    Given the user navigates to "/insights/data-explorer"
    And a fundamentals snapshot exists for symbol "MSFT" with pe_ratio 35.2 and market_cap 3100000000000
    When the user selects symbol "MSFT" and switches to the "Fundamentals" tab
    Then the page displays the fundamentals snapshot including pe_ratio "35.2" and market_cap "3100000000000"

  @AC-4 @FR-2
  Scenario: Query historical fundamentals by symbol and date range in the UI
    Given the user navigates to "/insights/data-explorer"
    And historical fundamentals exist for symbol "MSFT" with period_type "quarterly" for periods ending "2025-03-31" and "2025-06-30"
    When the user selects symbol "MSFT", switches to "Fundamentals" tab, and filters by period_type "quarterly" from "2025-01-01" to "2025-12-31"
    Then the page displays a table of historical fundamentals rows for both periods

  @AC-5 @FR-3
  Scenario: MCP agent query_bars tool returns OHLCV data
    Given OHLCV bars exist for symbol "AAPL" with timeframe "1Day" from "2025-01-01" to "2025-03-31"
    When the agent calls query_bars with symbol "AAPL", timeframe "1Day", start_date "2025-01-01", end_date "2025-01-31"
    Then the tool returns a list of OHLCV bar objects each containing time, open, high, low, close, volume
    And the result count is at most 1000

  @AC-6 @FR-4
  Scenario: MCP agent query_fundamentals tool returns snapshot data
    Given a fundamentals snapshot exists for symbol "GOOG" with pe_ratio 28.5
    When the agent calls query_fundamentals with symbol "GOOG"
    Then the tool returns the fundamentals snapshot including pe_ratio "28.5"

  @AC-7 @FR-4
  Scenario: MCP agent query_fundamentals tool returns historical data
    Given historical fundamentals exist for symbol "GOOG" with period_type "annual" for period ending "2024-12-31"
    When the agent calls query_fundamentals with symbol "GOOG", include_history true, period_type "annual"
    Then the tool returns a historical_fundamentals list containing the "2024-12-31" period

  @AC-8 @FR-5
  Scenario: OHLCV query enforces pagination in the UI
    Given OHLCV bars exist for symbol "SPY" with timeframe "1Min" spanning 50000 bars
    When the user queries symbol "SPY", timeframe "1Min" for the full range
    Then the page displays at most 500 bars per page
    And pagination controls allow navigating to subsequent pages

  @AC-9 @FR-5
  Scenario: MCP agent query_bars enforces max result limit
    Given OHLCV bars exist for symbol "SPY" with timeframe "1Min" spanning 50000 bars
    When the agent calls query_bars with symbol "SPY", timeframe "1Min" for the full range
    Then the tool returns at most 1000 bars
    And the response includes a cursor or indication that more data is available

  @AC-10 @FR-6
  Scenario: Data explorer page is registered in PLATFORM_SUBNAV
    Given the user is authenticated and on the insights segment
    When the user views the insights navigation sidebar
    Then a "Data Explorer" link is visible pointing to "/insights/data-explorer"
