# Promoted from docs/roadmap/features/178-quote-fanout-batching/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-178` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-portfolio — batched quote enrichment and watchlist binding reads
  Regression guard: portfolio read paths fetch quotes and watchlist bindings in batches rather than
  one item at a time, and a symbol with no quote keeps the same missing/neutral outcome the serial
  path produced (null-not-zero discipline).

  @AC-1 @FR-1 @FR-4 @feature-178
  Scenario: Position enrichment uses one batched quote call
    Given a portfolio with 30 open positions
    When ListPositions enriches those positions with latest quotes
    Then exactly one GetLatestQuotes call is made for the 30 symbols
    And no per-position GetLatestQuote call is made
    And each position's enriched price equals the value the serial path produced

  @AC-2 @FR-2 @FR-4 @feature-178
  Scenario: Watchlist bindings resolve in one query
    Given a user with 40 watchlists totaling 300 symbol bindings
    When ListWatchlists loads them
    Then the symbol bindings are read with a single ANY-array (or JOIN) query, not 40 listBindings queries
    And each watchlist's returned symbols, sources, and strategy ids match the per-watchlist result

  @AC-4 @FR-4 @feature-178
  Scenario: A symbol with no quote maps to the same missing outcome under batching
    Given a portfolio containing symbol NOQUOTE for which marketdata returns no latest quote
    When ListPositions enriches via the batched call
    Then NOQUOTE resolves to the same missing/neutral price outcome the serial path produced
    And NOQUOTE is not silently assigned a zero price or zero P&L
