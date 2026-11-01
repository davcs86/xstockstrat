Feature: Agent screen_symbols exposes score_unavailable (feature 245)
  Regression guard promoted from feature 245's acceptance scenarios.

  @AC-5 @FR-1 @regression @feature-245
  Scenario: The agent screen_symbols result carries score_unavailable on every row
    Given ScreenSymbols returns a row for "NVDA" with passed true and score_unavailable false
    And a row for "BAD" with status SCREEN_RESULT_STATUS_OK, passed false and score_unavailable true
    When the agent calls screen_symbols
    Then every result dict carries a boolean "score_unavailable"
    And the "BAD" result has "passed" false and "score_unavailable" true
