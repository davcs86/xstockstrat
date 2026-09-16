Feature: opportunities-latency-fix
  As a trader using the Insights Decide surface, I want the opportunities queue
  to load within seconds (even on a cold cache), so that I can act on
  time-sensitive entry/exit signals without encountering timeout errors.

  @AC-1 @FR-1
  Scenario: BFF enforces a 30s gRPC deadline on ListOpportunities
    Given the BFF forwards a ListOpportunities call to xstockstrat-analysis
    When the analysis service takes longer than 30 seconds to respond
    Then the BFF returns a DEADLINE_EXCEEDED error to the browser within ~30s
    And the browser does not receive an ECONNRESET after 120s

  @AC-2 @FR-2
  Scenario: BatchGetBars returns bars for multiple symbols in one call
    Given marketdata has stored daily bars for symbols "AAPL", "MSFT", and "GOOG"
    When a client calls BatchGetBars with symbols ["AAPL", "MSFT", "GOOG"] and timeframe "1Day"
    Then the response contains a SymbolBars entry for each of the 3 symbols
    And each SymbolBars entry contains the same bars as a single-symbol GetBars call

  @AC-3 @FR-2
  Scenario: BatchGetBars omits symbols with no stored bars
    Given marketdata has stored daily bars for "AAPL" but not for "ZZZZ"
    When a client calls BatchGetBars with symbols ["AAPL", "ZZZZ"]
    Then the response contains a SymbolBars entry for "AAPL" only
    And no entry exists for "ZZZZ" (omit-not-fabricate)

  @AC-4 @FR-3
  Scenario: BatchGetLatestPrice returns prices for multiple symbols in one call
    Given marketdata has a latest trade for "AAPL" at $185.50 and "MSFT" at $420.10
    When a client calls BatchGetLatestPrice with symbols ["AAPL", "MSFT"]
    Then the response contains a LatestPrice entry for "AAPL" with last_price 185.50
    And the response contains a LatestPrice entry for "MSFT" with last_price 420.10

  @AC-5 @FR-3
  Scenario: BatchGetLatestPrice omits symbols with no trade data
    Given marketdata has no trade data for "ZZZZ"
    When a client calls BatchGetLatestPrice with symbols ["AAPL", "ZZZZ"]
    Then the response contains a LatestPrice entry for "AAPL"
    And no entry exists for "ZZZZ"

  @AC-6 @FR-4
  Scenario: Phase 0 drains execute concurrently
    Given _compute_opportunities is invoked for a user with active signals, held positions, watchlist bindings, and source weights
    When Phase 0 runs
    Then all 4 drain calls (_drain_active_signals, _drain_held_symbols, _drain_watchlist_bindings, _drain_source_weights) execute concurrently via asyncio.gather
    And the total Phase 0 wall-clock time is approximately max(individual drain times), not the sum

  @AC-7 @FR-5
  Scenario: Phase 1 uses BatchGetBars instead of per-symbol GetBars
    Given _compute_opportunities Phase 1 needs bars for 50 unique symbols
    When Phase 1 executes
    Then it calls BatchGetBars with all 50 symbols in a single RPC (or bounded chunked calls)
    And it does not call single-symbol GetBars for opportunity compute

  @AC-8 @FR-6
  Scenario: Live enrichment uses batch RPCs instead of per-symbol calls
    Given _enrich_opportunities_live is invoked with 30 unique symbols
    When enrichment executes
    Then it calls BatchGetLatestPrice once for all 30 symbols
    And it calls BatchGetBars once for all 30 symbols (sparkline)
    And it does not acquire _bars_fetch_sem per-symbol for enrichment

  @AC-9 @FR-7
  Scenario: Memo TTL aligns with browser poll interval
    Given the browser polls ListOpportunities every 15 seconds
    And analysis.opportunity.live_enrich_ttl_seconds is at its code default
    When a second poll arrives 15 seconds after the first
    Then the live enrichment memo is still valid (TTL >= 15s)
    And no re-fetch to marketdata occurs for the same symbols
