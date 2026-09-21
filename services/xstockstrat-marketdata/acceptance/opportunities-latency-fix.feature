@feature-183
Feature: opportunities-latency-fix — marketdata batch RPC guarantees
  BatchGetBars and BatchGetLatestPrice batch RPCs for latency reduction.

  @AC-2 @FR-2 @feature-183
  Scenario: BatchGetBars returns bars for multiple symbols in one call
    Given marketdata has stored daily bars for symbols "AAPL", "MSFT", and "GOOG"
    When a client calls BatchGetBars with symbols ["AAPL", "MSFT", "GOOG"] and timeframe "1Day"
    Then the response contains a SymbolBars entry for each of the 3 symbols
    And each SymbolBars entry contains the same bars as a single-symbol GetBars call

  @AC-3 @FR-2 @feature-183
  Scenario: BatchGetBars omits symbols with no stored bars
    Given marketdata has stored daily bars for "AAPL" but not for "ZZZZ"
    When a client calls BatchGetBars with symbols ["AAPL", "ZZZZ"]
    Then the response contains a SymbolBars entry for "AAPL" only
    And no entry exists for "ZZZZ" (omit-not-fabricate)

  @AC-4 @FR-3 @feature-183
  Scenario: BatchGetLatestPrice returns prices for multiple symbols in one call
    Given marketdata has a latest trade for "AAPL" at $185.50 and "MSFT" at $420.10
    When a client calls BatchGetLatestPrice with symbols ["AAPL", "MSFT"]
    Then the response contains a LatestPrice entry for "AAPL" with last_price 185.50
    And the response contains a LatestPrice entry for "MSFT" with last_price 420.10

  @AC-5 @FR-3 @feature-183
  Scenario: BatchGetLatestPrice omits symbols with no trade data
    Given marketdata has no trade data for "ZZZZ"
    When a client calls BatchGetLatestPrice with symbols ["AAPL", "ZZZZ"]
    Then the response contains a LatestPrice entry for "AAPL"
    And no entry exists for "ZZZZ"
