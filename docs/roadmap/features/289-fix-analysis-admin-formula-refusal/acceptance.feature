Feature: fix-analysis-admin-formula-refusal (bug fix)
  # AC-11 is stub-level (the live loop keeps owner-only metadata and the old mapping). AC-8 is real: with owner-only metadata indicators answers NOT_FOUND, which now also yields the marker (AC-15).
  # @AC-14 retired 2026-11-05 — superseded by @AC-15 (context.md round-1 decision 1); ID not reused.
  Regression guard for defect report 2026-11-04-analysis-admin-formula-refusal-misclassified-defect: analysis treats indicators' admin-formula refusal as an outage / unhandled error.
  "the unreadable-formula marker" is the bool formula_unreadable (Opportunity field 25, SymbolReadiness field 6; provenance token and readiness_json key "formula_unreadable").

  Background:
    Given admin user "admin-1" (x-access-scope admin) owns live strategies "s-1" and "s-2", both bound to symbol "MYSZ" (and "s-2" also to symbol "AAPL")
    And a component formula "f-9" of "s-1" is authored by user "user-2", while all components of "s-2" are readable by "admin-1"
    And the entry rule of "s-1" references "f-9"

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
    Then the persisted readiness verdict for "MYSZ" under "s-1" is 0 of 0 conditions with the unreadable-formula marker and is served as fresh (not stale, not the data-unavailable sentinel)
    And the pass continues so that the "AAPL" entry is also written

  @AC-9 @FR-3 @regression
  Scenario: The 300-second heal does not re-stamp an unreadable row as unavailable or retry it endlessly
    Given the "MYSZ" row for "s-1" is data-unavailable and older than 300 seconds
    And the watchlist of "admin-1" holds "MYSZ" (bound to "s-1"), so its readiness verdict is also refreshed by the heal
    And indicators now answers ExecuteFormula for "f-9" with PERMISSION_DENIED
    When a read triggers the surgical per-symbol heal
    Then the row now carries the unreadable-formula marker and is no longer data-unavailable
    And the persisted watchlist readiness entry for "MYSZ" under "s-1" carries the unreadable-formula marker
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
  Scenario: A formula execution timeout still fails the opportunities recompute
    Given indicators ExecuteFormula for a component of "s-2" responds success=false with error "Formula execution timed out after 5000ms" (not an RPC deadline)
    When "admin-1" computes opportunities
    Then the recompute fails (warning "opportunity recompute failed"), and the previously stored rows are retained, exactly as before feature 289

  @AC-6 @FR-2
  Scenario: The agent exposes the unreadable-formula marker
    Given the "s-1" row for "MYSZ" carries the unreadable-formula marker
    When the agent tool list_opportunities is called as "admin-1"
    Then the returned "MYSZ" row for "s-1" carries the unreadable-formula marker

  @AC-7 @FR-2 @FR-3
  Scenario Outline: The UI shows a distinct state for an unreadable formula on every consuming surface
    Given <source> shows the "s-1" entry for "MYSZ" with the unreadable-formula marker
    When "admin-1" opens <surface>
    Then "MYSZ" is shown in the "formula not readable" state, not the data-unavailable state and not a quiet 0 of N row

    Examples:
      | surface                                          | source                                                   |
      | /insights/opportunities                          | the ListOpportunities row                                |
      | the mobile opportunity section                   | the ListOpportunities row                                |
      | /insights/watchlists (readiness panel)           | the GetWatchlistReadiness entry (0 of 0 conditions)      |
      | /trader/positions/MYSZ ("Why this fired" panel)  | the EvaluateReadiness result (0 of 0 conditions)         |

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

  @AC-13 @FR-5 @characterization
  Scenario: A formula execution timeout still aborts EvaluateReadiness
    Given indicators ExecuteFormula for a component of "s-2" responds success=false with error "Formula execution timed out after 5000ms" (not an RPC deadline)
    When "admin-1" calls EvaluateReadiness for "MYSZ" with strategy "s-2"
    Then the RPC fails with an unhandled-error status and ERROR "Unexpected [FormulaExecutionError]" is logged, as before feature 289, and the timeout is not converted into a 0 of 0 unreadable-formula result

  @AC-15 @FR-1 @FR-6 @regression
  Scenario: A NOT_FOUND refusal of a referenced formula also yields the marker
    Given indicators ExecuteFormula for "f-9" fails with NOT_FOUND
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker, is 0 of 0, and is not data-unavailable
    And exactly one log line "formula f-9 not readable by owner" is written

  @AC-16 @FR-6 @characterization
  Scenario: An unreferenced refused component is skipped as before
    Given indicators ExecuteFormula for "f-9" fails with NOT_FOUND and the entry rule of "s-1" does not reference "f-9"
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" is evaluated normally with that component skipped, carries no unreadable-formula marker and is not data-unavailable
    And exactly one log line "formula f-9 not readable by owner" is written

  @AC-17 @FR-2 @regression
  Scenario: A non-held unreadable row is non-actionable, floor-exempt and not a source
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED and "admin-1" holds no position in "MYSZ"
    When "admin-1" computes opportunities and lists them with min_conviction 0.9
    Then the "s-1" row for "MYSZ" has action UNSPECIFIED, conviction 0, signal axis 0 and a NULL composite, and is present in the list
    And its source is not "formula_unreadable" and "formula_unreadable" is not in available_sources

  @AC-18 @FR-2 @FR-6 @regression
  Scenario Outline: A held row keeps its signal action; an exit rule that references the refused formula never fabricates a REDUCE
    Given "admin-1" holds a position in "MYSZ" and the exit rule of "s-1" references "f-9"
    And indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED
    And the signal for "MYSZ" is <signal>
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker, is 0 of 0 and has conviction 0
    And its action is <action>, its signal axis is <axis> and its composite is <composite>

    Examples:
      | signal | action | axis                     | composite    |
      | sell   | REDUCE | greater than 0 (kept)    | signal-only  |
      | none   | ADD    | 0                        | NULL         |

  @AC-19 @FR-1 @FR-3 @regression
  Scenario: The daily refresh and the readiness materializer (owner-only metadata) persist the marker
    Given indicators answers ExecuteFormula for "f-9" with NOT_FOUND because the caller carries no admin scope
    When the daily opportunity refresh and the readiness materializer run for "admin-1"
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker
    And the readiness_cache entry for (admin-1, s-1, entry, MYSZ) is 0 of 0 with the marker and a bar_epoch >= 0

  @AC-20 @FR-3 @regression
  Scenario: A repeated EvaluateReadiness within the stale window still carries the marker
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED
    When "admin-1" calls EvaluateReadiness for "MYSZ" with strategy "s-1" twice within stale_after_seconds
    Then both results are OK, 0 of 0 with the unreadable-formula marker, and the second is served without calling indicators

  @AC-21 @FR-1 @FR-2 @regression
  Scenario: The marker round-trips storage and a sibling's outage does not flip the row
    Given the "s-1" row for "MYSZ" is computed with the unreadable-formula marker
    And a third live strategy "s-3" of "admin-1" bound to "MYSZ" shares the refused formula "f-9" while indicators is UNAVAILABLE for another component of "s-2" on "MYSZ"
    When "admin-1" lists opportunities
    Then the "s-1" and "s-3" rows for "MYSZ" carry the unreadable-formula marker and are not data-unavailable regardless of completion order
    And exactly one log line "formula f-9 not readable by owner" is written for the compute

  @AC-22 @FR-5 @FR-7 @regression
  Scenario Outline: With the fundamentals gate on, a refused custom formula is a FORMULA_ERROR in the backtest, with or without an explicit start
    Given analysis.backtest.fundamentals.enabled is true and GetFormula and ExecuteFormula for "f-9" fail with NOT_FOUND for the owner
    When the owner runs a backtest of "s-1" over "AAPL" <start>
    Then the symbol is reported as a FORMULA_ERROR with the warning "backtest symbol AAPL not evaluated: NOT_FOUND" and no "rerun" warning
    And the run status is INSUFFICIENT_DATA

    Examples:
      | start                    |
      | without an explicit start |
      | with an explicit start    |

  @AC-23 @FR-5 @FR-7 @regression
  Scenario: With the fundamentals gate on, a refused formula no longer blocks ScoreStrategy; an outage still does
    Given analysis.backtest.fundamentals.enabled is true and GetFormula for "f-9" fails with NOT_FOUND
    When ScoreStrategy is called for "s-1"
    Then it succeeds with the trailer x-score-excluded-symbols "[]"
    And with GetFormula failing UNAVAILABLE instead it aborts UNAVAILABLE "fundamentals availability unknown — grade unchanged"

  @AC-24 @FR-1 @FR-7 @regression
  Scenario Outline: With the fundamentals gate on, the opportunity compute and the heal yield the marker, not data-unavailable
    Given analysis.backtest.fundamentals.enabled is true and GetFormula and ExecuteFormula for "f-9" fail with NOT_FOUND for "admin-1"
    When <path>
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker and is not data-unavailable
    And the row is not selected by the heal on the next read

    Examples:
      | path                                          |
      | "admin-1" computes opportunities               |
      | a read triggers the surgical per-symbol heal   |

  @AC-25 @FR-4 @FR-7 @characterization
  Scenario: With the fundamentals gate on, a GetFormula outage is still data-unavailable
    Given analysis.backtest.fundamentals.enabled is true and GetFormula for "f-9" fails with UNAVAILABLE
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" has data_unavailable true, no unreadable-formula marker and its action kept

  @AC-26 @FR-3 @characterization
  Scenario: Once the formula becomes readable the next recompute evaluates the row normally
    Given the "s-1" row for "MYSZ" carries the unreadable-formula marker
    And indicators now answers ExecuteFormula for "f-9" successfully
    When the next opportunity recompute runs
    Then the "s-1" row for "MYSZ" is evaluated normally with no unreadable-formula marker

  @AC-27 @FR-2 @FR-3
  Scenario: A held unreadable row shows its action badge plus the cue
    Given the "s-1" row for "MYSZ" is held, carries the unreadable-formula marker and has action REDUCE
    When "admin-1" opens /insights/opportunities
    Then "MYSZ" shows the REDUCE badge and the "formula not readable" cue, not the data-unavailable state
