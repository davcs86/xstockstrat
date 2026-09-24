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
    Given OHLCV bars exist for symbol "SPY" with timeframe "1Day" from "2000-01-01" to "2025-12-31"
    When the user queries symbol "SPY", timeframe "1Day" for the full range
    Then the page displays at most 500 bars per page
    And a "Load More" control allows fetching subsequent cursor pages

  @AC-9 @FR-5
  Scenario: MCP agent query_bars enforces max result limit
    Given OHLCV bars exist for symbol "SPY" with timeframe "1Day" from "2000-01-01" to "2025-12-31"
    When the agent calls query_bars with symbol "SPY", timeframe "1Day" for the full range
    Then the tool returns at most 1000 bars
    And the response includes a next_page_token for retrieving subsequent pages

  @AC-10 @FR-6
  Scenario: Data explorer page is registered in PLATFORM_SUBNAV
    Given the user is authenticated and on the insights segment
    When the user views the insights navigation sidebar
    Then a "Data Explorer" link is visible pointing to "/insights/data-explorer"

  @AC-11 @FR-7 @FR-1
  Scenario: UI displays last refresh timestamp for OHLCV query results
    Given the user navigates to "/insights/data-explorer"
    And OHLCV bars exist for symbol "AAPL" with timeframe "1Day", most recent bar at "2025-06-30T20:00:00Z"
    When the user selects symbol "AAPL", timeframe "1Day", start "2025-01-01", end "2025-06-30"
    Then the page displays a "Last refreshed" timestamp showing "2025-06-30T20:00:00Z"

  @AC-12 @FR-7 @FR-2
  Scenario: UI displays last refresh timestamp for fundamentals snapshot
    Given the user navigates to "/insights/data-explorer"
    And a fundamentals snapshot exists for symbol "MSFT" with as_of "2025-09-24T14:30:00Z"
    When the user selects symbol "MSFT" and switches to the "Fundamentals" tab
    Then the page displays a "Last refreshed" timestamp derived from the as_of field showing "2025-09-24T14:30:00Z"

  @AC-13 @FR-7 @FR-3
  Scenario: MCP agent query_bars includes last refresh timestamp
    Given OHLCV bars exist for symbol "AAPL" with timeframe "1Day", most recent bar at "2025-06-30T20:00:00Z"
    When the agent calls query_bars with symbol "AAPL", timeframe "1Day", start_date "2025-01-01", end_date "2025-06-30"
    Then the tool response includes a last_refreshed field with value "2025-06-30T20:00:00Z"

  @AC-14 @FR-7 @FR-4
  Scenario: MCP agent query_fundamentals includes last refresh timestamp
    Given a fundamentals snapshot exists for symbol "GOOG" with as_of "2025-09-24T10:00:00Z"
    When the agent calls query_fundamentals with symbol "GOOG"
    Then the tool response includes a last_refreshed field derived from as_of with value "2025-09-24T10:00:00Z"

  @AC-15 @FR-2
  Scenario: Historical fundamentals rendered as time-series chart in the UI
    Given the user navigates to "/insights/data-explorer"
    And historical fundamentals exist for symbol "AAPL" with period_type "quarterly" for 4 periods from "2024-Q1" to "2024-Q4" with pe_ratio values 28.1, 29.3, 30.5, 31.2
    When the user selects symbol "AAPL", switches to "Fundamentals" tab, selects period_type "quarterly", and selects chart metric "pe_ratio"
    Then the page displays a time-series line chart with 4 data points plotting pe_ratio over fiscal periods

  @AC-16 @FR-8 @FR-1
  Scenario: Export OHLCV query results as CSV from the UI
    Given the user navigates to "/insights/data-explorer"
    And OHLCV bars exist for symbol "AAPL" with timeframe "1Day" from "2025-01-01" to "2025-01-31"
    When the user queries symbol "AAPL", timeframe "1Day", start "2025-01-01", end "2025-01-31"
    And clicks "Download CSV"
    Then the browser downloads a CSV file named "AAPL_1Day_2025-01-01_2025-01-31.csv"
    And the CSV contains columns time, open, high, low, close, volume with one row per bar

  @AC-17 @FR-8 @FR-2
  Scenario: Export fundamentals query results as CSV from the UI
    Given the user navigates to "/insights/data-explorer"
    And historical fundamentals exist for symbol "MSFT" with period_type "quarterly" for 4 periods
    When the user queries symbol "MSFT" fundamentals with period_type "quarterly"
    And clicks "Download CSV"
    Then the browser downloads a CSV file named "MSFT_fundamentals_quarterly.csv"
    And the CSV contains columns including symbol, period_end, pe_ratio, eps, market_cap

  @AC-20 @FR-5
  Scenario: Historical fundamentals query enforces pagination in the UI
    Given historical fundamentals exist for symbol "SPY" with period_type "quarterly" spanning 80 periods
    When the user queries symbol "SPY" fundamentals with period_type "quarterly" for the full range
    Then the page displays at most 50 periods per page
    And pagination controls allow navigating to subsequent pages

  @AC-21 @FR-5
  Scenario: MCP agent query_fundamentals enforces pagination on historical data
    Given historical fundamentals exist for symbol "SPY" with period_type "quarterly" spanning 80 periods
    When the agent calls query_fundamentals with symbol "SPY", include_history true, period_type "quarterly"
    Then the tool returns at most 50 periods
    And the response includes a next_page_token for retrieving subsequent pages

  @AC-18 @FR-9 @FR-3
  Scenario: MCP query_bars with format csv returns CSV content with MIME type
    Given OHLCV bars exist for symbol "AAPL" with timeframe "1Day" from "2025-01-01" to "2025-01-31"
    When the agent calls query_bars with symbol "AAPL", timeframe "1Day", start_date "2025-01-01", end_date "2025-01-31", format "csv"
    Then the tool returns an EmbeddedResource with MIME type "text/csv" containing CSV text
    And the CSV contains columns time, open, high, low, close, volume

  @AC-19 @FR-9 @FR-4
  Scenario: MCP query_fundamentals with format csv returns CSV content with MIME type
    Given historical fundamentals exist for symbol "GOOG" with period_type "annual" for 3 periods
    When the agent calls query_fundamentals with symbol "GOOG", include_history true, period_type "annual", format "csv"
    Then the tool returns an EmbeddedResource with MIME type "text/csv" containing CSV text
    And the CSV contains columns including symbol, period_end, pe_ratio, eps, market_cap

  @AC-22 @FR-2
  Scenario: Historical fundamentals with missing metrics renders gaps in chart and dashes in table
    Given the user navigates to "/insights/data-explorer"
    And historical fundamentals exist for symbol "AAPL" with period_type "quarterly" for 2 periods ending "2024-03-31" and "2024-06-30" where Q1 has pe_ratio in missing_metrics
    When the user selects symbol "AAPL", switches to "Fundamentals" tab, selects period_type "quarterly", and selects chart metric "pe_ratio"
    Then the table displays "—" for pe_ratio in the Q1 row
    And the chart renders a gap (no data point) for Q1 pe_ratio
