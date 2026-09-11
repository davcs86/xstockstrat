# Promoted from docs/roadmap/features/170-watchlist-bulk-default-strategy/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-170` tag.
# Durable business rules xstockstrat-agent guarantees for the manage_watchlist and
# manage_watchlist_symbols tools' bulk and default-strategy behavior.

Feature: watchlist-bulk-default-strategy
  Agent tool guarantees for default_strategy_id round-trip and bulk strategy assignment.

  @AC-11 @FR-5 @feature-170
  Scenario: Agent manage_watchlist round-trips the default strategy
    Given the agent calls manage_watchlist update for watchlist "Momentum" with default_strategy_id "swing"
    When the agent then calls manage_watchlist get for "Momentum"
    Then the returned watchlist includes default_strategy_id "swing"

  @AC-12 @FR-5 @feature-170
  Scenario: Agent bulk-assigns a strategy across selected symbols
    Given a watchlist "Momentum" with bindings AAPL→"", MSFT→""
    When the agent bulk-assigns strategy "swing" to symbols ["AAPL", "MSFT"] via manage_watchlist_symbols
    Then the bindings become AAPL→"swing", MSFT→"swing" in a single atomic call
