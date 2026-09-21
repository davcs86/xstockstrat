# Promoted from docs/roadmap/features/170-watchlist-bulk-default-strategy/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-170` tag.
# Durable business rules xstockstrat-ui guarantees for the bulk watchlist action bar, default-strategy
# control, and selection state management on the /insights/watchlists detail view.

Feature: watchlist-bulk-default-strategy
  UI-level guarantees for bulk-remove, default-strategy display, and selection clearing on the
  /insights/watchlists detail view.

  @AC-1 @FR-1 @feature-170
  Scenario: Bulk-remove selected symbols in one action
    Given a watchlist "Momentum" containing symbols AAPL, MSFT, NVDA, TSLA
    And the user has checked the rows for MSFT and TSLA in the detail view
    When the user clicks "Remove selected"
    Then RemoveWatchlistSymbols is called once with symbols ["MSFT", "TSLA"]
    And the detail view lists exactly AAPL and NVDA
    And the row selection is cleared

  @AC-6 @FR-3 @feature-170
  Scenario: Set and read a watchlist default strategy
    Given a watchlist "Momentum" with default_strategy_id ""
    When the user sets the default strategy to "swing" via UpdateWatchlist
    Then GetWatchlist returns the watchlist with default_strategy_id "swing"
    And the detail view's default-strategy control shows "swing"

  @AC-13 @FR-1 @feature-170
  Scenario: Switching the active watchlist clears any pending selection
    Given the user has checked two rows in watchlist "Momentum"
    When the user switches to watchlist "Breakouts"
    Then no rows are checked in "Breakouts"
    And the bulk action bar is hidden until a new selection is made
