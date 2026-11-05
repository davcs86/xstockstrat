Feature: fix-analysis-live-loop-budget-seed (bug fix)
  Regression guard for defect report 2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.

  @AC-1 @FR-1 @regression
  Scenario: The live-loop budget key is registered in a freshly migrated environment
    Given a freshly migrated config registry for "staging" and for "production"
    When the analysis namespace keys are listed
    Then analysis.engine.max_strategies_per_cycle is present in each environment as an int with value 50
    And its default_value is 50, its description is non-empty and its consuming_service is "xstockstrat-analysis"

  @AC-2 @FR-5 @regression
  Scenario: A steady-state budget overflow is logged once per state change, not on every cycle
    Given the live fleet has 690 live pairs and the budget is 200
    When the live loop runs 10 consecutive cycles
    Then exactly 1 overflow WARN is emitted in total
    And each of the 10 cycles still emits the INFO line "live_loop: evaluated 200/690 pairs"
    And the truncation counter increases by 490 on each of the 10 cycles
    When the pair count drifts to 700 for 5 more cycles
    Then the cumulative overflow WARN count is still 1
    When the budget changes to 250 and the next cycle runs (still 700 pairs)
    Then the cumulative overflow WARN count is 2
    When a cycle runs with 240 live pairs (under budget) and then one with 690 pairs again
    Then the cumulative overflow WARN count is 3
    When a cycle runs with 0 live pairs and then one with 690 pairs again
    Then the cumulative overflow WARN count is 4

  @AC-3 @FR-2 @regression
  Scenario: The seed preserves a runtime-created value and backfills its metadata
    Given staging holds analysis.engine.max_strategies_per_cycle = 200 as an int created by SetConfig with create_key=true
    And that row has an empty description and an empty default_value
    When the seed migration is applied
    Then GetConfig for the key on staging returns 200
    And the key's description is non-empty and its default_value is 50
    And listing the analysis keys shows exactly one row for the key on staging
    And its value_type is still int

  @AC-4 @FR-2
  Scenario: Applying the seed migration twice leaves one row per environment
    Given the seed migration has been applied once
    When it is applied a second time
    Then there is exactly one row for the key in "staging" and exactly one in "production"
    And staging still holds 200 and production still holds 50

  @AC-5 @FR-3 @regression
  Scenario: SetConfig works for the registered key without create_key
    Given the key is registered
    When an admin calls SetConfig for analysis.engine.max_strategies_per_cycle with value 150 and create_key=false
    Then the call succeeds and GetConfig returns 150

  @AC-6 @FR-3
  Scenario: SetConfig bounds reject out-of-range values
    Given the key is registered with a minimum of 1
    When an admin calls SetConfig with value 0, and again with value -5
    Then both calls are refused with INVALID_ARGUMENT
    And SetConfig with value 401 is refused with INVALID_ARGUMENT (candidate maximum 400, final value per design)
    And SetConfig with value 1, with value 200 and with value 400 is accepted

  @AC-7 @FR-6
  Scenario: Rolling back the seed keeps an operator-set value
    Given staging holds the key at 200 and production holds the seeded 50
    And a per-user override of 75 exists for user "user-2" on staging
    When the down migration is applied
    Then the production row is removed
    And the staging global row with value 200 and the per-user override 75 remain

  @AC-8 @FR-4
  Scenario: The wiring check passes with the baseline entry removed
    Given the seed migration is declared
    When node scripts/check-config-wiring.mjs --declared-migration <the new migration file> is run
    Then it exits 0 and scripts/config-wiring.json contains no entry for analysis.engine.max_strategies_per_cycle

  @AC-9 @FR-2 @regression
  Scenario: The seed never overwrites operator-written metadata
    Given staging holds analysis.engine.max_strategies_per_cycle = 200 with description "Operator note" and default_value "75"
    When the seed migration is applied
    Then GetConfig for the key on staging returns 200
    And its description is still "Operator note" and its default_value is still 75
