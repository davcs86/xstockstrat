Feature: quote-fanout-batching
  As a user with a non-trivial position book or watchlist, I want quotes and bindings fetched in
  batches instead of one at a time, so portfolio and watchlist reads don't scale latency and
  marketdata load linearly with item count or concurrent users.

  @AC-1 @FR-1 @FR-4
  Scenario: Position enrichment uses one batched quote call
    Given a portfolio with 30 open positions
    When ListPositions enriches those positions with latest quotes
    Then exactly one GetLatestQuotes call is made for the 30 symbols
    And no per-position GetLatestQuote call is made
    And each position's enriched price equals the value the serial path produced

  @AC-2 @FR-2 @FR-4
  Scenario: Watchlist bindings resolve in one query
    Given a user with 40 watchlists totaling 300 symbol bindings
    When ListWatchlists loads them
    Then the symbol bindings are read with a single ANY-array (or JOIN) query, not 40 listBindings queries
    And each watchlist's returned symbols, sources, and strategy ids match the per-watchlist result

  @AC-3 @FR-3
  Scenario: Concurrent cold-symbol requests coalesce to one Alpaca fetch
    Given symbol ZZZZ has never been backfilled and is absent from cache
    When 5 requests for ZZZZ latest data arrive simultaneously
    Then exactly one upstream Alpaca fetch is issued for ZZZZ
    And all 5 requests receive that fetch's result

  @AC-4 @FR-4
  Scenario: A symbol with no quote maps to the same missing outcome under batching
    Given a portfolio containing symbol NOQUOTE for which marketdata returns no latest quote
    When ListPositions enriches via the batched call
    Then NOQUOTE resolves to the same missing/neutral price outcome the serial path produced
    And NOQUOTE is not silently assigned a zero price or zero P&L
