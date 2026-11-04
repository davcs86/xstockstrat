Feature: fix-analysis-admin-formula-refusal (bug fix)
  Regression guard for defect report 2026-11-04-analysis-admin-formula-refusal-misclassified-defect: analysis treats indicators' admin-formula refusal as an outage / unhandled error.

  Background:
    Given admin user "admin-1" (x-access-scope admin) owns live strategy "s-1" bound to symbol "MYSZ"
    And a component formula "f-9" of "s-1" is authored by user "user-2"

  @AC-1 @FR-1 @FR-2 @regression
  Scenario: An unreadable component formula is flagged on the opportunity row, not reported as a data outage
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    When "admin-1" computes opportunities
    Then the "MYSZ" row has formula_unreadable true and data_unavailable false
    And "MYSZ" is not added to fetch_failed and no log line "indicator RPC failed for MYSZ" is written

  @AC-2 @FR-3 @regression
  Scenario: EvaluateReadiness degrades per symbol instead of aborting
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    When "admin-1" calls EvaluateReadiness for "MYSZ" with strategy "s-1"
    Then the RPC returns status OK with a result for "MYSZ" showing 0 of 0 conditions and formula_unreadable true
    And no ERROR "Unexpected [AioRpcError] raised by servicer method" is logged

  @AC-3 @FR-3 @regression
  Scenario: The sibling readiness paths degrade the same way
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    And "MYSZ" is on a watchlist of "admin-1" bound to "s-1"
    When GetWatchlistReadiness is called and the readiness materializer runs for "admin-1"
    Then both return a "MYSZ" entry with formula_unreadable true and neither aborts or logs an ERROR

  @AC-4 @FR-4 @characterization
  Scenario: A genuine indicators outage still yields a data-unavailable row
    Given indicators ExecuteFormula for "f-9" fails with UNAVAILABLE
    When "admin-1" computes opportunities
    Then the "MYSZ" row has data_unavailable true and formula_unreadable false
    And a data-unavailable row older than 300 seconds is healed by the surgical retry as before

  @AC-5 @FR-5 @characterization
  Scenario: The backtest mapping and formula timeouts are unchanged
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED
    When "admin-1" runs a backtest of "s-1" over "MYSZ"
    Then the symbol is reported as a FORMULA_ERROR "not readable by owner" exactly as before feature 289
    And a FormulaExecutionError "timed out after 5000ms" still propagates out of opportunities and readiness as before

  @AC-6 @FR-2
  Scenario: The agent exposes the unreadable-formula marker
    Given the "MYSZ" row has formula_unreadable true
    When the agent tool list_opportunities is called as "admin-1"
    Then the returned "MYSZ" row carries formula_unreadable true

  @AC-7 @FR-2
  Scenario: The UI shows a distinct state for an unreadable formula
    Given the "MYSZ" row has formula_unreadable true
    When "admin-1" opens the /insights opportunities queue and the watchlist readiness panel
    Then "MYSZ" shows the "formula not readable by you" state, not the data-unavailable state and not a quiet 0 of N row
