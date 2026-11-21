Feature: fix-listwatchlists-page-token (bug fix)
  Regression guard for defect report 2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect:
  ListWatchlists next_page_token skips the row at every page boundary.

  @AC-1 @FR-1 @FR-2 @regression
  Scenario: A page-by-page traversal of a user's watchlists returns every list exactly once
    Given user U owns three watchlists whose watchlist_id values sort a < b < c
    When U calls ListWatchlists with page_size 1 and an empty page_token
    And U keeps calling ListWatchlists with page_size 1 and the returned next_page_token until it is empty
    Then the pages return a, then b, then c, in that order
    And no watchlist is returned twice
    And the final page returns an empty next_page_token

  @AC-2 @FR-2 @regression
  Scenario: next_page_token identifies the last watchlist returned on the page
    Given user U owns three watchlists whose watchlist_id values sort a < b < c
    When U calls ListWatchlists with page_size 2 and an empty page_token
    Then the page returns a and b
    And next_page_token equals the watchlist_id of b
