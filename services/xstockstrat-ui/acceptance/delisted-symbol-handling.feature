# Promoted from docs/roadmap/features/352-delisted-symbol-handling/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-352 added.
# Durable business rules xstockstrat-ui guarantees for marking flagged-delisted symbols on the /insights watchlists page.

Feature: xstockstrat-ui — delisted symbol handling
  The /insights watchlist page marks a flagged-delisted symbol with its reason and first-unservable date.

  @AC-15 @FR-10 @feature-352
  Scenario: The watchlist page marks a flagged symbol
    Given "ROKU" is flagged delisted with reason "UNSERVABLE_REASON_NOT_TRADABLE" and first-unservable date 2026-11-09 on the watchlist "Tech"
    When the owner opens "Tech" on the /insights watchlists page
    Then the "ROKU" row shows a delisted marker with the text "not an active, tradable US equity" and the date 2026-11-09
    And the "AAPL" row shows no delisted marker
