# Promoted business-rule suite for xstockstrat-portfolio.
# Populated by scenario PROMOTION (Constitution C-16); provenance on each scenario's @feature-N tag.
# Do not hand-author — rules enter only by promotion from a launched feature's acceptance.feature.

Feature: watchlist-single-strategy-update
  Single-row watchlist strategy rebind via UpdateWatchlistBinding — targeted, atomic to one row,
  never a full-list replace.

  @AC-1 @FR-1 @feature-167
  Scenario: Rebind one symbol's strategy via a targeted single-row RPC
    Given a watchlist "wl-1" owned by user "u-1" with bindings AAPL->"sma_cross", MSFT->"macd", TSLA->"rsi"
    When UpdateWatchlistBinding is called with watchlist_id "wl-1", symbol "MSFT", strategy_id "fundamentals_macd_blend"
    Then the MSFT binding's strategy_id is "fundamentals_macd_blend"
    And the AAPL and TSLA bindings are unchanged
    And no full-list replace of watchlist_symbols occurred (AAPL and TSLA rows were not rewritten)

  @AC-2 @FR-2 @feature-167
  Scenario: Rebind preserves the entry's per-binding source on a system-managed list
    Given a system-managed watchlist "wl-1" (system_managed true on the list) whose NVDA binding has strategy_id "macd" and source SIGNAL
    When UpdateWatchlistBinding is called with watchlist_id "wl-1", symbol "NVDA", strategy_id "sma_cross"
    Then the NVDA binding's strategy_id is "sma_cross"
    And the NVDA binding's source is still SIGNAL
    And the watchlist "wl-1" is still system_managed true (the list-level flag is untouched)

  @AC-3 @FR-3 @feature-167
  Scenario: Rebinding an absent symbol is rejected, not inserted
    Given a watchlist "wl-1" owned by user "u-1" with no binding for symbol "GOOG"
    When UpdateWatchlistBinding is called with watchlist_id "wl-1", symbol "GOOG", strategy_id "macd"
    Then the call fails with NOT_FOUND
    And no binding for "GOOG" is created in "wl-1"

  @AC-4 @FR-3 @feature-167
  Scenario: A non-owner cannot rebind another user's watchlist
    Given a watchlist "wl-1" owned by user "u-1"
    When UpdateWatchlistBinding is called with x-user-id "u-2", watchlist_id "wl-1", symbol "AAPL", strategy_id "macd"
    Then the call fails with NOT_FOUND or PERMISSION_DENIED
    And the AAPL binding in "wl-1" is unchanged

  @AC-5 @FR-4 @feature-167
  Scenario: Empty strategy_id unbinds only that row
    Given a watchlist "wl-1" with bindings AAPL->"sma_cross", MSFT->"macd"
    When UpdateWatchlistBinding is called with watchlist_id "wl-1", symbol "AAPL", strategy_id ""
    Then the AAPL binding's strategy_id is "" (unbound)
    And the MSFT binding's strategy_id is still "macd"
