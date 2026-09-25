# Promoted from docs/roadmap/features/204-backfilled-data-queryable/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-204` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: backfilled-data-queryable (agent)
  What the agent guarantees for its query_bars / query_fundamentals data tools: OHLCV and
  fundamentals return shapes, the 1000-bar and 50-period result caps with next_page_token
  pagination, the last_refreshed field, and the csv-format EmbeddedResource/MIME contract.

  @AC-5 @FR-3 @feature-204
  Scenario: MCP agent query_bars tool returns OHLCV data
    Given OHLCV bars exist for symbol "AAPL" with timeframe "1Day" from "2025-01-01" to "2025-03-31"
    When the agent calls query_bars with symbol "AAPL", timeframe "1Day", start_date "2025-01-01", end_date "2025-01-31"
    Then the tool returns a list of OHLCV bar objects each containing time, open, high, low, close, volume
    And the result count is at most 1000

  @AC-6 @FR-4 @feature-204
  Scenario: MCP agent query_fundamentals tool returns snapshot data
    Given a fundamentals snapshot exists for symbol "GOOG" with pe_ratio 28.5
    When the agent calls query_fundamentals with symbol "GOOG"
    Then the tool returns the fundamentals snapshot including pe_ratio "28.5"

  @AC-7 @FR-4 @feature-204
  Scenario: MCP agent query_fundamentals tool returns historical data
    Given historical fundamentals exist for symbol "GOOG" with period_type "annual" for period ending "2024-12-31"
    When the agent calls query_fundamentals with symbol "GOOG", include_history true, period_type "annual"
    Then the tool returns a historical_fundamentals list containing the "2024-12-31" period

  @AC-9 @FR-5 @feature-204
  Scenario: MCP agent query_bars enforces max result limit
    Given OHLCV bars exist for symbol "SPY" with timeframe "1Day" from "2000-01-01" to "2025-12-31"
    When the agent calls query_bars with symbol "SPY", timeframe "1Day" for the full range
    Then the tool returns at most 1000 bars
    And the response includes a next_page_token for retrieving subsequent pages

  @AC-13 @FR-7 @FR-3 @feature-204
  Scenario: MCP agent query_bars includes last refresh timestamp
    Given OHLCV bars exist for symbol "AAPL" with timeframe "1Day", most recent bar at "2025-06-30T20:00:00Z"
    When the agent calls query_bars with symbol "AAPL", timeframe "1Day", start_date "2025-01-01", end_date "2025-06-30"
    Then the tool response includes a last_refreshed field with value "2025-06-30T20:00:00Z"

  @AC-14 @FR-7 @FR-4 @feature-204
  Scenario: MCP agent query_fundamentals includes last refresh timestamp
    Given a fundamentals snapshot exists for symbol "GOOG" with as_of "2025-09-24T10:00:00Z"
    When the agent calls query_fundamentals with symbol "GOOG"
    Then the tool response includes a last_refreshed field derived from as_of with value "2025-09-24T10:00:00Z"

  @AC-18 @FR-9 @FR-3 @feature-204
  Scenario: MCP query_bars with format csv returns CSV content with MIME type
    Given OHLCV bars exist for symbol "AAPL" with timeframe "1Day" from "2025-01-01" to "2025-01-31"
    When the agent calls query_bars with symbol "AAPL", timeframe "1Day", start_date "2025-01-01", end_date "2025-01-31", format "csv"
    Then the tool returns an EmbeddedResource with MIME type "text/csv" containing CSV text
    And the CSV contains columns time, open, high, low, close, volume

  @AC-19 @FR-9 @FR-4 @feature-204
  Scenario: MCP query_fundamentals with format csv returns CSV content with MIME type
    Given historical fundamentals exist for symbol "GOOG" with period_type "annual" for 3 periods
    When the agent calls query_fundamentals with symbol "GOOG", include_history true, period_type "annual", format "csv"
    Then the tool returns an EmbeddedResource with MIME type "text/csv" containing CSV text
    And the CSV contains columns including symbol, period_end, pe_ratio, eps, market_cap

  @AC-21 @FR-5 @feature-204
  Scenario: MCP agent query_fundamentals enforces pagination on historical data
    Given historical fundamentals exist for symbol "SPY" with period_type "quarterly" spanning 80 periods
    When the agent calls query_fundamentals with symbol "SPY", include_history true, period_type "quarterly"
    Then the tool returns at most 50 periods
    And the response includes a next_page_token for retrieving subsequent pages
