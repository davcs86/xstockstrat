# Promoted business-rule suite for xstockstrat-analysis (Constitution C-16). Promoted from feature 275's
# acceptance.feature at launch; @feature-275 marks provenance. These are the guarantees a future
# feature must not regress (recon reads this suite; the design-adversary enforces it).

Feature: Analysis backtest — a failed symbol is reported, never silently skipped
  Regression guard: a backtest whose symbols fail with an RPC error or exception must carry a typed
  diagnostics row and warnings, and must not be scored OK.

  @AC-1 @FR-3 @FR-4 @FR-7 @FR-8 @regression @feature-275
  Scenario: A symbol whose custom formula is refused by indicators to an admin is reported, and the run is not OK
    Given strategy "squeeze_breakout_trend" with a custom-formula component "31bb8ea6"
    And an admin-scoped caller runs the backtest
    And indicators ExecuteFormula for "31bb8ea6" fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    When RunBacktest is called for ["AAPL"] from 2026-01-01 to 2026-09-30
    Then the result has a diagnostics row for "AAPL" with no_trade_reason NO_TRADE_REASON_FORMULA_ERROR
    And no result warning contains the indicators error detail
    And the result warnings name "AAPL" and "PERMISSION_DENIED"
    And the status is BACKTEST_STATUS_INSUFFICIENT_DATA

  @AC-2 @FR-1 @FR-3 @FR-4 @FR-7 @regression @feature-275
  Scenario: A symbol whose bar fetch fails with an RPC error is reported, and the run is not OK
    Given marketdata GetBars for "SCHD" fails with gRPC status UNAVAILABLE (an RPC error, not a truncated series)
    When RunBacktest is called for ["SCHD"] from 2026-01-01 to 2026-09-30
    Then the result has a diagnostics row for "SCHD" with a typed no_trade_reason other than NO_TRADE_REASON_UNSPECIFIED
    And the result warnings name "SCHD" and "UNAVAILABLE"
    And the status is BACKTEST_STATUS_INSUFFICIENT_DATA

  @AC-6 @FR-7 @regression @feature-275
  Scenario: A truncated bar series still surfaces as FAILED_PRECONDITION, not as a diagnostics row
    Given feature 272 has landed, so _BarFetchError maps to FAILED_PRECONDITION
    And marketdata GetBars for "AAPL" returns a truncated bar series that feature 272 converts to _BarFetchError
    When RunBacktest is called for ["AAPL"] from 2026-01-01 to 2026-09-30
    Then RunBacktest fails with gRPC status FAILED_PRECONDITION
    And no diagnostics row is written for "AAPL" by the RPC/exception handling

  @AC-3 @FR-2 @FR-3 @FR-4 @regression @feature-275
  Scenario: A symbol that raises an unexpected exception is reported, and the run is not OK
    Given evaluating "AAPL" raises an unexpected ValueError
    When RunBacktest is called for ["AAPL"] from 2026-01-01 to 2026-09-30
    Then the result has a diagnostics row for "AAPL" with a typed no_trade_reason other than NO_TRADE_REASON_UNSPECIFIED
    And the result warnings name "AAPL"
    And the status is BACKTEST_STATUS_INSUFFICIENT_DATA

  @AC-4 @FR-4 @FR-5 @regression @feature-275
  Scenario: A run in which no symbol was evaluated is not scored as a success
    Given indicators ExecuteFormula fails with PERMISSION_DENIED for every requested symbol
    When RunBacktest is called for ["AAPL", "SCHD"] from 2026-01-01 to 2026-09-30
    Then the status is BACKTEST_STATUS_INSUFFICIENT_DATA
    And the run-history row records a null score (not 0) and an empty rating
    And no backtest detail row is written for the run
    And no evidence cell is written for "AAPL" or "SCHD"
    And the headline recompute is not run for the strategy

  @AC-5 @FR-1 @FR-3 @FR-6 @regression @feature-275
  Scenario: A partial run stays OK and still reports the failed symbol
    Given "AAPL" evaluates normally and produces at least one trade
    And marketdata GetBars for "MSFT" fails with UNAVAILABLE
    When RunBacktest is called for ["AAPL", "MSFT"] from 2026-01-01 to 2026-09-30
    Then the status is BACKTEST_STATUS_OK
    And the result has a diagnostics row for "MSFT" with a typed no_trade_reason other than NO_TRADE_REASON_UNSPECIFIED
    And the result warnings name "MSFT" and "UNAVAILABLE"

  @AC-7 @FR-3 @FR-4 @FR-8 @regression @feature-275
  Scenario: An owner run of a strategy whose formula the owner cannot read reports the same reason as an admin run
    Given strategy "squeeze_breakout_trend" with a custom-formula component "31bb8ea6" the owner cannot read
    And the strategy owner (not admin-scoped) runs the backtest
    And indicators ExecuteFormula for "31bb8ea6" fails with NOT_FOUND
    When RunBacktest is called for ["AAPL"] from 2026-01-01 to 2026-09-30
    Then the result has a diagnostics row for "AAPL" with no_trade_reason NO_TRADE_REASON_FORMULA_ERROR
    And the result warnings name "AAPL" and "NOT_FOUND"
    And the status is BACKTEST_STATUS_INSUFFICIENT_DATA

  # Promoted from docs/roadmap/features/289-fix-analysis-admin-formula-refusal/acceptance.feature
  # (Constitution C-16). Every @feature-289 scenario below assumes that feature's Background:
  #   Given admin user "admin-1" (x-access-scope admin) owns live strategies "s-1" and "s-2", both bound to symbol "MYSZ" (and "s-2" also to symbol "AAPL")
  #   And a component formula "f-9" of "s-1" is authored by user "user-2", while all components of "s-2" are readable by "admin-1"
  #   And the entry rule of "s-1" references "f-9"
  # "the unreadable-formula marker" is the bool formula_unreadable (Opportunity field 25, SymbolReadiness field 6; provenance token and readiness_json key "formula_unreadable").

  @AC-22 @FR-5 @FR-7 @regression @feature-289
  Scenario Outline: With the fundamentals gate on, a refused custom formula is a FORMULA_ERROR in the backtest, with or without an explicit start
    Given analysis.backtest.fundamentals.enabled is true and GetFormula and ExecuteFormula for "f-9" fail with NOT_FOUND for the owner
    When the owner runs a backtest of "s-1" over "AAPL" <start>
    Then the symbol is reported as a FORMULA_ERROR with the warning "backtest symbol AAPL not evaluated: NOT_FOUND" and no "rerun" warning
    And the run status is INSUFFICIENT_DATA

    Examples:
      | start                    |
      | without an explicit start |
      | with an explicit start    |

  @AC-5 @FR-5 @characterization @feature-289
  Scenario: The backtest mapping is unchanged
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED
    When "admin-1" runs a backtest of "s-1" over "MYSZ"
    Then the symbol is reported as a FORMULA_ERROR "not readable by owner" exactly as before feature 289
