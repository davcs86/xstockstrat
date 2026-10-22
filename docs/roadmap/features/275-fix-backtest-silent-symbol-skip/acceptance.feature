Feature: fix-backtest-silent-symbol-skip (bug fix)
  Regression guard for docs/reports/2026-10-15-backtest-silent-symbol-skip-reports-ok-defect.md:
  a backtest whose symbols all fail with an RPC error or exception reports OK with no diagnostics.

  @AC-1 @regression
  Scenario: A symbol whose custom formula is refused by indicators is reported, and the run is not OK
    Given strategy "squeeze_breakout_trend" with a custom-formula component "31bb8ea6"
    And indicators ExecuteFormula for "31bb8ea6" fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    When RunBacktest is called for ["AAPL"] from 2026-01-01 to 2026-09-30
    Then the result has a diagnostics row for "AAPL" with a typed no_trade_reason other than NO_TRADE_REASON_UNSPECIFIED
    And the result warnings name "AAPL" and "PERMISSION_DENIED"
    And the status is BACKTEST_STATUS_INSUFFICIENT_DATA

  @AC-2 @regression
  Scenario: A symbol whose bar fetch fails with an RPC error is reported, and the run is not OK
    Given marketdata GetBars for "SCHD" fails with UNAVAILABLE
    When RunBacktest is called for ["SCHD"] from 2026-01-01 to 2026-09-30
    Then the result has a diagnostics row for "SCHD" with a typed no_trade_reason other than NO_TRADE_REASON_UNSPECIFIED
    And the result warnings name "SCHD" and "UNAVAILABLE"
    And the status is BACKTEST_STATUS_INSUFFICIENT_DATA

  @AC-3 @regression
  Scenario: A symbol that raises an unexpected exception is reported, and the run is not OK
    Given evaluating "AAPL" raises an unexpected ValueError
    When RunBacktest is called for ["AAPL"] from 2026-01-01 to 2026-09-30
    Then the result has a diagnostics row for "AAPL" with a typed no_trade_reason other than NO_TRADE_REASON_UNSPECIFIED
    And the result warnings name "AAPL"
    And the status is BACKTEST_STATUS_INSUFFICIENT_DATA

  @AC-4 @regression
  Scenario: A run in which no symbol was evaluated is not scored as a success
    Given indicators ExecuteFormula fails with PERMISSION_DENIED for every requested symbol
    When RunBacktest is called for ["AAPL", "SCHD"] from 2026-01-01 to 2026-09-30
    Then the run-history row records no score and an empty rating
    And no evidence cell is written for "AAPL" or "SCHD"

  @AC-5 @regression
  Scenario: A partial run stays OK and still reports the failed symbol
    Given "AAPL" evaluates normally and produces at least one trade
    And marketdata GetBars for "MSFT" fails with UNAVAILABLE
    When RunBacktest is called for ["AAPL", "MSFT"] from 2026-01-01 to 2026-09-30
    Then the status is BACKTEST_STATUS_OK
    And the result has a diagnostics row for "MSFT" with a typed no_trade_reason other than NO_TRADE_REASON_UNSPECIFIED
    And the result warnings name "MSFT" and "UNAVAILABLE"
