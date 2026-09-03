Feature: watchlist-bulk-default-strategy
  As a trader curating an Insights watchlist, I want to multi-select symbols to remove or
  re-strategy them in one action and to set a default strategy for the watchlist, so that I
  can keep a large list's strategy bindings correct without repetitive per-row edits.

  @AC-1 @FR-1
  Scenario: Bulk-remove selected symbols in one action
    Given a watchlist "Momentum" containing symbols AAPL, MSFT, NVDA, TSLA
    And the user has checked the rows for MSFT and TSLA in the detail view
    When the user clicks "Remove selected"
    Then RemoveWatchlistSymbols is called once with symbols ["MSFT", "TSLA"]
    And the detail view lists exactly AAPL and NVDA
    And the row selection is cleared

  @AC-2 @FR-2
  Scenario: Bulk-assign one strategy across the selection atomically
    Given a watchlist "Momentum" with bindings AAPL→"", MSFT→"", NVDA→"swing"
    And the user has checked the rows for AAPL and MSFT
    When the user picks strategy "swing" and clicks "Apply strategy"
    Then UpdateWatchlistBindings is called once with symbols ["AAPL", "MSFT"] and strategy_id "swing"
    And after the call the bindings are AAPL→"swing", MSFT→"swing", NVDA→"swing"
    And the watchlist updated_at is bumped exactly once

  @AC-3 @FR-2
  Scenario: Bulk-assign the unbound sentinel clears strategy on the selection
    Given a watchlist "Momentum" with bindings AAPL→"swing", MSFT→"swing"
    And the user has checked the rows for AAPL and MSFT
    When the user picks "Unbound" and clicks "Apply strategy"
    Then UpdateWatchlistBindings is called once with symbols ["AAPL", "MSFT"] and strategy_id ""
    And after the call the bindings are AAPL→"", MSFT→""

  @AC-4 @FR-2
  Scenario: Bulk-assign rejects a symbol not in the watchlist without partial writes
    Given a watchlist "Momentum" with bindings AAPL→"", MSFT→""
    When UpdateWatchlistBindings is called with symbols ["AAPL", "GOOG"] and strategy_id "swing"
    Then the call returns an error (NOT_FOUND for GOOG)
    And no binding in the watchlist is changed (AAPL remains "")

  @AC-5 @FR-2
  Scenario: Bulk-assign is scoped to the owning user
    Given user U1 owns watchlist "Momentum" and user U2 does not
    When U2 calls UpdateWatchlistBindings for "Momentum" with symbols ["AAPL"] and strategy_id "swing"
    Then the call returns NOT_FOUND
    And U1's binding for AAPL is unchanged

  @AC-6 @FR-3
  Scenario: Set and read a watchlist default strategy
    Given a watchlist "Momentum" with default_strategy_id ""
    When the user sets the default strategy to "swing" via UpdateWatchlist
    Then GetWatchlist returns the watchlist with default_strategy_id "swing"
    And the detail view's default-strategy control shows "swing"

  @AC-7 @FR-4
  Scenario: Adding a bare symbol binds it to the watchlist default at add time
    Given a watchlist "Momentum" with default_strategy_id "swing"
    When the user adds bare symbol AMD (no explicit strategy) via AddWatchlistSymbols
    Then the resulting binding is AMD→"swing"

  @AC-8 @FR-4
  Scenario: An explicit per-symbol strategy overrides the watchlist default at add time
    Given a watchlist "Momentum" with default_strategy_id "swing"
    When the user adds symbol AMD with an explicit binding strategy_id "breakout" via AddWatchlistSymbols
    Then the resulting binding is AMD→"breakout"

  @AC-9 @FR-4
  Scenario: Changing the default does not retroactively rebind existing symbols
    Given a watchlist "Momentum" with default_strategy_id "" and bindings AAPL→"", MSFT→"swing"
    When the user sets default_strategy_id to "breakout" via UpdateWatchlist
    Then the existing bindings are unchanged (AAPL→"", MSFT→"swing")
    And only symbols added after this point inherit "breakout" when added bare

  @AC-10 @FR-4
  Scenario: CreateWatchlist applies the default to initial bare symbols
    Given no watchlist named "Breakouts" exists
    When the user creates "Breakouts" with default_strategy_id "breakout" and bare symbols AAPL, MSFT
    Then the created watchlist has bindings AAPL→"breakout", MSFT→"breakout"

  @AC-11 @FR-5
  Scenario: Agent manage_watchlist round-trips the default strategy
    Given the agent calls manage_watchlist update for watchlist "Momentum" with default_strategy_id "swing"
    When the agent then calls manage_watchlist get for "Momentum"
    Then the returned watchlist includes default_strategy_id "swing"

  @AC-12 @FR-5
  Scenario: Agent bulk-assigns a strategy across selected symbols
    Given a watchlist "Momentum" with bindings AAPL→"", MSFT→""
    When the agent bulk-assigns strategy "swing" to symbols ["AAPL", "MSFT"] via manage_watchlist_symbols
    Then the bindings become AAPL→"swing", MSFT→"swing" in a single atomic call

  @AC-13 @FR-1
  Scenario: Switching the active watchlist clears any pending selection
    Given the user has checked two rows in watchlist "Momentum"
    When the user switches to watchlist "Breakouts"
    Then no rows are checked in "Breakouts"
    And the bulk action bar is hidden until a new selection is made
