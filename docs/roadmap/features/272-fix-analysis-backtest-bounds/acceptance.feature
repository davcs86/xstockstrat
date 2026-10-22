Feature: fix-analysis-backtest-bounds (bug fix)
  Regression guard for docs/reports/2026-10-21-analysis-backtest-bounds-defect.md:
  bar pagination returns a partial series on a re-served page; the backtest wall-clock key is never enforced.

  @AC-1 @regression
  Scenario: A re-served bar page is a loud failure, not a truncated series
    Given marketdata answers every GetBars for "AAPL" with bars at t=1 and t=2 and next_page_token "stuck"
    When analysis fetches the paged daily bars for "AAPL"
    Then a bar-fetch error "refusing to return a truncated series" is raised
    And no bar series is returned

  @AC-2 @regression
  Scenario: Genuine end of data still returns the full series
    Given marketdata answers the first GetBars for "AAPL" with bars at t=1 and t=2 and next_page_token "t1"
    And answers the request with page_token "t1" with bars at t=3 and an empty next_page_token
    When analysis fetches the paged daily bars for "AAPL"
    Then the returned bar times are 1, 2, 3

  @AC-3 @regression
  Scenario: The backtest wall-clock limit is either enforced or no longer advertised
    Given analysis.backtest.max_duration_seconds is set to 1
    And a backtest whose evaluation takes 3 seconds
    When RunBacktest is called
    Then either RunBacktest fails with DEADLINE_EXCEEDED within 2 seconds
    Or the key analysis.backtest.max_duration_seconds is no longer seeded by any config migration and is absent from the analysis CLAUDE.md key table
