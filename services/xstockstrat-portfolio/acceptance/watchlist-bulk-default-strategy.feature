# Promoted from docs/roadmap/features/170-watchlist-bulk-default-strategy/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-170` tag.
# Durable business rules xstockstrat-portfolio guarantees for bulk watchlist binding operations
# (UpdateWatchlistBindings/RemoveWatchlistSymbols) and the default_strategy_id on watchlist create/add.

Feature: watchlist-bulk-default-strategy
  Portfolio-level guarantees for bulk-assign/remove watchlist operations and the watchlist
  default_strategy_id that is applied to bare symbols at add time.

  @AC-2 @FR-2 @feature-170
  Scenario: Bulk-assign one strategy across the selection atomically
    Given a watchlist "Momentum" with bindings AAPL→"", MSFT→"", NVDA→"swing"
    And the user has checked the rows for AAPL and MSFT
    When the user picks strategy "swing" and clicks "Apply strategy"
    Then UpdateWatchlistBindings is called once with symbols ["AAPL", "MSFT"] and strategy_id "swing"
    And after the call the bindings are AAPL→"swing", MSFT→"swing", NVDA→"swing"
    And the watchlist updated_at is bumped exactly once

  @AC-3 @FR-2 @feature-170
  Scenario: Bulk-assign the unbound sentinel clears strategy on the selection
    Given a watchlist "Momentum" with bindings AAPL→"swing", MSFT→"swing"
    And the user has checked the rows for AAPL and MSFT
    When the user picks "Unbound" and clicks "Apply strategy"
    Then UpdateWatchlistBindings is called once with symbols ["AAPL", "MSFT"] and strategy_id ""
    And after the call the bindings are AAPL→"", MSFT→""

  @AC-4 @FR-2 @feature-170
  Scenario: Bulk-assign rejects a symbol not in the watchlist without partial writes
    Given a watchlist "Momentum" with bindings AAPL→"", MSFT→""
    When UpdateWatchlistBindings is called with symbols ["AAPL", "GOOG"] and strategy_id "swing"
    Then the call returns an error (NOT_FOUND for GOOG)
    And no binding in the watchlist is changed (AAPL remains "")

  @AC-5 @FR-2 @feature-170
  Scenario: Bulk-assign is scoped to the owning user
    Given user U1 owns watchlist "Momentum" and user U2 does not
    When U2 calls UpdateWatchlistBindings for "Momentum" with symbols ["AAPL"] and strategy_id "swing"
    Then the call returns NOT_FOUND
    And U1's binding for AAPL is unchanged

  @AC-7 @FR-4 @feature-170
  Scenario: Adding a bare symbol binds it to the watchlist default at add time
    Given a watchlist "Momentum" with default_strategy_id "swing"
    When the user adds bare symbol AMD (no explicit strategy) via AddWatchlistSymbols
    Then the resulting binding is AMD→"swing"

  @AC-8 @FR-4 @feature-170
  Scenario: An explicit per-symbol strategy overrides the watchlist default at add time
    Given a watchlist "Momentum" with default_strategy_id "swing"
    When the user adds symbol AMD with an explicit binding strategy_id "breakout" via AddWatchlistSymbols
    Then the resulting binding is AMD→"breakout"

  @AC-9 @FR-4 @feature-170
  Scenario: Changing the default does not retroactively rebind existing symbols
    Given a watchlist "Momentum" with default_strategy_id "" and bindings AAPL→"", MSFT→"swing"
    When the user sets default_strategy_id to "breakout" via UpdateWatchlist
    Then the existing bindings are unchanged (AAPL→"", MSFT→"swing")
    And only symbols added after this point inherit "breakout" when added bare

  @AC-10 @FR-4 @feature-170
  Scenario: CreateWatchlist applies the default to initial bare symbols
    Given no watchlist named "Breakouts" exists
    When the user creates "Breakouts" with default_strategy_id "breakout" and bare symbols AAPL, MSFT
    Then the created watchlist has bindings AAPL→"breakout", MSFT→"breakout"
