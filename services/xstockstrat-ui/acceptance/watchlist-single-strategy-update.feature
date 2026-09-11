# Promoted business-rule suite for xstockstrat-ui.
# Populated by scenario PROMOTION (Constitution C-16); provenance on each scenario's @feature-N tag.
# Do not hand-author — rules enter only by promotion from a launched feature's acceptance.feature.

Feature: watchlist-single-strategy-update
  UI patches only the rebound watchlist row in its query cache — no whole-list invalidation or refetch.

  @AC-6 @FR-5 @feature-167
  Scenario: UI patches only the changed row without refetching the whole list
    Given the /insights/watchlists page has watchlist "wl-1" loaded with 200 symbols in the query cache
    When the trader changes symbol "MSFT" strategy to "fundamentals_macd_blend"
    Then a single UpdateWatchlistBinding request is sent for symbol "MSFT"
    And the ['watchlists'] query key is not invalidated and no listWatchlists refetch is issued
    And the rendered MSFT row shows "fundamentals_macd_blend" while the other 199 rows are untouched
