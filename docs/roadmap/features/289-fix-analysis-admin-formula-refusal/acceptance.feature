Feature: fix-analysis-admin-formula-refusal (bug fix)
  Regression guard for defect report 2026-11-04-analysis-admin-formula-refusal-misclassified-defect: analysis treats indicators' admin-formula refusal as an outage / unhandled error.
  "the unreadable-formula marker" stands for whatever field /sdd-design chooses (a boolean or a reason enum).

  Background:
    Given admin user "admin-1" (x-access-scope admin) owns live strategies "s-1" and "s-2", both bound to symbol "MYSZ" (and "s-2" also to symbol "AAPL")
    And a component formula "f-9" of "s-1" is authored by user "user-2", while all components of "s-2" are readable by "admin-1"

  @AC-1 @FR-1 @FR-2 @regression
  Scenario: An unreadable component formula is flagged on the opportunity row, not reported as a data outage
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    When "admin-1" computes opportunities and then lists them with the default min_conviction
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker, is not data-unavailable, and is present in the list
    And the "s-2" row for "MYSZ" is evaluated normally and is not data-unavailable
    And no log line "indicator RPC failed for MYSZ" is written

  @AC-2 @FR-3 @regression
  Scenario: EvaluateReadiness degrades per symbol instead of aborting
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    When "admin-1" calls EvaluateReadiness for "MYSZ" with strategy "s-1"
    Then the RPC returns status OK with a result for "MYSZ" showing 0 of 0 conditions and the unreadable-formula marker
    And no ERROR "Unexpected [AioRpcError] raised by servicer method" is logged

  @AC-3 @FR-3 @regression
  Scenario: The cache-only watchlist readiness read serves a resolved unreadable entry
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED
    And the watchlist of "admin-1" holds "MYSZ" (bound to "s-1") and "AAPL" (bound to "s-2")
    And the background readiness refresh for "admin-1" has completed
    When GetWatchlistReadiness is called
    Then the "MYSZ" entry is RESOLVED with 0 of 0 conditions and the unreadable-formula marker, not UNKNOWN or PENDING
    And the "AAPL" entry is also RESOLVED (one unreadable symbol does not discard the batch)
    And no "readiness refresh kick failed" warning is logged

  @AC-8 @FR-3 @regression
  Scenario: The readiness materializer persists the unreadable verdict and continues (defense in depth)
    # The materializer's metadata is owner-only (no admin scope), so indicators does not normally answer PERMISSION_DENIED
    # there; this guards the stub-level behaviour should the scope ever propagate.
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED and the watchlist of "admin-1" holds "MYSZ" (bound to "s-1") and "AAPL" (bound to "s-2")
    When the readiness materializer runs for "admin-1"
    Then a readiness_cache row exists for (admin-1, s-1, entry, MYSZ) with 0 of 0 conditions, the unreadable-formula marker and bar_epoch >= 0
    And the pass continues so that the "AAPL" entry is also written

  @AC-9 @FR-3 @regression
  Scenario: The 300-second heal does not re-stamp an unreadable row as unavailable or retry it endlessly
    Given the "MYSZ" row for "s-1" is data-unavailable and older than 300 seconds
    And indicators now answers ExecuteFormula for "f-9" with PERMISSION_DENIED
    When a read triggers the surgical per-symbol heal
    Then the row now carries the unreadable-formula marker and is no longer data-unavailable
    And the readiness-cache entry staged by the heal carries the unreadable-formula marker
    And the row is not selected by the heal on the next read (no endless 300-second retry)

  @AC-4 @FR-4 @characterization
  Scenario: A genuine indicators outage still yields a data-unavailable row
    Given indicators ExecuteFormula for "f-9" fails with UNAVAILABLE
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" has data_unavailable true and no unreadable-formula marker

  @AC-5 @FR-5 @characterization
  Scenario: The backtest mapping is unchanged
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED
    When "admin-1" runs a backtest of "s-1" over "MYSZ"
    Then the symbol is reported as a FORMULA_ERROR "not readable by owner" exactly as before feature 289

  @AC-10 @FR-5 @characterization
  Scenario: A formula execution timeout still propagates
    Given indicators ExecuteFormula for a component of "s-2" times out after 5000ms
    When "admin-1" computes opportunities and calls EvaluateReadiness for "MYSZ" with strategy "s-2"
    Then the FormulaExecutionError "timed out after 5000ms" propagates exactly as before feature 289

  @AC-6 @FR-2
  Scenario: The agent exposes the unreadable-formula marker
    Given the "s-1" row for "MYSZ" carries the unreadable-formula marker
    When the agent tool list_opportunities is called as "admin-1"
    Then the returned "MYSZ" row for "s-1" carries the unreadable-formula marker

  @AC-7 @FR-2
  Scenario Outline: The UI shows a distinct state for an unreadable formula on every consuming surface
    Given the "s-1" row for "MYSZ" carries the unreadable-formula marker
    When "admin-1" opens <surface>
    Then "MYSZ" is shown in the "formula not readable by you" state, not the data-unavailable state and not a quiet 0 of N row

    Examples:
      | surface                                                   |
      | /insights/opportunities                                   |
      | /insights/watchlists (readiness panel)                    |
      | /trader/positions/MYSZ ("Why this fired" panel)           |
      | the mobile opportunity section                            |

  @AC-11 @FR-5 @characterization
  Scenario: The live loop handles the same refusal exactly as before
    Given the live loop evaluates "s-1" for "MYSZ" and indicators answers ExecuteFormula for "f-9" with PERMISSION_DENIED
    When the live-loop cycle runs
    Then the pair is isolated and logged as "live_loop: (s-1,MYSZ) error … — continuing" and the cycle proceeds, exactly as before feature 289

  @AC-12 @FR-4 @characterization
  Scenario: A data-unavailable row older than 300 seconds is still healed when indicators has recovered
    Given the "s-1" row for "MYSZ" is data-unavailable and older than 300 seconds
    And indicators now answers ExecuteFormula for "f-9" successfully
    When a read triggers the surgical per-symbol heal
    Then the row is restored to an evaluated state and is no longer data-unavailable, as before feature 289
