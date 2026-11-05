# Promoted from docs/roadmap/features/178-quote-fanout-batching/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-178` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-portfolio — batched quote enrichment and watchlist binding reads
  Regression guard: portfolio read paths fetch quotes and watchlist bindings in batches rather than
  one item at a time, and a symbol with no quote keeps the same missing/neutral outcome the serial
  path produced (null-not-zero discipline).

  # Narrowed by feature 231 (@AC-1 @feature-231): a one-sided quote is priced from mark_price, never averaged with 0,
  # and by feature 240 for offline positions (see third clause).
  @AC-1 @FR-1 @FR-4 @feature-178
  Scenario: Position enrichment uses one batched quote call
    Given a portfolio with 30 open positions
    When ListPositions enriches those positions with latest quotes
    Then exactly one GetLatestQuotes call is made for the 30 symbols
    And no per-position GetLatestQuote call is made
    And each position whose quote is two-sided gets the same enriched price the serial path produced (feature 240, offline positions only: the quote must be from the reference session, an off-session read uses the reference session's daily close when it exists, and a quote from before the reference session is ignored)

  @AC-2 @FR-2 @FR-4 @feature-178
  Scenario: Watchlist bindings resolve in one query
    Given a user with 40 watchlists totaling 300 symbol bindings
    When ListWatchlists loads them
    Then the symbol bindings are read with a single ANY-array (or JOIN) query, not 40 listBindings queries
    And each watchlist's returned symbols, sources, and strategy ids match the per-watchlist result

  # Changed by feature 240 (C-16, operator sign-off 2026-10-19): for OFFLINE positions a missing quote
  # falls back to the last daily close; broker positions keep the serial-path outcome.
  @AC-4 @FR-4 @feature-178 @feature-240
  Scenario: A symbol with no quote maps to the last close (offline) or the same missing outcome (broker) under batching
    Given an offline portfolio containing symbol NOQUOTE for which marketdata returns no latest quote
    And the latest NOQUOTE daily bar closed at 12.34 within portfolio.marketdata.last_close_lookback_days
    When ListPositions enriches via the batched call
    Then NOQUOTE is returned with current_price 12.34 and mark_source MARK_SOURCE_LAST_CLOSE
    And NOQUOTE is not silently assigned a zero price or zero P&L
    And when no daily bar exists NOQUOTE is listed with current_price 0 and mark_source MARK_SOURCE_NONE
    And a broker-valued position with no quote keeps the same missing/neutral outcome the serial path produced
