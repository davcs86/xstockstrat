Feature: Single-symbol Screening section handles score-unavailable rows (feature 245)
  Regression guard promoted from feature 245's acceptance scenarios.

  @AC-4 @FR-4 @regression @feature-245
  Scenario: The single-symbol Screening section shows "Not evaluated" for a score-unavailable row
    Given a trader opens /trader/positions/AAPL and AAPL is not on any watchlist, so the Screening section renders
    And ScreenSymbols returns one row for "AAPL" with status SCREEN_RESULT_STATUS_OK, passed false and score_unavailable true
    When the trader runs the screen
    Then the Screening section shows the "Not evaluated" notice
    And it shows neither the per-criterion results table nor the "Insufficient data" notice
