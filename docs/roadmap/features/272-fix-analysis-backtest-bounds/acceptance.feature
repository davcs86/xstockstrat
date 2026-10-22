Feature: fix-analysis-backtest-bounds (bug fix)
  Regression guard for docs/reports/2026-10-21-analysis-backtest-bounds-defect.md:
  bar pagination returns a partial series on a re-served page; the backtest wall-clock key is never enforced.

  @AC-1 @FR-1 @regression
  Scenario: A re-served bar page is a loud failure, not a truncated series
    Given marketdata answers every GetBars for "AAPL" with bars at t=1 and t=2 and next_page_token "stuck"
    When analysis fetches the paged daily bars for "AAPL"
    Then a bar-fetch error "refusing to return a truncated series" is raised
    And no bar series is returned

  @AC-2 @FR-2 @regression
  Scenario: Genuine end of data still returns the full series
    Given marketdata answers the first GetBars for "AAPL" with bars at t=1 and t=2 and next_page_token "t1"
    And answers the request with page_token "t1" with bars at t=3 and an empty next_page_token
    When analysis fetches the paged daily bars for "AAPL"
    Then the returned bar times are 1, 2, 3

  @AC-4 @FR-1 @regression
  Scenario: An empty page on a token-bearing request is a loud failure, not end of data
    Given marketdata answers the first GetBars for "AAPL" with bars at t=1 and t=2 and next_page_token "t1"
    And answers the request with page_token "t1" with no bars and next_page_token "t1"
    When analysis fetches the paged daily bars for "AAPL"
    Then a bar-fetch error "refusing to return a truncated series" is raised
    And no bar series is returned

  @AC-3 @FR-3 @regression
  Scenario: RunBacktest enforces the backtest wall-clock limit
    Given analysis.backtest.max_duration_seconds is set to 1
    And a backtest whose evaluation takes 3 seconds
    When RunBacktest is called
    Then RunBacktest fails with DEADLINE_EXCEEDED within 2 seconds
    And the error message names the 1 second limit

  @AC-5 @FR-3 @regression
  Scenario: A stored 0 disables the backtest limit and a negative value falls back to 300 seconds
    Given analysis.backtest.max_duration_seconds is stored as 0
    And a backtest whose evaluation takes 2 seconds
    When RunBacktest is called
    Then RunBacktest returns a result with status BACKTEST_STATUS_OK
    When analysis.backtest.max_duration_seconds is stored as -5 and RunBacktest is called
    Then the run is bounded by 300 seconds
    And a WARN log names analysis.backtest.max_duration_seconds and the value -5

  @AC-6 @FR-1 @regression
  Scenario: A truncated bar series fails the backtest instead of dropping the symbol
    Given marketdata re-serves the bars for "AAPL" with next_page_token "stuck"
    When RunBacktest is called for "AAPL" and "MSFT"
    Then RunBacktest fails with FAILED_PRECONDITION and a message starting "backtest bar series incomplete:"
    And no evidence cell and no run-history row are written
    When the same re-served page is returned for the run's benchmark symbol "SPY"
    Then RunBacktest fails with FAILED_PRECONDITION and a message starting "backtest bar series incomplete:"

  @AC-7 @FR-2 @regression
  Scenario: An empty terminal page after a sent token is end of data
    Given marketdata answers the first GetBars for "AAPL" with bars at t=1 and t=2 and next_page_token "t1"
    And answers the request with page_token "t1" with no bars and an empty next_page_token
    When analysis fetches the paged daily bars for "AAPL"
    Then the returned bar times are 1, 2
